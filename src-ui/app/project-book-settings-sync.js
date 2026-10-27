import { state, createEditorExportModalState } from "./state.js";
import { invoke, listen } from "./runtime.js";
import { getActiveStorageLogin } from "./team-storage.js";
import { selectedProjectsTeam } from "./project-context.js";
import { mapProjectToProjectRepoSyncDescriptor } from "./project-repo-sync-shared.js";
import { enqueueRepoWrite, projectRepoScope, waitForRepoWriteQueueIdle } from "./repo-write-queue.js";
import { showNoticeBadge } from "./status-feedback.js";
import { formatErrorForDisplay } from "./error-display.js";
import { loadBookSettings, replaceBookSettings, saveBookSettings } from "./project-book-settings.js";
import { portableBookSettings, portableBookOptions, bookSettingsEqual, mergeRemoteBookSettings, comparableBookLayout } from "./project-book-settings-document.js";
import { applyProjectBookSettings } from "./project-book-flow.js";

const modal = () => state.editorChapter?.exportModal;
const requests = new Map();
const pendingSaves = new Map();
let subscription;
let entry;
let pendingNotice;

function matches(scope, page1 = false) {
  const current = modal();
  return state.selectedTeamId === scope.teamId && getActiveStorageLogin() === scope.login
    && current?.isOpen && current.projectId === scope.projectId
    && current.book?.settingsEntryId === scope.id && (!page1 || current.page === 1);
}

function makeScope(render, operations) {
  const current = modal(), team = selectedProjectsTeam();
  const project = state.projects.find((project) => project.id === current?.projectId);
  const descriptor = mapProjectToProjectRepoSyncDescriptor(project);
  if (!current?.book || !descriptor || !team) return null;
  return { id: crypto.randomUUID(), projectId: project.id, teamId: team.id, login: getActiveStorageLogin(), languageCode: current.languageCode,
    project, team, descriptor, queueScope: projectRepoScope({ team, project }), render, operations,
    base: portableBookSettings(loadBookSettings(project.id)),
    defaults: portableBookOptions({ ...createEditorExportModalState(), ...current }),
  };
}

function setBook(patch) {
  const current = modal();
  state.editorChapter = { ...state.editorChapter, exportModal: { ...current, book: { ...current.book, ...patch } } };
}

async function subscribe(operations) {
  if (!subscription) subscription = Promise.resolve((operations.listen || listen)("project-export-settings", ({ payload }) => {
    const request = requests.get(payload?.requestId);
    if (!request) return;
    requests.delete(payload.requestId);
    clearTimeout(request.timer);
    if (payload.error) request.reject(new Error(payload.error));
    else request.resolve(payload);
  })).catch((error) => { subscription = null; throw error; });
  await subscription;
}

async function job(scope, settings) {
  const operations = scope.operations;
  await subscribe(operations);
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { requests.delete(requestId); reject(new Error("The export settings sync timed out. Local settings are still saved.")); }, 300000);
    timer.unref?.();
    requests.set(requestId, { resolve, reject, timer });
    Promise.resolve((operations.invoke || invoke)("start_project_export_settings_sync", { input: {
      requestId, login: scope.login, installationId: scope.team.installationId, project: scope.descriptor,
      settings: settings || null, base: scope.base,
    } })).catch((error) => {
      clearTimeout(timer); requests.delete(requestId); reject(error);
    });
  });
}

function comparable(scope, document, code) {
  const local = loadBookSettings(scope.projectId);
  const defaults = { ...scope.defaults, ...portableBookOptions(local.options), ...portableBookOptions(local.layouts?.[code]?.options) };
  return comparableBookLayout(document, scope.project.chapters || [], code, defaults);
}

function receive(scope, settings, { saved } = {}) {
  if (!settings || state.selectedTeamId !== scope.teamId || getActiveStorageLogin() !== scope.login) return;
  const local = loadBookSettings(scope.projectId);
  const code = matches(scope) ? modal().languageCode : scope.languageCode;
  const differs = !bookSettingsEqual(comparable(scope, local, code), comparable(scope, settings, code));
  // A completion of our own older save must not replace edits made afterward.
  const remoteChanged = !saved || !bookSettingsEqual(comparable(scope, saved, code), comparable(scope, settings, code));
  const notify = matches(scope, !saved) && modal().status === "idle" && differs && remoteChanged;
  // A new page-1 entry will fetch again after pending saves settle. An older
  // completion must not silently replace that entry's draft before its notice.
  const newerEntry = saved && modal()?.isOpen && modal().projectId === scope.projectId && !matches(scope);
  replaceBookSettings(scope.projectId, mergeRemoteBookSettings(local, settings, code, newerEntry || (saved && differs && !remoteChanged)));
  if (notify) {
    pendingNotice = { scope };
    scope.base = portableBookSettings(settings);
    setBook({ settingsNotice: true });
    applyProjectBookSettings(loadBookSettings(scope.projectId), scope.render);
  } else if (matches(scope, true)) {
    scope.base = portableBookSettings(settings);
  }
}

