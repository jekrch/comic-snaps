// The data-editing commands — /update, /tag_series, /tag_artist,
// /rename_series, /resolve — as pure edits over in-memory documents.
//
// Typed directly or confirmed from an agent proposal, they run through
// runCommands: every file is read at one base commit, each command is applied in
// memory (a bad one fails alone), and everything that changed lands as a single
// commit on top of that base. That keeps a rename, which touches gallery.json
// and series.json together, from ever being half-committed, and gives the
// metadata job one push to react to instead of several.

import type {
  ArtistEntry,
  ArtistsFile,
  DisambiguationFile,
  Env,
  Gallery,
  SeriesEntry,
  SeriesFile,
} from "./types";
import { parseIssue, parseTags } from "./caption";
import {
  RefMovedError,
  commitFiles,
  dispatchWorkflow,
  findSeries,
  formatIssue,
  getHeadSha,
  readJsonFile,
  serializeDataFile,
} from "./github";
import { byName, resolveSeries } from "./series";

export const GALLERY_PATH = "public/data/gallery.json";
export const SERIES_PATH = "public/data/series.json";
export const ARTISTS_PATH = "public/data/artists.json";
export const DISAMBIGUATION_PATH = "public/data/disambiguation.json";

const METADATA_WORKFLOW = "compute-image-metadata.yml";

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/** Fetch a data file's parsed contents, or null when it doesn't exist. */
export type DocLoader = (path: string) => Promise<unknown | null>;

/** A file couldn't be read. Unlike a bad command, this aborts the whole run. */
export class WorkspaceLoadError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Couldn't read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "WorkspaceLoadError";
  }
}

/** A command that can't be applied. Reported against that command only. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

/** The data files at one commit, loaded on first use, with what's been changed. */
export class Workspace {
  private readonly docs = new Map<string, { data: unknown; dirty: boolean }>();

  constructor(private readonly loader: DocLoader) {}

  private async load<T>(path: string, empty: () => T): Promise<T> {
    const hit = this.docs.get(path);
    if (hit) return hit.data as T;
    let data: unknown | null;
    try {
      data = await this.loader(path);
    } catch (err) {
      throw new WorkspaceLoadError(path, err);
    }
    const doc = (data ?? empty()) as T;
    this.docs.set(path, { data: doc, dirty: false });
    return doc;
  }

  gallery(): Promise<Gallery> {
    return this.load<Gallery>(GALLERY_PATH, () => ({ panels: [] }));
  }

  series(): Promise<SeriesFile> {
    return this.load<SeriesFile>(SERIES_PATH, () => ({ series: [] }));
  }

  artists(): Promise<ArtistsFile> {
    return this.load<ArtistsFile>(ARTISTS_PATH, () => ({ artists: [] }));
  }

  disambiguation(): Promise<DisambiguationFile> {
    return this.load<DisambiguationFile>(DISAMBIGUATION_PATH, () => ({}));
  }

  /** Mark a loaded file as changed. */
  touch(path: string): void {
    const doc = this.docs.get(path);
    if (doc) doc.dirty = true;
  }

  /** Every changed file, serialised in the format it's stored in. */
  dirtyFiles(): { path: string; content: string }[] {
    const out: { path: string; content: string }[] = [];
    for (const [path, doc] of this.docs) {
      if (doc.dirty) out.push({ path, content: serializeDataFile(path, doc.data) });
    }
    return out;
  }
}

