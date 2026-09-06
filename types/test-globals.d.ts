/**
 * Ambient declarations for the test project only (see tsconfig.test.json).
 *
 * `worker/src/ratings.ts` memoises its source reads in the Workers edge cache.
 * The real declaration lives in `@cloudflare/workers-types`, which is a
 * dependency of the worker package rather than the root one, so the root test
 * project states the one member it touches instead of pulling that in.
 */
declare global {
  interface CacheStorage {
    default: Cache;
  }
}

export {};
