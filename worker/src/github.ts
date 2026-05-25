import type {
  ArtistEntry,
  ArtistsFile,
  Env,
  Gallery,
  GitHubContentsResponse,
  PanelEntry,
  SeriesEntry,
  SeriesFile,
} from "./types";
import { parseIssue } from "./caption";

// Display form for an issue identifier (e.g. `#5` for a number, `VOL 1` as-is).
export function formatIssue(issue: number | string): string {
  return typeof issue === "number" ? `#${issue}` : issue;
}

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "comic-panel-bot";

/** Common headers for GitHub API requests. */
function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };
}

/** Convert an ArrayBuffer to a base64-encoded string. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// btoa/atob only handle Latin-1, so non-ASCII chars (curly quotes, em-dashes,
// accents, emoji) need to round-trip through UTF-8 bytes.
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/** Commit a single file to the repository. */
export async function commitFile(
  env: Env,
  path: string,
  base64Content: string,
  commitMessage: string
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env.GITHUB_TOKEN),
    body: JSON.stringify({
      message: commitMessage,
      content: base64Content,
      branch: "main",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GitHub commit failed (${resp.status}): ${err}`);
  }
}

/** Fetch gallery.json and return parsed gallery + SHA. */
export async function readGalleryJson(
  env: Env
): Promise<{ gallery: Gallery; sha: string | null }> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/public/data/gallery.json`;

  const getResp = await fetch(url, {
    headers: githubHeaders(env.GITHUB_TOKEN),
  });

  let gallery: Gallery = { panels: [] };
  let sha: string | null = null;

  if (getResp.ok) {
    const data: GitHubContentsResponse = await getResp.json();
    sha = data.sha;
    const content = base64ToUtf8(data.content.replace(/\n/g, ""));
    gallery = JSON.parse(content);
  } else if (getResp.status !== 404) {
    const err = await getResp.text();
    throw new Error(`Failed to read gallery.json (${getResp.status}): ${err}`);
  }

  return { gallery, sha };
}

/** Write gallery.json back to GitHub. */
async function writeGalleryJson(
  env: Env,
  gallery: Gallery,
  sha: string | null,
  commitMessage: string
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/public/data/gallery.json`;

  const updatedContent = utf8ToBase64(JSON.stringify(gallery, null, 2));

  const putBody: Record<string, string> = {
    message: commitMessage,
    content: updatedContent,
    branch: "main",
  };
  if (sha) putBody.sha = sha;

  const putResp = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env.GITHUB_TOKEN),
    body: JSON.stringify(putBody),
  });

  if (!putResp.ok) {
    const err = await putResp.text();
    throw new Error(`Gallery update failed (${putResp.status}): ${err}`);
  }
}

/** Get the next sequential ID based on existing entries. */
export function nextSeq(gallery: Gallery): number {
  let max = 0;
  for (const p of gallery.panels) {
    if (p.seq && p.seq > max) max = p.seq;
  }
  return max + 1;
}

/** Read gallery.json, prepend a new entry, and commit the update. */
export async function updateGalleryJson(
  env: Env,
  newEntry: PanelEntry
): Promise<void> {
  const { gallery, sha } = await readGalleryJson(env);
  gallery.panels.unshift(newEntry);
  await writeGalleryJson(
    env,
    gallery,
    sha,
    `Update gallery: add ${newEntry.title} ${formatIssue(newEntry.issue)}`
  );
}

/** Delete a file from the repository. */
async function deleteFile(
  env: Env,
  path: string,
  sha: string,
  commitMessage: string
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const resp = await fetch(url, {
    method: "DELETE",
    headers: githubHeaders(env.GITHUB_TOKEN),
    body: JSON.stringify({
      message: commitMessage,
      sha,
      branch: "main",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GitHub delete failed (${resp.status}): ${err}`);
  }
}

/** Delete a panel by seq ID. Returns the deleted entry or null. */
export async function deletePanel(
  env: Env,
  seq: number
): Promise<PanelEntry | null> {
  const { gallery, sha } = await readGalleryJson(env);
  const idx = gallery.panels.findIndex((p) => p.seq === seq);
  if (idx === -1) return null;

  const [removed] = gallery.panels.splice(idx, 1);

  // Update gallery.json first (before deleting the image changes the repo state)
  await writeGalleryJson(
    env,
    gallery,
    sha,
    `Update gallery: remove ${removed.title} ${formatIssue(removed.issue)}`
  );

  // Delete the image file from the repo
  const imagePath = `public/${removed.image}`;
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const fileUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/${imagePath}`;
  const fileResp = await fetch(fileUrl, {
    headers: githubHeaders(env.GITHUB_TOKEN),
  });
  if (fileResp.ok) {
    const fileData: GitHubContentsResponse = await fileResp.json();
    await deleteFile(
      env,
      imagePath,
      fileData.sha,
      `Delete panel: ${removed.title} ${formatIssue(removed.issue)}`
    );
  }

  return removed;
}

const UPDATABLE_FIELDS = ["title", "issue", "year", "artist", "notes", "tags"] as const;
type UpdatableField = typeof UPDATABLE_FIELDS[number];

export function isUpdatableField(field: string): field is UpdatableField {
  return (UPDATABLE_FIELDS as readonly string[]).includes(field);
}

/** Generic JSON file read from GitHub. */
async function readJsonFile<T>(
  env: Env,
  path: string
): Promise<{ data: T | null; sha: string | null }> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const resp = await fetch(url, { headers: githubHeaders(env.GITHUB_TOKEN) });

  if (resp.status === 404) return { data: null, sha: null };
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to read ${path} (${resp.status}): ${err}`);
  }

  const meta: GitHubContentsResponse = await resp.json();
  const content = base64ToUtf8(meta.content.replace(/\n/g, ""));
  return { data: JSON.parse(content) as T, sha: meta.sha };
}

