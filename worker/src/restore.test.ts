import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_PATHS,
  applyRestoredPanel,
  approveRestore,
  dropEmbedding,
  parseRestoreCommand,
  rejectRestore,
  startRestore,
} from "./restore";
import type { Env, Gallery, PanelEntry } from "./types";

const env = { GITHUB_REPO: "owner/repo", GITHUB_TOKEN: "tok" } as Env;
const API = "https://api.github.com/repos/owner/repo/";
const GALLERY = "public/data/gallery.json";

function panel(over: Partial<PanelEntry> & Record<string, unknown> = {}): PanelEntry {
  return {
    seq: 7,
    id: "saga-4-1",
    title: "Saga",
    slug: "saga",
    issue: 4,
    year: 2012,
    artist: "Fiona Staples",
    image: "images/saga/issue-4-1.jpg",
    notes: null,
    tags: [],
    postedBy: "jek",
    addedAt: "2026-01-01T00:00:00.000Z",
    width: 800,
    height: 1280,
    phash: "aa",
    ...over,
  } as PanelEntry;
}

describe("parseRestoreCommand", () => {
  it("reads the id and any directions", () => {
    expect(parseRestoreCommand("/restore 247")).toEqual({ verb: "restore", seq: 247, notes: "" });
    expect(parseRestoreCommand("/restore #247 keep the\nyellow sky")).toEqual({
      verb: "restore",
      seq: 247,
      notes: "keep the\nyellow sky",
    });
    expect(parseRestoreCommand("/redo@comic_bot 3 take less")).toEqual({
      verb: "redo",
      seq: 3,
      notes: "take less",
    });
    expect(parseRestoreCommand("/approve 12")).toEqual({ verb: "approve", seq: 12 });
    expect(parseRestoreCommand("/REJECT 12")).toEqual({ verb: "reject", seq: 12 });
  });

  it("answers a missing id or stray words with usage", () => {
    expect(parseRestoreCommand("/restore")).toHaveProperty("error");
    expect(parseRestoreCommand("/restore saga 4")).toHaveProperty("error");
    expect(parseRestoreCommand("/approve 12 please")).toHaveProperty("error");
  });

  it("ignores other commands", () => {
    expect(parseRestoreCommand("/restored 4")).toBeNull();
    expect(parseRestoreCommand("/rate 4 8")).toBeNull();
  });
});

describe("dropEmbedding", () => {
  const file = (entries: string) => `{"model_version": "v1", "dim": 2, "embeddings": {${entries}}}`;

  it("removes an entry from the middle", () => {
    const text = file(`"a": [0.1, -0.2], "b": [1e-05, 0.3], "c": [0.4, 0.5]`);
    expect(dropEmbedding(text, "b")).toBe(file(`"a": [0.1, -0.2], "c": [0.4, 0.5]`));
  });

  it("removes the first and the last entry without stranding a comma", () => {
    const text = file(`"a": [0.1], "b": [0.2]`);
    expect(dropEmbedding(text, "a")).toBe(file(`"b": [0.2]`));
    expect(dropEmbedding(text, "b")).toBe(file(`"a": [0.1]`));
    expect(JSON.parse(dropEmbedding(`${text}\n`, "b")!)).toEqual(JSON.parse(file(`"a": [0.1]`)));
  });

  it("leaves the Python float formatting alone", () => {
    const text = file(`"a": [1e-05, 2.0], "b": [0.2]`);
    expect(dropEmbedding(text, "b")).toContain("[1e-05, 2.0]");
  });

  it("matches the whole id, not a suffix of another", () => {
    const text = file(`"xb": [0.1], "b": [0.2]`);
    expect(dropEmbedding(text, "b")).toBe(file(`"xb": [0.1]`));
  });

  it("returns null when the id has no entry", () => {
    expect(dropEmbedding(file(`"a": [0.1]`), "b")).toBeNull();
  });
});

