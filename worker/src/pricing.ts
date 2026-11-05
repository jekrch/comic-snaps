// Model tiers and prices, kept in step with plantyJ's worker.

// /ask1 = flash-lite (cheap), /ask2 = flash (balanced), /ask3 = argon (best).
export const MODEL_ALIASES: Record<string, string> = {
  "1": "gemini-3.5-flash-lite",
  "2": "gemini-3.8-flash",
  "3": "gemini-4-argon",
};
// Bare /ask and /resp, and threads whose model has since been retired.
export const DEFAULT_MODEL_ALIAS = "3";
export const DEFAULT_MODEL = MODEL_ALIASES[DEFAULT_MODEL_ALIAS];
/** Turns a described photo into a caption: vision, a few lookups, one proposal. */
export const DESCRIBE_MODEL = MODEL_ALIASES["2"];

// Standard paid-tier USD per 1M tokens (verify at ai.google.dev/pricing).
//   i = uncached input, c = implicit-cache read, o = output (incl. thinking)
// Each model lists its price periods oldest-first; `from` is the UTC date a
// period takes effect, so announced price changes apply without a redeploy.
interface PricePeriod {
  from?: string;
  i: number;
  c: number;
  o: number;
}
const MODEL_PRICING: Record<string, PricePeriod[]> = {
  "gemini-4-argon": [
    { i: 2.0, c: 0.1, o: 10.0 },
    { from: "2026-12-01", i: 4.0, c: 0.2, o: 20.0 },
  ],
  "gemini-3.8-flash": [
    { i: 0.75, c: 0.075, o: 3.75 },
    { from: "2027-01-01", i: 1.5, c: 0.15, o: 7.5 },
  ],
  "gemini-3.5-flash-lite": [{ i: 0.3, c: 0.03, o: 2.5 }],
};

export interface Usage {
  prompt: number;
  /** Prompt tokens Gemini served from its implicit cache (a subset of prompt). */
  cached: number;
  output: number;
}

/** Estimated USD for a usage breakdown at the rates in effect on `at`, or null if unpriced. */
export function estimateCost(model: string, usage: Usage, at: Date = new Date()): number | null {
  const periods = MODEL_PRICING[model];
  if (!periods) return null;
  const day = at.toISOString().slice(0, 10);
  let p = periods[0];
  for (const period of periods) if (!period.from || period.from <= day) p = period;
  const uncached = usage.prompt - usage.cached;
  return (uncached * p.i + usage.cached * p.c + usage.output * p.o) / 1_000_000;
}

export function formatUsd(cost: number): string {
  return cost < 0.0001 ? "<$0.0001" : `$${cost.toFixed(4)}`;
}

/** `[$0.0123 | 1,200 cached, 15,000 in / 300 out]`, or "" for an unpriced model. */
export function formatCostLine(model: string, usage: Usage): string {
  const cost = estimateCost(model, usage);
  if (cost === null) return "";
  const cacheNote = usage.cached > 0 ? ` ${usage.cached.toLocaleString()} cached,` : "";
  return `[${formatUsd(cost)} |${cacheNote} ${usage.prompt.toLocaleString()} in / ${usage.output.toLocaleString()} out]`;
}
