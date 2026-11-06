// The collection, compressed into plain text for the agent's system prompt:
// enough to answer questions about it and to propose exact commands (panel
// seqs, series ids, names spelled as stored) without a tool call per lookup.

import type { ArtistsFile, DisambiguationFile, Gallery, SeriesEntry, SeriesFile } from "./types";
import { formatIssue } from "./github";
import type { Workspace } from "./edits";

export interface CollectionDocs {
  gallery: Gallery;
  series: SeriesFile;
  artists: ArtistsFile;
  disambiguation: DisambiguationFile;
}

export async function loadCollection(ws: Workspace): Promise<CollectionDocs> {
  const [gallery, series, artists, disambiguation] = await Promise.all([
    ws.gallery(),
    ws.series(),
    ws.artists(),
    ws.disambiguation(),
  ]);
  return { gallery, series, artists, disambiguation };
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/[\r\n|]+/g, " ").trim() || "-";
}

/** Panels in posting order. */
function bySeq(panels: Gallery["panels"]): Gallery["panels"] {
  return [...panels].sort((a, b) => a.seq - b.seq);
}

// What the pipeline's "sources" markers and the references would otherwise
// both have to be sent for: a database whose lookup ran but found nothing,
// usually because our name differs from theirs. /rename_series fixes these.
const LOOKUPS: [source: string, reference: string][] = [
  ["metron", "Metron"],
  ["comicvine", "Comic Vine"],
];

function unmatchedLookups(s: SeriesEntry): string {
  const sources = new Set(s.sources ?? []);
  const refs = new Set((s.references ?? []).map((r) => r.name));
  const missing = LOOKUPS.filter(([src, ref]) => sources.has(src) && !refs.has(ref)).map(([src]) => src);
  return missing.length ? missing.join(", ") : "-";
}

function panelLine(p: Gallery["panels"][number]): string {
  return `  ${[p.seq, cell(formatIssue(p.issue)), cell(p.year), cell(p.artist)].join(" | ")}`;
}

// Kept to what /ask needs on every turn: ids, names and seqs to copy into
// commands, and enough to answer "what's posted". Aliases, tags, notes,
// posters and full references come from get_series when a question needs them.
export function buildRollup(docs: CollectionDocs): string {
  const { gallery, series, artists, disambiguation } = docs;
  const panelsBySlug = new Map<string, Gallery["panels"]>();
  for (const p of gallery.panels) {
    const list = panelsBySlug.get(p.slug) ?? [];
    list.push(p);
    panelsBySlug.set(p.slug, list);
  }

  const seriesLines: string[] = [];
  let seriesCount = 0;
  const known = new Set<string>();
  for (const s of series.series) {
    known.add(s.id);
    seriesCount++;
    seriesLines.push(
      [s.id, cell(s.name), cell(s.startYear), cell(s.publisher), unmatchedLookups(s)].join(" | ")
    );
    seriesLines.push(...bySeq(panelsBySlug.get(s.id) ?? []).map(panelLine));
  }
  // Posted since the metadata job last ran, so not in series.json yet.
  for (const [slug, panels] of panelsBySlug) {
    if (known.has(slug)) continue;
    seriesCount++;
    seriesLines.push([slug, cell(panels[0].title), "-", "-", "(not in series.json yet)"].join(" | "));
    seriesLines.push(...bySeq(panels).map(panelLine));
  }

  const artistLines = artists.artists.map((a) => {
    const aliases = (a.aliases ?? []).slice(0, 3);
    return aliases.length ? `${a.name} (aka ${aliases.join("; ")})` : a.name;
  });

  const disambiguationLines: string[] = [];
  for (const [key, names] of Object.entries(disambiguation)) {
    for (const [name, entry] of Object.entries(names)) {
      if (entry.id) continue;
      const candidates = entry.candidates
        .map((c) => `${c.id} ${c.name ?? "?"}`)
        .join("; ");
      disambiguationLines.push(`${key} | ${name} | ${candidates || "(no candidates)"}`);
    }
  }

  return [
    `# Series (${seriesCount}) with their panels (${gallery.panels.length})`,
    "# id | name | startYear | publisher | lookups that ran without a match",
    "#   panel seq | issue | year | artist",
    ...seriesLines,
    "",
    `# Artists (${artistLines.length})`,
    ...artistLines,
    "",
    "# Unresolved disambiguation (section | name as searched | candidates: id name)",
    ...(disambiguationLines.length ? disambiguationLines : ["(none)"]),
  ].join("\n");
}

/** One series' full series.json entry plus its panels, for the get_series tool. */
export function seriesDetail(docs: CollectionDocs, ref: string): string {
  const r = ref.trim().toLowerCase();
  const entry = docs.series.series.find(
    (s) =>
      s.id === r ||
      s.name.toLowerCase() === r ||
      (s.aliases ?? []).some((a) => a.toLowerCase() === r)
  );
  const slug = entry?.id ?? r;
  const panels = docs.gallery.panels
    .filter((p) => p.slug === slug)
    .map((p) => ({
      seq: p.seq,
      title: p.title,
      issue: p.issue,
      year: p.year,
      artist: p.artist,
      tags: p.tags,
      notes: p.notes,
    }));
  if (!entry && panels.length === 0) return `No series "${ref}".`;
  // Cover and image URLs are noise to the model.
  const series = entry
    ? Object.fromEntries(
        Object.entries(entry).filter(([k]) => k !== "coverImages" && k !== "imageUrl")
      )
    : null;
  return JSON.stringify({ series, panels });
}
