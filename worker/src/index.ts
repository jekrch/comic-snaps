import type { Env, PanelEntry, TelegramMessage, TelegramUpdate } from "./types";
import { parseCaption, parseTags, slugify } from "./caption";
import { downloadFile, sendReply } from "./telegram";
import {
  formatAggregate,
  invalidateSourceCache,
  parseRateArgs,
  resolveTarget,
  upsertRating,
  type RatingTarget,
  type UpsertResult,
} from "./ratings";
import {
  addArtistTags,
  addSeriesTags,
  arrayBufferToBase64,
  commitFile,
  deletePanel,
  formatIssue,
  isUpdatableField,
  lastArtistForSlug,
  nextSeq,
  readGalleryJson,
  updateGalleryJson,
  updatePanel,
} from "./github";

const HELP_TEXT = `Comic Snaps Bot — Commands:

Add a panel:
  Post a photo with a caption in this format (artist, notes and tags are optional):
  Title // Issue // Year // Artist // notes // tags

  Issue can be a number (1, 42) or text (VOL 1, Annual 2).

  Leave the artist off and it's taken from the last panel posted for
  that series:
  Saga // 2 // 2012

  Tags accept prefixes:
    tag    → panel tag
    +tag   → series tag (applied to the matching series)
    ++tag  → artist tag (applied to the matching artist)

  Example:
  Saga // 1 // 2012 // Fiona Staples // great spread // sci-fi, +space opera, ++indie

Commands:
  /delete {id} — Delete a panel by its numeric ID
  /update {id} {field} {value} — Update a field on a panel
  /tag_series {ref} // {tags} — Add tags to a series (ref = id or name)
  /tag_artist {ref} // {tags} — Add tags to an artist (ref = id, name, or alias)

Updatable fields: title, issue, year, artist, notes, tags

Examples:
  /delete 5
  /update 3 artist Fiona Staples
  /update 3 tags sci-fi, space opera
  /tag_series Saga // sci-fi, space opera
  /tag_artist Fiona Staples // canadian

Ratings (1-10):
  /rate {ref} {score} — Rate the issue a reference points at
  /rate {ref} {score} // {review} — Same, with a review
  /rate_series {ref} {score} — Rate the whole series instead
  /rate {ref} {score} --me — Sign it with your name (--us undoes it)

  A {ref} can be a panel ID, a series name, or a series plus an issue:
    /rate 247 8                    the issue panel #247 came from
    /rate Saga #4 8                by series and issue
    /rate Saga 4 8                 same
    /rate Saga 9                   the series itself
    /rate Hellboy #Annual 2 7      non-numeric issues need the #
    panel:247 / series:saga / issue:saga-4 force the reading

  Scores and reviews are independent — a score alone leaves your review
  alone, and a review alone leaves your score alone. Re-run /rate to change
  your mind.

  Ratings are published on the site as the group's — "our rating" — with
  no name attached. Add --me to sign one with your Telegram first name;
  --us hands it back to the group and drops the name again.`;

/**
 * Handle `/tag_series` and `/tag_artist`. Argument form: `ref // tag1, tag2, ...`
 * Tags may carry `+`/`++` prefixes but the prefix is stripped — the target type
 * is determined by the command, not the prefix.
 */
