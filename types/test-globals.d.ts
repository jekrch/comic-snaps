/**
 * Ambient declarations for the test project only (see tsconfig.test.json).
 *
 * `worker/src/ratings.ts` memoises its source reads in the Workers edge cache.
 * The real declaration lives in `@cloudflare/workers-types`, which is a
 * dependency of the worker package rather than the root one, so the root test
 * project states the one member it touches instead of pulling that in.
 *
 * The agent modules (jobs.ts, and Env in types.ts) name the KV, Queue and queue
 * message types, and index.ts its handler types, so the members they use are
 * stated here the same way.
 */
declare global {
  interface CacheStorage {
    default: Cache;
  }

  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
  }

  interface Queue<Body = unknown> {
    send(body: Body, options?: { contentType?: string; delaySeconds?: number }): Promise<void>;
  }

  interface Message<Body = unknown> {
    readonly body: Body;
    readonly attempts: number;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
  }

  interface MessageBatch<Body = unknown> {
    readonly messages: readonly Message<Body>[];
  }

  // index.ts, which the webhook tests import, names its handler types.
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
  }

  interface ExportedHandler<Env = unknown, QueueMessage = unknown> {
    fetch?(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
    queue?(batch: MessageBatch<QueueMessage>, env: Env, ctx: ExecutionContext): void | Promise<void>;
  }
}

export {};
