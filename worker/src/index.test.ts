// Who reaches the allowlisted commands, driven through the webhook handler.

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env } from "./types";

const CHAT = -100;
const ALLOWED = 5;

function env(over: Partial<Env> = {}): Env {
  return {
    TELEGRAM_BOT_TOKEN: "bot",
    TELEGRAM_ALLOWED_CHAT_ID: String(CHAT),
    GITHUB_REPO: "owner/repo",
    GITHUB_TOKEN: "tok",
    ALLOWED_USER_IDS: String(ALLOWED),
    ...over,
  } as Env;
}

/** POST one message to the webhook and return what the bot replied. */
async function send(e: Env, text: string, opts: { from?: number; secret?: string } = {}) {
  const replies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) replies.push(JSON.parse(String(init?.body)).text);
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    })
  );
  const pending: Promise<unknown>[] = [];
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.secret) headers["X-Telegram-Bot-Api-Secret-Token"] = opts.secret;
  const request = new Request("https://bot.example/", {
    method: "POST",
    headers,
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 9,
        chat: { id: CHAT, type: "group" },
        from: { id: opts.from ?? ALLOWED, first_name: "J" },
        date: 0,
        text,
      },
    }),
  });
  const response = await worker.fetch(request, e, {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    passThroughOnException: () => {},
  });
  await Promise.all(pending);
  return { status: response.status, replies };
}

afterEach(() => vi.unstubAllGlobals());

describe("the allowlisted commands", () => {
  it("are off without a webhook secret, since the sender id could be forged", async () => {
    for (const text of ["/ask hi", "/restore 7", "/approve 7", "/confirm"]) {
      const { replies } = await send(env(), text);
      expect(replies).toEqual([expect.stringContaining("WEBHOOK_SECRET")]);
    }
  });

  it("refuse a sender who isn't allowlisted", async () => {
    const { replies } = await send(env({ WEBHOOK_SECRET: "s" }), "/restore 7", { from: 6, secret: "s" });
    expect(replies).toEqual([expect.stringContaining("only enabled for allowlisted users")]);
  });

  it("let an allowlisted sender through once the secret checks out", async () => {
    const { replies } = await send(env({ WEBHOOK_SECRET: "s" }), "/ask hi", { secret: "s" });
    expect(replies).toEqual([expect.stringContaining("no GEMINI_API_KEY")]);
  });

  it("reject a request with the wrong secret before reading it", async () => {
    const { status, replies } = await send(env({ WEBHOOK_SECRET: "s" }), "/ask hi", { secret: "x" });
    expect(status).toBe(403);
    expect(replies).toEqual([]);
  });
});
