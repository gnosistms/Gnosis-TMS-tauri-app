import { createRepoResourceOldLayoutDiscardFlow } from "./repo-resource/old-layout-discard-flow.js";
import { loadTeamGlossaries } from "./glossary-discovery-flow.js";
import { glossaryResourceDescriptor } from "./glossary-resource-descriptor.js";

const glossaryOldLayoutDiscardFlow = createRepoResourceOldLayoutDiscardFlow({
  ...glossaryResourceDescriptor,
  stateField: "glossaryOldLayoutDiscard",
  notFoundMessage: "Could not find the selected glossary.",
  defaultResourceName: "Glossary",
  prepareErrorMessage: "Could not prepare this glossary for sync recovery.",
  badgeScope: "glossaries",
  sourceScreen: "glossaries",
  queueKind: "glossaryOldLayoutDiscard",
  errorKind: "glossaryOldLayoutDiscard",
  command: "discard_old_layout_gtms_glossary_repos",
  refreshingMessage: "Refreshing glossary list...",
  successMessage: "Discarded old local changes and synced the migrated glossary from the server.",
  noOpMessage: "This glossary no longer needed old-format recovery.",
  reload: loadTeamGlossaries,
});

export function openGlossaryOldLayoutDiscard(render, glossaryId) {
  glossaryOldLayoutDiscardFlow.open(render, glossaryId);
}

export function closeGlossaryOldLayoutDiscard(render) {
  glossaryOldLayoutDiscardFlow.close(render);
}

export async function confirmGlossaryOldLayoutDiscard(render) {
  await glossaryOldLayoutDiscardFlow.confirm(render);
}
