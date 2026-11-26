import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  // @jekrch/dimensional-docs is installed from its private git repo, which
  // has no dist/. This condition resolves it to its TypeScript source, and
  // keeping it out of the dep optimizer compiles it with the app's own code.
  resolve: { conditions: ["dimensional-source", ...defaultClientConditions] },
  optimizeDeps: { exclude: ["@jekrch/dimensional-docs"] },
});
