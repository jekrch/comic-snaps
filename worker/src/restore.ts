// Restorations from the chat: /restore, /redo, /approve, /reject.
//
// The restore skills need OpenCV and a look-and-adjust loop, so they can't run
// in the Worker. /restore and /redo dispatch .github/workflows/restore.yml,
// which runs the restore skills' scripts with Gemini judging the results, commits
// the result to its own branch, restore/{seq}, and posts the before/after back to
// the chat.
//
// /approve doesn't merge that branch. Its embeddings files are one line each,
// so any metadata run on main since the branch was cut would conflict with it.
// Instead /approve replays what `restore.py install` did onto main as it is now:
// the new image (the branch's blob, not a copy), the panel's image metadata, the
// old image's removal, and the panel's embedding entries dropped so the
// metadata job re-embeds it. That lands as one commit made with the bot's
// token, and a push from that token starts the metadata job and the deploy
// after it, which a push from the workflow's own token wouldn't.

import type { Env, Gallery, PanelEntry } from "./types";
import {
  RefMovedError,
  commitFiles,
  deleteBranch,
  dispatchWorkflow,
  formatIssue,
  getBranchSha,
  getCommitMessage,
  getFileSha,
  getHeadSha,
  readGalleryJson,
  readJsonFile,
  readRawFile,
  serializeDataFile,
  type TreeChange,
} from "./github";

export const RESTORE_WORKFLOW = "restore.yml";
const GALLERY_PATH = "public/data/gallery.json";

/** What `restore.py install` rewrites on a panel; scripts/restore_ci.py checks the same list. */
export const RESTORE_FIELDS = [
  "image",
  "width",
  "height",
  "dominantColors",
  "colorfulness",
  "phash",
  "ahash",
  "dhash",
] as const;

export const EMBEDDING_PATHS = [
  "public/data/embeddings.json",
  "public/data/embeddings-dino.json",
  "public/data/embeddings-gram.json",
];

