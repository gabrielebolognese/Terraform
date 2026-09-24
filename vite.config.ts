import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The project convention (CLAUDE.md) is ESM with `.js` extensions on relative
 * imports, even from `.ts` files. Vite resolves most of these on its own, but
 * this makes it explicit and version-proof: if `./x.js` does not exist on disk
 * and `./x.ts` does, resolve to the `.ts`.
 */
function resolveTsFromJsSpecifier(): Plugin {
  return {
    name: "resolve-ts-from-js-specifier",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
      const jsPath = resolve(dirname(importer), source);
      if (existsSync(jsPath)) return null;
      const tsPath = `${jsPath.slice(0, -3)}.ts`;
      return existsSync(tsPath) ? tsPath : null;
    },
  };
}

export default defineConfig({
  root,
  plugins: [resolveTsFromJsSpecifier()],
  server: { port: 5173, open: false },
  build: { outDir: "dist-web", emptyOutDir: true },
});
