import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GitHubWriteError,
  addArtistTags,
  addSeriesTags,
  arrayBufferToBase64,
  commitFile,
  deletePanel,
  findSeries,
  formatIssue,
  isUpdatableField,
  lastArtistForSlug,
  mutateJsonFile,
  nextSeq,
  readGalleryJson,
  readJsonFile,
  updateGalleryJson,
  updatePanel,
  writeJsonFile,
} from "./github";
import type { Env, Gallery, PanelEntry } from "./types";

const env = { GITHUB_REPO: "owner/repo", GITHUB_TOKEN: "tok" } as Env;

function panel(over: Partial<PanelEntry> = {}): PanelEntry {
  return {
    seq: 1,
    id: "saga-1-abc",
    title: "Saga",
    slug: "saga",
    issue: 1,
    year: 2012,
    artist: "Fiona Staples",
    image: "images/saga/1.jpg",
    notes: null,
    tags: [],
    postedBy: "jek",
    addedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/**
 * A stand-in for the GitHub contents API: files live in a map, reads return
 * base64 with a sha, and writes are recorded so a test can inspect the commit.
 */
interface StubResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function githubStub(files: Record<string, unknown> = {}) {
  const store = new Map<string, { content: unknown; sha: string }>();
  for (const [path, content] of Object.entries(files)) {
    store.set(path, { content, sha: `sha-${path}` });
  }
  const writes: { path: string; method: string; body: Record<string, string> }[] = [];
  /** Statuses to return from the next PUTs, one per entry, before succeeding. */
  const putFailures: number[] = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<StubResponse> => {
    const path = decodeURIComponent(
      String(url).replace("https://api.github.com/repos/owner/repo/contents/", ""),
    );
    const method = init?.method ?? "GET";

    if (method === "GET") {
      const hit = store.get(path);
      if (!hit) {
        return { ok: false, status: 404, json: async () => null, text: async () => "not found" };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: hit.sha,
          content: Buffer.from(JSON.stringify(hit.content), "utf8").toString("base64"),
        }),
        text: async () => "",
      };
    }

    const body = JSON.parse(String(init?.body ?? "{}"));
    writes.push({ path, method, body });

    if (method === "PUT") {
      const status = putFailures.shift();
      if (status) {
        return { ok: false, status, json: async () => null, text: async () => "conflict" };
      }
      // Most writes are JSON documents; `commitFile` puts raw image bytes,
      // which are stored as-is.
      const raw = body.content ? Buffer.from(body.content, "base64").toString("utf8") : null;
      let content: unknown = raw;
      try {
        if (raw !== null) content = JSON.parse(raw);
      } catch {
        /* not JSON — an image */
      }
      store.set(path, { content, sha: `sha-${path}-${writes.length}` });
    }
    if (method === "DELETE") store.delete(path);
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  });

  vi.stubGlobal("fetch", fetchMock);
  return { store, writes, putFailures, fetchMock };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("formatIssue", () => {
  it("agrees with the frontend's copy", () => {
    expect(formatIssue(5)).toBe("#5");
    expect(formatIssue("VOL 1")).toBe("VOL 1");
  });
});

