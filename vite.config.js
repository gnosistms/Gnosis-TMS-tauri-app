import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Telemetry (Sentry) build-time constants. The DSN is non-secret — it only permits
// SENDING events and ships in the client bundle regardless — so it lives here in config
// (one place, not scattered) with an env override for CI/alternate projects. Injected as
// bare globals (read via `typeof` guards in telemetry.js) rather than `import.meta.env`,
// because Vite's `define` does not compose with optional-chaining reads.
const sentryDsn =
  process.env.VITE_SENTRY_DSN
  ?? readFileSync(new URL("./src-tauri/sentry-dsn.txt", import.meta.url), "utf8").trim();
const emitSourceMaps = process.env.GNOSIS_EMIT_SOURCEMAPS === "1";

export default defineConfig({
  root: "src-ui",
  define: {
    __GNOSIS_SENTRY_DSN__: JSON.stringify(sentryDsn),
    __GNOSIS_APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: "127.0.0.1",
    port: 1431,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Release builds emit hidden source maps only inside the Tauri beforeBuildCommand.
    // That script uploads them to Sentry and deletes the .map files before packaging.
    sourcemap: emitSourceMaps ? "hidden" : false,
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