/** Generic JSON file write to GitHub. */
async function writeJsonFile(
  env: Env,
  path: string,
  data: unknown,
  sha: string | null,
  commitMessage: string
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const body: Record<string, string> = {
    message: commitMessage,
    content: utf8ToBase64(JSON.stringify(data, null, 2)),
    branch: "main",
  };
  if (sha) body.sha = sha;

  const resp = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(env.GITHUB_TOKEN),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Write to ${path} failed (${resp.status}): ${err}`);
  }
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Match a series by id (case-insensitive) or name (case-insensitive). */
function findSeries(list: SeriesEntry[], ref: string): SeriesEntry | undefined {
  const r = normalize(ref);
  return (
    list.find((s) => normalize(s.id) === r) ??
    list.find((s) => normalize(s.name) === r)
  );
}

/** Match an artist by id, name, or alias (all case-insensitive). */
function findArtist(list: ArtistEntry[], ref: string): ArtistEntry | undefined {
  const r = normalize(ref);
  return (
    list.find((a) => normalize(a.id) === r) ??
    list.find((a) => normalize(a.name) === r) ??
    list.find((a) => a.aliases?.some((alias) => normalize(alias) === r))
  );
}

/** Merge new tags into an entry's tag array, returning only the newly added tags. */
function mergeTags(entry: { tags?: string[] }, incoming: string[]): string[] {
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

export interface TagAddResult {
  entry: { id: string; name: string } | null;
  addedTags: string[];
  allTags: string[];
}

/** Add tags to a series identified by id or name. Returns result with diff. */
export async function addSeriesTags(
  env: Env,
  ref: string,
  newTags: string[]
): Promise<TagAddResult> {
  if (newTags.length === 0) {
    return { entry: null, addedTags: [], allTags: [] };
  }
  const { data, sha } = await readJsonFile<SeriesFile>(env, "public/data/series.json");
  if (!data) return { entry: null, addedTags: [], allTags: [] };

  const entry = findSeries(data.series, ref);
  if (!entry) return { entry: null, addedTags: [], allTags: [] };

  const added = mergeTags(entry, newTags);
  if (added.length === 0) {
    return {
      entry: { id: entry.id, name: entry.name },
      addedTags: [],
      allTags: entry.tags ?? [],
    };
  }

  await writeJsonFile(
    env,
    "public/data/series.json",
    data,
    sha,
    `Update series: tag ${entry.name} (${added.join(", ")})`
  );

  return {
    entry: { id: entry.id, name: entry.name },
    addedTags: added,
    allTags: entry.tags ?? [],
  };
}

/** Add tags to an artist identified by id, name, or alias. Returns result with diff. */
export async function addArtistTags(
  env: Env,
  ref: string,
  newTags: string[]
): Promise<TagAddResult> {
  if (newTags.length === 0) {
    return { entry: null, addedTags: [], allTags: [] };
  }
  const { data, sha } = await readJsonFile<ArtistsFile>(env, "public/data/artists.json");
  if (!data) return { entry: null, addedTags: [], allTags: [] };

  const entry = findArtist(data.artists, ref);
  if (!entry) return { entry: null, addedTags: [], allTags: [] };

  const added = mergeTags(entry, newTags);
  if (added.length === 0) {
    return {
      entry: { id: entry.id, name: entry.name },
      addedTags: [],
      allTags: entry.tags ?? [],
    };
  }

  await writeJsonFile(
    env,
    "public/data/artists.json",
    data,
    sha,
    `Update artist: tag ${entry.name} (${added.join(", ")})`
  );

  return {
    entry: { id: entry.id, name: entry.name },
    addedTags: added,
    allTags: entry.tags ?? [],
  };
}

/** Update a single field on a panel by seq ID. Returns the updated entry or null. */
export async function updatePanel(
  env: Env,
  seq: number,
  field: string,
  value: string
): Promise<PanelEntry | null> {
  if (!isUpdatableField(field)) {
    throw new Error(
      `Cannot update "${field}". Updatable fields: ${UPDATABLE_FIELDS.join(", ")}`
    );
  }

  const { gallery, sha } = await readGalleryJson(env);
  const panel = gallery.panels.find((p) => p.seq === seq);
  if (!panel) return null;

  switch (field) {
    case "title":
      panel.title = value;
      break;
    case "issue":
      panel.issue = parseIssue(value);
      break;
    case "year":
      panel.year = parseInt(value, 10);
      if (isNaN(panel.year)) throw new Error(`Invalid year: "${value}"`);
      break;
    case "artist":
      panel.artist = value;
      break;
    case "notes":
      panel.notes = value || null;
      break;
    case "tags":
      panel.tags = value.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
      break;
  }

  await writeGalleryJson(
    env,
    gallery,
    sha,
    `Update gallery: edit ${panel.title} ${formatIssue(panel.issue)} (${field})`
  );

  return panel;
}