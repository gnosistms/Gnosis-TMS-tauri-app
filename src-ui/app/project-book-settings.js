import { readPersistentValue, writePersistentValue } from "./persistent-store.js";
import { getActiveStorageLogin } from "./team-storage.js";
const key = () => `gnosis-tms-project-book-settings:${String(getActiveStorageLogin() || "local").toLowerCase()}`;
const contentsKey = () => `gnosis-tms-book-contents-titles:${String(getActiveStorageLogin() || "local").toLowerCase()}`;
export const loadBookSettings = (projectId) => readPersistentValue(key(), {})?.[projectId] ?? {};
export const loadContentsTitle = (code) => readPersistentValue(contentsKey(), {})?.[code] ?? "Table of Contents";
export function saveContentsTitle(code, title) {
  writePersistentValue(contentsKey(), { ...readPersistentValue(contentsKey(), {}), [code]: title });
}
export function saveBookSettings(modal) {
  if (!modal?.projectId || !modal.book) return;
  const records = readPersistentValue(key(), {});
  const previous = records?.[modal.projectId] ?? {};
  const options = Object.fromEntries(["selectedOptionId", "pdfPaperSize", "footnoteLinksAsPlainText", "omitCustomHtml", "expandedCategoryIds"].map((field) => [field, modal[field]]));
  // Destination choices are preferences; credentials and transient jobs are never stored.
  options.wordpress = Object.fromEntries(["title", "mode", "selectedPostId", "searchQuery"].map((field) => [field, modal.wordpress?.[field]]));
  const connection = modal.wordpress?.connection;
  if (connection?.siteId) options.wordpress.connection = Object.fromEntries(["siteId", "kind", "siteUrl", "displayName", "blogId"].filter((field) => connection[field] != null).map((field) => [field, connection[field]]));
  const selectedPost = modal.wordpress?.searchResults?.find((post) => post.id === modal.wordpress?.selectedPostId);
  if (selectedPost) options.wordpress.searchResults = [Object.fromEntries(["id", "title", "status", "link", "modified"].filter((field) => selectedPost[field] != null).map((field) => [field, selectedPost[field]]))];
  const next = {
    version: 1, languageCode: modal.languageCode, options,
    layouts: { ...previous.layouts, [modal.languageCode]: {
      selectedItemId: modal.book.selectedItemId,
      items: modal.book.items.map(({ available: _available, defaultTitle: _defaultTitle, ...item }) => item),
    } },
  };
  if (JSON.stringify(previous) !== JSON.stringify(next)) writePersistentValue(key(), { ...records, [modal.projectId]: next });
}
