import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

// Versionsnummer aus der Wurzel-package.json und Build-Zeitpunkt für die Anzeige in der App
const rootPkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

const target = process.env.TF_API ?? "http://localhost:18080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 400,
    rolldownOptions: {
      output: {
        // Bibliotheken in eigene, lange cachebare Chunks: ein Spiel-Update lädt nur den App-Code neu.
        // PixiJS bleibt bewusst außen vor – es hängt nur an der verzögert geladenen Karte.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
            { name: "query", test: /node_modules[\\/]@(tanstack|trpc)[\\/]/, priority: 10 },
            // Alles, was der Start ohnehin braucht, in einen App-Chunk statt vieler Kleinstteile.
            { name: "app", tags: ["$initial"], priority: 0 },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      "/trpc": { target, changeOrigin: true },
      "/ws": { target, ws: true, changeOrigin: true },
    },
  },
});
