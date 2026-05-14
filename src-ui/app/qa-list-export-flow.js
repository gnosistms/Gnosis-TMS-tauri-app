import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { currentQaListTeam, repoBackedQaListInput } from "./qa-list-top-level-state.js";
import { teamSupportsQaListRepos } from "./qa-list-repo-flow.js";

function serializeQaListToTmx(qaList) {
  const languageCode = qaList.language?.code ?? "";
  const escapeXml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const body = (qaList.terms ?? [])
    .map((term) => `
    <tu>
      <tuv xml:lang="${escapeXml(languageCode)}"><seg>${escapeXml(term.text)}</seg></tuv>
      <prop type="notes">${escapeXml(term.notes)}</prop>
    </tu>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header creationtool="Gnosis TMS" datatype="plaintext" segtype="sentence" adminlang="en" srclang="${escapeXml(languageCode)}"/>
  <body>${body}
  </body>
</tmx>
`;
}

function sanitizeTmxFileName(value) {
  return String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim() || "qa-list";
}

async function saveTmxFilePath(options) {
  const save = window.__TAURI__?.dialog?.save;
  if (typeof save !== "function") {
    return null;
  }
  return save(options);
}

export async function downloadQaListAsTmx(render, qaListId) {
  const qaList = state.qaLists.find((item) => item.id === qaListId);
  if (!qaList || typeof document === "undefined") {
    return;
  }

  const team = currentQaListTeam();
  if (teamSupportsQaListRepos(team) && qaList.repoName) {
    const defaultFileName = `${sanitizeTmxFileName(qaList.title || qaList.repoName)}.tmx`;
    try {
      const outputPath = await saveTmxFilePath({
        title: "Export QA list as TMX",
        defaultPath: defaultFileName,
        filters: [
          {
            name: "TMX QA list",
            extensions: ["tmx"],
          },
        ],
      });
      if (!outputPath) {
        return;
      }
      await invoke("export_gtms_qa_list_to_tmx", {
        input: {
          ...repoBackedQaListInput(team, qaList),
          outputPath,
        },
      });
      render();
      return;
    } catch (error) {
      state.qaListDiscovery = {
        status: "error",
        error: error?.message ?? "Could not export this QA list.",
        recoveryMessage: "",
      };
      render();
      return;
    }
  }

  const blob = new Blob([serializeQaListToTmx(qaList)], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${qaList.title.replaceAll(/[^a-z0-9-_]+/gi, "-") || "qa-list"}.tmx`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  render();
}
