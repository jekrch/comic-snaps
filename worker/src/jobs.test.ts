// The queue side of the agent: what a finished job leaves in KV, redelivery,
// and the retry budget wrangler.toml has to allow for.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./types";
import type { AnswerResult } from "./agent";

const answerQuestion = vi.fn<(...args: unknown[]) => Promise<AnswerResult>>();
vi.mock("./agent", () => ({
  answerQuestion: (...args: unknown[]) => answerQuestion(...args),
  describePanel: vi.fn(),
}));

const { MAX_ATTEMPTS, processJobBatch } = await import("./jobs");
const { PENDING_DO_KEY } = await import("./keys");

function kv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    delete: vi.fn(async (key: string) => void store.delete(key)),
  };
}

function setup() {
  const state = kv();
  const env = {
    TELEGRAM_BOT_TOKEN: "bot",
    BOT_STATE: state as unknown as KVNamespace,
    JOBS: { send: vi.fn() } as unknown as Queue,
  } as Env;
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)).text);
      return { ok: true, status: 200, text: async () => "" };
    })
  );
  return { env, state, sent };
}

function message(body: unknown, attempts = 1) {
  return { body, attempts, ack: vi.fn(), retry: vi.fn() };
}

const askJob = (id = "ask-5-100") => ({
  job: { id, kind: "ask", chatId: 1, messageId: 100, userId: 5, request: "q", createdAt: "" },
});

const answer = (proposals: AnswerResult["proposals"]): AnswerResult => ({
  reply: "answer",
  thread: { model: "m", history: [], updatedAt: "2026-11-04T00:00:00.000Z" },
  proposals,
});

beforeEach(() => {
  answerQuestion.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("an /ask job", () => {
  it("replaces the pending proposals with this turn's", async () => {
    const { env, state, sent } = setup();
    answerQuestion.mockResolvedValue(answer([{ command: "/tag_series saga // a", rationale: "r" }]));
    await processJobBatch({ messages: [message(askJob())] } as never, env);
    expect(JSON.parse(state.store.get(PENDING_DO_KEY(5))!).proposals).toHaveLength(1);
    expect(sent[0]).toContain("1. /tag_series saga // a");
  });

  it("clears the last turn's proposals when this one proposes nothing", async () => {
    const { env, state } = setup();
    state.store.set(PENDING_DO_KEY(5), JSON.stringify({ proposals: [{ command: "/x" }] }));
    answerQuestion.mockResolvedValue(answer([]));
    await processJobBatch({ messages: [message(askJob())] } as never, env);
    expect(state.store.has(PENDING_DO_KEY(5))).toBe(false);
  });

  it("runs once however often the queue delivers it", async () => {
    const { env } = setup();
    answerQuestion.mockResolvedValue(answer([]));
    const first = message(askJob());
    const again = message(askJob());
    await processJobBatch({ messages: [first, again] } as never, env);
    expect(answerQuestion).toHaveBeenCalledTimes(1);
    expect(again.ack).toHaveBeenCalled();
  });

  it("retries a failure, then reports it once the attempts are spent", async () => {
    const { env, sent } = setup();
    answerQuestion.mockImplementation(async () => {
      throw new Error("model down");
    });
    const first = message(askJob(), 1);
    await processJobBatch({ messages: [first] } as never, env);
    expect(first.retry).toHaveBeenCalled();

    const last = message(askJob(), MAX_ATTEMPTS);
    await processJobBatch({ messages: [last] } as never, env);
    expect(last.ack).toHaveBeenCalled();
    expect(sent[sent.length - 1]).toContain("model down");
  });
});

describe("queue config", () => {
  it("retries at least MAX_ATTEMPTS times, so a crashed job still gets reported", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    const retries = parseInt(toml.match(/^max_retries\s*=\s*(\d+)/m)![1], 10);
    expect(retries).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
  });
});
