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
  const canSearch = invite.query.trim().length >= 2 && !invite.query.includes("@");
  const showSuggestions = canSearch && invite.suggestions.length > 0;
  const showNoResults =
    canSearch && invite.suggestionsStatus === "ready" && invite.suggestions.length === 0;
  const showSearching = canSearch && invite.suggestionsStatus === "loading";

  const submitButton = loadingPrimaryButton({
    label: "Invite User",
    loadingLabel: "Inviting...",
    action: "submit-invite-user",
    isLoading: isSubmitting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-invite-user", {
    disabled: isSubmitting,
  });
  const errorMarkup = invite.error ? `<p class="modal__error">${escapeHtml(invite.error)}</p>` : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--allow-overflow">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">INVITE USER</p>
          <h2 class="modal__title">Invite A User</h2>
          <p class="modal__supporting">
            Enter a GitHub username or email address. As you type a username or full name, Gnosis TMS will suggest matching GitHub users.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">GitHub Username Or Email</span>
              <div class="invite-user__field-wrap">
                <input
                  class="field__input"
                  type="text"
                  placeholder="Enter GitHub username or email"
                  value="${escapeHtml(invite.query)}"
                  data-invite-user-input
                  autocomplete="off"
                  ${isSubmitting ? "disabled" : ""}
                />
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
