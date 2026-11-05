import type { Env, TelegramMessage, TelegramUpdate } from "./types";
import { parseCaption } from "./caption";
import { makeReplier, type Replier } from "./telegram";
import {
  formatAggregate,
  invalidateSourceCache,
  parseRateArgs,
  resolveTarget,
  upsertRating,
  type RatingTarget,
  type UpsertResult,
} from "./ratings";
import { deletePanel, formatIssue } from "./github";
import { EDIT_VERBS, commandVerb, formatRun, parseEditCommand, runCommands } from "./edits";
import { ingestPanel } from "./ingest";
import { processJobBatch, type JobMessage } from "./jobs";
import { checkDailyLimit } from "./keys";
import { approveRestore, parseRestoreCommand, rejectRestore, startRestore } from "./restore";
import {
  handleAsk,
  handleCancel,
  handleConfirm,
  handleCost,
  handleDescribedPhoto,
  handleResp,
} from "./session";

const HELP_TEXT = `Comic Snaps Bot — Commands:

Add a panel:
  Post a photo with a caption in this format (artist, notes and tags are optional):
  Title // Issue // Year // Artist // notes // tags

  Issue can be a number (1, 42) or text (VOL 1, Annual 2).

  Leave the artist off and it's taken from the last panel posted for
  that series:
  Saga // 2 // 2012

  A title that matches an existing series by name or alias joins that
  series, whatever the casing.

  Tags accept prefixes:
    tag    → panel tag
    +tag   → series tag (applied to the matching series)
    ++tag  → artist tag (applied to the matching artist)

  Example:
  Saga // 1 // 2012 // Fiona Staples // great spread // sci-fi, +space opera, ++indie

  Or describe it instead, and the bot writes the caption for you to confirm:
  (photo) /ask Saga issue 4, Fiona Staples, the robot prince one

Commands:
  /delete {id} — Delete a panel by its numeric ID
  /update {id} {field} {value} — Update a field on a panel
  /tag_series {ref} // {tags} — Add tags to a series (ref = id or name)
  /tag_artist {ref} // {tags} — Add tags to an artist (ref = id, name, or alias)
  /rename_series {ref} // {new name} [// {start year}] — Rename a series
  /resolve metron:series // {name} // {metron id} — Pick a Metron match
  /describe_series {ref} (or /describe_artist {ref}), then the description
    on the following lines, then optionally "Sources:" and lines of
    "- {name} | {url}" — Replace a description and add its sources

Updatable fields: title, issue, year, artist, notes, tags
Setting title moves that panel to the series the title names.

/rename_series retitles every panel in the series, keeps the old name as
an alias, and clears the lookup markers so the metadata job searches
Metron and Comic Vine again under the new name. Use the name exactly as
Metron lists it, without the (year).

Examples:
  /delete 5
  /update 3 artist Fiona Staples
  /update 3 tags sci-fi, space opera
  /tag_series Saga // sci-fi, space opera
  /tag_artist Fiona Staples // canadian
  /rename_series thrillology // Thrillogy
  /rename_series 247 // Legion of Super-Heroes // 1989

Agent (for allowlisted users):
  /ask {question or request} — Ask about the gallery, or describe a change;
    it answers and proposes commands to run
  /resp {follow-up} — Continue the last /ask, or correct a described photo
  /confirm — Run all proposals (or post the described photo)
  /confirm 1 3 — Run only those proposals
  /cancel — Drop pending proposals and any described photo
  /cost — Model spend today and this month
  /ask1, /ask2, /ask3 (and /resp1-3) pick a cheaper or stronger model;
  bare /ask uses the strongest.

  Examples:
    /ask which series never matched Metron, and what should they be called?
    /ask tag every Hellboy panel with mignolaverse
    /ask write a new description for Paul Pope, focus on his manga work
    /ask rewrite the Saga description from https://example.com/saga-review

  Description requests are researched on the web: every sentence is
  checked against a quote from its source, and you see the draft and
  its sources before /confirm. Takes a minute or two.

Restorations (for allowlisted users):
  /restore {id} [directions] — Clean up a panel's photo: evens the light,
    takes out the lamp's color cast, and seats the blacks. The before/after
    comes back here in a few minutes; nothing changes on the site yet.
  /redo {id} {what to change} — Try again, told what was wrong
  /approve {id} — Put the restoration on the site
  /reject {id} — Drop it

  Examples:
    /restore 247
    /restore 247 the sky is painted yellow, keep it
    /redo 247 the face went purple, take less

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

const NO_CAPTION_HELP =
  "Photo received but no caption found.\n\nExpected format:\nTitle // Issue // Year // Artist // notes // tags\n\nExample:\nSaga // 1 // 2012 // Fiona Staples // great spread // sci-fi, space opera\n\nThe artist can be left off for a series already in the gallery:\nSaga // 2 // 2012\n\nOr caption it /ask with a description and the bot will write the caption.";

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


// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

type AgentAccess = "ok" | "not-allowed" | "no-secret";

/**
 * Whether this person may use the model-backed commands and restorations. Fails
 * closed: an unset ALLOWED_USER_IDS means nobody, since every call costs money.
 * So does an unset WEBHOOK_SECRET. The sender id is only as trustworthy as the
 * request it came in, and without the secret anyone can POST an update naming
 * an allowlisted id (they're public in wrangler.toml). The plain commands stay
 * open to the whole chat, as they always have been.
 */
function agentAccess(message: TelegramMessage, env: Env): AgentAccess {
  if (!env.WEBHOOK_SECRET) return "no-secret";
  const id = message.from?.id;
  if (id === undefined || !env.ALLOWED_USER_IDS) return "not-allowed";
  return env.ALLOWED_USER_IDS.split(",").some((s) => s.trim() === String(id))
    ? "ok"
    : "not-allowed";
}

const ACCESS_DENIED: Record<Exclude<AgentAccess, "ok">, string> = {
  "not-allowed": "The agent commands are only enabled for allowlisted users.",
  "no-secret":
    "The agent commands are off until the webhook has a secret (WEBHOOK_SECRET), since without one the sender can't be trusted.",
};
const AGENT_NOT_CONFIGURED = "The agent isn't configured yet (no GEMINI_API_KEY).";

const RESTORE_DAILY_LIMIT = 10;
const RESTORE_RATE_LIMITED = `Rate limit reached: ${RESTORE_DAILY_LIMIT} restorations per person per day.`;

// Constant-time comparison, so a wrong webhook secret can't be recovered byte
// by byte from response timing. The length check leaks only the length.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** `/ask2 rest` → { alias: "2", text: "rest" }; null when it isn't that verb. */
function matchAgentVerb(text: string, verb: "ask" | "resp"): { alias?: string; text: string } | null {
  const m = text.match(new RegExp(`^\\/${verb}([123])?(?:@\\w+)?(?:\\s+([\\s\\S]*))?$`, "i"));
  if (!m) return null;
  return { alias: m[1], text: (m[2] ?? "").trim() };
}

async function handleText(
  text: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier
): Promise<void> {
  if (/^\/(help|start)(?:@\w+)?$/i.test(text)) {
    await reply(HELP_TEXT);
    return;
  }

  const deleteMatch = text.match(/^\/delete(?:@\w+)?\s+(\d+)$/);
  if (deleteMatch) {
    const seq = parseInt(deleteMatch[1], 10);
    const removed = await deletePanel(env, seq);
    await invalidateSourceCache();
    await reply(
      removed
        ? `Deleted panel #${seq}: ${removed.title} ${formatIssue(removed.issue)}`
        : `No panel found with ID ${seq}.`
    );
    return;
  }

  const rateMatch = text.match(/^\/(rate|rate_series)(?:@\w+)?(?:\s+([\s\S]+))?$/);
  if (rateMatch) {
    const forceSeries = rateMatch[1] === "rate_series";
    await reply(await handleRateCommand(env, message, rateMatch[2] ?? "", forceSeries));
    return;
  }

  const verb = commandVerb(text);
  if ((EDIT_VERBS as readonly string[]).includes(verb)) {
    // A malformed command is answered without touching GitHub.
    const parsed = parseEditCommand(text);
    if (parsed && "error" in parsed) {
      await reply(parsed.error);
      return;
    }
    const result = await runCommands(env, [text]);
    if (result.commitSha) await invalidateSourceCache();
    await reply(formatRun(result));
    return;
  }

  const restore = parseRestoreCommand(text);
  if (restore) {
    const access = agentAccess(message, env);
    if (access !== "ok") await reply(ACCESS_DENIED[access]);
    else if ("error" in restore) await reply(restore.error);
    else if (restore.verb === "approve") {
      const result = await approveRestore(env, restore.seq);
      if (result.commitSha) await invalidateSourceCache();
      await reply(result.reply);
    } else if (restore.verb === "reject") {
      await reply(await rejectRestore(env, restore.seq));
    } else if (restore.verb === "restore" || restore.verb === "redo") {
      // Each run is up to half an hour of the strongest Gemini model, and runs
      // for different panels go in parallel.
      if (!(await checkDailyLimit(env, "restore", message.from!.id, RESTORE_DAILY_LIMIT))) {
        await reply(RESTORE_RATE_LIMITED);
      } else {
        await reply(
          await startRestore(env, restore, { chatId: message.chat.id, messageId: message.message_id })
        );
      }
    }
    return;
  }

  const ask = matchAgentVerb(text, "ask");
  const resp = matchAgentVerb(text, "resp");
  const confirm = text.match(/^\/confirm(?:@\w+)?(\s[\s\S]*)?$/i);
  const isAgent = ask || resp || confirm || /^\/(cancel|cost)(?:@\w+)?$/i.test(text);
  if (!isAgent) return; // unknown text: ignore

  const access = agentAccess(message, env);
  if (access !== "ok") {
    await reply(ACCESS_DENIED[access]);
    return;
  }
  if ((ask || resp) && !env.GEMINI_API_KEY) {
    await reply(AGENT_NOT_CONFIGURED);
    return;
  }
  if (ask) await handleAsk(ask, message, env, reply);
  else if (resp) await handleResp(resp, message, env, reply);
  else if (confirm) await handleConfirm(confirm[1] ?? "", message, env, reply);
  else if (/^\/cancel/i.test(text)) await handleCancel(message, env, reply);
  else await handleCost(env, reply);
}