export function beginBookSettingsSync(render, operations = {}) {
  const current = modal();
  if (!current?.isOpen || !current.book || current.page !== 1) return;
  const scope = makeScope(render, operations);
  if (!scope) return;
  entry = scope;
  pendingNotice = null;
  setBook({ settingsEntryId: scope.id, settingsNotice: false });
  if (typeof (operations.invoke || invoke) !== "function" || typeof (operations.listen || listen) !== "function") return;
  const initial = portableBookSettings(loadBookSettings(scope.projectId));
  void (async () => {
    try {
      let local;
      try {
        local = await (operations.invoke || invoke)("load_project_export_settings", { input: {
          login: scope.login, installationId: scope.team.installationId, project: scope.descriptor,
        } });
      } catch {
        // A missing/corrupt local image must not prevent recovery from GitHub.
      }
      if (matches(scope, true) && local?.settings && !pendingSaves.has(scope.queueScope)
        && bookSettingsEqual(initial, portableBookSettings(loadBookSettings(scope.projectId)))
        && (!modal().book.settingsLocalSeeded || bookSettingsEqual(initial, portableBookSettings(local.settings)))) {
        const code = modal().languageCode;
        const changed = !bookSettingsEqual(comparable(scope, loadBookSettings(scope.projectId), code), comparable(scope, local.settings, code));
        const imagesChanged = !bookSettingsEqual(modal().book.items.map((item) => item.image), (local.settings.layouts?.[code]?.items || []).map((item) => item.image));
        replaceBookSettings(scope.projectId, mergeRemoteBookSettings(loadBookSettings(scope.projectId), local.settings, modal().languageCode));
        scope.base = portableBookSettings(local.settings);
        if (changed || imagesChanged) applyProjectBookSettings(loadBookSettings(scope.projectId), render);
      }
      if (pendingSaves.has(scope.queueScope)) await waitForRepoWriteQueueIdle(scope.queueScope);
      if (matches(scope, true)) {
        const result = await job(scope);
        if (matches(scope, true)) receive(scope, result?.settings);
      }
    } catch (error) {
      if (matches(scope, true)) (operations.notice || showNoticeBadge)(`Using local export settings. ${formatErrorForDisplay(error)}`, render, 5000);
    }
  })();
}

export function leaveBookSettingsPage1(render, operations = {}) {
  const current = modal();
  if (!current?.isOpen || !current.book || current.page !== 1) return;
  saveBookSettings(current);
  const scope = entry && matches(entry, true) ? entry : makeScope(render, operations);
  entry = null;
  if (!scope || typeof (scope.operations.invoke || invoke) !== "function" || typeof (scope.operations.listen || listen) !== "function") return;
  const settings = portableBookSettings(loadBookSettings(scope.projectId));
  pendingSaves.set(scope.queueScope, (pendingSaves.get(scope.queueScope) || 0) + 1);
  void enqueueRepoWrite({ scope: scope.queueScope, operationType: "localMetadataWrite", kind: "projectExportSettings",
    label: "Save export settings", recordFailure: false, run: () => {
      if (getActiveStorageLogin() !== scope.login) return null;
      return job(scope, settings);
    },
  }).then((result) => receive(scope, result?.settings, { saved: settings })).catch((error) => {
    if (state.selectedTeamId === scope.teamId && getActiveStorageLogin() === scope.login) (scope.operations.notice || showNoticeBadge)(`Export settings are saved locally. ${formatErrorForDisplay(error)}`, render, 6000);
  }).finally(() => {
    const count = (pendingSaves.get(scope.queueScope) || 1) - 1;
    if (count) pendingSaves.set(scope.queueScope, count); else pendingSaves.delete(scope.queueScope);
  });
}

export function acceptRemoteBookSettings(render) {
  const notice = pendingNotice;
  pendingNotice = null;
  if (!notice || !matches(notice.scope)) return;
  setBook({ settingsNotice: false });
  render?.();
}