describe("arrayBufferToBase64", () => {
  it("encodes bytes", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(arrayBufferToBase64(bytes.buffer as ArrayBuffer)).toBe(
      Buffer.from("hello").toString("base64"),
    );
  });

  it("encodes an empty buffer", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });

  it("handles bytes outside the ASCII range", () => {
    const bytes = new Uint8Array([0, 127, 128, 255]);
    expect(arrayBufferToBase64(bytes.buffer)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("nextSeq", () => {
  it("is one past the highest existing seq", () => {
    const gallery: Gallery = { panels: [panel({ seq: 3 }), panel({ seq: 7 })] };
    expect(nextSeq(gallery)).toBe(8);
  });

  it("starts at one for an empty gallery", () => {
    expect(nextSeq({ panels: [] })).toBe(1);
  });

  it("does not assume the panels are in order", () => {
    expect(nextSeq({ panels: [panel({ seq: 9 }), panel({ seq: 2 })] })).toBe(10);
  });

  it("ignores an entry with no seq", () => {
    expect(nextSeq({ panels: [panel({ seq: undefined as never })] })).toBe(1);
  });
});

describe("lastArtistForSlug", () => {
  it("returns the artist on the most recently added panel of the series", () => {
    const gallery: Gallery = {
      panels: [
        panel({ seq: 1, slug: "saga", artist: "Early" }),
        panel({ seq: 5, slug: "saga", artist: "Latest" }),
      ],
    };
    expect(lastArtistForSlug(gallery, "saga")).toBe("Latest");
  });

  it("ignores other series", () => {
    const gallery: Gallery = {
      panels: [panel({ seq: 9, slug: "other", artist: "Nope" }), panel({ seq: 1, slug: "saga" })],
    };
    expect(lastArtistForSlug(gallery, "saga")).toBe("Fiona Staples");
  });

  it("skips panels with no artist", () => {
    const gallery: Gallery = {
      panels: [panel({ seq: 9, slug: "saga", artist: "" }), panel({ seq: 1, slug: "saga", artist: "Real" })],
    };
    expect(lastArtistForSlug(gallery, "saga")).toBe("Real");
  });

  it("is null for a series with no panels yet", () => {
    expect(lastArtistForSlug({ panels: [] }, "saga")).toBeNull();
  });
});

describe("isUpdatableField", () => {
  it("accepts the editable fields", () => {
    for (const f of ["title", "issue", "year", "artist", "notes", "tags"]) {
      expect(isUpdatableField(f)).toBe(true);
    }
  });

  it("rejects anything else, including derived fields", () => {
    for (const f of ["seq", "id", "slug", "image", "phash", "postedBy", ""]) {
      expect(isUpdatableField(f)).toBe(false);
    }
  });
});

describe("findSeries", () => {
  const list = [
    { id: "love-rockets", name: "Love & Rockets", aliases: ["L&R"] },
    { id: "saga", name: "Saga" },
  ];

  it("matches by id, name and alias, case-insensitively", () => {
    expect(findSeries(list, "LOVE-ROCKETS")?.id).toBe("love-rockets");
    expect(findSeries(list, "love & rockets")?.id).toBe("love-rockets");
    expect(findSeries(list, "l&r")?.id).toBe("love-rockets");
  });

  it("ignores surrounding whitespace", () => {
    expect(findSeries(list, "  saga  ")?.id).toBe("saga");
  });

  it("prefers an id match over a name match", () => {
    const ambiguous = [{ id: "b", name: "a" }, { id: "a", name: "z" }];
    expect(findSeries(ambiguous, "a")?.id).toBe("a");
  });

  it("is undefined when nothing matches", () => {
    expect(findSeries(list, "nope")).toBeUndefined();
  });

  it("tolerates an entry with no aliases", () => {
    expect(findSeries([{ id: "x", name: "X" }], "nope")).toBeUndefined();
  });
});

describe("GitHubWriteError", () => {
  it("treats 409 and 422 as conflicts — a stale sha", () => {
    expect(new GitHubWriteError(409, "x").isConflict).toBe(true);
    expect(new GitHubWriteError(422, "x").isConflict).toBe(true);
  });

  it("treats other statuses as hard failures", () => {
    expect(new GitHubWriteError(404, "x").isConflict).toBe(false);
    expect(new GitHubWriteError(500, "x").isConflict).toBe(false);
  });

  it("is a named Error carrying its status", () => {
    const err = new GitHubWriteError(409, "boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GitHubWriteError");
    expect(err.status).toBe(409);
  });
});

describe("readJsonFile", () => {
  it("parses the base64 payload and returns the sha", async () => {
    githubStub({ "data/x.json": { hello: "world" } });
    const out = await readJsonFile<{ hello: string }>(env, "data/x.json");
    expect(out.data).toEqual({ hello: "world" });
    expect(out.sha).toBe("sha-data/x.json");
  });

  it("reports a missing file as null rather than throwing", async () => {
    githubStub();
    expect(await readJsonFile(env, "data/missing.json")).toEqual({ data: null, sha: null });
  });

  it("throws on any other failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })),
    );
    await expect(readJsonFile(env, "data/x.json")).rejects.toThrow(/500/);
  });

  it("sends the token and a user agent", async () => {
    const { fetchMock } = githubStub({ "data/x.json": {} });
    await readJsonFile(env, "data/x.json");
    const headers = fetchMock.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["User-Agent"]).toBe("comic-panel-bot");
  });
});