export function restoreBranch(seq: number): string {
  return `restore/${seq}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type RestoreCommand =
  | { verb: "restore" | "redo"; seq: number; notes: string }
  | { verb: "approve" | "reject"; seq: number };

const USAGE: Record<RestoreCommand["verb"], string> = {
  restore: "/restore {id} [directions], e.g. /restore 247 keep the yellow sky",
  redo: "/redo {id} {what to change}, e.g. /redo 247 the face went purple, take less",
  approve: "/approve {id}",
  reject: "/reject {id}",
};

/** A restore verb's arguments; null when the text isn't one of them. */
export function parseRestoreCommand(text: string): RestoreCommand | { error: string } | null {
  const m = text.match(/^\/(restore|redo|approve|reject)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const verb = m[1].toLowerCase() as RestoreCommand["verb"];
  const args = (m[2] ?? "").trim().match(/^#?(\d+)(?:\s+([\s\S]*))?$/);
  if (!args) return { error: `Usage: ${USAGE[verb]}` };
  const seq = parseInt(args[1], 10);
  const rest = (args[2] ?? "").trim();
  if (verb === "approve" || verb === "reject") {
    if (rest) return { error: `Usage: ${USAGE[verb]}` };
    return { verb, seq };
  }
  return { verb, seq, notes: rest };
}

// ---------------------------------------------------------------------------
// Pure pieces of /approve
// ---------------------------------------------------------------------------

/**
 * Copy the restored panel's image and image metadata onto the same panel (by
 * id) in `gallery`, leaving everything else as main has it, so a caption edit
 * made since the restore started survives. Returns the image it replaced, or
 * null when the panel is gone.
 */
export function applyRestoredPanel(gallery: Gallery, restored: PanelEntry): string | null {
  const panel = gallery.panels.find((p) => p.id === restored.id);
  if (!panel) return null;
  const previousImage = panel.image;
  const target = panel as unknown as Record<string, unknown>;
  const source = restored as unknown as Record<string, unknown>;
  for (const field of RESTORE_FIELDS) {
    if (field in source) target[field] = source[field];
  }
  return previousImage;
}

/** The paths `restore.py install` writes: a plain .jpg in a series folder. */
const IMAGE_PATH_RE = /^images\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.jpg$/;

function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

/**
 * Why `restored` isn't an image path /approve may write, or null when it is.
 * The branch is the workflow's output, so its gallery.json says where the new
 * image goes, and /approve writes that path on main. A restore only ever
 * versions the image in its own folder (issue-4-1.jpg → issue-4-1-v2.jpg), so
 * anything else, such as a data file or another panel's image, is refused.
 * scripts/restore_ci.py checks the same rule before the branch is pushed.
 */
export function restoredImageProblem(previous: string, restored: string): string | null {
  if (!IMAGE_PATH_RE.test(restored)) return `${restored} isn't an image path a restoration writes`;
  if (dirname(restored) !== dirname(previous)) {
    return `${restored} isn't in the same folder as ${previous}`;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove one id's entry from an embeddings file without re-serialising it, the
 * same edit `restore.py install` makes: the file is a single line of Python
 * `json.dumps`, and a JS round trip would rewrite its float formatting. Returns
 * null when the id has no entry (already pending).
 */
export function dropEmbedding(text: string, id: string): string | null {
  const key = JSON.stringify(id);
  const entry = new RegExp(`${escapeRegExp(key)}:\\s*\\[[^\\]]*\\](\\s*,\\s*)?`);
  const match = entry.exec(text);
  if (!match) return null;
  let start = match.index;
  // An entry with no comma after it is the last one: take the comma before it
  // instead, or the file is left with `..., }}`.
  if (!match[1]) start = text.slice(0, start).replace(/\s*,\s*$/, "").length;
  const out = text.slice(0, start) + text.slice(match.index + match[0].length);
  if (out.includes(`${key}:`)) throw new Error(`${id} has more than one embedding entry`);
  return out;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function panelLabel(p: PanelEntry): string {
  return `${p.title} ${formatIssue(p.issue)}`;
}

/** /restore and /redo: start the workflow. Returns the reply. */
export async function startRestore(
  env: Env,
  cmd: { verb: "restore" | "redo"; seq: number; notes: string },
  chat: { chatId: number; messageId: number }
): Promise<string> {
  const { gallery } = await readGalleryJson(env);
  const panel = gallery.panels.find((p) => p.seq === cmd.seq);
  if (!panel) return `No panel found with ID ${cmd.seq}.`;

  const pending = await getBranchSha(env, restoreBranch(cmd.seq));
  const failure = await dispatchWorkflow(env, RESTORE_WORKFLOW, {
    seq: String(cmd.seq),
    notes: cmd.notes,
    redo: cmd.verb === "redo",
    chat_id: String(chat.chatId),
    reply_to: String(chat.messageId),
  }).catch((err: unknown) => (err as Error).message);
  if (failure !== null) {
    return (
      `Couldn't start the restore workflow (${failure}). It has to be on main, ` +
      "and the bot's GitHub token needs Actions read/write."
    );
  }

  const lines = [
    `Restoring #${cmd.seq}, ${panelLabel(panel)}. The before/after comes back here in a few minutes.`,
  ];
  if (cmd.verb === "redo" && !pending) {
    lines.push("There's no earlier attempt waiting, so this one starts fresh.");
  } else if (pending) {
    lines.push(`It replaces the attempt waiting on ${restoreBranch(cmd.seq)}.`);
  }
  return lines.join("\n");
}

function refusal(seq: number, problem: string): string {
  return `Not approving #${seq}: ${problem}. /reject ${seq} drops it, /redo ${seq} tries again.`;
}

export interface ApproveResult {
  reply: string;
  /** The commit that landed on main, or null when nothing changed. */
  commitSha: string | null;
}

/** /approve: replay the branch's restoration onto main, then delete the branch. */
export async function approveRestore(env: Env, seq: number, attempts = 3): Promise<ApproveResult> {
  const branch = restoreBranch(seq);
  const branchSha = await getBranchSha(env, branch);
  if (!branchSha) {
    return { reply: `No restoration of #${seq} is waiting. /restore ${seq} starts one.`, commitSha: null };
  }

  const restored = (await readJsonFile<Gallery>(env, GALLERY_PATH, branchSha)).data?.panels.find(
    (p) => p.seq === seq
  );
  if (!restored) throw new Error(`${branch} has no panel #${seq} in its gallery.json`);
  if (!IMAGE_PATH_RE.test(restored.image)) {
    return { reply: refusal(seq, `${restored.image} isn't an image path a restoration writes`), commitSha: null };
  }
  const imageSha = await getFileSha(env, `public/${restored.image}`, branchSha);
  if (!imageSha) throw new Error(`${branch} doesn't contain ${restored.image}`);
  const message = await getCommitMessage(env, branchSha);

  for (let attempt = 1; ; attempt++) {
    const base = await getHeadSha(env);
    const gallery = (await readJsonFile<Gallery>(env, GALLERY_PATH, base)).data ?? { panels: [] };
    const previousImage = applyRestoredPanel(gallery, restored);
    if (previousImage === null) {
      return {
        reply: `Panel #${seq} isn't in the gallery any more. /reject ${seq} drops the restoration.`,
        commitSha: null,
      };
    }
    if (previousImage === restored.image) {
      const live = await getFileSha(env, `public/${restored.image}`, base);
      if (live !== imageSha) {
        return {
          reply: `Main already shows a different ${restored.image}. /redo ${seq} restores it again from there.`,
          commitSha: null,
        };
      }
      await deleteBranch(env, branch);
      return { reply: `#${seq}'s restoration is already on the site.`, commitSha: null };
    }
    const problem = restoredImageProblem(previousImage, restored.image);
    if (problem) return { reply: refusal(seq, problem), commitSha: null };
    // A restore writes a new file. One already at that path on main belongs to
    // something else, and placing the branch's blob would overwrite it.
    if ((await getFileSha(env, `public/${restored.image}`, base)) !== null) {
      return { reply: refusal(seq, `main already has a file at ${restored.image}`), commitSha: null };
    }

    const changes: TreeChange[] = [
      { path: GALLERY_PATH, content: serializeDataFile(GALLERY_PATH, gallery) },
      { path: `public/${restored.image}`, sha: imageSha },
      { path: `public/${previousImage}`, sha: null },
    ];
    for (const path of EMBEDDING_PATHS) {
      const text = await readRawFile(env, path, base);
      const out = text === null ? null : dropEmbedding(text, restored.id);
      if (out !== null) changes.push({ path, content: out });
    }

    let commitSha: string;
    try {
      commitSha = await commitFiles(env, base, changes, message);
    } catch (err) {
      if (err instanceof RefMovedError && attempt < attempts) continue;
      throw err;
    }
    await deleteBranch(env, branch);
    return {
      reply:
        `Approved #${seq}, ${panelLabel(restored)}. It's on main as ${restored.image}; ` +
        "the site picks it up once the metadata job has re-embedded it, in a few minutes.",
      commitSha,
    };
  }
}

/** /reject: drop the waiting restoration. */
export async function rejectRestore(env: Env, seq: number): Promise<string> {
  return (await deleteBranch(env, restoreBranch(seq)))
    ? `Dropped the restoration of #${seq}. The panel stays as it was.`
    : `No restoration of #${seq} is waiting.`;
}
