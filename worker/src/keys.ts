// Per-user agent state in BOT_STATE.

import type { ProposedCommand } from "./proposals";

/** Proposals from the last /ask or /resp turn, waiting on /confirm. */
export interface PendingDo {
  proposals: ProposedCommand[];
  createdAt: string;
}

/** A described photo, waiting on /confirm (or a /resp correction). */
export interface PendingPanel {
  /** Telegram file_id: stable for this bot, so the photo can be fetched again later. */
  fileId: string;
  postedBy: string;
  /** The description and every correction since, oldest first. */
  prompts: string[];
  /** The caption to post on /confirm; null until the model produced a usable one. */
  caption: string | null;
  createdAt: string;
}

export const PENDING_DO_KEY = (userId: number) => `pending:do:${userId}`;
export const PENDING_PANEL_KEY = (userId: number) => `pending:panel:${userId}`;
export const THREAD_KEY = (userId: number) => `thread:${userId}`;

export const PENDING_TTL_SECONDS = 3600;
export const THREAD_TTL_SECONDS = 7 * 86400;

/**
 * Count one use of `bucket` against a per-user daily cap. False once the cap
 * is reached. KV has no atomic increment, so two calls at the same instant can
 * both pass, which is fine for a cost guard in a small group.
 */
export async function checkDailyLimit(
  env: { BOT_STATE: KVNamespace },
  bucket: string,
  userId: number,
  limit: number
): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `ratelimit:${bucket}:${userId}:${today}`;
  const raw = await env.BOT_STATE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return false;
  await env.BOT_STATE.put(key, String(count + 1), { expirationTtl: 86400 });
  return true;
}
