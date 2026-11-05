// Handlers for the agent's conversational commands. Everything here reads or
// clears per-user state in BOT_STATE, and assumes the caller already checked
// that the user may use the model-backed commands.

import type { Env, TelegramMessage } from "./types";
import type { Replier } from "./telegram";
import type { Thread } from "./agent";
import { checkAskRateLimit, runOrEnqueue } from "./jobs";
import { ingestPanel } from "./ingest";
import { parseConfirmIndices } from "./proposals";
import { readCostTotals, formatCostReport } from "./cost";
import { DEFAULT_MODEL, DEFAULT_MODEL_ALIAS, MODEL_ALIASES } from "./pricing";
import {
  PENDING_DO_KEY,
  PENDING_PANEL_KEY,
  THREAD_KEY,
  type PendingDo,
  type PendingPanel,
} from "./keys";

const RATE_LIMITED = "Rate limit reached: 100 model calls per person per day.";

function postedByOf(message: TelegramMessage): string {
  return message.from?.first_name || message.from?.username || "unknown";
}

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const raw = await env.BOT_STATE.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

/** `/ask[1-3] {question}` */
export async function handleAsk(
  args: { alias?: string; text: string },
  message: TelegramMessage,
  env: Env,
  reply: Replier
): Promise<void> {
  const userId = message.from!.id;
  if (!args.text) {
    await reply(
      "Ask anything about the gallery, or describe a change:\n  /ask which series never matched Metron?\n  /ask fix the name of Thrillology so Metron finds it"
    );
    return;
  }
  if (!(await checkAskRateLimit(userId, env))) {
    await reply(RATE_LIMITED);
    return;
  }
  const status = await runOrEnqueue(env, {
    id: `ask-${userId}-${message.message_id}`,
    kind: "ask",
    chatId: message.chat.id,
    messageId: message.message_id,
    userId,
    request: args.text,
    model: MODEL_ALIASES[args.alias ?? DEFAULT_MODEL_ALIAS],
    createdAt: new Date().toISOString(),
  });
  if (status === "queued") await reply("Taking a moment. The reply will arrive shortly.");
}

/** A photo captioned `/ask {description}`, or with a caption that didn't parse. */
export async function handleDescribedPhoto(
  description: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier
): Promise<void> {
  const userId = message.from!.id;
  if (!description) {
    await reply(
      "Describe the panel after /ask, e.g.\n/ask Saga issue 4, Fiona Staples, the one with the robot prince"
    );
    return;
  }
  if (!(await checkAskRateLimit(userId, env))) {
    await reply(RATE_LIMITED);
    return;
  }
  const photo = message.photo![message.photo!.length - 1];
  const status = await runOrEnqueue(env, {
    id: `describe-${userId}-${message.message_id}`,
    kind: "describe",
    chatId: message.chat.id,
    messageId: message.message_id,
    userId,
    fileId: photo.file_id,
    postedBy: postedByOf(message),
    prompts: [description],
    priorCaption: null,
    createdAt: new Date().toISOString(),
  });
  if (status === "queued") await reply("Working out the caption. It will arrive shortly.");
}

