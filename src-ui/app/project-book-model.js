import { compareFilesByName } from "./projects-list-model.js";

export const BOOK_SECTION_TYPES = [
  { kind: "title", label: "Title page" },
  { kind: "copyright", label: "Copyright" },
  { kind: "dedication", label: "Dedication" },
  { kind: "contents", label: "Table of contents" },
  { kind: "image", label: "Full page image" },
];
const FRONT_ORDER = ["title", "copyright", "dedication", "contents"];
export const bookItemIncluded = (item) => !item.excluded && item.available !== false;
export const bookSectionLabel = (kind) => BOOK_SECTION_TYPES.find((entry) => entry.kind === kind)?.label || "Chapter";
export const bookItemTitle = (item) => item.kind === "chapter" ? item.name : item.title || (item.kind === "image" && item.caption) || bookSectionLabel(item.kind);

export function bookLanguages(chapters) {
  return [...new Map(chapters.flatMap((chapter) => chapter.languages ?? []).map((language) => [language.code, language])).values()];
}

export function reconcileBookLayout(chapters, languageCode, saved = {}) {
  const active = chapters.filter((chapter) => chapter.status !== "deleted").sort(compareFilesByName);
  const byId = new Map(active.map((chapter) => [chapter.id, chapter]));
  const seen = new Set();
  const items = (Array.isArray(saved.items) ? saved.items : []).flatMap((item) => {
    if (!item?.id || seen.has(item.id)) return [];
    seen.add(item.id);
    if (item.kind !== "chapter") return BOOK_SECTION_TYPES.some((type) => type.kind === item.kind)
      ? [{ ...item, available: true }] : [];
    const chapter = byId.get(item.chapterId ?? item.id);
    return chapter ? [{ ...item, name: chapter.name, chapterId: chapter.id, available: chapter.languages?.some((language) => language.code === languageCode) === true }] : [];
  });
  for (const chapter of active) {
    if (items.some((item) => item.kind === "chapter" && item.chapterId === chapter.id)) continue;
    const item = { id: chapter.id, chapterId: chapter.id, kind: "chapter", name: chapter.name, excluded: false, available: chapter.languages?.some((language) => language.code === languageCode) === true };
    insertBookChapter(items, item);
  }
  return { items, selectedItemId: items.some((item) => item.id === saved.selectedItemId) ? saved.selectedItemId : items[0]?.id || "" };
}

function insertBookChapter(items, item) {
  let predecessor = -1;
  // Prefer the lexically closest preceding chapter, regardless of front matter.
  for (let index = 0; index < items.length; index++) {
    if (items[index].kind !== "chapter" || !bookItemIncluded(items[index]) || compareFilesByName(items[index], item) >= 0) continue;
    if (predecessor < 0 || compareFilesByName(items[predecessor], items[index]) < 0) predecessor = index;
  }
  if (predecessor >= 0) items.splice(predecessor + 1, 0, item);
  else {
    const firstChapter = items.findIndex((entry) => entry.kind === "chapter");
    items.splice(firstChapter >= 0 ? firstChapter : items.length, 0, item);
  }
}

export function includeBookItem(items, id, included) {
  const item = items.find((entry) => entry.id === id);
  if (!item || (included && item.available === false)) return items;
  const next = items.filter((entry) => entry.id !== id).map((entry) => ({ ...entry }));
  const updated = { ...item, excluded: !included };
  if (included && item.kind === "chapter") insertBookChapter(next, updated);
  else if (included) insertBookSection(next, updated);
  else next.push(updated);
  return next;
}

function insertBookSection(items, item) {
  const rank = FRONT_ORDER.indexOf(item.kind);
  const index = rank >= 0 ? items.findIndex((entry) => entry.kind === "chapter" || FRONT_ORDER.indexOf(entry.kind) > rank) : -1;
  items.splice(index < 0 ? items.length : index, 0, item);
}

export function addBookSection(items, kind, projectTitle, contentsTitle) {
  if (!BOOK_SECTION_TYPES.some((type) => type.kind === kind)) return items;
  const id = globalThis.crypto?.randomUUID?.() || `section-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item = { id, kind, excluded: false, available: true, title: kind === "title" ? projectTitle : kind === "contents" ? contentsTitle : "", subtitle: "", author: "", translator: "", text: "", caption: "", image: null, ...(kind === "contents" ? { includeH1Headings: false } : {}) };
  const next = [...items];
  insertBookSection(next, item);
  return next;
}

export function reorderBookItems(items, id, targetId, after) {
  const item = items.find((entry) => entry.id === id);
  const target = items.find((entry) => entry.id === targetId);
  if (!item || !target || id === targetId || !bookItemIncluded(item) || !bookItemIncluded(target)) return items;
  const next = items.filter((entry) => entry.id !== id);
  next.splice(next.findIndex((entry) => entry.id === targetId) + (after ? 1 : 0), 0, item);
  return next;
}

export function bookContentsItems(items) {
  return items.filter((item) => bookItemIncluded(item) && item.kind === "chapter");
}

export function bookContentsEntries(items, headings = {}, includeH1 = false) {
  return bookContentsItems(items).flatMap((item, index) => [
    { title: `${index + 1}. ${bookItemTitle(item)}`, level: 0 },
    ...(includeH1 ? (headings[item.chapterId] || []).map((title) => ({ title, level: 1 })) : []),
  ]);
}

export function bookExportItems(modal) {
  return (modal.book?.items ?? []).filter(bookItemIncluded).map((item) => ({
    id: item.id, kind: item.kind, chapterId: item.chapterId || "", title: bookItemTitle(item),
    subtitle: item.subtitle || "", author: item.author || "", translator: item.translator || "",
    text: item.text || "", caption: item.caption || "", imageAssetId: item.image?.assetId || "",
    ...(item.kind === "contents" ? { includeH1Headings: item.includeH1Headings === true } : {}),
  }));
}
