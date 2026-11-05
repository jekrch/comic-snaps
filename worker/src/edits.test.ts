import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARTISTS_PATH,
  DISAMBIGUATION_PATH,
  GALLERY_PATH,
  SERIES_PATH,
  Workspace,
  WorkspaceLoadError,
  applyCommand,
  commandVerb,
  findArtist,
  formatRun,
  isUpdatableField,
  mergeTags,
  parseEditCommand,
  runCommands,
} from "./edits";
import type { Env, PanelEntry, SeriesEntry } from "./types";

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

function series(over: Partial<SeriesEntry> & { id: string; name: string }): SeriesEntry {
  return { parentSeries: null, references: [], ...over };
}

/** A workspace over in-memory files, with the parsed docs reachable for asserts. */
function workspace(files: Record<string, unknown>) {
  const store = structuredClone(files);
  const loader = vi.fn(async (path: string) => store[path] ?? null);
  return { ws: new Workspace(loader), store, loader };
}

const baseFiles = () => ({
  [GALLERY_PATH]: {
    panels: [
      panel({ seq: 1 }),
      panel({ seq: 2, issue: 2 }),
      panel({ seq: 3, title: "Thrillology", slug: "thrillology", artist: "Pius Bak" }),
      panel({ seq: 4, title: "Hellboy", slug: "hellboy", artist: "Mike Mignola" }),
    ],
  },
  [SERIES_PATH]: {
    series: [
      series({ id: "hellboy", name: "Hellboy" }),
      series({ id: "saga", name: "Saga", tags: ["existing"] }),
      series({
        id: "thrillology",
        name: "Thrillology",
        sources: ["comicvine", "metron", "metron-series-lookup"],
        coverSources: { metron: [1], comicvine: [1] },
      }),
    ],
  },
  [ARTISTS_PATH]: {
    artists: [{ id: "jean-giraud", name: "Jean Giraud", aliases: ["Moebius"] }],
  },
  [DISAMBIGUATION_PATH]: {
    "metron:series": {
      Hup: { id: null, candidates: [{ id: 11, name: "Hup (1987)" }, { id: 12, name: "Hup (2020)" }] },
    },
  },
});

describe("commandVerb", () => {
  it("drops a bot-name suffix and lowercases", () => {
    expect(commandVerb("/Rename_Series@ComicBot thrillology // X")).toBe("/rename_series");
  });
});

describe("parseEditCommand", () => {
  it("is null for anything that isn't an edit verb", () => {
    expect(parseEditCommand("/rate 5 8")).toBeNull();
    expect(parseEditCommand("hello")).toBeNull();
  });

  it("keeps everything but notes on one line", () => {
    expect(parseEditCommand("/update 3 title Saga\nimage=x")).toEqual({
      error: expect.stringMatching(/one line/),
    });
    expect(parseEditCommand("/rename_series saga // Saga\nVol 2")).toEqual({
      error: expect.stringMatching(/one line/),
    });
    expect(parseEditCommand("/tag_series saga // a,\nb")).toEqual({
      error: expect.stringMatching(/one line/),
    });
    expect(parseEditCommand("/update 3 notes first\nsecond")).toEqual({
      verb: "update",
      seq: 3,
      field: "notes",
      value: "first\nsecond",
    });
  });

  it("reads /update and rejects an unknown field", () => {
    expect(parseEditCommand("/update 3 artist Fiona Staples")).toEqual({
      verb: "update",
      seq: 3,
      field: "artist",
      value: "Fiona Staples",
    });
    expect(parseEditCommand("/update 3 slug x")).toEqual({
      error: 'Invalid field "slug". Updatable fields: title, issue, year, artist, notes, tags',
    });
    expect(parseEditCommand("/update three title x")).toHaveProperty("error");
  });

  it("strips tag prefixes, since the command decides the target", () => {
    expect(parseEditCommand("/tag_series Saga // +space opera, ++indie, sci-fi")).toEqual({
      verb: "tag_series",
      ref: "Saga",
      tags: ["sci-fi", "space opera", "indie"],
    });
  });

  it("reports the tag command's usage problems", () => {
    expect(parseEditCommand("/tag_artist Moebius")).toEqual({
      error: "Expected format:\n/tag_artist {ref} // tag1, tag2",
    });
    expect(parseEditCommand("/tag_series // x")).toEqual({ error: "Missing series reference." });
    expect(parseEditCommand("/tag_series Saga // , ,")).toEqual({ error: "No tags provided." });
  });

  it("reads /rename_series with and without a start year", () => {
    expect(parseEditCommand("/rename_series thrillology // Thrillogy")).toEqual({
      verb: "rename_series",
      ref: "thrillology",
      name: "Thrillogy",
      startYear: null,
    });
    expect(parseEditCommand("/rename_series 247 // Legion of Super-Heroes // 1989")).toMatchObject({
      startYear: 1989,
    });
    expect(parseEditCommand("/rename_series x // y // soon")).toEqual({
      error: 'Invalid start year: "soon"',
    });
    expect(parseEditCommand("/rename_series thrillology")).toHaveProperty("error");
  });

  it("reads /resolve only for the sections the pipeline reads", () => {
    expect(parseEditCommand("/resolve metron:series // Hup // 11")).toEqual({
      verb: "resolve",
      key: "metron:series",
      name: "Hup",
      id: 11,
    });
    expect(parseEditCommand("/resolve comicvine:series // Hup // 11")).toHaveProperty("error");
    expect(parseEditCommand("/resolve metron:series // Hup // abc")).toHaveProperty("error");
  });
});