/** `/resp[1-3] {follow-up}`: continue whichever conversation is most recent. */
export async function handleResp(
  args: { alias?: string; text: string },
  message: TelegramMessage,
  env: Env,
  reply: Replier
): Promise<void> {
  const userId = message.from!.id;
  if (!args.text) {
    await reply("Add the follow-up after /resp.");
    return;
  }
  const [panel, thread] = await Promise.all([
    readJson<PendingPanel>(env, PENDING_PANEL_KEY(userId)),
    readJson<Thread>(env, THREAD_KEY(userId)),
  ]);
  if (!panel && !thread) {
    await reply("Nothing to follow up on. Start with /ask, or a photo captioned /ask {description}.");
    return;
  }
  if (!(await checkAskRateLimit(userId, env))) {
    await reply(RATE_LIMITED);
    return;
  }

  // A described photo is pending only for an hour and is the narrower context,
  // so it wins unless an /ask thread has moved on since.
  if (panel && (!thread || panel.createdAt >= thread.updatedAt)) {
    const status = await runOrEnqueue(env, {
      id: `describe-resp-${userId}-${message.message_id}`,
      kind: "describe",
      chatId: message.chat.id,
      messageId: message.message_id,
      userId,
      fileId: panel.fileId,
      postedBy: panel.postedBy,
      prompts: [...panel.prompts, args.text],
      priorCaption: panel.caption,
      createdAt: new Date().toISOString(),
    });
    if (status === "queued") await reply("Revising. The new caption will arrive shortly.");
    return;
  }

  // Threads outlive model upgrades; one that names a retired model continues
  // on the default.
  const model = args.alias
    ? MODEL_ALIASES[args.alias]
    : Object.values(MODEL_ALIASES).includes(thread!.model)
      ? thread!.model
      : DEFAULT_MODEL;
  const status = await runOrEnqueue(env, {
    id: `resp-${userId}-${message.message_id}`,
    kind: "ask",
    chatId: message.chat.id,
    messageId: message.message_id,
    userId,
    request: args.text,
    model,
    history: thread!.history,
    createdAt: new Date().toISOString(),
  });
  if (status === "queued") await reply("Taking a moment. The reply will arrive shortly.");
}

/** `/confirm [n …]`: run the most recent pending thing. */
export async function handleConfirm(
  args: string,
  message: TelegramMessage,
  env: Env,
  reply: Replier
): Promise<void> {
  const userId = message.from!.id;
  const [panel, pending] = await Promise.all([
    readJson<PendingPanel>(env, PENDING_PANEL_KEY(userId)),
    readJson<PendingDo>(env, PENDING_DO_KEY(userId)),
  ]);

  if (panel && (!pending || panel.createdAt >= pending.createdAt)) {
    if (!panel.caption) {
      await reply("There's no caption to post yet. Reply /resp with what was missing, or /cancel.");
      return;
    }
    // Posted through the same path as a typed caption. The pending entry is
    // dropped only once that succeeds, so a failure can be fixed with /resp.
    const result = await ingestPanel(env, panel.caption, panel.fileId, panel.postedBy);
    await env.BOT_STATE.delete(PENDING_PANEL_KEY(userId)).catch(() => {});
    await reply(result);
    return;
  }

  if (!pending) {
    await reply("Nothing to confirm. Start with /ask {request}, or a photo captioned /ask {description}.");
    return;
  }
  const sel = parseConfirmIndices(args, pending.proposals.length);
  if (sel === "invalid") {
    await reply(
      `Invalid selection. Use /confirm (all) or /confirm N [N ...] with numbers 1..${pending.proposals.length}.`
    );
    return;
  }
  const indices = sel === "all" ? pending.proposals.map((_, i) => i + 1) : sel;
  const commands = indices.map((n) => pending.proposals[n - 1].command);
  await env.BOT_STATE.delete(PENDING_DO_KEY(userId)).catch(() => {});
  const status = await runOrEnqueue(env, {
    id: `confirm-${userId}-${message.message_id}`,
    kind: "confirm",
    chatId: message.chat.id,
    messageId: message.message_id,
    userId,
    commands,
    createdAt: new Date().toISOString(),
  });
  if (status === "queued") {
    await reply(`Queued ${commands.length} command(s). The summary will arrive when they've run.`);
  }
}

/** `/cancel`: drop pending proposals and any described photo. The /ask thread stays. */
export async function handleCancel(message: TelegramMessage, env: Env, reply: Replier): Promise<void> {
  const userId = message.from!.id;
  await Promise.all([
    env.BOT_STATE.delete(PENDING_DO_KEY(userId)).catch(() => {}),
    env.BOT_STATE.delete(PENDING_PANEL_KEY(userId)).catch(() => {}),
  ]);
  await reply("Cancelled. Nothing was run.");
}

export async function handleCost(env: Env, reply: Replier): Promise<void> {
  await reply(formatCostReport(await readCostTotals(env)));
}
