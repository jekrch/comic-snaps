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

function clip(text: string | null | undefined, max: number): string {
  if (!text) return "-";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Distinct issues, numbers ascending, then named issues ("Annual 2") alphabetically. */
function issueList(panels: Gallery["panels"]): string {
  const issues = [...new Set(panels.map((p) => p.issue))].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1;
    if (typeof b === "number") return 1;
    return a.localeCompare(b);
  });
  return issues.map(formatIssue).join(", ");
}

function referenceNames(s: SeriesEntry): string {
  const names = (s.references ?? []).map((r) => r.name);
  return names.length ? names.join(", ") : "-";
}

export function buildRollup(docs: CollectionDocs): string {
  const { gallery, series, artists, disambiguation } = docs;
  const panelsBySlug = new Map<string, Gallery["panels"]>();
  for (const p of gallery.panels) {
    const list = panelsBySlug.get(p.slug) ?? [];
    list.push(p);
    panelsBySlug.set(p.slug, list);
  }

  const seriesLines: string[] = [];
  const known = new Set<string>();
  for (const s of series.series) {
    known.add(s.id);
    const panels = panelsBySlug.get(s.id) ?? [];
    const issues = issueList(panels);
    const panelArtists = [...new Set(panels.map((p) => p.artist))].join(", ");
    seriesLines.push(
      [
        s.id,
        cell(s.name),
        cell((s.aliases ?? []).join("; ")),
        cell(s.startYear),
        cell(s.publisher),
        referenceNames(s),
        cell((s.sources ?? []).join(",")),
        cell(issues),
        cell(panelArtists),
      ].join(" | ")
    );
  }
  // Posted since the metadata job last ran, so not in series.json yet.
  for (const [slug, panels] of panelsBySlug) {
    if (known.has(slug)) continue;
    const issues = issueList(panels);
    const panelArtists = [...new Set(panels.map((p) => p.artist))].join(", ");
    seriesLines.push(
      [slug, cell(panels[0].title), "-", "-", "-", "(not in series.json yet)", "-", issues, panelArtists].join(
        " | "
      )
    );
  }

  const panelLines = [...gallery.panels]
    .sort((a, b) => a.seq - b.seq)
    .map((p) =>
      [
        p.seq,
        p.slug,
        cell(formatIssue(p.issue)),
        cell(p.year),
        cell(p.artist),
        cell(p.tags.join(", ")),
        clip(p.notes, 80),
        cell(p.postedBy),
      ].join(" | ")
    );

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
    `# Series (${seriesLines.length})`,
    "# id | name | aliases | startYear | publisher | references | sources (pipeline markers) | issues posted | artists posted",
    ...seriesLines,
    "",
    `# Panels (${panelLines.length})`,
    "# seq | series id | issue | year | artist | tags | notes | posted by",
    ...panelLines,
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
