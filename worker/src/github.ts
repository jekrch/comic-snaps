import type {
  Env,
  Gallery,
  GitHubContentsResponse,
  PanelEntry,
  SeriesEntry,
} from "./types";

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

/**
 * A file's text from a contents-API response. That JSON form carries the file
 * only up to 1 MB. Past that `content` comes back empty (encoding "none"), so
 * the text is fetched as the blob the response names, which also keeps the
 * returned sha exactly the one that was read.
 */
async function contentsText(env: Env, meta: GitHubContentsResponse): Promise<string> {
  if (meta.content || meta.encoding !== "none") {
    return base64ToUtf8((meta.content ?? "").replace(/\n/g, ""));
  }
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const resp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/blobs/${meta.sha}`, {
    headers: { ...githubHeaders(env.GITHUB_TOKEN), Accept: "application/vnd.github.raw+json" },
  });
  if (!resp.ok) throw new Error(`Failed to read blob ${meta.sha} (${resp.status}): ${await resp.text()}`);
  return resp.text();
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
    gallery = JSON.parse(await contentsText(env, data));
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

/**
 * Find the artist credited on the most recently added panel of a series,
 * matched by slug. Returns null when the series has no panels yet.
 */
export function lastArtistForSlug(gallery: Gallery, slug: string): string | null {
  let latest: PanelEntry | null = null;
  for (const p of gallery.panels) {
    if (p.slug !== slug || !p.artist) continue;
    if (!latest || (p.seq ?? 0) > (latest.seq ?? 0)) latest = p;
  }
  return latest ? latest.artist : null;
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

/**
 * Files the Python pipeline writes: `json.dumps(indent=2)` with its default
 * `ensure_ascii`, plus a trailing newline. A bot write has to reproduce that
 * byte for byte or it re-lines the whole file. gallery.json is the exception —
 * the bot has always written it, as plain `JSON.stringify`.
 */
const PYTHON_FORMAT_PATHS = new Set([
  "public/data/series.json",
  "public/data/artists.json",
  "public/data/disambiguation.json",
  "public/data/issues.json",
  "public/data/ratings.json",
]);

/** Serialise a data file in the exact format the file is already stored in. */
export function serializeDataFile(path: string, data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  if (!PYTHON_FORMAT_PATHS.has(path)) return json;
  const escaped = json.replace(
    /[\u0080-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
  return `${escaped}\n`;
}

/** Generic JSON file read from GitHub, at `ref` (a commit sha) or the default branch. */
export async function readJsonFile<T>(
  env: Env,
  path: string,
  ref?: string
): Promise<{ data: T | null; sha: string | null }> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}${query}`;

  const resp = await fetch(url, { headers: githubHeaders(env.GITHUB_TOKEN) });

  if (resp.status === 404) return { data: null, sha: null };
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to read ${path} (${resp.status}): ${err}`);
  }

  const meta: GitHubContentsResponse = await resp.json();
  return { data: JSON.parse(await contentsText(env, meta)) as T, sha: meta.sha };
}

/** A failed write to GitHub, carrying the status so conflicts can be retried. */
export class GitHubWriteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "GitHubWriteError";
  }

  /** GitHub answers a stale `sha` with 409, and sometimes 422. */
  get isConflict(): boolean {
    return this.status === 409 || this.status === 422;
  }
}

/** Generic JSON file write to GitHub. */
export async function writeJsonFile(
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
    content: utf8ToBase64(serializeDataFile(path, data)),
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
    throw new GitHubWriteError(resp.status, `Write to ${path} failed (${resp.status}): ${err}`);
  }
}

/**
 * Read a JSON file, apply a change, and commit it — retrying the whole cycle
 * when someone else committed first.
 *
 * Panel posts are rare and naturally serialised, but rating taps are not: two
 * people tapping at once is exactly the read-modify-write collision a bare PUT
 * loses. GitHub rejects a stale `sha` rather than clobbering, so a conflict is
 * safe to re-apply against the newer file.
 */
export async function mutateJsonFile<T, R>(
  env: Env,
  path: string,
  empty: () => T,
  apply: (data: T) => { result: R; message: string },
  attempts = 4
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    const { data, sha } = await readJsonFile<T>(env, path);
    const doc = data ?? empty();
    const { result, message } = apply(doc);

    try {
      await writeJsonFile(env, path, doc, sha, message);
      return result;
    } catch (err) {
      const conflict = err instanceof GitHubWriteError && err.isConflict;
      if (!conflict || attempt >= attempts - 1) throw err;
      // Brief, growing backoff so simultaneous taps don't lock-step.
      await new Promise((r) => setTimeout(r, 120 * (attempt + 1) + Math.random() * 80));
    }
  }
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Match a series by id, name, or alias (all case-insensitive). */
export function findSeries(list: SeriesEntry[], ref: string): SeriesEntry | undefined {
  const r = normalize(ref);
  return (
    list.find((s) => normalize(s.id) === r) ??
    list.find((s) => normalize(s.name) === r) ??
    list.find((s) => s.aliases?.some((alias) => normalize(alias) === r))
  );
}

// ---------------------------------------------------------------------------
// Multi-file commits (Git Data API)
// ---------------------------------------------------------------------------
//
// The contents API commits one file at a time. A rename touches gallery.json
// and series.json, and two commits would let the metadata job check out between
// them and then collide with the second on its push. So edits read every file at
// one commit, apply in memory, and land as a single commit on top of it.

/** `main` moved between reading the base commit and updating the ref. */
export class RefMovedError extends Error {
  constructor() {
    super("main moved while the commit was being built");
    this.name = "RefMovedError";
  }
}

async function githubJson<T>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; ok: boolean; data: T | null; text: string }> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const resp = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/${path}`, {
    method: init.method ?? "GET",
    headers: githubHeaders(env.GITHUB_TOKEN),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await resp.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    /* error bodies aren't always JSON */
  }
  return { status: resp.status, ok: resp.ok, data, text };
}

