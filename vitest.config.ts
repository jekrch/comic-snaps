import { defineConfig } from "vitest/config";

/**
 * Deliberately not `vite.config.ts`: the unit suite is pure logic in a Node
 * environment, and loading the React/Tailwind plugin chain to run it buys
 * nothing. `base` is kept in step with the app config because the modules
 * under test build URLs from `import.meta.env.BASE_URL`.
 */
export default defineConfig({
  base: "/",
  test: {
    environment: "node",
    include: ["{src,worker/src}/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      /**
       * Scoped to the logic layers the suite actually reasons about. The
       * WebGL visualizer engine and the React tree are excluded rather than
       * counted as untested: a percentage dominated by 19k lines of shader
       * plumbing says nothing about whether the sorting rules hold.
       */
      include: [
        "src/utils/**/*.ts",
        "src/adjacency.ts",
        "src/components/rowGeometry.ts",
        "src/components/viz/vizUrl.ts",
        "src/components/viz/engine/rng.ts",
        "worker/src/caption.ts",
        "worker/src/ratings.ts",
        "worker/src/github.ts",
      ],
      exclude: ["**/*.test.ts"],
    },
  },
});