async function handleTagCommand(
  env: Env,
  argument: string,
  type: "series" | "artist"
): Promise<string> {
  const sepIdx = argument.indexOf("//");
  if (sepIdx === -1) {
    return `Expected format:\n/tag_${type} {ref} // tag1, tag2`;
  }

  const ref = argument.slice(0, sepIdx).trim();
  const rawTags = argument.slice(sepIdx + 2).trim();

  if (!ref) return `Missing ${type} reference.`;
  if (!rawTags) return `No tags provided.`;

  const buckets = parseTags(rawTags);
  const tags = [...buckets.tags, ...buckets.seriesTags, ...buckets.artistTags];
  if (tags.length === 0) return `No tags provided.`;

  const result =
    type === "series"
      ? await addSeriesTags(env, ref, tags)
      : await addArtistTags(env, ref, tags);

  if (!result.entry) {
    return `No ${type} found matching "${ref}".`;
  }
  if (result.addedTags.length === 0) {
    return `${result.entry.name}: all tags already present.\n  Tags: ${result.allTags.join(", ")}`;
  }
  return `Tagged ${type} ${result.entry.name}:\n  Added: ${result.addedTags.join(", ")}\n  Tags: ${result.allTags.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

function raterName(from?: { first_name?: string; username?: string }): string {
  return from?.first_name || from?.username || "someone";
}

/**
 * `Issue avg 8.0 from 2 · Series avg 8.5 from 4` — §1.7. Issue and series
 * averages are quoted side by side and never blended: one person's series score
 * shouldn't outweigh a stack of issue scores (§8).
 */
function aggregateLine(target: RatingTarget, result: UpsertResult): string {
  if (target.type === "series") {
    return `  Series avg ${formatAggregate(result.target)}`;
  }
  return `  Issue avg ${formatAggregate(result.target)} · Series avg ${formatAggregate(result.series)}`;
}

/**
 * What the message a command replied to was about. The bot's own cards carry
 * their panel id in the text ("ID: 247"), and a human's photo carries the
 * caption the panel was created from — so a reply resolves without keeping a
 * chat-message map anywhere.
 */
async function targetOfRepliedMessage(
  env: Env,
  message: TelegramMessage
): Promise<RatingTarget | null> {
  const replied = message.reply_to_message;
  if (!replied) return null;

  const fromCard = replied.text?.match(/\(ID:\s*(\d+)\)/);
  if (fromCard) {
    const resolved = await resolveTarget(env, `panel:${fromCard[1]}`);
    return resolved.ok ? resolved.target : null;
  }

  if (replied.caption) {
    try {
      const meta = parseCaption(replied.caption);
      const resolved = await resolveTarget(env, `${meta.title} #${meta.issue}`);
      return resolved.ok ? resolved.target : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * `/rate` and `/rate_series`. Both take the same references (§1.6) — the only
 * difference is that `/rate_series` forces every one of them onto the series.
 */
async function handleRateCommand(
  env: Env,
  message: TelegramMessage,
  argument: string,
  forceSeries: boolean
): Promise<string> {
  const command = forceSeries ? "/rate_series" : "/rate";

  const args = parseRateArgs(argument);
  if (!args.ok) return args.message;

  const replyTarget = await targetOfRepliedMessage(env, message);

  const resolved = await resolveTarget(env, args.ref, { forceSeries, replyTarget });
  if (!resolved.ok) {
    const suggestions = resolved.candidates.length
      ? `\n\nDid you mean: ${resolved.candidates.map((c) => c.label).join(", ")}`
      : "";
    return `${resolved.message}${suggestions}`;
  }

  const target = resolved.target;
  if (args.score === null && args.review === null) {
    return `Found ${target.label}, but no score.\n\nTry: ${command} ${args.ref || target.label} 8`;
  }

  const user = { id: message.from?.id ?? 0, name: raterName(message.from) };
  return upsertAndDescribe(env, target, user, args.score, args.review, args.attributed);
}

async function upsertAndDescribe(
  env: Env,
  target: RatingTarget,
  user: { id: number; name: string },
  score: number | null,
  review: string | null,
  attributed: boolean | null
): Promise<string> {
  const result = await upsertRating(env, target, user, score, review, attributed);
  const { previous, current } = result;

  const lines: string[] = [];
  if (score !== null) {
    const was =
      previous?.score != null && previous.score !== score ? ` (was ${previous.score})` : "";
    lines.push(`${user.name} rated ${target.label} → ${score}${was}`);
  } else {
    lines.push(`${user.name} reviewed ${target.label}`);
  }

  lines.push(aggregateLine(target, result));

  if (review !== null) {
    const rewritten = previous?.review != null;
    lines.push(`  Review ${rewritten ? "rewritten" : "saved"} (${current.review?.length ?? 0} chars)`);
  }

  // The chat always knows who spoke; the site doesn't, unless it was signed.
  lines.push(
    result.attributed
      ? `  Published as ${user.name}'s — --us makes it the group's`
      : "  Published as our rating — add --me to sign it"
  );

  return lines.join("\n");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    // Verify webhook secret (if configured)
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 403 });
    }

    const update: TelegramUpdate = await request.json();

    const message = update.message;

    if (!message) {
      return new Response("OK");
    }

    // Silently ignore messages from other chats
    if (String(message.chat.id) !== env.TELEGRAM_ALLOWED_CHAT_ID) {
      return new Response("OK");
    }

    // Handle text commands
    if (message.text) {
      const text = message.text.trim();

      try {
        if (text === "/help" || text === "/start") {
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            HELP_TEXT
          );
          return new Response("OK");
        }

        const deleteMatch = text.match(/^\/delete\s+(\d+)$/);
        if (deleteMatch) {
          const seq = parseInt(deleteMatch[1], 10);
          const removed = await deletePanel(env, seq);
          await invalidateSourceCache();
          if (!removed) {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `No panel found with ID ${seq}.`
            );
          } else {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `Deleted panel #${seq}: ${removed.title} ${formatIssue(removed.issue)}`
            );
          }
          return new Response("OK");
        }

        const rateMatch = text.match(/^\/(rate|rate_series)(?:@\w+)?(?:\s+([\s\S]+))?$/);
        if (rateMatch) {
          const forceSeries = rateMatch[1] === "rate_series";
          const reply = await handleRateCommand(
            env,
            message,
            rateMatch[2] ?? "",
            forceSeries
          );
          await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, reply);
          return new Response("OK");
        }

        const tagSeriesMatch = text.match(/^\/tag_series\s+([\s\S]+)$/);
        if (tagSeriesMatch) {
          const reply = await handleTagCommand(env, tagSeriesMatch[1], "series");
          await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, reply);
          return new Response("OK");
        }

        const tagArtistMatch = text.match(/^\/tag_artist\s+([\s\S]+)$/);
        if (tagArtistMatch) {
          const reply = await handleTagCommand(env, tagArtistMatch[1], "artist");
          await sendReply(env.TELEGRAM_BOT_TOKEN, message.chat.id, message.message_id, reply);
          return new Response("OK");
        }

        const updateMatch = text.match(/^\/update\s+(\d+)\s+(\S+)\s+([\s\S]+)$/);
        if (updateMatch) {
          const seq = parseInt(updateMatch[1], 10);
          const field = updateMatch[2];
          const value = updateMatch[3].trim();

          if (!isUpdatableField(field)) {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `Invalid field "${field}". Updatable fields: title, issue, year, artist, notes, tags`
            );
            return new Response("OK");
          }

          const updated = await updatePanel(env, seq, field, value);
          await invalidateSourceCache();
          if (!updated) {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `No panel found with ID ${seq}.`
            );
          } else {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `Updated panel #${seq}: set ${field} to "${value}"\n→ ${updated.title} ${formatIssue(updated.issue)}`
            );
          }
          return new Response("OK");
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        await sendReply(
          env.TELEGRAM_BOT_TOKEN,
          message.chat.id,
          message.message_id,
          `Error: ${errorMessage}`
        );
        return new Response("OK");
      }

      // Unknown text — ignore
      return new Response("OK");
    }

    // Photo without caption → remind the sender of the expected format
    if (message.photo && !message.caption) {
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        "Photo received but no caption found.\n\nExpected format:\nTitle // Issue // Year // Artist // notes // tags\n\nExample:\nSaga // 1 // 2012 // Fiona Staples // great spread // sci-fi, space opera\n\nThe artist can be left off for a series already in the gallery:\nSaga // 2 // 2012"
      );
      return new Response("OK");
    }

    // Ignore anything that isn't a photo with a caption
    if (!message.photo || !message.caption) {
      return new Response("OK");
    }

    try {
      // 1. Parse caption
      const metadata = parseCaption(message.caption);

      // 2. Extract poster info
      const postedBy =
        message.from?.first_name || message.from?.username || "unknown";

      // 3. Generate paths and IDs
      const timestamp = Math.floor(Date.now() / 1000);
      const slug = slugify(metadata.title);
      const issueSlug = slugify(String(metadata.issue));
      const filename = `issue-${issueSlug}-${timestamp}.jpg`;
      const repoImagePath = `public/images/${slug}/${filename}`;
      const browserImagePath = `images/${slug}/${filename}`;
      const id = `${slug}-${issueSlug}-${timestamp}`;

      // 4. Read the gallery up front — a caption with no artist inherits the
      //    one from the series' most recent panel, and that has to resolve
      //    before anything is committed.
      const { gallery } = await readGalleryJson(env);
      const seq = nextSeq(gallery);

      let artist = metadata.artist;
      let inheritedArtist = false;
      if (!artist) {
        artist = lastArtistForSlug(gallery, slug);
        if (!artist) {
          throw new Error(
            `No artist given and "${metadata.title}" isn't in the gallery yet.\n\nInclude the artist:\n${metadata.title} // ${metadata.issue} // ${metadata.year} // Artist Name`
          );
        }
        inheritedArtist = true;
      }

      // 5. Download the largest resolution photo from Telegram
      const photo = message.photo[message.photo.length - 1];
      const imageBytes = await downloadFile(photo.file_id, env.TELEGRAM_BOT_TOKEN);

      // 6. Commit image file to GitHub
      const base64Image = arrayBufferToBase64(imageBytes);
      await commitFile(
        env,
        repoImagePath,
        base64Image,
        `Add panel: ${metadata.title} ${formatIssue(metadata.issue)}`
      );

      // 7. Append entry to gallery.json
      const entry: PanelEntry = {
        seq,
        id,
        title: metadata.title,
        slug,
        issue: metadata.issue,
        year: metadata.year,
        artist,
        image: browserImagePath,
        notes: metadata.notes,
        tags: metadata.tags,
        postedBy,
        addedAt: new Date().toISOString(),
      };
      await updateGalleryJson(env, entry);
      await invalidateSourceCache();

      // 8. Confirm via Telegram
      const artistLine = `\n  Artist: ${artist}${inheritedArtist ? " (from last post in series)" : ""}`;
      const notesLine = metadata.notes ? `\n  Notes: ${metadata.notes}` : "";
      const tagsLine = metadata.tags.length > 0 ? `\n  Tags: ${metadata.tags.join(", ")}` : "";
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        `Added to gallery (ID: ${seq}):\n  ${metadata.title} ${formatIssue(metadata.issue)} (${metadata.year})${artistLine}${notesLine}${tagsLine}\n  → ${browserImagePath}`
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        `Error: ${errorMessage}`
      );
    }

    return new Response("OK");
  },
};