/** The commit a branch points at, or null when there's no such branch. */
export async function getBranchSha(env: Env, branch: string): Promise<string | null> {
  const r = await githubJson<{ object: { sha: string } }>(env, `git/ref/heads/${branch}`);
  if (r.status === 404) return null;
  if (!r.ok || !r.data) throw new Error(`Failed to read ${branch} (${r.status}): ${r.text}`);
  return r.data.object.sha;
}

/** The commit `main` currently points at. */
export async function getHeadSha(env: Env): Promise<string> {
  const sha = await getBranchSha(env, "main");
  if (!sha) throw new Error("Failed to read main: no such branch");
  return sha;
}

/** Delete a branch. Returns false when it was already gone. */
export async function deleteBranch(env: Env, branch: string): Promise<boolean> {
  const r = await githubJson(env, `git/refs/heads/${branch}`, { method: "DELETE" });
  if (r.status === 404 || r.status === 422) return false;
  if (!r.ok) throw new Error(`Failed to delete ${branch} (${r.status}): ${r.text}`);
  return true;
}

/** A commit's full message. */
export async function getCommitMessage(env: Env, sha: string): Promise<string> {
  const r = await githubJson<{ message: string }>(env, `git/commits/${sha}`);
  if (!r.ok || !r.data) throw new Error(`Failed to read commit ${sha} (${r.status}): ${r.text}`);
  return r.data.message;
}

/** The blob sha of a file at `ref`, or null when it isn't there. */
export async function getFileSha(env: Env, path: string, ref: string): Promise<string | null> {
  const r = await githubJson<{ sha: string; type: string }>(
    env,
    `contents/${path}?ref=${encodeURIComponent(ref)}`
  );
  if (r.status === 404) return null;
  if (!r.ok || !r.data) throw new Error(`Failed to read ${path} (${r.status}): ${r.text}`);
  return r.data.type === "file" ? r.data.sha : null;
}

/**
 * A file's text at `ref`, or null when it isn't there. Unlike readJsonFile this
 * asks for the raw bytes, which the contents API serves up to 100 MB; its JSON
 * form stops carrying content at 1 MB, and the embeddings files are past that.
 */
export async function readRawFile(env: Env, path: string, ref: string): Promise<string | null> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  const resp = await fetch(url, {
    headers: { ...githubHeaders(env.GITHUB_TOKEN), Accept: "application/vnd.github.raw+json" },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Failed to read ${path} (${resp.status}): ${await resp.text()}`);
  return resp.text();
}

/**
 * One change in a commit: a file's new text, an existing blob placed at a path
 * (`sha`), or a deletion (`sha: null`).
 */
export type TreeChange = { path: string; content: string } | { path: string; sha: string | null };

/**
 * Commit `files` (full text contents) on top of `baseSha` and fast-forward
 * `main` to it. Throws RefMovedError when `main` is no longer `baseSha`, so the
 * caller can re-read and re-apply against the newer tree.
 */
export async function commitFiles(
  env: Env,
  baseSha: string,
  files: TreeChange[],
  message: string
): Promise<string> {
  const base = await githubJson<{ tree: { sha: string } }>(env, `git/commits/${baseSha}`);
  if (!base.ok || !base.data) {
    throw new Error(`Failed to read commit ${baseSha} (${base.status}): ${base.text}`);
  }

  const tree = await githubJson<{ sha: string }>(env, "git/trees", {
    method: "POST",
    body: {
      base_tree: base.data.tree.sha,
      tree: files.map((f) => ({ mode: "100644", type: "blob", ...f })),
    },
  });
  if (!tree.ok || !tree.data) throw new Error(`Failed to write tree (${tree.status}): ${tree.text}`);

  const commit = await githubJson<{ sha: string }>(env, "git/commits", {
    method: "POST",
    body: { message, tree: tree.data.sha, parents: [baseSha] },
  });
  if (!commit.ok || !commit.data) {
    throw new Error(`Failed to write commit (${commit.status}): ${commit.text}`);
  }

  const ref = await githubJson(env, "git/refs/heads/main", {
    method: "PATCH",
    body: { sha: commit.data.sha, force: false },
  });
  // A non-fast-forward update is refused with 422 ("Update is not a fast forward").
  if (ref.status === 422 || ref.status === 409) throw new RefMovedError();
  if (!ref.ok) throw new Error(`Failed to update main (${ref.status}): ${ref.text}`);
  return commit.data.sha;
}

/**
 * Start a workflow on main. Returns null on success, or why it couldn't — most
 * often a token without Actions write access, which the caller reports rather
 * than treats as a failed edit.
 */
export async function dispatchWorkflow(
  env: Env,
  workflowFile: string,
  inputs?: Record<string, string | boolean>
): Promise<string | null> {
  const r = await githubJson(env, `actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    body: inputs ? { ref: "main", inputs } : { ref: "main" },
  });
  return r.ok ? null : `HTTP ${r.status}`;
}