/** Load files from the repo as they were at `sha`. */
export function githubLoader(env: Env, sha: string): DocLoader {
  return async (path) => (await readJsonFile(env, path, sha)).data;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export const UPDATABLE_FIELDS = ["title", "issue", "year", "artist", "notes", "tags"] as const;
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export function isUpdatableField(field: string): field is UpdatableField {
  return (UPDATABLE_FIELDS as readonly string[]).includes(field);
}

/** Disambiguation sections the metadata pipeline actually reads. */
const RESOLVABLE_KEYS = ["metron:series", "metron:creator"];

export type EditCommand =
  | { verb: "update"; seq: number; field: UpdatableField; value: string }
  | { verb: "tag_series" | "tag_artist"; ref: string; tags: string[] }
  | { verb: "rename_series"; ref: string; name: string; startYear: number | null }
  | { verb: "resolve"; key: string; name: string; id: number };

/** Every verb runCommands understands, as typed. */
export const EDIT_VERBS = [
  "/update",
  "/tag_series",
  "/tag_artist",
  "/rename_series",
  "/resolve",
] as const;

const RENAME_USAGE =
  "Expected format:\n/rename_series {series} // {new name}\n/rename_series {series} // {new name} // {start year}";
const RESOLVE_USAGE =
  "Expected format:\n/resolve metron:series // {name} // {metron id}\n/resolve metron:creator // {name} // {metron id}";

/** The verb a command starts with, minus any `@botname` suffix. */
export function commandVerb(text: string): string {
  return text.trim().split(/\s+/)[0].replace(/@\w+$/, "").toLowerCase();
}

/**
 * Parse an edit command. Null when `text` isn't one of the edit verbs at all;
 * `{ error }` when it is but can't be read, with the message to send back.
 */
export function parseEditCommand(text: string): EditCommand | { error: string } | null {
  const trimmed = text.trim();
  const verb = commandVerb(trimmed);
  const rest = trimmed.slice(trimmed.split(/\s+/)[0].length).trim();
  // Names, titles, tags and ids are single-line everywhere they end up (the
  // caption format, the agent's rollup, the restore workflow's outputs), so
  // only a panel's notes may span lines.
  const multiline = /[\r\n]/.test(rest);
  const ONE_LINE = "Keep the command on one line (only notes can span lines).";

  switch (verb) {
    case "/update": {
      const m = rest.match(/^(\d+)\s+(\S+)\s+([\s\S]+)$/);
      if (!m) return { error: "Expected format:\n/update {id} {field} {value}" };
      const field = m[2];
      if (!isUpdatableField(field)) {
        return {
          error: `Invalid field "${field}". Updatable fields: ${UPDATABLE_FIELDS.join(", ")}`,
        };
      }
      if (field !== "notes" && multiline) return { error: ONE_LINE };
      return { verb: "update", seq: parseInt(m[1], 10), field, value: m[3].trim() };
    }

    case "/tag_series":
    case "/tag_artist": {
      if (multiline) return { error: ONE_LINE };
      const type = verb === "/tag_series" ? "series" : "artist";
      const sepIdx = rest.indexOf("//");
      if (sepIdx === -1) return { error: `Expected format:\n/tag_${type} {ref} // tag1, tag2` };
      const ref = rest.slice(0, sepIdx).trim();
      if (!ref) return { error: `Missing ${type} reference.` };
      // Prefixes are stripped: the command, not the prefix, decides the target.
      const buckets = parseTags(rest.slice(sepIdx + 2));
      const tags = [...buckets.tags, ...buckets.seriesTags, ...buckets.artistTags];
      if (tags.length === 0) return { error: "No tags provided." };
      return { verb: type === "series" ? "tag_series" : "tag_artist", ref, tags };
    }

    case "/rename_series": {
      if (multiline) return { error: ONE_LINE };
      const parts = rest.split("//").map((s) => s.trim());
      if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) {
        return { error: RENAME_USAGE };
      }
      let startYear: number | null = null;
      if (parts.length === 3 && parts[2] !== "") {
        if (!/^\d{4}$/.test(parts[2])) return { error: `Invalid start year: "${parts[2]}"` };
        startYear = parseInt(parts[2], 10);
      }
      return { verb: "rename_series", ref: parts[0], name: parts[1], startYear };
    }

    case "/resolve": {
      if (multiline) return { error: ONE_LINE };
      const parts = rest.split("//").map((s) => s.trim());
      if (parts.length !== 3 || !parts[1]) return { error: RESOLVE_USAGE };
      const key = parts[0].toLowerCase();
      if (!RESOLVABLE_KEYS.includes(key)) {
        return { error: `Unknown section "${parts[0]}". Use ${RESOLVABLE_KEYS.join(" or ")}.` };
      }
      if (!/^\d+$/.test(parts[2])) return { error: `Invalid id: "${parts[2]}"` };
      return { verb: "resolve", key, name: parts[1], id: parseInt(parts[2], 10) };
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export interface Applied {
  /** What to tell the person who ran it. */
  reply: string;
  /** One line for the commit message, or null when nothing changed. */
  summary: string | null;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Match an artist by id, name, or alias (all case-insensitive). */
export function findArtist(list: ArtistEntry[], ref: string): ArtistEntry | undefined {
  const r = normalize(ref);
  return (
    list.find((a) => normalize(a.id) === r) ??
    list.find((a) => normalize(a.name) === r) ??
    list.find((a) => a.aliases?.some((alias) => normalize(alias) === r))
  );
}

/** Merge new tags into an entry's tag array, returning only the newly added tags. */
export function mergeTags(entry: { tags?: string[] }, incoming: string[]): string[] {
  const existing = new Set(entry.tags ?? []);
  const added: string[] = [];
  for (const t of incoming) {
    if (!existing.has(t)) {
      existing.add(t);
      added.push(t);
    }
  }
  entry.tags = Array.from(existing);
  return added;
}

async function applyUpdate(
  ws: Workspace,
  c: Extract<EditCommand, { verb: "update" }>
): Promise<Applied> {
  const gallery = await ws.gallery();
  const panel = gallery.panels.find((p) => p.seq === c.seq);
  if (!panel) throw new CommandError(`No panel found with ID ${c.seq}.`);

  let note = "";
  switch (c.field) {
    case "title": {
      // Retitling moves the panel to whichever series the title means, so its
      // slug follows. Leaving the slug behind is how titles and series drift.
      const { series } = await ws.series();
      const resolved = resolveSeries(c.value, series, gallery.panels);
      panel.title = resolved.title;
      panel.slug = resolved.slug;
      if (!resolved.existing) note = `\n  New series: ${resolved.slug}`;
      else if (resolved.title !== c.value) note = `\n  Matched series "${resolved.title}"`;
      break;
    }
    case "issue":
      try {
        panel.issue = parseIssue(c.value);
      } catch (err) {
        throw new CommandError((err as Error).message);
      }
      break;
    case "year": {
      const year = parseInt(c.value, 10);
      if (isNaN(year)) throw new CommandError(`Invalid year: "${c.value}"`);
      panel.year = year;
      break;
    }
    case "artist":
      panel.artist = c.value;
      break;
    case "notes":
      panel.notes = c.value || null;
      break;
    case "tags":
      panel.tags = c.value
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      break;
  }

  ws.touch(GALLERY_PATH);
  return {
    reply: `Updated panel #${c.seq}: set ${c.field} to "${c.value}"\n→ ${panel.title} ${formatIssue(panel.issue)}${note}`,
    summary: `Update gallery: edit ${panel.title} ${formatIssue(panel.issue)} (${c.field})`,
  };
}

async function applyTags(
  ws: Workspace,
  c: Extract<EditCommand, { verb: "tag_series" | "tag_artist" }>
): Promise<Applied> {
  const isSeries = c.verb === "tag_series";
  const type = isSeries ? "series" : "artist";
  const path = isSeries ? SERIES_PATH : ARTISTS_PATH;
  const entry = isSeries
    ? findSeries((await ws.series()).series, c.ref)
    : findArtist((await ws.artists()).artists, c.ref);
  if (!entry) throw new CommandError(`No ${type} found matching "${c.ref}".`);

  const added = mergeTags(entry, c.tags);
  const all = (entry.tags ?? []).join(", ");
  if (added.length === 0) {
    return { reply: `${entry.name}: all tags already present.\n  Tags: ${all}`, summary: null };
  }
  ws.touch(path);
  return {
    reply: `Tagged ${type} ${entry.name}:\n  Added: ${added.join(", ")}\n  Tags: ${all}`,
    summary: `Update ${type}: tag ${entry.name} (${added.join(", ")})`,
  };
}

async function applyRename(
  ws: Workspace,
  c: Extract<EditCommand, { verb: "rename_series" }>
): Promise<Applied> {
  const gallery = await ws.gallery();
  const file = await ws.series();
  const name = c.name.trim();

  // A bare number names the series of that panel.
  let slug: string;
  if (/^\d+$/.test(c.ref)) {
    const panel = gallery.panels.find((p) => p.seq === parseInt(c.ref, 10));
    if (!panel) throw new CommandError(`No panel found with ID ${c.ref}.`);
    slug = panel.slug;
  } else {
    const resolved = resolveSeries(c.ref, file.series, gallery.panels);
    if (!resolved.existing) throw new CommandError(`No series found matching "${c.ref}".`);
    slug = resolved.slug;
  }

  // The new name must not already mean some other series, or the two would
  // become indistinguishable to posting and to the metadata lookups.
  const clash = resolveSeries(
    name,
    file.series.filter((s) => s.id !== slug),
    gallery.panels.filter((p) => p.slug !== slug)
  );
  if (clash.existing) {
    throw new CommandError(
      `"${name}" is already series ${clash.slug} ("${clash.title}"). To fold panels into it, move them one at a time with /update {id} title ${clash.title}`
    );
  }

  const entry: SeriesEntry | undefined = file.series.find((s) => s.id === slug);
  const panels = gallery.panels.filter((p) => p.slug === slug);
  const oldName = entry?.name ?? panels[0]?.title ?? slug;

  let retitled = 0;
  for (const p of panels) {
    if (p.title !== name) {
      p.title = name;
      retitled++;
    }
  }
  if (retitled > 0) ws.touch(GALLERY_PATH);

  const lines: string[] = [];
  const renamed = oldName !== name;
  lines.push(
    renamed
      ? `Renamed series ${slug}: "${oldName}" → "${name}"`
      : `Series ${slug} keeps the name "${name}"`
  );
  lines.push(`  ${retitled} panel(s) retitled`);

  if (entry) {
    // The old spelling becomes an alias so captions that still use it land
    // here instead of starting a new series.
    const aliases = (entry.aliases ?? []).filter((a) => normalize(a) !== normalize(name));
    if (renamed && normalize(oldName) !== normalize(name)) {
      if (!aliases.some((a) => normalize(a) === normalize(oldName))) aliases.push(oldName);
      lines.push(`  "${oldName}" kept as an alias`);
    }
    if (aliases.length > 0 || entry.aliases) entry.aliases = aliases;

    entry.name = name;
    if (c.startYear !== null) {
      entry.startYear = c.startYear;
      lines.push(`  Start year set to ${c.startYear}`);
    }
    // Every source marks an entry as tried even when it found nothing, and
    // cover lookups snapshot the issues they tried. Clearing both is what makes
    // the metadata job search again under the new name (see commit a1ba147e).
    entry.sources = [];
    delete entry.coverSources;
    file.series.sort(byName);
    ws.touch(SERIES_PATH);
    lines.push("  Lookup markers cleared: the metadata job will search Metron and Comic Vine again");
  } else {
    lines.push("  Not in series.json yet: the metadata job will create it under the new name");
  }

  return {
    reply: lines.join("\n"),
    summary: `Update series: rename ${slug} to ${name}`,
  };
}

async function applyResolve(
  ws: Workspace,
  c: Extract<EditCommand, { verb: "resolve" }>
): Promise<Applied> {
  const data = await ws.disambiguation();
  const section = (data[c.key] ??= {});
  const name = Object.keys(section).find((n) => normalize(n) === normalize(c.name)) ?? c.name;
  const entry = (section[name] ??= { id: null, candidates: [] });

  const candidate = entry.candidates.find((x) => x.id === c.id);
  entry.id = c.id;
  ws.touch(DISAMBIGUATION_PATH);

  const lines = [
    `Resolved ${c.key} "${name}" → ${c.id}${candidate?.name ? ` (${candidate.name})` : ""}`,
    "  The metadata job fetches that record on its next run",
  ];
  if (!candidate && entry.candidates.length > 0) {
    lines.push(`  Note: ${c.id} isn't one of the ${entry.candidates.length} recorded candidates`);
  }
  return { reply: lines.join("\n"), summary: `Update disambiguation: ${c.key} ${name} → ${c.id}` };
}

/** Apply one edit command to the workspace. Throws CommandError when it can't. */
export async function applyCommand(ws: Workspace, text: string): Promise<Applied> {
  const parsed = parseEditCommand(text);
  if (parsed === null) throw new CommandError(`Not an edit command: ${text.split(/\s+/)[0]}`);
  if ("error" in parsed) throw new CommandError(parsed.error);
  switch (parsed.verb) {
    case "update":
      return applyUpdate(ws, parsed);
    case "tag_series":
    case "tag_artist":
      return applyTags(ws, parsed);
    case "rename_series":
      return applyRename(ws, parsed);
    case "resolve":
      return applyResolve(ws, parsed);
  }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface CommandOutcome {
  command: string;
  ok: boolean;
  reply: string;
}

export interface RunResult {
  outcomes: CommandOutcome[];
  /** The commit that landed, or null when nothing changed. */
  commitSha: string | null;
  /** A line about the metadata job, when the commit didn't start it by itself. */
  followUp: string | null;
}

function commitMessage(summaries: string[]): string {
  if (summaries.length === 1) return summaries[0];
  return `Update data: ${summaries.length} edits\n\n${summaries.map((s) => `- ${s}`).join("\n")}`;
}

/**
 * The metadata job only runs on pushes that touch gallery.json. A commit that
 * changes series.json or disambiguation.json alone would otherwise wait for the
 * next post, and the site, which deploys off that job, would wait with it.
 */
async function startMetadataJob(env: Env): Promise<string> {
  const failure = await dispatchWorkflow(env, METADATA_WORKFLOW).catch(
    (err: unknown) => (err as Error).message
  );
  return failure === null
    ? "Started the metadata job."
    : `Couldn't start the metadata job (${failure}). It runs with the next post, or start it from the Actions tab.`;
}

/**
 * Apply `commands` in order against one snapshot of the repo and commit every
 * change together. A command that can't be applied is reported and skipped; the
 * rest still land. If main moves before the commit lands, the whole run is
 * re-applied against the newer files.
 */
export async function runCommands(
  env: Env,
  commands: string[],
  attempts = 3
): Promise<RunResult> {
  for (let attempt = 1; ; attempt++) {
    const base = await getHeadSha(env);
    const ws = new Workspace(githubLoader(env, base));
    const outcomes: CommandOutcome[] = [];
    const summaries: string[] = [];

    for (const command of commands) {
      try {
        const applied = await applyCommand(ws, command);
        outcomes.push({ command, ok: true, reply: applied.reply });
        if (applied.summary) summaries.push(applied.summary);
      } catch (err) {
        if (err instanceof WorkspaceLoadError) throw err;
        outcomes.push({ command, ok: false, reply: (err as Error).message });
      }
    }

    const files = ws.dirtyFiles();
    if (files.length === 0) return { outcomes, commitSha: null, followUp: null };

    let commitSha: string;
    try {
      commitSha = await commitFiles(env, base, files, commitMessage(summaries));
    } catch (err) {
      if (err instanceof RefMovedError && attempt < attempts) continue;
      throw err;
    }

    const followUp = files.some((f) => f.path === GALLERY_PATH)
      ? null
      : await startMetadataJob(env);
    return { outcomes, commitSha, followUp };
  }
}

/** The reply for a run: one command's own reply, or a numbered summary. */
export function formatRun(result: RunResult): string {
  const { outcomes, followUp } = result;
  let body: string;
  if (outcomes.length === 1) {
    body = outcomes[0].reply;
  } else {
    body = `Ran ${outcomes.length} command(s):\n${outcomes
      .map(
        (o, i) =>
          `${i + 1}. ${o.command}\n   ${o.ok ? "OK" : "FAIL"}: ${o.reply.split("\n")[0]}`
      )
      .join("\n")}`;
  }
  return followUp ? `${body}\n${followUp}` : body;
}
