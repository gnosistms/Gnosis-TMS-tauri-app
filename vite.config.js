import { defineConfig } from "vite";

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
  },
});