describe("applyRestoredPanel", () => {
  it("copies only the image and its metadata, keeping caption edits made since", () => {
    const gallery: Gallery = { panels: [panel({ title: "Saga (retitled)" })] };
    const restored = panel({ image: "images/saga/issue-4-1-v2.jpg", phash: "bb", width: 801 });
    expect(applyRestoredPanel(gallery, restored)).toBe("images/saga/issue-4-1.jpg");
    expect(gallery.panels[0]).toMatchObject({
      title: "Saga (retitled)",
      image: "images/saga/issue-4-1-v2.jpg",
      phash: "bb",
      width: 801,
    });
  });

  it("keeps the panel's key order, so the diff is only the changed lines", () => {
    const gallery: Gallery = { panels: [panel()] };
    applyRestoredPanel(gallery, panel({ image: "images/saga/issue-4-1-v2.jpg" }));
    expect(Object.keys(gallery.panels[0])).toEqual(Object.keys(panel()));
  });

  it("returns null when the panel was deleted", () => {
    expect(applyRestoredPanel({ panels: [] }, panel())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The GitHub side
// ---------------------------------------------------------------------------

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function gitStub(opts: {
  main: Gallery;
  branch?: Gallery | null;
  embeddings?: string;
  conflicts?: number;
  liveImageSha?: string;
}) {
  const calls: Call[] = [];
  let head = "c0";
  let conflicts = opts.conflicts ?? 0;
  const json = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === null ? "" : typeof body === "string" ? body : JSON.stringify(body)),
  });

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(url).replace(API, "");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });

    if (path === "git/ref/heads/main") return json(200, { object: { sha: head } });
    if (path === "git/ref/heads/restore/7") {
      return opts.branch ? json(200, { object: { sha: "b1" } }) : json(404, { message: "Not Found" });
    }
    if (path === "git/refs/heads/restore/7" && method === "DELETE") {
      return opts.branch ? json(204, null) : json(422, { message: "Reference does not exist" });
    }
    if (path.startsWith("contents/")) {
      const [file, query] = decodeURIComponent(path.replace("contents/", "")).split("?ref=");
      const raw = (init?.headers as Record<string, string>)?.Accept?.includes("raw");
      if (file === GALLERY) {
        const doc = query === "b1" ? opts.branch : opts.main;
        return json(200, {
          sha: `g-${query}`,
          content: Buffer.from(JSON.stringify(doc), "utf8").toString("base64"),
        });
      }
      if (file.startsWith("public/images/")) {
        if (query === "b1") return json(200, { type: "file", sha: "img-blob" });
        if (opts.liveImageSha) return json(200, { type: "file", sha: opts.liveImageSha });
        return json(404, { message: "Not Found" });
      }
      if (raw && (EMBEDDING_PATHS as string[]).includes(file) && opts.embeddings !== undefined) {
        return json(200, opts.embeddings);
      }
      return json(404, { message: "Not Found" });
    }
    if (path === "git/commits/b1") return json(200, { message: "Restore #7: Saga #4\n\nlevels only" });
    if (path.startsWith("git/commits/")) return json(200, { tree: { sha: "t0" } });
    if (path === "git/trees") return json(201, { sha: "t1" });
    if (path === "git/commits") return json(201, { sha: "c1" });
    if (path === "git/refs/heads/main") {
      if (conflicts > 0) {
        conflicts--;
        head = `moved-${conflicts}`;
        return json(422, { message: "Update is not a fast forward" });
      }
      return json(200, { object: { sha: body!.sha } });
    }
    if (path.startsWith("actions/workflows/")) return json(204, null);
    return json(500, { message: `unexpected ${method} ${path}` });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const restoredGallery = (): Gallery => ({
  panels: [panel({ image: "images/saga/issue-4-1-v2.jpg", phash: "bb" })],
});
const EMBEDDINGS = `{"model_version": "v1", "dim": 1, "embeddings": {"hup-1": [0.1], "saga-4-1": [0.2]}}`;

describe("approveRestore", () => {
  it("lands the branch's image, metadata and embedding drop on main in one commit", async () => {
    const { calls } = gitStub({
      main: { panels: [panel({ notes: "edited since" })] },
      branch: restoredGallery(),
      embeddings: EMBEDDINGS,
    });
    const result = await approveRestore(env, 7);

    expect(result.commitSha).toBe("c1");
    const tree = calls.find((c) => c.path === "git/trees")!.body as {
      tree: { path: string; content?: string; sha?: string | null }[];
    };
    const byPath = Object.fromEntries(tree.tree.map((t) => [t.path, t]));
    expect(byPath["public/images/saga/issue-4-1-v2.jpg"]).toMatchObject({ sha: "img-blob", mode: "100644" });
    expect(byPath["public/images/saga/issue-4-1.jpg"]).toMatchObject({ sha: null });
    expect(JSON.parse(byPath[GALLERY].content!).panels[0]).toMatchObject({
      image: "images/saga/issue-4-1-v2.jpg",
      phash: "bb",
      notes: "edited since",
    });
    for (const path of EMBEDDING_PATHS) {
      expect(JSON.parse(byPath[path].content!).embeddings).toEqual({ "hup-1": [0.1] });
    }
    expect(calls.find((c) => c.path === "git/commits")!.body).toMatchObject({
      message: "Restore #7: Saga #4\n\nlevels only",
      parents: ["c0"],
    });
    expect(calls.some((c) => c.method === "DELETE" && c.path === "git/refs/heads/restore/7")).toBe(true);
  });

  it("reads the embeddings raw, since the JSON contents API stops at 1 MB", async () => {
    const { calls } = gitStub({ main: { panels: [panel()] }, branch: restoredGallery(), embeddings: EMBEDDINGS });
    await approveRestore(env, 7);
    const reads = calls.filter((c) => c.path.includes("embeddings"));
    expect(reads).toHaveLength(EMBEDDING_PATHS.length);
  });

  it("re-applies against the newer main when main moves", async () => {
    const { calls } = gitStub({
      main: { panels: [panel()] },
      branch: restoredGallery(),
      embeddings: EMBEDDINGS,
      conflicts: 1,
    });
    const result = await approveRestore(env, 7);
    expect(result.commitSha).toBe("c1");
    const parents = calls.filter((c) => c.path === "git/commits").map((c) => c.body!.parents);
    expect(parents).toEqual([["c0"], ["moved-0"]]);
  });

  it("says so when nothing is waiting", async () => {
    gitStub({ main: { panels: [panel()] }, branch: null });
    const result = await approveRestore(env, 7);
    expect(result).toEqual({ reply: expect.stringContaining("No restoration of #7"), commitSha: null });
  });

  it("doesn't commit when the panel was deleted meanwhile", async () => {
    const { calls } = gitStub({ main: { panels: [] }, branch: restoredGallery() });
    const result = await approveRestore(env, 7);
    expect(result.commitSha).toBeNull();
    expect(result.reply).toContain("isn't in the gallery");
    expect(calls.some((c) => c.path === "git/trees")).toBe(false);
  });

  it("treats a second /approve as done", async () => {
    gitStub({ main: restoredGallery(), branch: restoredGallery(), liveImageSha: "img-blob" });
    const result = await approveRestore(env, 7);
    expect(result).toEqual({ reply: expect.stringContaining("already on the site"), commitSha: null });
  });

  it("refuses a branch whose image path points anywhere but a new file beside the old one", async () => {
    for (const image of [
      "data/artists.json",
      "index.html",
      "images/saga/../../data/series.json",
      "images/hup/issue-1-2.jpg",
    ]) {
      const { calls } = gitStub({
        main: { panels: [panel()] },
        branch: { panels: [panel({ image, phash: "bb" })] },
        embeddings: EMBEDDINGS,
      });
      const result = await approveRestore(env, 7);
      expect(result.commitSha).toBeNull();
      expect(result.reply).toMatch(/^Not approving #7/);
      expect(calls.some((c) => c.path === "git/trees")).toBe(false);
    }
  });

  it("refuses to overwrite a file main already has at the new path", async () => {
    const { calls } = gitStub({
      main: { panels: [panel()] },
      branch: restoredGallery(),
      embeddings: EMBEDDINGS,
      liveImageSha: "someone-elses",
    });
    const result = await approveRestore(env, 7);
    expect(result.reply).toContain("main already has a file at images/saga/issue-4-1-v2.jpg");
    expect(calls.some((c) => c.path === "git/trees")).toBe(false);
  });

  it("refuses when main has a different image under the same name", async () => {
    gitStub({ main: restoredGallery(), branch: restoredGallery(), liveImageSha: "someone-elses" });
    const result = await approveRestore(env, 7);
    expect(result.commitSha).toBeNull();
    expect(result.reply).toContain("/redo 7");
  });
});

describe("startRestore", () => {
  it("dispatches the workflow with the chat to answer in", async () => {
    const { calls } = gitStub({ main: { panels: [panel()] }, branch: null });
    const reply = await startRestore(env, { verb: "restore", seq: 7, notes: "keep it warm" }, { chatId: -5, messageId: 99 });
    expect(reply).toContain("Restoring #7, Saga #4");
    expect(calls.find((c) => c.path === "actions/workflows/restore.yml/dispatches")!.body).toEqual({
      ref: "main",
      inputs: { seq: "7", notes: "keep it warm", redo: false, chat_id: "-5", reply_to: "99" },
    });
  });

  it("says when a redo has nothing to build on", async () => {
    gitStub({ main: { panels: [panel()] }, branch: null });
    const reply = await startRestore(env, { verb: "redo", seq: 7, notes: "less" }, { chatId: -5, messageId: 99 });
    expect(reply).toContain("starts fresh");
  });

  it("doesn't dispatch for a panel that doesn't exist", async () => {
    const { calls } = gitStub({ main: { panels: [] }, branch: null });
    const reply = await startRestore(env, { verb: "restore", seq: 7, notes: "" }, { chatId: -5, messageId: 99 });
    expect(reply).toBe("No panel found with ID 7.");
    expect(calls.some((c) => c.path.startsWith("actions/"))).toBe(false);
  });
});

describe("rejectRestore", () => {
  it("deletes the branch, or says there was none", async () => {
    gitStub({ main: { panels: [] }, branch: restoredGallery() });
    expect(await rejectRestore(env, 7)).toContain("Dropped");
    gitStub({ main: { panels: [] }, branch: null });
    expect(await rejectRestore(env, 7)).toContain("No restoration");
  });
});
