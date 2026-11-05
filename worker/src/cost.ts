import type { Env } from "./types";
import { estimateCost, formatUsd, type Usage } from "./pricing";

// Per-day buckets are kept for ~95 days; per-month buckets for ~13 months.
const DAY_TTL_SECONDS = 95 * 86400;
const MONTH_TTL_SECONDS = 400 * 86400;

export interface CostBucket {
  usd: number;
  prompt: number;
  cached: number;
  output: number;
}

const emptyBucket = (): CostBucket => ({ usd: 0, prompt: 0, cached: 0, output: 0 });

const dayKey = (d: Date): string => `cost:day:${d.toISOString().slice(0, 10)}`;
const monthKey = (d: Date): string => `cost:month:${d.toISOString().slice(0, 7)}`;

async function bumpBucket(
  env: Env,
  key: string,
  ttlSeconds: number,
  usdDelta: number,
  usage: Usage
): Promise<void> {
  const raw = await env.BOT_STATE.get(key);
  const cur: CostBucket = raw ? JSON.parse(raw) : emptyBucket();
  cur.usd += usdDelta;
  cur.prompt += usage.prompt;
  cur.cached += usage.cached;
  cur.output += usage.output;
  await env.BOT_STATE.put(key, JSON.stringify(cur), { expirationTtl: ttlSeconds });
}

/**
 * Add a call to today's and this month's buckets. A no-op for an unpriced
 * model. Best-effort: callers catch and log, since a ledger write failing must
 * not lose the answer it was recording.
 */
export async function recordCost(env: Env, model: string, usage: Usage): Promise<void> {
  const usd = estimateCost(model, usage);
  if (usd === null) return;
  const now = new Date();
  await bumpBucket(env, dayKey(now), DAY_TTL_SECONDS, usd, usage);
  await bumpBucket(env, monthKey(now), MONTH_TTL_SECONDS, usd, usage);
}

export async function readCostTotals(
  env: Env
): Promise<{ day: CostBucket; month: CostBucket; dayLabel: string; monthLabel: string }> {
  const now = new Date();
  const [d, m] = await Promise.all([
    env.BOT_STATE.get(dayKey(now)),
    env.BOT_STATE.get(monthKey(now)),
  ]);
  return {
    day: d ? JSON.parse(d) : emptyBucket(),
    month: m ? JSON.parse(m) : emptyBucket(),
    dayLabel: now.toISOString().slice(0, 10),
    monthLabel: now.toISOString().slice(0, 7),
  };
}

function formatBucket(label: string, b: CostBucket): string {
  const tokens = `${b.prompt.toLocaleString()} in / ${b.output.toLocaleString()} out`;
  const cacheStr = b.cached > 0 ? ` [${b.cached.toLocaleString()} cached]` : "";
  return `  ${label}: ${formatUsd(b.usd)}  (${tokens})${cacheStr}`;
}

export function formatCostReport(totals: {
  day: CostBucket;
  month: CostBucket;
  dayLabel: string;
  monthLabel: string;
}): string {
  return [
    "Estimated Gemini spend (this bot):",
    formatBucket(`Today  (${totals.dayLabel})`, totals.day),
    formatBucket(`Month  (${totals.monthLabel})`, totals.month),
    "",
    "Estimate from token rates in pricing.ts. The Google invoice is authoritative.",
  ].join("\n");
}
