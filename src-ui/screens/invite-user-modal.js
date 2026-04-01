import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";

function renderSuggestionItem(suggestion, isSelected) {
  const avatar = suggestion.avatarUrl
    ? `<img class="user-suggestion__avatar" src="${escapeHtml(suggestion.avatarUrl)}" alt="" />`
    : `<span class="user-suggestion__avatar user-suggestion__avatar--placeholder" aria-hidden="true">${escapeHtml(
        suggestion.login.slice(0, 1).toUpperCase(),
      )}</span>`;

  const nameLine =
    suggestion.name && suggestion.name !== suggestion.login
      ? `<span class="user-suggestion__name">${escapeHtml(suggestion.name)}</span>`
      : "";

  return `
    <button
      class="user-suggestion${isSelected ? " is-selected" : ""}"
      data-action="select-invite-user-suggestion:${escapeHtml(String(suggestion.id))}"
      type="button"
    >
      ${avatar}
      <span class="user-suggestion__content">
        <span class="user-suggestion__login">@${escapeHtml(suggestion.login)}</span>
        ${nameLine}
      </span>
    </button>
  `;
}

export function renderInviteUserModal(state) {
  const invite = state.inviteUser;
  if (!invite?.isOpen) {
    return "";
  }

  const isSubmitting = invite.status === "loading";
  const trimmedQuery = invite.query.trim();
  const hasNonUsernameInput = trimmedQuery.includes("@") || /\s/.test(trimmedQuery);
  const selectedSuggestion = invite.selectedSuggestion;
  const canSearch = trimmedQuery.length >= 4 && !hasNonUsernameInput && !selectedSuggestion;
  const showSuggestions = canSearch && invite.suggestions.length > 0;
  const showNoResults =
    canSearch && invite.suggestionsStatus === "ready" && invite.suggestions.length === 0;
  const showSearching = canSearch && invite.suggestionsStatus === "loading";
  const showUsernameOnlyUnavailable = hasNonUsernameInput;

  const submitButton = loadingPrimaryButton({
    label: "Invite",
    loadingLabel: "Inviting...",
    action: "submit-invite-user",
    isLoading: isSubmitting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-invite-user", {
    disabled: isSubmitting,
  });
  const errorMarkup = invite.error ? `<p class="modal__error">${escapeHtml(invite.error)}</p>` : "";
  const avatar = selectedSuggestion?.avatarUrl
    ? `<img class="user-suggestion__avatar" src="${escapeHtml(selectedSuggestion.avatarUrl)}" alt="" />`
    : selectedSuggestion
      ? `<span class="user-suggestion__avatar user-suggestion__avatar--placeholder" aria-hidden="true">${escapeHtml(
          selectedSuggestion.login.slice(0, 1).toUpperCase(),
        )}</span>`
      : "";
  const selectedNameLine =
    selectedSuggestion?.name && selectedSuggestion.name !== selectedSuggestion.login
      ? `<span class="user-suggestion__name">${escapeHtml(selectedSuggestion.name)}</span>`
      : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--allow-overflow">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">INVITE MEMBER</p>
          <h2 class="modal__title">Invite A Member</h2>
          <p class="modal__supporting">
            Type in the box below to search for GitHub users.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">GitHub Username</span>
              <div class="invite-user__field-wrap">
                ${
                  selectedSuggestion
                    ? `
                      <div class="invite-user__selected">
                        <span class="invite-user__selected-main">
                          ${avatar}
                          <span class="user-suggestion__content">
                            <span class="user-suggestion__login">@${escapeHtml(selectedSuggestion.login)}</span>
                            ${selectedNameLine}
                          </span>
                        </span>
                        <button
                          class="invite-user__selected-change"
                          type="button"
                          data-action="edit-selected-invite-user"
                          ${isSubmitting ? "disabled" : ""}
                        >
                          Change
                        </button>
                      </div>
                    `
                    : `
                      <input
                        class="field__input"
                        type="text"
                        placeholder="Enter GitHub username"
                        value="${escapeHtml(invite.query)}"
                        data-invite-user-input
                        autocomplete="off"
                        ${isSubmitting ? "disabled" : ""}
                      />
                    `
                }
                ${
                  showSuggestions
                    ? `<div class="user-suggestions">${invite.suggestions
                        .map((suggestion) =>
                          renderSuggestionItem(
                            suggestion,
                            String(suggestion.id) === String(invite.selectedUserId),
                          ),
                        )
                        .join("")}</div>`
                    : showSearching
                      ? '<div class="user-suggestions user-suggestions--status">Searching GitHub users...</div>'
                      : showUsernameOnlyUnavailable
                        ? '<div class="user-suggestions user-suggestions--status">Search by GitHub username only.</div>'
                      : showNoResults
                        ? '<div class="user-suggestions user-suggestions--status">No matching GitHub users found.</div>'
                        : ""
                }
              </div>
            </label>
          </div>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${submitButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
