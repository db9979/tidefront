// Bündelt api, worker und migrate in je eine Datei (dist/server), damit das Laufzeit-Image keine node_modules braucht.
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

rmSync("dist/server", { recursive: true, force: true });
await build({
  entryPoints: {
    api: "apps/api/src/main.ts",
    worker: "apps/worker/src/main.ts",
    migrate: "apps/api/src/migrate.ts",
  },
  outdir: "dist/server",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  // Einige Abhängigkeiten sind CommonJS und rufen require() auf.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
cpSync("packages/db/migrations", "dist/server/migrations", { recursive: true });
