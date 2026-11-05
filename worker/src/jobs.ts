// Work that can outlive the webhook: model calls (/ask, /resp, described
// photos) and /confirm runs. Ported from plantyJ's worker.
//
// A job first runs inline for INLINE_TIMEOUT_MS; past that it moves to the JOBS
// queue, whose consumer runs one job per invocation (max_batch_size = 1 in
// wrangler.toml) with a fresh time and subrequest budget, one at a time
// (max_concurrency = 1) so /confirm runs never race each other's commits.
//
// Delivery is at-least-once, so every message that reaches a final outcome is
// marked finished in KV and a redelivery of it is acked without running again.
// Queue messages cap at 128 KB, so a job that won't fit (a long /resp thread)
// is parked in KV and the message carries a pointer to it.

import type { Content } from "@google/genai";
import type { Env } from "./types";
import { sendReply, downloadFile } from "./telegram";
import { answerQuestion, describePanel } from "./agent";
import { arrayBufferToBase64 } from "./github";
import { formatRun, runCommands } from "./edits";
import { invalidateSourceCache } from "./ratings";
import {
  PENDING_DO_KEY,
  PENDING_PANEL_KEY,
  PENDING_TTL_SECONDS,
  THREAD_KEY,
  THREAD_TTL_SECONDS,
  checkDailyLimit,
  type PendingPanel,
} from "./keys";

const JOB_PREFIX = "job:";
const DONE_PREFIX = "jobdone:";
const MAX_INLINE_JOB_BYTES = 100_000;
// Outlives the queue's retention, so a parked job and its finished marker both
// outlast any redelivery of their message.
const JOB_TTL = 2 * 86400;
// KV reads in another location can trail a write by up to ~60s, so a parked
// job that isn't visible yet is re-sent after this delay, a couple of times.
const REF_MISS_DELAY_SECONDS = 90;
const MAX_REF_MISSES = 2;
const DONE = "done";
// The only retry budget. wrangler.toml's max_retries must be at least this
// (jobs.test.ts checks), so a job whose attempts all died without throwing
// still gets one more delivery, which only reports the failure.
export const MAX_ATTEMPTS = 2;
const RETRY_DELAY_SECONDS = 30;
// Sized against the ~30s waitUntil window: 10s for the model leaves room to
// enqueue and reply if it runs long.
const INLINE_TIMEOUT_MS = 10_000;

const ASK_DAILY_LIMIT = 100;

/** Per-user daily cap shared by every model-backed entry point. */
export function checkAskRateLimit(userId: number, env: Env): Promise<boolean> {
  return checkDailyLimit(env, "ask", userId, ASK_DAILY_LIMIT);
}

type JobKind = "ask" | "describe" | "confirm";

export interface JobRecord {
  id: string;
  kind: JobKind;
  chatId: number;
  messageId: number;
  userId: number;
  createdAt: string;
  // ask
  request?: string;
  model?: string;
  history?: Content[];
  // describe
  fileId?: string;
  postedBy?: string;
  prompts?: string[];
  priorCaption?: string | null;
  // confirm
  commands?: string[];
}

interface JobOwner {
  kind: JobKind;
  chatId: number;
  messageId: number;
}

/** Body of a JOBS queue message: the job itself, or a pointer to it in KV. */
export type JobMessage =
  | { job: JobRecord }
  | (JobOwner & { ref: string; misses?: number });

async function sendJobMessage(env: Env, body: JobMessage, delaySeconds?: number): Promise<void> {
  await env.JOBS.send(body, { contentType: "json", delaySeconds });
}

export async function enqueueJob(env: Env, job: JobRecord): Promise<void> {
  const body = JSON.stringify(job);
  if (new TextEncoder().encode(body).byteLength <= MAX_INLINE_JOB_BYTES) {
    await sendJobMessage(env, { job });
    return;
  }
  const ref = `${job.id}:${crypto.randomUUID()}`;
  await env.BOT_STATE.put(`${JOB_PREFIX}${ref}`, body, { expirationTtl: JOB_TTL });
  await sendJobMessage(env, { ref, kind: job.kind, chatId: job.chatId, messageId: job.messageId });
}

/**
 * Run a job on the webhook path, falling back to the queue if it takes longer
 * than INLINE_TIMEOUT_MS or fails. On "inline" the reply is already sent.
 *
 * A timed-out inline run is abandoned rather than awaited, and can't act on its
 * result: runJob claims the job before its first side effect, and the claim
 * fails once the job is abandoned. A job already claimed when the timer fires
 * is finished here instead of being queued.
 */
export async function runOrEnqueue(env: Env, job: JobRecord): Promise<"inline" | "queued"> {
  const TIMEOUT = Symbol("timeout");
  const run = { phase: "running" as "running" | "claimed" | "abandoned" };
  const claim = () => {
    if (run.phase === "abandoned") throw new Error("abandoned after the inline timeout");
    run.phase = "claimed";
  };
  const work = runJob(env, job, claim).then(
    () => ({ ok: true as const }),
    (err: unknown) => ({ ok: false as const, err })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), INLINE_TIMEOUT_MS);
  });

  let winner = await Promise.race([work, timeout]);
  if (timer) clearTimeout(timer);

  if (winner === TIMEOUT) {
    if (run.phase === "running") {
      run.phase = "abandoned";
      await enqueueJob(env, job);
      return "queued";
    }
    winner = await work;
  }
  if (!winner.ok) {
    console.log(`[runOrEnqueue] inline failed, falling back to queue: ${String(winner.err)}`);
    await enqueueJob(env, job);
    return "queued";
  }
  return "inline";
}

