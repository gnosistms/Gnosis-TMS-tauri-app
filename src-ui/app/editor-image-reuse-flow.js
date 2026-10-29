import { compareFilesByName } from "./projects-list-model.js";
import { invoke } from "./runtime.js";
import { createEditorImageReuseModalState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

// The insert continuation waiting on the modal. Kept out of state because it
// holds closures and image data, and only one confirmation can be open.
let pendingImageReuse = null;

async function sha256Hex(blob) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Uploads are matched by name, then by contents. Sending the size and hash
// instead of the bytes keeps the image from crossing IPC a second time.
async function imageReuseCandidate(image) {
  if (image?.kind !== "upload") {
    return image;
  }

  return {
    kind: "upload",
    fileName: image.fileName,
    byteLength: image.fileBlob.size,
    sha256: await sha256Hex(image.fileBlob),
  };
}

function reusedChapterTitles(project, chapters) {
  const projectChapters = Array.isArray(project?.chapters) ? project.chapters : [];
  return chapters
    .map((chapter) => {
      const projectChapter = projectChapters.find((candidate) => candidate?.id === chapter?.chapterId);
      const name = String(projectChapter?.name ?? "").trim() || String(chapter?.title ?? "").trim();
      return { id: chapter?.chapterId ?? "", name };
    })
    .filter((chapter) => chapter.name)
    .sort(compareFilesByName)
    .map((chapter) => chapter.name);
}

/**
 * Resolves to `{ imageKey, chapterTitles }` when the image is already used in
 * the project, or null when it can be inserted silently. The check never
 * blocks an insert: if it fails, it reports no reuse.
 */
export async function findEditorImageReuse({ team, project, chapterId, rowId, image }) {
  try {
    const response = await invoke("find_gtms_editor_image_reuse", {
      input: {
        installationId: team.installationId,
        projectId: project.id ?? null,
        repoName: project.name,
        chapterId,
        rowId,
        image: await imageReuseCandidate(image),
      },
    });
    const chapterTitles = reusedChapterTitles(
      project,
      Array.isArray(response?.chapters) ? response.chapters : [],
    );
    if (chapterTitles.length === 0 || typeof response?.imageKey !== "string") {
      return null;
    }
    return { imageKey: response.imageKey, chapterTitles };
  } catch {
    return null;
  }
}

function setImageReuseModal(nextModal) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imageReuseModal: nextModal,
  };
}

/**
 * Asks before inserting a reused image. `insert` runs on confirm and `cancel`
 * on dismiss; both receive no arguments and own their own editor state.
 */
export function openEditorImageReuseModal(render, { reuse, rowId, languageCode, team, project, insert, cancel }) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const requestId = crypto.randomUUID();
  pendingImageReuse = {
    requestId,
    chapterId: state.editorChapter.chapterId,
    imageKey: reuse.imageKey,
    allowInput: {
      installationId: team.installationId,
      projectId: project.id ?? null,
      repoName: project.name,
      imageKey: reuse.imageKey,
    },
    insert,
    cancel,
  };
  setImageReuseModal({
    ...createEditorImageReuseModalState(),
    isOpen: true,
    requestId,
    rowId,
    languageCode,
    chapterTitles: reuse.chapterTitles,
  });
  render?.();
}

function takePendingImageReuse() {
  const modal = state.editorChapter?.imageReuseModal;
  const pending = pendingImageReuse;
  if (
    modal?.isOpen !== true
    || !pending
    || pending.requestId !== modal.requestId
    || pending.chapterId !== state.editorChapter?.chapterId
  ) {
    return null;
  }

  pendingImageReuse = null;
  return { modal, pending };
}

export function updateEditorImageReuseDontShowAgain(nextValue) {
  if (state.editorChapter?.imageReuseModal?.isOpen !== true) {
    return;
  }

  setImageReuseModal({
    ...state.editorChapter.imageReuseModal,
    dontShowAgain: nextValue === true,
  });
}

export function cancelEditorImageReuse(render) {
  const taken = takePendingImageReuse();
  pendingImageReuse = null;
  setImageReuseModal(createEditorImageReuseModalState());
  taken?.pending.cancel?.();
  render?.();
}

export async function confirmEditorImageReuse(render) {
  const taken = takePendingImageReuse();
  if (!taken) {
    cancelEditorImageReuse(render);
    return;
  }

  setImageReuseModal(createEditorImageReuseModalState());
  render?.();
  if (taken.modal.dontShowAgain === true) {
    try {
      await invoke("allow_gtms_editor_image_reuse", { input: taken.pending.allowInput });
    } catch (error) {
      // Remembering the choice is secondary; the insert the user asked for still runs.
      const message = error instanceof Error ? error.message : String(error);
      showNoticeBadge(message || "The image setting could not be saved.", render);
    }
  }
  await taken.pending.insert?.();
}
