import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  root: "src-ui",
  // Expose the app version to the frontend for the telemetry release tag.
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  server: {
    host: "127.0.0.1",
    port: 1431,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Source maps are required for readable telemetry stack traces (upload step is
    // configured in the release script once a Sentry auth token is available).
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src-ui/index.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/")) {
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
});