describe("isUpdatableField", () => {
  it("accepts the editable fields and nothing derived", () => {
    for (const f of ["title", "issue", "year", "artist", "notes", "tags"]) {
      expect(isUpdatableField(f)).toBe(true);
    }
    expect(isUpdatableField("slug")).toBe(false);
    expect(isUpdatableField("seq")).toBe(false);
  });
});

describe("findArtist / mergeTags", () => {
  it("matches an artist through an alias, case-insensitively", () => {
    expect(findArtist([{ id: "jean-giraud", name: "Jean Giraud", aliases: ["Moebius"] }], "moebius")?.id).toBe(
      "jean-giraud",
    );
  });

  it("returns only the tags that were new, and creates the list if missing", () => {
    const entry: { tags?: string[] } = {};
    expect(mergeTags(entry, ["a", "b", "a"])).toEqual(["a", "b"]);
    expect(mergeTags(entry, ["b", "c"])).toEqual(["c"]);
    expect(entry.tags).toEqual(["a", "b", "c"]);
  });
});

describe("applyCommand: /update", () => {
  it("updates a field and says what changed", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/update 1 artist Someone Else");
    expect(out.reply).toBe('Updated panel #1: set artist to "Someone Else"\n→ Saga #1');
    expect(out.summary).toBe("Update gallery: edit Saga #1 (artist)");
    expect((await ws.gallery()).panels[0].artist).toBe("Someone Else");
  });

  it("parses issues like the caption parser, and rejects bad years", async () => {
    const { ws } = workspace(baseFiles());
    await applyCommand(ws, "/update 1 issue Annual 2");
    expect((await ws.gallery()).panels[0].issue).toBe("Annual 2");
    await expect(applyCommand(ws, "/update 1 year soon")).rejects.toThrow('Invalid year: "soon"');
  });

  it("splits, trims and compacts a tag list", async () => {
    const { ws } = workspace(baseFiles());
    await applyCommand(ws, "/update 1 tags  a , ,b ");
    expect((await ws.gallery()).panels[0].tags).toEqual(["a", "b"]);
  });

  it("fails for a panel that doesn't exist", async () => {
    const { ws } = workspace(baseFiles());
    await expect(applyCommand(ws, "/update 99 artist x")).rejects.toThrow("No panel found with ID 99.");
  });

  it("moves a panel to the series its new title names, slug and all", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/update 4 title saga");
    const moved = (await ws.gallery()).panels.find((p) => p.seq === 4)!;
    expect(moved.slug).toBe("saga");
    expect(moved.title).toBe("Saga");
    expect(out.reply).toContain('Matched series "Saga"');
  });

  it("starts a new series when the title names none", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/update 4 title B.P.R.D.");
    const moved = (await ws.gallery()).panels.find((p) => p.seq === 4)!;
    expect(moved.slug).toBe("b-p-r-d");
    expect(out.reply).toContain("New series: b-p-r-d");
  });
});

