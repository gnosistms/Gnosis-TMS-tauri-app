import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src-ui",
  server: {
    host: "127.0.0.1",
    port: 1431,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
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