function formatProposals(reply: string, proposals: { command: string; rationale: string }[]): string {
  if (proposals.length === 0) return reply;
  return [
    reply,
    "",
    "Proposed commands:",
    proposals.map((p, i) => `  ${i + 1}. ${p.command}\n     ${p.rationale}`).join("\n"),
    "",
    "Reply /confirm to run all, /confirm 1 3 to run a subset, or /cancel to drop.",
  ].join("\n");
}

// `claim` is called before the job's first side effect and throws if the run
// has been abandoned (see runOrEnqueue). Queue runs never abandon.
async function runJob(env: Env, job: JobRecord, claim: () => void = () => {}): Promise<void> {
  const reply = (text: string) =>
    sendReply(env.TELEGRAM_BOT_TOKEN, job.chatId, job.messageId, text);

  if (job.kind === "ask") {
    const result = await answerQuestion(env, job.request ?? "", job.model, job.history ?? []);
    claim();
    // Each turn's proposals replace the last turn's, an empty list included: a
    // follow-up that changes course mustn't leave the old ones for /confirm.
    if (result.proposals.length > 0) {
      await env.BOT_STATE.put(
        PENDING_DO_KEY(job.userId),
        JSON.stringify({ proposals: result.proposals, createdAt: new Date().toISOString() }),
        { expirationTtl: PENDING_TTL_SECONDS }
      );
    } else {
      await env.BOT_STATE.delete(PENDING_DO_KEY(job.userId));
    }
    await env.BOT_STATE.put(THREAD_KEY(job.userId), JSON.stringify(result.thread), {
      expirationTtl: THREAD_TTL_SECONDS,
    });
    await reply(formatProposals(result.reply, result.proposals));
    return;
  }

  if (job.kind === "describe") {
    const bytes = await downloadFile(job.fileId ?? "", env.TELEGRAM_BOT_TOKEN);
    const prompts = job.prompts ?? [];
    const { body, proposal } = await describePanel(
      env,
      arrayBufferToBase64(bytes),
      prompts,
      job.priorCaption ?? null
    );
    claim();
    // Kept even without a proposal, so /resp can add what was missing without
    // the photo being sent again.
    const pending: PendingPanel = {
      fileId: job.fileId ?? "",
      postedBy: job.postedBy ?? "unknown",
      prompts,
      caption: proposal?.caption ?? null,
      createdAt: new Date().toISOString(),
    };
    await env.BOT_STATE.put(PENDING_PANEL_KEY(job.userId), JSON.stringify(pending), {
      expirationTtl: PENDING_TTL_SECONDS,
    });
    await reply(body);
    return;
  }

  // confirm: every selected command, one commit.
  claim();
  const result = await runCommands(env, job.commands ?? []);
  if (result.commitSha) await invalidateSourceCache().catch(() => {});
  // Committed: a throw from here would retry the message and apply it again,
  // so a failed summary is only logged.
  await reply(formatRun(result)).catch((err) =>
    console.log(`[jobs] ${job.id} summary reply failed: ${String(err)}`)
  );
}

export async function processJobBatch(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) await processJobMessage(msg, env);
}

async function notifyFailed(env: Env, owner: JobOwner, reason: string): Promise<void> {
  await sendReply(
    env.TELEGRAM_BOT_TOKEN,
    owner.chatId,
    owner.messageId,
    `Sorry, that ${owner.kind === "confirm" ? "/confirm" : "request"} failed: ${reason}`
  ).catch(() => {});
}

function finishedKey(body: JobMessage): string {
  return "job" in body ? `${DONE_PREFIX}${body.job.id}` : `${JOB_PREFIX}${body.ref}`;
}

async function markFinished(env: Env, key: string): Promise<void> {
  await env.BOT_STATE.put(key, DONE, { expirationTtl: JOB_TTL }).catch((err) => {
    console.log(`[jobs] failed to mark ${key} finished: ${String(err)}`);
  });
}

async function processJobMessage(msg: Message<JobMessage>, env: Env): Promise<void> {
  const body = msg.body;
  const owner: JobOwner = "job" in body ? body.job : body;
  const doneKey = finishedKey(body);

  let job: JobRecord;
  const raw = await env.BOT_STATE.get(doneKey);
  if ("job" in body) {
    if (raw !== null) {
      msg.ack(); // duplicate delivery of a finished job
      return;
    }
    job = body.job;
  } else {
    if (raw === DONE) {
      msg.ack();
      return;
    }
    if (raw === null) {
      // Usually KV lag behind the enqueue in another location. A fresh message
      // (not msg.retry) so the wait doesn't spend the job's attempts.
      const misses = (body.misses ?? 0) + 1;
      if (misses <= MAX_REF_MISSES) {
        await sendJobMessage(env, { ...body, misses }, REF_MISS_DELAY_SECONDS);
      } else {
        await notifyFailed(env, owner, "the queued job could not be loaded.");
      }
      msg.ack();
      return;
    }
    job = JSON.parse(raw);
  }

  // Every earlier delivery died without reaching the catch below (CPU or memory
  // limit, eviction). Report it rather than run the job again.
  if (msg.attempts > MAX_ATTEMPTS) {
    await notifyFailed(env, owner, `it was interrupted ${MAX_ATTEMPTS} times.`);
    await markFinished(env, doneKey);
    msg.ack();
    return;
  }

  try {
    await runJob(env, job);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.log(`[jobs] ${job.id} attempt ${msg.attempts}/${MAX_ATTEMPTS} failed: ${message}`);
    if (msg.attempts < MAX_ATTEMPTS) {
      msg.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      return;
    }
    await notifyFailed(env, owner, `${message} (after ${MAX_ATTEMPTS} attempts)`);
  }
  await markFinished(env, doneKey);
  msg.ack();
}
