import { formatErrorForDisplay } from "../app/error-display.js";
import { eligibleProjectTransferTargets } from "../app/project-transfer-flow.js";
import {
  escapeHtml,
  loadingPrimaryButton,
  primaryButton,
  secondaryButton,
} from "../lib/ui.js";
import { renderExportSelect, supportingText } from "./export-fields.js";

function teamLabel(team) {
  return String(team?.name ?? team?.githubOrg ?? "Team");
}

export function renderProjectTransferModal(state) {
  const transfer = state.projectTransfer;
  if (!transfer?.isOpen) {
    return "";
  }
  const isTransferring = transfer.status === "transferring";
  const targets = eligibleProjectTransferTargets(state);
  const targetTeam = targets.find((team) => team.id === transfer.targetTeamId) ?? null;
  const activeProject = (Array.isArray(state.projects) ? state.projects : [])
    .find((project) => project?.id === transfer.projectId) ?? null;
  const fileCount = (Array.isArray(activeProject?.chapters) ? activeProject.chapters : [])
    .filter((chapter) => chapter?.status !== "deleted").length;
  const sameTeam = targetTeam?.id === state.selectedTeamId;
  const duplicateTitle = transfer.targetProjects.some((project) =>
    String(project?.title ?? "").trim().toLocaleLowerCase()
      === String(transfer.projectName ?? "").trim().toLocaleLowerCase()
  );
  const glossaryDisabled =
    isTransferring
    || transfer.resourcesStatus !== "done"
    || transfer.glossaries.length === 0;
  const context = targetTeam
    ? `${fileCount} file${fileCount === 1 ? "" : "s"} will be copied into ${teamLabel(targetTeam)}.`
    : "Choose the destination team.";
  const sameTeamMarkup = sameTeam
    ? supportingText("This will create a second, independent copy of the project in this team.")
    : "";
  const duplicateMarkup = duplicateTitle
    ? `<p class="modal__supporting">That team already has a project with this title. Duplicate project names are allowed.</p>`
    : "";
  const glossaryNote =
    transfer.resourcesStatus === "loading"
      ? supportingText("Loading that team’s projects and glossaries…")
      : transfer.resourcesStatus === "done" && transfer.glossaries.length === 0
        ? supportingText("That team has no glossaries yet.")
        : "";
  const stageMarkup = isTransferring && transfer.stage
    ? `<p class="modal__supporting" aria-live="polite">${escapeHtml(transfer.stage)}</p>`
    : "";
  const errorMarkup = transfer.error
    ? `<p class="modal__error" role="alert">${escapeHtml(formatErrorForDisplay(transfer.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--editor-export">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">TRANSFER PROJECT</p>
          <h2 class="modal__title">Transfer project</h2>
          ${supportingText("Create a new, independent project from the current content. Commit history is not copied, and the source project is left untouched.")}
          <div class="modal__form">
            ${renderExportSelect({
              id: "project-transfer-team",
              label: "Team",
              selectAttributes: { "data-project-transfer-team-select": true },
              placeholder: "Choose a team",
              options: targets.map((team) => ({ value: team.id, label: teamLabel(team) })),
              value: transfer.targetTeamId,
              disabled: isTransferring,
            })}
            <label class="field editor-export-modal__field">
              <span class="field__label">Project name</span>
              <input
                class="field__input"
                type="text"
                value="${escapeHtml(transfer.projectName)}"
                data-project-transfer-name-input
                ${isTransferring ? "disabled" : ""}
              />
            </label>
            ${renderExportSelect({
              id: "project-transfer-glossary",
              label: "Glossary",
              selectAttributes: { "data-project-transfer-glossary-select": true },
              placeholder: transfer.glossaries.length > 0 ? "No glossary" : "No glossary",
              options: [
                { value: "", label: "No glossary" },
                ...transfer.glossaries.map((glossary) => ({
                  value: glossary.id,
                  label: glossary.title,
                })),
              ],
              value: transfer.glossaryId,
              disabled: glossaryDisabled,
            })}
          </div>
          ${supportingText(context)}
          ${sameTeamMarkup}
          ${duplicateMarkup}
          ${glossaryNote}
          ${stageMarkup}
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-transfer", { disabled: isTransferring })}
            ${isTransferring
              ? loadingPrimaryButton({
                  label: "Transfer project",
                  loadingLabel: "Transferring...",
                  action: "submit-project-transfer",
                  isLoading: true,
                })
              : primaryButton("Transfer project", "submit-project-transfer", {
                  disabled: transfer.resourcesStatus !== "done",
                })}
          </div>
        </div>
      </section>
    </div>
  `;
}