describe("writeJsonFile", () => {
  it("commits pretty-printed JSON on the main branch", async () => {
    const { writes } = githubStub();
    await writeJsonFile(env, "data/x.json", { a: 1 }, null, "msg");
    expect(writes).toHaveLength(1);
    expect(writes[0].body.message).toBe("msg");
    expect(writes[0].body.branch).toBe("main");
    expect(Buffer.from(writes[0].body.content, "base64").toString("utf8")).toBe(
      JSON.stringify({ a: 1 }, null, 2),
    );
  });

  it("includes the sha when updating an existing file", async () => {
    const { writes } = githubStub();
    await writeJsonFile(env, "data/x.json", { a: 1 }, "abc", "msg");
    expect(writes[0].body.sha).toBe("abc");
  });

  it("omits the sha when creating a new file", async () => {
    const { writes } = githubStub();
    await writeJsonFile(env, "data/x.json", { a: 1 }, null, "msg");
    expect(writes[0].body.sha).toBeUndefined();
  });

  it("throws a GitHubWriteError carrying the status", async () => {
    const stub = githubStub();
    stub.putFailures.push(409);
    await expect(writeJsonFile(env, "data/x.json", {}, "stale", "msg")).rejects.toMatchObject({
      name: "GitHubWriteError",
      status: 409,
    });
  });
});

