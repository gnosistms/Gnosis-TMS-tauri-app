import { defineConfig } from "vite";
import { resolve } from "node:path";

const srcUiRoot = resolve(__dirname, "src-ui");

function appChunkGroup(id) {
  if (id.includes("/node_modules/")) {
    return "vendor";
  }

  if (!id.startsWith(srcUiRoot)) {
    return undefined;
  }

  const relativePath = id.slice(srcUiRoot.length + 1);

  if (
    relativePath.startsWith("app/editor-ai-")
    || relativePath.startsWith("app/ai-")
    || relativePath.startsWith("screens/ai-")
  ) {
    return "ai";
  }

  if (
    relativePath.startsWith("app/editor-")
    || relativePath.startsWith("app/translate-")
    || relativePath === "app/translate-flow.js"
    || relativePath.startsWith("screens/translate")
    || relativePath.startsWith("screens/editor-")
  ) {
    return "editor";
  }

  if (
    relativePath.startsWith("app/glossary")
    || relativePath.startsWith("screens/glossary")
    || relativePath === "screens/glossaries.js"
  ) {
    return "glossaries";
  }

  if (
    relativePath.startsWith("app/project")
    || relativePath.startsWith("screens/project")
    || relativePath === "screens/projects.js"
  ) {
    return "projects";
  }

  if (
    relativePath.startsWith("app/team")
    || relativePath.startsWith("app/member")
    || relativePath.startsWith("screens/team")
    || relativePath === "screens/teams.js"
    || relativePath === "screens/users.js"
    || relativePath === "screens/invite-user-modal.js"
    || relativePath.startsWith("screens/teams/")
  ) {
    return "teams";
  }

  return undefined;
}

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
      },
      output: {
        manualChunks: appChunkGroup,
      },
    },
  },
});
