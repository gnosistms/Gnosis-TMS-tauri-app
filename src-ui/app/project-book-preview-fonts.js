import { state } from "./state.js";
import { invoke, listen, convertLocalFileSrc } from "./runtime.js";
import { formatErrorForDisplay } from "./error-display.js";

const profiles = new Map();
const faces = new Map();
let listener;
let timer;
let active;
const modal = () => state.editorChapter?.exportModal;

function fontInput(current) {
  if (!current?.isOpen || !current.book || current.page !== 1) return null;
  const texts = current.book.items.flatMap((item) => [item.title, item.subtitle, item.author, item.translator, item.text, item.caption]);
  for (const block of current.book.previewBlocks || []) texts.push(block.text, block.caption, block.attribution, ...(block.footnotes || []).map((note) => note.text));
  const joined = texts.filter(Boolean).join("\n");
  const scripts = [/\p{Script=Hebrew}/u, /\p{Script=Devanagari}/u, /\p{Script=Han}/u].map((regex) => regex.test(joined));
  return { key: `${current.languageCode}:${scripts.join(",")}`, languageCode: current.languageCode, texts: texts.filter(Boolean) };
}

function isCurrent(request) {
  const current = modal();
  return active === request && current?.book?.previewCache === request.session
    && current.projectId === request.projectId && state.selectedTeamId === request.teamId
    && fontInput(current)?.key === request.key;
}

function publish(request, patch) {
  if (!isCurrent(request)) return;
  const current = modal();
  state.editorChapter = { ...state.editorChapter, exportModal: { ...current,
    book: { ...current.book, previewFonts: { ...current.book.previewFonts, ...patch } },
  } };
  request.render?.({ scope: "project-book-preview" });
}

async function loadFace(font, operations) {
  const key = JSON.stringify(font);
  if (!faces.has(key)) faces.set(key, (async () => {
    const Constructor = operations.FontFace ?? globalThis.FontFace;
    const source = (operations.convertLocalFileSrc ?? convertLocalFileSrc)(font.filePath);
    const options = { style: font.style, weight: font.weight };
    // Match the PDF's whole-Greek-run EB Garamond rule, avoiding the handful of
    // stray Greek glyphs in the Latin display/body faces.
    if (["Crimson Pro", "Alegreya"].includes(font.family)) options.unicodeRange = "U+0-36F,U+400-1EFF,U+2000-10FFFF";
    const face = new Constructor(font.family, `url(${JSON.stringify(source)})`, options);
    await face.load();
    (operations.fonts ?? document.fonts).add(face);
  })().catch((error) => { faces.delete(key); throw error; }));
  return faces.get(key);
}

export function requestBookPreviewFonts(render, operations = {}) {
  const current = modal();
  const input = fontInput(current);
  if (!input) { clearTimeout(timer); active = null; return; }
  if (!operations.force && active?.key === input.key && isCurrent(active)) return;
  clearTimeout(timer);
  const request = { key: input.key, id: crypto.randomUUID(), session: current.book.previewCache,
    projectId: current.projectId, teamId: state.selectedTeamId, render, operations };
  active = request;
  if (!operations.force && profiles.has(input.key)) {
    publish(request, { status: "ready", key: input.key, profile: profiles.get(input.key), error: "" });
    return;
  }
  publish(request, { status: "loading", key: input.key, error: "" });
  timer = setTimeout(async () => {
    if (!isCurrent(request)) return;
    try {
      if (!listener) {
        const subscribe = operations.listen ?? listen;
        if (!subscribe) throw new Error("PDF preview fonts are available in the desktop app.");
        listener = Promise.resolve(subscribe("book-preview-fonts", async ({ payload }) => {
          const target = active;
          if (!target || target.id !== payload?.requestId || !isCurrent(target)) return;
          try {
            if (payload.error) throw new Error(payload.error);
            await Promise.all((payload.fonts || []).map((font) => loadFace(font, target.operations)));
            const profile = { ...payload.profile, fallbackFamilies: (payload.fonts || []).map((font) => font.family).filter((family) => family !== "Great Vibes") };
            profiles.set(target.key, profile);
            publish(target, { status: "ready", profile, error: "" });
          } catch (error) {
            publish(target, { status: "error", error: formatErrorForDisplay(error) });
          }
        })).catch((error) => { listener = null; throw error; });
      }
      await listener;
      if (isCurrent(request)) await (operations.invoke ?? invoke)("start_project_book_preview_fonts", { input: {
        requestId: request.id, languageCode: input.languageCode, texts: input.texts,
      } });
    } catch (error) { publish(request, { status: "error", error: formatErrorForDisplay(error) }); }
  }, operations.delay ?? 200);
}
