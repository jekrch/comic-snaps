import type { PanelMetadata } from "./types";

/**
 * Parse a Telegram caption into structured panel metadata.
 *
 * Primary format (// delimited):
 *   Title // Issue // Year // Artist // optional notes // optional tags
 *
 * Tags are comma-separated and stored as an array:
 *   Saga // 1 // 2012 // Fiona Staples // great spread // sci-fi, space opera, BKV
 *
 * To include tags without notes, leave the notes segment empty:
 *   Saga // 1 // 2012 // Fiona Staples // // sci-fi, space opera
 *
 * Fallback format (freeform, no notes/tags support):
 *   Title #Issue Year Artist
 */
export function parseCaption(caption: string): PanelMetadata {
  if (caption.includes("//")) {
    const parts = caption.split("//").map((s) => s.trim());
    if (parts.length >= 4) {
      const issue = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);

      if (isNaN(issue)) throw new Error(`Invalid issue number: "${parts[1]}"`);
      if (isNaN(year)) throw new Error(`Invalid year: "${parts[2]}"`);

      const notes = parts.length > 4 && parts[4] !== "" ? parts[4] : null;
      const tags = parts.length > 5 ? parseTags(parts[5]) : [];

      return { title: parts[0], issue, year, artist: parts[3], notes, tags };
    }
  }

  const match = caption.match(/^(.+?)\s*#(\d+)\s+(\d{4})\s+(.+)$/);
  if (match) {
    return {
      title: match[1].trim(),
      issue: parseInt(match[2], 10),
      year: parseInt(match[3], 10),
      artist: match[4].trim(),
      notes: null,
      tags: [],
    };
  }

  throw new Error(
    `Could not parse caption: "${caption}"\n\nExpected format:\nTitle // Issue # // Year // Artist`
  );
}

/** Parse a comma-separated tag string into a trimmed, non-empty array. */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Convert a title into a URL-safe slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}