async function handlePhoto(message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  const caption = message.caption?.trim();
  if (!caption) {
    await reply(NO_CAPTION_HELP);
    return;
  }

  const access = agentAccess(message, env);
  const canDescribe = access === "ok" && Boolean(env.GEMINI_API_KEY);
  const ask = matchAgentVerb(caption, "ask");
  if (ask) {
    if (access !== "ok") await reply(ACCESS_DENIED[access]);
    else if (!env.GEMINI_API_KEY) await reply(AGENT_NOT_CONFIGURED);
    else await handleDescribedPhoto(ask.text, message, env, reply);
    return;
  }

  try {
    parseCaption(caption);
  } catch (err) {
    if (!canDescribe) throw err;
    // Not the caption format: read it as a description instead.
    await reply("That isn't in the caption format, so I'm reading it as a description.");
    await handleDescribedPhoto(caption, message, env, reply);
    return;
  }

  const photo = message.photo![message.photo!.length - 1];
  const postedBy = message.from?.first_name || message.from?.username || "unknown";
  await reply(await ingestPanel(env, caption, photo.file_id, postedBy));
}

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const message = update.message;
  if (!message) return;
  // Silently ignore messages from other chats
  if (String(message.chat.id) !== env.TELEGRAM_ALLOWED_CHAT_ID) return;

  const reply = makeReplier(env, message);
  try {
    if (message.text) await handleText(message.text.trim(), message, env, reply);
    else if (message.photo) await handlePhoto(message, env, reply);
  } catch (err) {
    await reply(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    // Verify webhook secret (if configured)
    if (env.WEBHOOK_SECRET) {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
      if (!timingSafeEqual(secret, env.WEBHOOK_SECRET)) {
        return new Response("Unauthorized", { status: 403 });
      }
    }

    const update: TelegramUpdate = await request.json();
    // Ack straight away so Telegram doesn't time out and resend the update while
    // a model call or commit is still running; the work finishes in the
    // background.
    ctx.waitUntil(
      handleUpdate(update, env).catch((err) =>
        console.log(`handleUpdate failed: ${(err as Error).message}`)
      )
    );
    return new Response("OK");
  },

  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    await processJobBatch(batch, env);
  },
} satisfies ExportedHandler<Env, JobMessage>;
