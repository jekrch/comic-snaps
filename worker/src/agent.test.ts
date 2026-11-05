// The tool loop against a scripted Gemini: what happens when the model keeps
// calling tools past the round limit.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateContentParameters, GenerateContentResponse, Part } from "@google/genai";
import type { Env } from "./types";

const generateContent = vi.fn<(req: GenerateContentParameters) => Promise<GenerateContentResponse>>();

vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent };
  },
}));
vi.mock("./github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./github")>()),
  readJsonFile: vi.fn(async () => ({ data: null, sha: null })),
}));

const { FunctionCallingConfigMode } = await import("@google/genai");
const { MAX_TOOL_ITERATIONS, answerQuestion } = await import("./agent");

const env = {
  GEMINI_API_KEY: "key",
  BOT_STATE: { get: async () => null, put: async () => {} },
} as unknown as Env;

const respond = (parts: Part[]) =>
  ({ candidates: [{ content: { role: "model", parts } }] }) as GenerateContentResponse;
const lookup: Part = { functionCall: { name: "get_series", args: { ref: "saga" } } };
const propose: Part = {
  functionCall: {
    name: "propose_commands",
    args: { commands: [{ command: "/tag_series saga // space opera", rationale: "asked" }] },
  },
};

beforeEach(() => {
  generateContent.mockReset();
});

describe("the tool loop", () => {
  it("ends with a tools-off round, so proposals from the last tool round still count", async () => {
    // Every tool round calls a tool, the last of them proposes, and the model
    // tries to call a tool even in the final round.
    for (let i = 0; i < MAX_TOOL_ITERATIONS - 1; i++) generateContent.mockResolvedValueOnce(respond([lookup]));
    generateContent.mockResolvedValueOnce(respond([propose]));
    generateContent.mockResolvedValueOnce(respond([{ text: "Proposed a tag." }, lookup]));

    const result = await answerQuestion(env, "tag saga", "gemini-3.8-flash");

    expect(generateContent).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
    const finalConfig = generateContent.mock.calls[generateContent.mock.calls.length - 1][0].config;
    expect(finalConfig?.toolConfig?.functionCallingConfig?.mode).toBe(FunctionCallingConfigMode.NONE);
    expect(generateContent.mock.calls[0][0].config?.toolConfig).toBeUndefined();

    expect(result.proposals).toEqual([{ command: "/tag_series saga // space opera", rationale: "asked" }]);
    expect(result.reply).toContain("Proposed a tag.");
    // The thread ends on the model's text, with the unanswerable call dropped.
    const last = result.thread.history[result.thread.history.length - 1];
    expect(last).toEqual({ role: "model", parts: [{ text: "Proposed a tag." }] });
    expect(result.thread.history.filter((c) => c.parts?.some((p) => p.functionCall))).toHaveLength(
      MAX_TOOL_ITERATIONS
    );
  });

  it("stops as soon as the model answers in text", async () => {
    generateContent.mockResolvedValueOnce(respond([lookup]));
    generateContent.mockResolvedValueOnce(respond([{ text: "Saga has 3 panels." }]));
    const result = await answerQuestion(env, "how many saga panels?", "gemini-3.8-flash");
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result.proposals).toEqual([]);
    expect(result.reply).toContain("Saga has 3 panels.");
  });
});
