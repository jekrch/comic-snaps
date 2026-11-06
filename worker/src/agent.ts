// The model-backed side of the bot: /ask (questions and proposed edits) and
// described photos (a caption written from plain English). Both run one Gemini
// tool loop over the same collection rollup and lookup tools. Neither writes
// anything: /ask ends in proposals and a description ends in a caption, and a
// person has to /confirm either one. /ask can also research a new artist or
// series description from the web, or find further reading to add to an
// entry's sources (research.ts), and each ends in a proposal too.

import { FunctionCallingConfigMode, GoogleGenAI, Type } from "@google/genai";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import type { Env } from "./types";
import { Workspace } from "./edits";
import { readJsonFile } from "./github";
import { buildRollup, loadCollection, seriesDetail, type CollectionDocs } from "./rollup";
import { resolveSeries } from "./series";
import {
  comicVineConfigured,
  getMetronSeries,
  metronConfigured,
  searchComicVineVolumes,
  searchMetronSeries,
} from "./lookup";
import {
  buildPanelCaption,
  sanitizeProposals,
  type PanelFields,
  type ProposedCommand,
} from "./proposals";
import { DEFAULT_MODEL, DESCRIBE_MODEL, formatCostLine, formatSpendLine, type Usage } from "./pricing";
import { recordCost } from "./cost";
import {
  researchDescription,
  researchSources,
  resolveResearchKind,
  type ModelSpend,
  type ResearchArgs,
  type ResearchMode,
  type ResearchResult,
} from "./research";

/** Rounds of tool calls before a final round with tools off. */
export const MAX_TOOL_ITERATIONS = 6;
const TELEGRAM_MAX_LEN = 4096;
/** /resp threads keep this many exchanges, so each follow-up doesn't cost more than the last. */
export const MAX_THREAD_EXCHANGES = 8;

export interface Thread {
  model: string;
  history: Content[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Tool declarations
// ---------------------------------------------------------------------------

const SEARCH_METRON: FunctionDeclaration = {
  name: "search_metron_series",
  description:
    "Search Metron for series whose name contains the given text. Returns id, name (the form the metadata pipeline matches on), display name with start year, start year and issue count.",
  parameters: {
    type: Type.OBJECT,
    properties: { name: { type: Type.STRING, description: "Part of the series name" } },
    required: ["name"],
  },
};

const GET_METRON: FunctionDeclaration = {
  name: "get_metron_series",
  description:
    "Fetch one Metron series by id: publisher, start and end year, issue count, type, description. Use it to tell apart series that share a name.",
  parameters: {
    type: Type.OBJECT,
    properties: { id: { type: Type.INTEGER, description: "Metron series id" } },
    required: ["id"],
  },
};

const SEARCH_COMICVINE: FunctionDeclaration = {
  name: "search_comicvine_volumes",
  description:
    "Search Comic Vine for volumes (series) matching the text. Use when Metron doesn't have the series.",
  parameters: {
    type: Type.OBJECT,
    properties: { name: { type: Type.STRING, description: "Series name to search for" } },
    required: ["name"],
  },
};

const GET_SERIES: FunctionDeclaration = {
  name: "get_series",
  description:
    "Fetch one gallery series' full series.json entry (description, references, sources, startYear, publisher) and its panels.",
  parameters: {
    type: Type.OBJECT,
    properties: { ref: { type: Type.STRING, description: "Series id, name or alias" } },
    required: ["ref"],
  },
};

const PROPOSE_COMMANDS: FunctionDeclaration = {
  name: "propose_commands",
  description:
    "Submit bot commands for the user to confirm. Call this whenever your answer involves changing data, once per turn with the full list. The user sees a numbered list and replies /confirm.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      commands: {
        type: Type.ARRAY,
        description: "Ordered proposals. Empty means no actions.",
        items: {
          type: Type.OBJECT,
          properties: {
            command: {
              type: Type.STRING,
              description: "The literal slash command, e.g. '/rename_series thrillology // Thrillogy'",
            },
            rationale: { type: Type.STRING, description: "One line: why, grounded in the data." },
          },
          required: ["command", "rationale"],
        },
      },
    },
    required: ["commands"],
  },
};