describe("applyCommand: tags", () => {
  it("adds new series tags and reports the diff", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/tag_series Saga // existing, new");
    expect(out.reply).toBe("Tagged series Saga:\n  Added: new\n  Tags: existing, new");
    expect(out.summary).toBe("Update series: tag Saga (new)");
  });

  it("changes nothing when every tag is already there", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/tag_series saga // existing");
    expect(out).toEqual({ reply: "Saga: all tags already present.\n  Tags: existing", summary: null });
    expect(ws.dirtyFiles()).toEqual([]);
  });

  it("tags an artist found by alias", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/tag_artist moebius // sci-fi");
    expect(out.summary).toBe("Update artist: tag Jean Giraud (sci-fi)");
    expect(ws.dirtyFiles().map((f) => f.path)).toEqual([ARTISTS_PATH]);
  });

  it("fails for an unknown series", async () => {
    const { ws } = workspace(baseFiles());
    await expect(applyCommand(ws, "/tag_series Nope // x")).rejects.toThrow('No series found matching "Nope".');
  });
});

describe("applyCommand: /rename_series", () => {
  it("retitles every panel, keeps the slug, and resets the lookup markers", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/rename_series thrillology // Thrillogy");

    const panels = (await ws.gallery()).panels.filter((p) => p.slug === "thrillology");
    expect(panels.map((p) => p.title)).toEqual(["Thrillogy"]);

    const entry = (await ws.series()).series.find((s) => s.id === "thrillology")!;
    expect(entry.name).toBe("Thrillogy");
    expect(entry.aliases).toEqual(["Thrillology"]);
    expect(entry.sources).toEqual([]);
    expect(entry).not.toHaveProperty("coverSources");

    expect(out.reply).toContain('Renamed series thrillology: "Thrillology" → "Thrillogy"');
    expect(out.reply).toContain("1 panel(s) retitled");
    expect(out.summary).toBe("Update series: rename thrillology to Thrillogy");
    expect(ws.dirtyFiles().map((f) => f.path).sort()).toEqual([GALLERY_PATH, SERIES_PATH].sort());
  });

  it("resolves the series by name, alias, or a panel id", async () => {
    for (const ref of ["Thrillology", "3"]) {
      const { ws } = workspace(baseFiles());
      await applyCommand(ws, `/rename_series ${ref} // Thrillogy`);
      expect((await ws.series()).series.find((s) => s.id === "thrillology")!.name).toBe("Thrillogy");
    }
  });

  it("sets the start year when given", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/rename_series saga // Saga // 2012");
    expect((await ws.series()).series.find((s) => s.id === "saga")!.startYear).toBe(2012);
    expect(out.reply).toContain("Start year set to 2012");
  });

  it("re-runs the lookup without renaming when the name is unchanged", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/rename_series thrillology // Thrillology");
    const entry = (await ws.series()).series.find((s) => s.id === "thrillology")!;
    expect(entry.aliases).toBeUndefined();
    expect(entry.sources).toEqual([]);
    expect(out.reply).toContain('keeps the name "Thrillology"');
    expect(out.reply).toContain("0 panel(s) retitled");
  });

  it("doesn't add a case-only change as an alias", async () => {
    const { ws } = workspace(baseFiles());
    await applyCommand(ws, "/rename_series saga // SAGA");
    expect((await ws.series()).series.find((s) => s.id === "saga")!.aliases).toBeUndefined();
  });

  it("refuses a name that already belongs to another series", async () => {
    const { ws } = workspace(baseFiles());
    await expect(applyCommand(ws, "/rename_series thrillology // hellboy")).rejects.toThrow(
      '"hellboy" is already series hellboy ("Hellboy")',
    );
  });

  it("keeps series.json sorted by name, as the pipeline writes it", async () => {
    const { ws } = workspace(baseFiles());
    await applyCommand(ws, "/rename_series hellboy // Zzz Hellboy");
    expect((await ws.series()).series.map((s) => s.id)).toEqual(["saga", "thrillology", "hellboy"]);
  });

  it("renames panels of a series the metadata job hasn't seeded yet", async () => {
    const files = baseFiles();
    files[GALLERY_PATH].panels.push(panel({ seq: 9, title: "Hup", slug: "hup" }));
    const { ws } = workspace(files);
    const out = await applyCommand(ws, "/rename_series hup // Hup!");
    expect((await ws.gallery()).panels.find((p) => p.seq === 9)!.title).toBe("Hup!");
    expect(out.reply).toContain("Not in series.json yet");
    expect(ws.dirtyFiles().map((f) => f.path)).toEqual([GALLERY_PATH]);
  });

  it("fails for a series that doesn't exist", async () => {
    const { ws } = workspace(baseFiles());
    await expect(applyCommand(ws, "/rename_series nope // X")).rejects.toThrow(
      'No series found matching "nope".',
    );
  });
});

