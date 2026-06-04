import { createRepoResourceOldLayoutDiscardFlow } from "./repo-resource/old-layout-discard-flow.js";
import { loadTeamQaLists } from "./qa-list-discovery-flow.js";
import { qaListResourceDescriptor } from "./qa-list-resource-descriptor.js";

const qaListOldLayoutDiscardFlow = createRepoResourceOldLayoutDiscardFlow({
  ...qaListResourceDescriptor,
  stateField: "qaListOldLayoutDiscard",
  notFoundMessage: "Could not find the selected QA list.",
  defaultResourceName: "QA list",
  prepareErrorMessage: "Could not prepare this QA list for sync recovery.",
  badgeScope: "qa",
  sourceScreen: "qa",
  queueKind: "qaListOldLayoutDiscard",
  errorKind: "qaListOldLayoutDiscard",
  command: "discard_old_layout_gtms_qa_list_repos",
  refreshingMessage: "Refreshing QA list...",
  successMessage: "Discarded old local changes and synced the migrated QA list from the server.",
  noOpMessage: "This QA list no longer needed old-format recovery.",
  reload: loadTeamQaLists,
});

export function openQaListOldLayoutDiscard(render, qaListId) {
  qaListOldLayoutDiscardFlow.open(render, qaListId);
}

export function closeQaListOldLayoutDiscard(render) {
  qaListOldLayoutDiscardFlow.close(render);
}

export async function confirmQaListOldLayoutDiscard(render) {
  await qaListOldLayoutDiscardFlow.confirm(render);
}