describe("mutateJsonFile", () => {
  it("reads, applies and commits in one pass", async () => {
    const { store } = githubStub({ "data/x.json": { count: 1 } });
    const result = await mutateJsonFile<{ count: number }, string>(
      env,
      "data/x.json",
      () => ({ count: 0 }),
      (doc) => {
        doc.count += 1;
        return { result: "done", message: "bump" };
      },
    );
    expect(result).toBe("done");
    expect(store.get("data/x.json")!.content).toEqual({ count: 2 });
  });

  it("starts from the empty document when the file does not exist", async () => {
    const { store } = githubStub();
    await mutateJsonFile<{ count: number }, void>(
      env,
      "data/new.json",
      () => ({ count: 0 }),
      (doc) => {
        doc.count += 1;
        return { result: undefined, message: "create" };
      },
    );
    expect(store.get("data/new.json")!.content).toEqual({ count: 1 });
  });

  it("retries the whole read-modify-write cycle on a conflict", async () => {
    // Two people tapping a rating at once is exactly the collision a bare PUT
    // loses; GitHub rejects the stale sha rather than clobbering.
    const stub = githubStub({ "data/x.json": { count: 1 } });
    stub.putFailures.push(409);
    const apply = vi.fn((doc: { count: number }) => {
      doc.count += 1;
      return { result: doc.count, message: "bump" };
    });

    const promise = mutateJsonFile<{ count: number }, number>(
      env,
      "data/x.json",
      () => ({ count: 0 }),
      apply,
    );
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(apply).toHaveBeenCalledTimes(2);
    // The retry re-read the file, so the change lands once, not twice.
    expect(stub.store.get("data/x.json")!.content).toEqual({ count: 2 });
  });

  it("re-applies against the newer file rather than the stale one", async () => {
    const stub = githubStub({ "data/x.json": { count: 1 } });
    stub.putFailures.push(409);
    let attempt = 0;
    const promise = mutateJsonFile<{ count: number }, number>(
      env,
      "data/x.json",
      () => ({ count: 0 }),
      (doc) => {
        if (attempt++ === 0) {
          // Someone else commits while this attempt is in flight; the PUT
          // then loses on the stale sha and the retry must see their work.
          stub.store.set("data/x.json", { content: { count: 50 }, sha: "newer" });
        }
        doc.count += 1;
        return { result: doc.count, message: "bump" };
      },
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toBe(51);
    expect(stub.store.get("data/x.json")!.content).toEqual({ count: 51 });
  });

  it("gives up after the attempt budget", async () => {
    const stub = githubStub({ "data/x.json": { count: 1 } });
    stub.putFailures.push(409, 409, 409, 409);
    const promise = mutateJsonFile(
      env,
      "data/x.json",
      () => ({}),
      () => ({ result: null, message: "m" }),
      4,
    );
    const assertion = expect(promise).rejects.toMatchObject({ status: 409 });
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("does not retry a non-conflict failure", async () => {
    const stub = githubStub({ "data/x.json": {} });
    stub.putFailures.push(500);
    const apply = vi.fn(() => ({ result: null, message: "m" }));
    await expect(
      mutateJsonFile(env, "data/x.json", () => ({}), apply),
    ).rejects.toMatchObject({ status: 500 });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("honours a custom attempt budget", async () => {
    const stub = githubStub({ "data/x.json": {} });
    stub.putFailures.push(409, 409);
    const apply = vi.fn(() => ({ result: null, message: "m" }));
    const promise = mutateJsonFile(env, "data/x.json", () => ({}), apply, 2);
    const assertion = expect(promise).rejects.toMatchObject({ status: 409 });
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(apply).toHaveBeenCalledTimes(2);
  });
});

describe("readGalleryJson", () => {
  it("parses the gallery and its sha", async () => {
    githubStub({ "public/data/gallery.json": { panels: [panel()] } });
    const { gallery, sha } = await readGalleryJson(env);
    expect(gallery.panels).toHaveLength(1);
    expect(sha).toBe("sha-public/data/gallery.json");
  });

  it("treats a missing gallery as empty rather than an error", async () => {
    githubStub();
    expect(await readGalleryJson(env)).toEqual({ gallery: { panels: [] }, sha: null });
  });

  it("throws on any other read failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, text: async () => "down" })),
    );
    await expect(readGalleryJson(env)).rejects.toThrow(/503/);
  });
});

describe("updateGalleryJson", () => {
  it("prepends the new panel so the newest is first", async () => {
    const { store } = githubStub({ "public/data/gallery.json": { panels: [panel({ seq: 1 })] } });
    await updateGalleryJson(env, panel({ seq: 2, title: "New" }));
    const saved = store.get("public/data/gallery.json")!.content as Gallery;
    expect(saved.panels.map((p) => p.seq)).toEqual([2, 1]);
  });

  it("names the panel in the commit message", async () => {
    const { writes } = githubStub({ "public/data/gallery.json": { panels: [] } });
    await updateGalleryJson(env, panel({ title: "Saga", issue: 4 }));
    expect(writes[0].body.message).toBe("Update gallery: add Saga #4");
  });
});

describe("updatePanel", () => {
  const gallery = () => ({ "public/data/gallery.json": { panels: [panel({ seq: 1 })] } });

  it("refuses a field that is not updatable", async () => {
    githubStub(gallery());
    await expect(updatePanel(env, 1, "slug", "x")).rejects.toThrow(/Cannot update "slug"/);
  });

  it("is null for a panel that does not exist", async () => {
    githubStub(gallery());
    expect(await updatePanel(env, 999, "title", "x")).toBeNull();
  });

  it("updates a text field", async () => {
    githubStub(gallery());
    expect((await updatePanel(env, 1, "title", "New Title"))!.title).toBe("New Title");
  });

  it("parses an issue the same way the caption parser does", async () => {
    githubStub(gallery());
    expect((await updatePanel(env, 1, "issue", "4"))!.issue).toBe(4);
    githubStub(gallery());
    expect((await updatePanel(env, 1, "issue", "VOL 1"))!.issue).toBe("VOL 1");
  });

  it("rejects a year that is not a number", async () => {
    githubStub(gallery());
    await expect(updatePanel(env, 1, "year", "soon")).rejects.toThrow(/Invalid year/);
  });

  it("clears notes when given an empty value", async () => {
    githubStub(gallery());
    expect((await updatePanel(env, 1, "notes", ""))!.notes).toBeNull();
  });

  it("splits, trims and compacts a tag list", async () => {
    githubStub(gallery());
    expect((await updatePanel(env, 1, "tags", " a , ,b "))!.tags).toEqual(["a", "b"]);
  });

  it("names the panel and the field in the commit message", async () => {
    const { writes } = githubStub(gallery());
    await updatePanel(env, 1, "title", "New");
    expect(writes[0].body.message).toBe("Update gallery: edit New #1 (title)");
  });
});

describe("deletePanel", () => {
  const files = () => ({
    "public/data/gallery.json": { panels: [panel({ seq: 1 }), panel({ seq: 2 })] },
    "public/images/saga/1.jpg": "bytes",
  });

  it("removes the entry and returns it", async () => {
    const { store } = githubStub(files());
    const removed = await deletePanel(env, 1);
    expect(removed!.seq).toBe(1);
    expect((store.get("public/data/gallery.json")!.content as Gallery).panels).toHaveLength(1);
  });

  it("deletes the image file too", async () => {
    const { store, writes } = githubStub(files());
    await deletePanel(env, 1);
    expect(store.has("public/images/saga/1.jpg")).toBe(false);
    expect(writes.some((w) => w.method === "DELETE")).toBe(true);
  });

  it("writes the gallery before touching the image", async () => {
    const { writes } = githubStub(files());
    await deletePanel(env, 1);
    expect(writes[0].path).toBe("public/data/gallery.json");
  });

  it("is null when no panel carries that seq", async () => {
    const { writes } = githubStub(files());
    expect(await deletePanel(env, 999)).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it("still removes the entry when the image is already gone", async () => {
    const { store } = githubStub({
      "public/data/gallery.json": { panels: [panel({ seq: 1 })] },
    });
    expect((await deletePanel(env, 1))!.seq).toBe(1);
    expect((store.get("public/data/gallery.json")!.content as Gallery).panels).toEqual([]);
  });
});

describe("addSeriesTags", () => {
  const files = () => ({
    "public/data/series.json": {
      series: [{ id: "saga", name: "Saga", tags: ["existing"] }],
    },
  });

  it("adds a new tag and reports the diff", async () => {
    const { store } = githubStub(files());
    const out = await addSeriesTags(env, "Saga", ["new"]);
    expect(out.entry).toEqual({ id: "saga", name: "Saga" });
    expect(out.addedTags).toEqual(["new"]);
    expect(out.allTags).toEqual(["existing", "new"]);
    const saved = store.get("public/data/series.json")!.content as {
      series: { tags: string[] }[];
    };
    expect(saved.series[0].tags).toEqual(["existing", "new"]);
  });

  it("reports only the tags that were actually new", async () => {
    githubStub(files());
    const out = await addSeriesTags(env, "Saga", ["existing", "new"]);
    expect(out.addedTags).toEqual(["new"]);
  });

  it("writes nothing when every tag is already there", async () => {
    const { writes } = githubStub(files());
    const out = await addSeriesTags(env, "Saga", ["existing"]);
    expect(out.addedTags).toEqual([]);
    expect(out.allTags).toEqual(["existing"]);
    expect(writes).toHaveLength(0);
  });

  it("does nothing for an empty tag list", async () => {
    const { fetchMock } = githubStub(files());
    expect(await addSeriesTags(env, "Saga", [])).toEqual({
      entry: null,
      addedTags: [],
      allTags: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports no entry for an unknown series", async () => {
    githubStub(files());
    expect((await addSeriesTags(env, "nope", ["x"])).entry).toBeNull();
  });

  it("reports no entry when series.json does not exist", async () => {
    githubStub();
    expect((await addSeriesTags(env, "Saga", ["x"])).entry).toBeNull();
  });

  it("names the series and the tags in the commit message", async () => {
    const { writes } = githubStub(files());
    await addSeriesTags(env, "Saga", ["a", "b"]);
    expect(writes[0].body.message).toBe("Update series: tag Saga (a, b)");
  });
});

describe("addArtistTags", () => {
  const files = () => ({
    "public/data/artists.json": {
      artists: [{ id: "jean-giraud", name: "Jean Giraud", aliases: ["Moebius"] }],
    },
  });

  it("matches an artist through an alias", async () => {
    githubStub(files());
    const out = await addArtistTags(env, "moebius", ["sci-fi"]);
    expect(out.entry).toEqual({ id: "jean-giraud", name: "Jean Giraud" });
    expect(out.addedTags).toEqual(["sci-fi"]);
  });

  it("creates the tag list on an entry that has none", async () => {
    const { store } = githubStub(files());
    await addArtistTags(env, "jean-giraud", ["sci-fi"]);
    const saved = store.get("public/data/artists.json")!.content as {
      artists: { tags: string[] }[];
    };
    expect(saved.artists[0].tags).toEqual(["sci-fi"]);
  });

  it("does nothing for an empty tag list", async () => {
    const { fetchMock } = githubStub(files());
    expect((await addArtistTags(env, "moebius", [])).entry).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports no entry for an unknown artist", async () => {
    githubStub(files());
    expect((await addArtistTags(env, "nobody", ["x"])).entry).toBeNull();
  });

  it("names the artist in the commit message", async () => {
    const { writes } = githubStub(files());
    await addArtistTags(env, "moebius", ["sci-fi"]);
    expect(writes[0].body.message).toBe("Update artist: tag Jean Giraud (sci-fi)");
  });
});

describe("commitFile", () => {
  it("PUTs the content on the main branch", async () => {
    const { writes } = githubStub();
    await commitFile(env, "public/images/x.jpg", "Ynl0ZXM=", "Add x");
    expect(writes[0]).toMatchObject({
      path: "public/images/x.jpg",
      method: "PUT",
      body: { message: "Add x", content: "Ynl0ZXM=", branch: "main" },
    });
  });

  it("throws with the status on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 422, text: async () => "bad" })),
    );
    await expect(commitFile(env, "p", "c", "m")).rejects.toThrow(/422/);
  });
});