describe("applyCommand: /resolve", () => {
  it("sets the id on an existing row and names the candidate", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/resolve metron:series // hup // 11");
    expect((await ws.disambiguation())["metron:series"].Hup.id).toBe(11);
    expect(out.reply).toContain('Resolved metron:series "Hup" → 11 (Hup (1987))');
  });

  it("notes an id that wasn't among the candidates", async () => {
    const { ws } = workspace(baseFiles());
    const out = await applyCommand(ws, "/resolve metron:series // Hup // 99");
    expect(out.reply).toContain("isn't one of the 2 recorded candidates");
  });

  it("creates a row for a name the pipeline hasn't recorded", async () => {
    const { ws } = workspace(baseFiles());
    await applyCommand(ws, "/resolve metron:creator // Kaz // 7");
    expect((await ws.disambiguation())["metron:creator"].Kaz).toEqual({ id: 7, candidates: [] });
  });
});

describe("applyCommand: /describe_*", () => {
  const command = [
    "/describe_series hellboy",
    "Hellboy is a comic series by Mike Mignola.",
    "",
    "It began in 1994.",
    "",
    "Sources:",
    "- Wikipedia | https://en.wikipedia.org/wiki/Hellboy",
    "- The Comics Journal | https://www.tcj.com/mignola/ | A Mignola interview",
  ].join("\n");

  it("sets the description with CRLF paragraphs and appends new references", async () => {
    const files = baseFiles();
    (files[SERIES_PATH] as { series: SeriesEntry[] }).series[0].references = [
      { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Hellboy/" },
    ];
    const { ws } = workspace(files);
    const out = await applyCommand(ws, command);
    const entry = (await ws.series()).series.find((s) => s.id === "hellboy")!;
    expect(entry.description).toBe("Hellboy is a comic series by Mike Mignola.\r\n\r\nIt began in 1994.");
    expect(entry.references).toEqual([
      { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Hellboy/" },
      { name: "The Comics Journal", url: "https://www.tcj.com/mignola/", title: "A Mignola interview" },
    ]);
    expect(out.reply).toContain("Added 1 reference(s); 1 were already listed");
    expect(out.summary).toBe("Update series: describe Hellboy");
    expect(ws.dirtyFiles().map((f) => f.path)).toEqual([SERIES_PATH]);
  });

  it("describes an artist found by alias, creating the references list", async () => {
    const { ws } = workspace(baseFiles());
    await applyCommand(ws, "/describe_artist Moebius\nA French cartoonist.\nSources:\n- Comiclopedia | https://www.lambiek.net/artists/g/giraud.htm");
    const artist = (await ws.artists()).artists[0];
    expect(artist.description).toBe("A French cartoonist.");
    expect(artist.references).toEqual([{ name: "Comiclopedia", url: "https://www.lambiek.net/artists/g/giraud.htm" }]);
  });

  it("changes nothing when run twice", async () => {
    const { ws } = workspace(baseFiles());
    await applyCommand(ws, command);
    expect((await applyCommand(ws, command)).summary).toBeNull();
  });

  it("fails for an entry that isn't in the data files yet", async () => {
    const { ws } = workspace(baseFiles());
    await expect(applyCommand(ws, "/describe_artist Nobody\nText.")).rejects.toThrow(/No artist found/);
  });

  it("lists a multi-line command by its first line in a run summary", () => {
    const text = formatRun({
      outcomes: [
        { command, ok: true, reply: "Described series Hellboy:" },
        { command: "/tag_series saga // x", ok: true, reply: "Tagged" },
      ],
      commitSha: "abc",
      followUp: null,
    });
    expect(text).toContain("1. /describe_series hellboy\n   OK");
    expect(text).not.toContain("It began");
  });
});

describe("Workspace", () => {
  it("loads each file once and writes only the ones that changed", async () => {
    const { ws, loader } = workspace(baseFiles());
    await applyCommand(ws, "/update 1 notes hi");
    await applyCommand(ws, "/update 2 notes there");
    expect(loader).toHaveBeenCalledTimes(1);
    const files = ws.dirtyFiles();
    expect(files.map((f) => f.path)).toEqual([GALLERY_PATH]);
    // gallery.json keeps the bot's plain JSON.stringify format.
    expect(files[0].content.endsWith("}")).toBe(true);
  });

  it("writes Python-owned files in their stored format", async () => {
    const { ws } = workspace(baseFiles());
    await applyCommand(ws, "/tag_artist moebius // café");
    expect(ws.dirtyFiles()[0].content).toContain('"caf\\u00e9"');
    expect(ws.dirtyFiles()[0].content.endsWith("}\n")).toBe(true);
  });

  it("wraps a failed read so it can't pass for a bad command", async () => {
    const ws = new Workspace(async () => {
      throw new Error("boom");
    });
    await expect(ws.gallery()).rejects.toBeInstanceOf(WorkspaceLoadError);
  });
});

// ---------------------------------------------------------------------------
// runCommands against a stubbed GitHub
// ---------------------------------------------------------------------------

const env = { GITHUB_REPO: "owner/repo", GITHUB_TOKEN: "tok" } as Env;
const API = "https://api.github.com/repos/owner/repo/";

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

/** Git Data API + contents API over an in-memory repo whose main can be moved under a run. */
function gitStub(files: Record<string, unknown>, opts: { refConflicts?: number; dispatchStatus?: number } = {}) {
  const calls: Call[] = [];
  let conflicts = opts.refConflicts ?? 0;
  let head = "c0";

  const json = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === null ? "" : JSON.stringify(body)),
  });

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(url).replace(API, "");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path, body });

    if (path === "git/ref/heads/main") return json(200, { object: { sha: head } });
    if (path.startsWith("contents/")) {
      const file = decodeURIComponent(path.replace("contents/", "").replace(/\?.*$/, ""));
      if (!(file in files)) return json(404, { message: "Not Found" });
      return json(200, {
        sha: `blob-${file}`,
        content: Buffer.from(JSON.stringify(files[file]), "utf8").toString("base64"),
      });
    }
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
    if (path.startsWith("actions/workflows/")) return json(opts.dispatchStatus ?? 204, null);
    return json(500, { message: `unexpected ${method} ${path}` });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runCommands", () => {
  it("commits every changed file in one commit on top of main", async () => {
    const { calls } = gitStub(baseFiles());
    const result = await runCommands(env, ["/rename_series thrillology // Thrillogy"]);

    expect(result.commitSha).toBe("c1");
    const tree = calls.find((c) => c.path === "git/trees")!.body as {
      base_tree: string;
      tree: { path: string; content: string }[];
    };
    expect(tree.base_tree).toBe("t0");
    expect(tree.tree.map((t) => t.path).sort()).toEqual([GALLERY_PATH, SERIES_PATH].sort());
    expect(calls.find((c) => c.path === "git/commits")!.body).toMatchObject({
      message: "Update series: rename thrillology to Thrillogy",
      parents: ["c0"],
    });
    expect(calls.find((c) => c.path === "git/refs/heads/main")!.body).toEqual({ sha: "c1", force: false });
  });

  it("reads every file at the base commit, not whatever main is by then", async () => {
    const { calls } = gitStub(baseFiles());
    await runCommands(env, ["/update 1 notes hi"]);
    const reads = calls.filter((c) => c.path.startsWith("contents/"));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r.path).toContain("?ref=c0");
  });

  it("doesn't start the metadata job when gallery.json changed (the push does)", async () => {
    const { calls } = gitStub(baseFiles());
    const result = await runCommands(env, ["/update 1 notes hi"]);
    expect(result.followUp).toBeNull();
    expect(calls.some((c) => c.path.startsWith("actions/"))).toBe(false);
  });

  it("starts the metadata job itself when only series/disambiguation data changed", async () => {
    const { calls } = gitStub(baseFiles());
    const result = await runCommands(env, ["/resolve metron:series // Hup // 11"]);
    const dispatch = calls.find((c) => c.path.startsWith("actions/"))!;
    expect(dispatch.path).toBe("actions/workflows/compute-image-metadata.yml/dispatches");
    expect(dispatch.body).toEqual({ ref: "main" });
    expect(result.followUp).toBe("Started the metadata job.");
  });

  it("reports, rather than fails on, a token that can't start workflows", async () => {
    gitStub(baseFiles(), { dispatchStatus: 403 });
    const result = await runCommands(env, ["/tag_series Saga // new"]);
    expect(result.commitSha).toBe("c1");
    expect(result.followUp).toContain("Couldn't start the metadata job (HTTP 403)");
  });

  it("commits nothing when nothing changed", async () => {
    const { calls } = gitStub(baseFiles());
    const result = await runCommands(env, ["/tag_series Saga // existing"]);
    expect(result.commitSha).toBeNull();
    expect(calls.some((c) => c.path === "git/trees")).toBe(false);
  });

  it("applies the good commands when one fails, and reports each", async () => {
    gitStub(baseFiles());
    const result = await runCommands(env, ["/update 99 notes x", "/update 1 notes ok"]);
    expect(result.outcomes.map((o) => o.ok)).toEqual([false, true]);
    expect(result.commitSha).toBe("c1");
    expect(formatRun(result)).toBe(
      'Ran 2 command(s):\n1. /update 99 notes x\n   FAIL: No panel found with ID 99.\n2. /update 1 notes ok\n   OK: Updated panel #1: set notes to "ok"',
    );
  });

  it("names every edit in the message of a multi-command commit", async () => {
    const { calls } = gitStub(baseFiles());
    await runCommands(env, ["/update 1 notes a", "/tag_series Saga // new"]);
    expect(calls.find((c) => c.path === "git/commits")!.body!.message).toBe(
      "Update data: 2 edits\n\n- Update gallery: edit Saga #1 (notes)\n- Update series: tag Saga (new)",
    );
  });

  it("re-reads and re-applies when main moved before the commit landed", async () => {
    const { calls } = gitStub(baseFiles(), { refConflicts: 1 });
    const result = await runCommands(env, ["/update 1 notes hi"]);
    expect(result.commitSha).toBe("c1");
    const commits = calls.filter((c) => c.path === "git/commits");
    expect(commits.map((c) => (c.body!.parents as string[])[0])).toEqual(["c0", "moved-0"]);
  });

  it("gives up after the attempt budget", async () => {
    gitStub(baseFiles(), { refConflicts: 5 });
    await expect(runCommands(env, ["/update 1 notes hi"], 2)).rejects.toThrow("main moved");
  });

  it("aborts the run when a file can't be read", async () => {
    gitStub({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> =>
        String(url).endsWith("git/ref/heads/main")
          ? { ok: true, status: 200, text: async () => JSON.stringify({ object: { sha: "c0" } }) }
          : { ok: false, status: 500, text: async () => "down" },
      ),
    );
    await expect(runCommands(env, ["/update 1 notes hi"])).rejects.toBeInstanceOf(WorkspaceLoadError);
  });
});
