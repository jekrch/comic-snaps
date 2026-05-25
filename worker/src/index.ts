import type { Env, PanelEntry, TelegramUpdate } from "./types";
import { parseCaption, parseTags, slugify } from "./caption";
import { downloadFile, sendReply } from "./telegram";
import {
  addArtistTags,
  addSeriesTags,
  arrayBufferToBase64,
  commitFile,
  deletePanel,
  formatIssue,
  isUpdatableField,
  nextSeq,
  readGalleryJson,
  updateGalleryJson,
  updatePanel,
} from "./github";

const HELP_TEXT = `Comic Snaps Bot — Commands:

Add a panel:
  Post a photo with a caption in this format (notes and tags are optional):
  Title // Issue // Year // Artist // notes // tags

  Issue can be a number (1, 42) or text (VOL 1, Annual 2).

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
  /tag_artist Fiona Staples // canadian`;

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
        "Photo received but no caption found.\n\nExpected format:\nTitle // Issue // Year // Artist // notes // tags\n\nExample:\nSaga // 1 // 2012 // Fiona Staples // great spread // sci-fi, space opera"
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

      // 3. Download the largest resolution photo from Telegram
      const photo = message.photo[message.photo.length - 1];
      const imageBytes = await downloadFile(photo.file_id, env.TELEGRAM_BOT_TOKEN);

      // 4. Generate paths and IDs
      const timestamp = Math.floor(Date.now() / 1000);
      const slug = slugify(metadata.title);
      const issueSlug = slugify(String(metadata.issue));
      const filename = `issue-${issueSlug}-${timestamp}.jpg`;
      const repoImagePath = `public/images/${slug}/${filename}`;
      const browserImagePath = `images/${slug}/${filename}`;
      const id = `${slug}-${issueSlug}-${timestamp}`;

      // 5. Commit image file to GitHub
      const base64Image = arrayBufferToBase64(imageBytes);
      await commitFile(
        env,
        repoImagePath,
        base64Image,
        `Add panel: ${metadata.title} ${formatIssue(metadata.issue)}`
      );

      // 6. Assign sequential ID and append entry to gallery.json
      const { gallery } = await readGalleryJson(env);
      const seq = nextSeq(gallery);

      const entry: PanelEntry = {
        seq,
        id,
        title: metadata.title,
        slug,
        issue: metadata.issue,
        year: metadata.year,
        artist: metadata.artist,
        image: browserImagePath,
        notes: metadata.notes,
        tags: metadata.tags,
        postedBy,
        addedAt: new Date().toISOString(),
      };
      await updateGalleryJson(env, entry);

      // 7. Confirm via Telegram
      const notesLine = metadata.notes ? `\n  Notes: ${metadata.notes}` : "";
      const tagsLine = metadata.tags.length > 0 ? `\n  Tags: ${metadata.tags.join(", ")}` : "";
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        `Added to gallery (ID: ${seq}):\n  ${metadata.title} ${formatIssue(metadata.issue)} (${metadata.year})\n  Artist: ${metadata.artist}${notesLine}${tagsLine}\n  → ${browserImagePath}`
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
