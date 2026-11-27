import path from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), restartOnInstall()],
  // @jekrch/dimensional-docs is installed from its private git repo, which
  // has no dist/. This condition resolves it to its TypeScript source, and
  // keeping it out of the dep optimizer compiles it with the app's own code.
  resolve: { conditions: ["dimensional-source", ...defaultClientConditions] },
  optimizeDeps: { exclude: ["@jekrch/dimensional-docs"] },
});

/**
 * Restarts the dev server when bun.lock changes. Vite caches what it served
 * from node_modules and doesn't watch it, so after `bun run dimdoc:update`
 * (or any install) a running server kept serving the old package until it
 * was restarted by hand. Watching the package itself doesn't work: bun swaps
 * the directory out rather than editing files in it.
 */
function restartOnInstall(): Plugin {
  return {
    name: "restart-on-install",
    apply: "serve",
    configureServer(server) {
      const lock = path.resolve(server.config.root, "bun.lock");
      server.watcher.add(lock);
      const onLock = (file: string) => {
        if (path.resolve(file) !== lock) return;
        server.config.logger.info("bun.lock changed, restarting", { timestamp: true });
        void server.restart();
      };
      // bun may write the lockfile in place or replace it.
      server.watcher.on("change", onLock);
      server.watcher.on("add", onLock);
    },
  };
}
