import type { Env, Gallery, GitHubContentsResponse, PanelEntry } from "./types";

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

/** Read gallery.json, prepend a new entry, and commit the update. */
export async function updateGalleryJson(
  env: Env,
  newEntry: PanelEntry
): Promise<void> {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/public/data/gallery.json`;

  // Fetch current gallery.json (need its SHA to update)
  const getResp = await fetch(url, {
    headers: githubHeaders(env.GITHUB_TOKEN),
  });

  let gallery: Gallery = { panels: [] };
  let sha: string | null = null;

  if (getResp.ok) {
    const data: GitHubContentsResponse = await getResp.json();
    sha = data.sha;
    const content = atob(data.content.replace(/\n/g, ""));
    gallery = JSON.parse(content);
  } else if (getResp.status !== 404) {
    const err = await getResp.text();
    throw new Error(`Failed to read gallery.json (${getResp.status}): ${err}`);
  }

  gallery.panels.unshift(newEntry);

  const updatedContent = btoa(JSON.stringify(gallery, null, 2));

  const putBody: Record<string, string> = {
    message: `Update gallery: add ${newEntry.title} #${newEntry.issue}`,
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