const PROPOSE_PANEL: FunctionDeclaration = {
  name: "propose_panel",
  description:
    "Submit the gallery entry for the described photo. Call once; call again only if it is rejected or the user corrects it.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description:
          "Series name. For an existing series, its name exactly as in the rollup. For a new one, the database name without the (year).",
      },
      existingSeriesId: {
        type: Type.STRING,
        description: "The rollup series id when this is an existing series, else empty.",
      },
      issue: { type: Type.STRING, description: "Issue number (e.g. 4) or text (e.g. Annual 2)." },
      year: { type: Type.INTEGER, description: "Cover year of that issue." },
      artist: {
        type: Type.STRING,
        description:
          "Who drew the panel. Empty only for an existing series when the user didn't name one (it is inherited).",
      },
      notes: { type: Type.STRING, description: "A note the user wants kept with the panel, else empty." },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Panel tags the user asked for, lowercase. Usually empty.",
      },
      assumptions: {
        type: Type.STRING,
        description: "Anything you looked up, guessed or changed, in one or two short sentences.",
      },
    },
    required: ["title", "issue", "year", "artist", "assumptions"],
  },
};

const RESEARCH_DESCRIPTION: FunctionDeclaration = {
  name: "research_description",
  description:
    "Write a new description for one artist or series from web research: searches the web, reads the pages (and any URLs the user gave), drafts a description in the site's style, and checks every sentence against a verbatim quote from its source. Unsupported sentences are dropped. The result becomes a proposal with its sources, for the user to /confirm. Takes a minute or two. Use it for any request to write, rewrite, improve, expand or correct a description. For sources alone, use research_sources.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      kind: { type: Type.STRING, enum: ["artist", "series"], description: "Which kind of entry." },
      ref: {
        type: Type.STRING,
        description: "The series id, or the artist's name, exactly as in the rollup.",
      },
      instructions: {
        type: Type.STRING,
        description:
          "The user's directions in their own words: what to focus on, emphasise, add, fix or leave out, and length. Include corrections from follow-ups. Empty if none.",
      },
      urls: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Every URL the user gave as a source, copied exactly. Empty if none.",
      },
    },
    required: ["kind", "ref", "instructions", "urls"],
  },
};

const RESEARCH_SOURCES: FunctionDeclaration = {
  name: "research_sources",
  description:
    "Find further reading for one artist or series and add it to the entry's sources, without changing its description: searches the web for interviews, criticism, essays and the like, reads pages not already in its sources (and any URLs the user gave), and picks the ones worth reading, with a line on what each holds. They become a proposal adding them to its sources, for the user to /confirm. Takes a minute or two. Use it for any request to find or add sources, links, articles, interviews, reviews or further reading.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      kind: { type: Type.STRING, enum: ["artist", "series"], description: "Which kind of entry." },
      ref: {
        type: Type.STRING,
        description: "The series id, or the artist's name, exactly as in the rollup.",
      },
      instructions: {
        type: Type.STRING,
        description: "What kinds of sources the user wants (interviews, reviews, a publisher's page), in their own words. Empty if none.",
      },
      urls: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Every URL the user gave to add, copied exactly. Empty if none.",
      },
    },
    required: ["kind", "ref", "instructions", "urls"],
  },
};

/** research_description or research_sources, with the arguments the /ask model passed. */
function runResearch(
  env: Env,
  docs: CollectionDocs,
  mode: ResearchMode,
  a: Record<string, unknown>,
  alive: () => boolean
): Promise<ResearchResult> | null {
  const kind = a.kind === "artist" ? "artist" : a.kind === "series" ? "series" : null;
  if (!kind) return null;
  const req = {
    kind,
    ref: String(a.ref ?? ""),
    instructions: typeof a.instructions === "string" ? a.instructions : "",
    urls: Array.isArray(a.urls) ? a.urls.filter((u): u is string => typeof u === "string") : [],
  } as const;
  return mode === "sources" ? researchSources(env, docs, req, alive) : researchDescription(env, docs, req, alive);
}

