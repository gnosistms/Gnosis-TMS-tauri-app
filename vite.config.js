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
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src-ui/index.html"),
        splashscreen: resolve(__dirname, "src-ui/splashscreen.html"),
      },
    },
  },
});
