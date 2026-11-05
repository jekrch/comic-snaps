// Pure checks on what the model hands back. It proposes; nothing it says
// reaches the repo until it parses as a real command (or caption) here and a
// person confirms it.

import type { PanelMetadata } from "./types";
import { parseCaption } from "./caption";
import { EDIT_VERBS, commandVerb, parseEditCommand } from "./edits";

export interface ProposedCommand {
  command: string;
  rationale: string;
}

export interface SanitizedProposals {
  accepted: ProposedCommand[];
  /** Commands dropped, with why, so the model can be told and try again. */
  rejected: { command: string; reason: string }[];
}

/**
 * Keep the proposals that are well-formed edit commands, deduplicated, in
 * order. Anything else (another verb, a malformed command, a non-object) is
 * dropped and reported.
 */
export function sanitizeProposals(raw: unknown): SanitizedProposals {
  const accepted: ProposedCommand[] = [];
  const rejected: { command: string; reason: string }[] = [];
  if (!Array.isArray(raw)) return { accepted, rejected };
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { command?: unknown; rationale?: unknown };
    const command = typeof r.command === "string" ? r.command.trim().replace(/\s*\n\s*/g, " ") : "";
    const rationale = typeof r.rationale === "string" ? r.rationale.trim() : "";
    if (!command) continue;
    if (!(EDIT_VERBS as readonly string[]).includes(commandVerb(command))) {
      rejected.push({ command, reason: `not an allowed verb (${EDIT_VERBS.join(", ")})` });
      continue;
    }
    const parsed = parseEditCommand(command);
    if (parsed === null || "error" in parsed) {
      rejected.push({ command, reason: parsed ? parsed.error.split("\n")[0] : "unparseable" });
      continue;
    }
    if (seen.has(command)) continue;
    seen.add(command);
    accepted.push({ command, rationale: rationale || "(no rationale)" });
  }
  return { accepted, rejected };
}

/** `/confirm` → all; `/confirm 1 3` or `/confirm 1,3` → those; anything else → invalid. */
export function parseConfirmIndices(args: string, max: number): number[] | "all" | "invalid" {
  const rest = args.trim();
  if (rest === "") return "all";
  const out: number[] = [];
  for (const t of rest.split(/[\s,]+/).filter(Boolean)) {
    const n = parseInt(t, 10);
    if (isNaN(n) || String(n) !== t || n < 1 || n > max) return "invalid";
    if (!out.includes(n)) out.push(n);
  }
  return out.length === 0 ? "invalid" : out;
}

export interface PanelFields {
  title?: unknown;
  issue?: unknown;
  year?: unknown;
  artist?: unknown;
  notes?: unknown;
  tags?: unknown;
}

function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  // `//` is the caption's separator and a newline would end it, so neither may
  // survive inside a field.
  return String(value).replace(/\/\/+/g, "/").replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * Build the canonical `Title // Issue // Year // Artist // notes // tags`
 * caption from structured fields, and prove it by parsing it back. The model
 * never writes the `//` string itself, so a stray separator in its notes can't
 * shift every field after it.
 */
export function buildPanelCaption(
  f: PanelFields
): { caption: string; metadata: PanelMetadata } | { error: string } {
  const title = field(f.title);
  const issue = field(f.issue).replace(/^#\s*/, "");
  const year = field(f.year);
  const artist = field(f.artist);
  const notes = field(f.notes);
  const tags = (Array.isArray(f.tags) ? f.tags : [])
    .map((t) => field(t).replace(/,/g, " ").replace(/^\++/, "").trim())
    .filter(Boolean);

  if (!title) return { error: "no series title" };
  if (!issue) return { error: "no issue" };
  if (!/^\d{4}$/.test(year)) return { error: `year "${year}" isn't a four-digit year` };

  const parts = [title, issue, year, artist, notes, tags.join(", ")];
  while (parts.length > 3 && parts[parts.length - 1] === "") parts.pop();
  const caption = parts.join(" // ");
  try {
    return { caption, metadata: parseCaption(caption) };
  } catch (err) {
    return { error: (err as Error).message.split("\n")[0] };
  }
}