function lookupDeclarations(env: Env): FunctionDeclaration[] {
  const out: FunctionDeclaration[] = [GET_SERIES];
  if (metronConfigured(env)) out.push(SEARCH_METRON, GET_METRON);
  if (comicVineConfigured(env)) out.push(SEARCH_COMICVINE);
  return out;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

function lookupHandlers(env: Env, docs: CollectionDocs): Record<string, ToolHandler> {
  return {
    get_series: async (a) => seriesDetail(docs, String(a.ref ?? "")),
    search_metron_series: async (a) => searchMetronSeries(env, String(a.name ?? "")),
    get_metron_series: async (a) => getMetronSeries(env, Number(a.id)),
    search_comicvine_volumes: async (a) => searchComicVineVolumes(env, String(a.name ?? "")),
  };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const ABOUT = `Comic Snaps is a gallery of phone photos of comic book panels, posted by a small group through this Telegram bot. Each panel belongs to a series (grouped by a fixed series id, the slug of the name it was first posted under) and an issue. A metadata pipeline in CI enriches series, artists and issues from Wikipedia, Metron and Comic Vine.`;

const NAMING = `# How series names reach Metron and Comic Vine
The pipeline searches each database by the series name and accepts a result only if its name equals ours exactly, ignoring case but not punctuation or spacing ("Chocolate/Vanilla" does not match "Chocolate / Vanilla"). Metron results display as "Name (1987)"; the comparable name is the part before the year. If a series has a startYear, results starting in a different year are thrown out, which is how relaunches that share a name are told apart.
The pipeline looks each series up once, even if it finds nothing, and never searches again on its own. The rollup's last series column lists the databases whose lookup ran without a match, usually because our name differs from theirs. /rename_series clears that so the next run searches again.
To find the right name: search_metron_series with a distinctive part of the name (it is a contains-search, so a short fragment works), compare start year and issue count against the issues posted, and use get_metron_series to settle a tie. If Metron doesn't have it, try search_comicvine_volumes. If neither has it, say so and don't rename.`;

const COMMANDS = `# Commands you can propose
/rename_series {series id} // {new name}
/rename_series {series id} // {new name} // {start year}
  Renames a whole series: every panel's title, the series.json name (the old name is kept as an alias), and clears the lookup markers so the pipeline searches again. Add the start year when it is what distinguishes the right database series.
/update {seq} {field} {value}
  Fields: title, issue, year, artist, notes, tags (comma-separated, replaces the list). Setting title moves that one panel to the series the title names.
/tag_series {series id} // tag1, tag2
/tag_artist {artist name} // tag1, tag2
/resolve metron:series // {name as searched} // {metron id}
/resolve metron:creator // {name as searched} // {metron id}
  Picks the right candidate for an unresolved disambiguation row. Verify with get_metron_series first.
/describe_artist and /describe_series (a new description with sources) come only from research_description, and /add_sources_artist and /add_sources_series (further reading added to an entry's sources) only from research_sources. Each proposes its command for you.
Nothing else can be proposed. /delete and /rate are never proposed; mention them in prose if relevant.`;

const RULES = `# Rules
- Never invent panel seqs, series ids or artist names; copy them exactly from the rollup.
- Rename a series with /rename_series, never with /update title on each panel.
- Don't propose no-ops: a tag already present, a name already correct.
- The rollup leaves out aliases, tags, notes and who posted. Call get_series when a question needs them, and always before /update {seq} tags, since it replaces the panel's whole list.
- When an answer implies changes, call propose_commands once with the full list, then reply with a short summary. The numbered list is appended for you; don't repeat the commands in your text.
- For read-only questions don't call propose_commands.
- To write or rewrite an artist's or series' description, call research_description, once per entry, passing the user's directions and any URLs they gave. Never write description text yourself, and never state facts about a creator or work from memory as if sourced. Afterwards reply in a line or two; the draft, its sources and anything left out are shown to the user for you. For a revision on /resp, call it again with the new directions added to the old.
- To add sources, links, articles, interviews or further reading to an entry, call research_sources, once per entry, the same way. Prefer it whenever the user wants sources and not a new description.
- Never claim to have run anything. The user runs /confirm.
- Captions for a new photo use: Title // Issue // Year // Artist // notes // tags (artist can be left off for a series already in the gallery). A photo captioned "/ask" and a description also works.
- Reply in plain text, no Markdown. Keep it under ${TELEGRAM_MAX_LEN} characters.`;

function askSystemPrompt(rollup: string): string {
  return [ABOUT, NAMING, COMMANDS, RULES, "# Collection rollup", rollup].join("\n\n");
}

function describeSystemPrompt(rollup: string): string {
  return [
    ABOUT,
    `# Your job
The user is posting a panel photo and has described it in plain English instead of writing the caption. Turn it into one gallery entry and call propose_panel. The photo is attached; use it only to confirm or fill gaps (a visible title, a signature). The description wins.
- TRUST what the user says. Don't second-guess a plausible identification.
- If the series is already in the gallery (match by name or an obvious misspelling; get_series also matches aliases), use its name exactly as in the rollup and set existingSeriesId.
- For a new series, find the name the databases use (below) so the pipeline will match it, and use that, minus the (year).
- Issue: a number, or text like "Annual 2". Year: the cover year of that issue. If they didn't give it, work it out from the series run (get_metron_series), and say so in assumptions.
- Artist: who drew the panel. For an existing series you may leave it empty when the user didn't name one (it is inherited from the series' last panel). A new series needs one; if you can't establish it, give your best guess and say so.
- Notes and tags only when the user asked for them. Tags are lowercase.
- If propose_panel is rejected, fix what it says and call it again.
- After propose_panel, reply with one short line (or nothing). Plain text, no Markdown.`,
    NAMING,
    "# Collection rollup",
    rollup,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Tool loop
// ---------------------------------------------------------------------------

interface LoopResult {
  text: string;
  contents: Content[];
  usage: Usage;
}

async function runToolLoop(
  env: Env,
  model: string,
  systemInstruction: string,
  contents: Content[],
  declarations: FunctionDeclaration[],
  handlers: Record<string, ToolHandler>,
  alive: () => boolean = () => true
): Promise<LoopResult> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY isn't configured.");
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  // The rollup-heavy system prompt is a stable prefix, so Gemini's implicit
  // caching discounts repeat calls on its own.
  const config = { systemInstruction, tools: [{ functionDeclarations: declarations }] };
  const usage: Usage = { prompt: 0, cached: 0, output: 0 };

  for (let i = 0; ; i++) {
    // The last round runs with tools off, so a turn always ends on text. Ending
    // on a call would drop it unrun (a propose_commands with it) and save a
    // thread whose last turn is a call with no response, which every later
    // /resp would have to send back.
    const final = i >= MAX_TOOL_ITERATIONS;
    // Abandoned inline runs are re-run from the queue; don't keep paying for this one.
    if (!alive()) throw new Error("abandoned after the inline timeout");
    const response = await client.models.generateContent({
      model,
      contents,
      config: final
        ? { ...config, toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } } }
        : config,
    });
    const meta = response.usageMetadata;
    if (meta) {
      usage.prompt += meta.promptTokenCount ?? 0;
      usage.cached += meta.cachedContentTokenCount ?? 0;
      usage.output += (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
    }

    const returned: Part[] = response.candidates?.[0]?.content?.parts ?? [];
    // A call in the final round can't be answered, so it doesn't go into
    // history. Everything else goes back in full, thought signatures included,
    // which multi-turn function calling requires.
    const parts = final ? returned.filter((p) => !p.functionCall) : returned;
    if (parts.length > 0) contents.push({ role: "model", parts });
    const calls = parts.filter((p) => p.functionCall);

    if (calls.length === 0) {
      await recordCost(env, model, usage).catch((err) =>
        console.log(`[agent] recordCost failed: ${(err as Error).message}`)
      );
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("\n")
        .trim();
      return { text, contents, usage };
    }

    const results: Part[] = await Promise.all(
      calls.map(async (p) => {
        const name = p.functionCall?.name ?? "";
        const args = (p.functionCall?.args ?? {}) as Record<string, unknown>;
        const handler = handlers[name];
        const result = handler ? await handler(args) : `Unknown tool: ${name}`;
        return { functionResponse: { name, response: { result } } };
      })
    );
    contents.push({ role: "user", parts: results });
  }
}

/**
 * The last `max` exchanges of a thread. An exchange starts at a user turn that
 * carries text; tool results are user turns too, but carry only
 * functionResponse parts, so a cut never separates a call from its response.
 */
export function trimHistory(contents: Content[], max = MAX_THREAD_EXCHANGES): Content[] {
  const starts = contents.flatMap((c, i) =>
    c.role === "user" && c.parts?.some((p) => typeof p.text === "string") ? [i] : []
  );
  return starts.length <= max ? contents : contents.slice(starts[starts.length - max]);
}

function truncateForTelegram(text: string, reserve = 0): string {
  const max = TELEGRAM_MAX_LEN - reserve;
  if (text.length <= max) return text;
  const cutoff = text.lastIndexOf("\n", max - 30);
  const pos = cutoff > max / 2 ? cutoff : max - 30;
  return `${text.slice(0, pos)}\n[...truncated]`;
}

/** The collection as it is on main right now. */
async function currentCollection(env: Env): Promise<CollectionDocs> {
  return loadCollection(new Workspace(async (path) => (await readJsonFile(env, path)).data));
}

// ---------------------------------------------------------------------------
// /ask
// ---------------------------------------------------------------------------

export interface AnswerResult {
  reply: string;
  thread: Thread;
  proposals: ProposedCommand[];
}

/** Answer a question about the collection, proposing edit commands when it implies some. */
export async function answerQuestion(
  env: Env,
  question: string,
  model: string = DEFAULT_MODEL,
  history: Content[] = [],
  alive: () => boolean = () => true
): Promise<AnswerResult> {
  const docs = await currentCollection(env);
  let proposals: ProposedCommand[] = [];
  // Kept apart from propose_commands' list, which each call replaces. Keyed by
  // entry, so researching the same one twice keeps the later draft.
  const researched = new Map<string, ProposedCommand>();
  const spend: ModelSpend[] = [];

  const handlers: Record<string, ToolHandler> = {
    ...lookupHandlers(env, docs),
    // Last call wins if the model proposes twice in one turn.
    propose_commands: async (a) => {
      const { accepted, rejected } = sanitizeProposals(a.commands);
      proposals = accepted;
      const rejectedNote = rejected.length
        ? ` Rejected ${rejected.length}: ${rejected.map((r) => `${r.command} (${r.reason})`).join("; ")}. Call propose_commands again with the full corrected list if they matter.`
        : "";
      return `Recorded ${accepted.length} proposal(s).${rejectedNote} Otherwise, reply with a short plain-text summary for the user.`;
    },
    research_description: (a) => research("describe", a),
    research_sources: (a) => research("sources", a),
  };

  async function research(mode: ResearchMode, a: Record<string, unknown>): Promise<string> {
    try {
      const run = runResearch(env, docs, mode, a, alive);
      if (!run) return 'kind must be "artist" or "series".';
      const result = await run;
      spend.push(...result.spend);
      if (result.key && result.proposal) researched.set(result.key, result.proposal);
      return result.toolResult;
    } catch (err) {
      if ((err as Error).message.startsWith("abandoned")) throw err;
      const tool = mode === "sources" ? "research_sources" : "research_description";
      console.log(`[agent] ${tool} failed: ${(err as Error).message}`);
      return `Research failed: ${(err as Error).message.split("\n")[0]}. Tell the user; don't write ${mode === "sources" ? "sources" : "a description"} yourself.`;
    }
  }

  const contents: Content[] = [...history, { role: "user", parts: [{ text: question }] }];
  const result = await runToolLoop(
    env,
    model,
    askSystemPrompt(buildRollup(docs)),
    contents,
    [...lookupDeclarations(env), PROPOSE_COMMANDS, RESEARCH_DESCRIPTION, RESEARCH_SOURCES],
    handlers,
    alive
  );

  const costLine = formatSpendLine([{ model, usage: result.usage }, ...spend]);
  const body = truncateForTelegram(result.text || "No response.", 1200);
  return {
    reply: costLine ? `${body}\n${costLine}` : body,
    thread: { model, history: trimHistory(result.contents), updatedAt: new Date().toISOString() },
    proposals: [...proposals, ...researched.values()],
  };
}

// ---------------------------------------------------------------------------
// /research and /source
// ---------------------------------------------------------------------------

export interface ResearchReply {
  reply: string;
  proposal: ProposedCommand | null;
}

/**
 * A research run on its own, for /research (mode "describe") and /source
 * (mode "sources"). Skips the /ask model, whose system prompt carries the
 * whole collection rollup on every turn.
 */
export async function researchCommand(
  env: Env,
  args: ResearchArgs,
  alive: () => boolean = () => true,
  mode: ResearchMode = "describe"
): Promise<ResearchReply> {
  const docs = await currentCollection(env);
  const verb = mode === "sources" ? "source" : "research";
  let kind = args.kind;
  if (!kind) {
    const resolved = resolveResearchKind(docs, args.ref, verb);
    if ("error" in resolved) return { reply: resolved.error, proposal: null };
    kind = resolved.kind;
  }
  const req = { kind, ref: args.ref, instructions: args.instructions, urls: args.urls };
  const result =
    mode === "sources" ? await researchSources(env, docs, req, alive) : await researchDescription(env, docs, req, alive);
  const costLine = formatSpendLine(result.spend);
  const lines = [result.message];
  if (result.proposal) {
    lines.push(
      mode === "sources"
        ? `To look again, run /source ${kind} ${args.ref} // {directions or a URL}.`
        : `To revise it, run /research ${kind} ${args.ref} // {directions} again.`
    );
  } else if (result.key) {
    // Got as far as reading pages: a page to start from is usually the fix.
    lines.push(
      mode === "sources"
        ? `Name a page to add: /source ${kind} ${args.ref} https://…`
        : `Name a page to work from: /research ${kind} ${args.ref} // https://…`
    );
  }
  if (costLine) lines.push(costLine);
  return { reply: lines.join("\n"), proposal: result.proposal };
}

// ---------------------------------------------------------------------------
// Described photos
// ---------------------------------------------------------------------------

export interface PanelProposal {
  caption: string;
  /** The series it resolved to, and whether that series is already in the gallery. */
  seriesTitle: string;
  seriesSlug: string;
  existing: boolean;
  assumptions: string;
}

export interface DescribeResult {
  body: string;
  proposal: PanelProposal | null;
}

/**
 * Turn a photo plus a plain-English description into one caption. `prompts`
 * holds every description and correction so far, oldest first; `priorCaption`
 * is what the last turn proposed, if anything.
 */
export async function describePanel(
  env: Env,
  imageBase64: string,
  prompts: string[],
  priorCaption: string | null
): Promise<DescribeResult> {
  const docs = await currentCollection(env);
  let proposal: PanelProposal | null = null;

  const handlers: Record<string, ToolHandler> = {
    ...lookupHandlers(env, docs),
    propose_panel: async (a) => {
      const built = buildPanelCaption(a as PanelFields);
      if ("error" in built) return `Rejected: ${built.error}. Fix it and call propose_panel again.`;
      const resolved = resolveSeries(built.metadata.title, docs.series.series, docs.gallery.panels);
      if (!resolved.existing && !built.metadata.artist) {
        return `Rejected: "${resolved.title}" is a new series, so it needs an artist. Find or estimate one and call propose_panel again.`;
      }
      proposal = {
        caption: built.caption,
        seriesTitle: resolved.title,
        seriesSlug: resolved.slug,
        existing: resolved.existing,
        assumptions: typeof a.assumptions === "string" ? a.assumptions.trim() : "",
      };
      return "Recorded. Reply with one short line, or nothing.";
    },
  };

  const [first, ...corrections] = prompts;
  const lines = [`The user's description: "${first || "(none)"}"`];
  if (priorCaption) lines.push(`Your last proposal: ${priorCaption}`);
  corrections.forEach((c, i) =>
    lines.push(`${i === corrections.length - 1 ? "Their correction now" : `Earlier correction ${i + 1}`}: "${c}"`)
  );

  const contents: Content[] = [
    {
      role: "user",
      parts: [
        { text: lines.join("\n") },
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
      ],
    },
  ];
  const result = await runToolLoop(
    env,
    DESCRIBE_MODEL,
    describeSystemPrompt(buildRollup(docs)),
    contents,
    [...lookupDeclarations(env), PROPOSE_PANEL],
    handlers
  );

  const costLine = formatCostLine(DESCRIBE_MODEL, result.usage);
  const final = proposal as PanelProposal | null;
  if (!final) {
    const why = result.text || "Couldn't turn that into a gallery entry.";
    return {
      body: `${why}\n\nReply /resp {more detail} to try again (series, issue, year, artist), or /cancel.${costLine ? `\n${costLine}` : ""}`,
      proposal: null,
    };
  }

  const out = [
    "Proposed caption:",
    `  ${final.caption}`,
    final.existing
      ? `  Joins existing series "${final.seriesTitle}"`
      : `  Starts a new series "${final.seriesTitle}" (${final.seriesSlug})`,
  ];
  if (final.assumptions) out.push(`  ${final.assumptions}`);
  out.push(
    "",
    "Reply /confirm to post it, /resp {correction} to revise, or /cancel to drop it."
  );
  if (costLine) out.push(costLine);
  return { body: out.join("\n"), proposal: final };
}
