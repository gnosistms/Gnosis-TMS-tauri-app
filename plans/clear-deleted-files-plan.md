# Clear Deleted Files

## Summary

Add a project-level "Clear all deleted files" action inside an expanded project deleted-files section. The action opens a confirmation modal styled like the existing permanent project deletion modal, requires typing the project name, and permanently removes all soft-deleted files in one backend operation and one git commit.

## Key Changes

- In the Projects screen, when a project's deleted-files section is expanded, render `Clear all deleted files` directly beneath the `Hide deleted files` separator and above the deleted file rows.
- Show the button only when the user can manage projects and permanently delete project files; disable it under the same conditions as other destructive deleted-file actions: offline, heavy/page writes blocked, or project content actions blocked.
- Add a new modal state for clearing deleted project files: `isOpen`, `projectId`, `projectName`, `confirmationText`, `status`, and `error`.
- Add a modal that reuses the same structural classes as `project-permanent-deletion-modal`: `modal-backdrop`, `card modal-card modal-card--compact`, `card__body modal-card__body`, `card__eyebrow`, `modal__title`, `modal__supporting`, `modal__form`, `field`, `field__label`, `field__input`, `modal__actions`, and `modal__error`.
- Modal copy:
  - Eyebrow: `CLEAR DELETED FILES`
  - Title: `Permanently remove all deleted files`
  - Message: `To permanently remove all deleted files in this project, type the project name: <strong>[project name]</strong> in the box below and click Delete all. This action cannot be undone.`
  - Buttons: `Cancel` and `Delete all`
- Disable `Delete all` until `normalizedConfirmationValue(confirmationText)` matches `normalizedConfirmationValue(projectName)`.
- Add input handling for the new confirmation field, mirroring existing permanent delete input handlers and updating the button disabled state without rerendering on every keystroke.
- Add project actions:
  - `clear-deleted-files:<projectId>` opens the modal.
  - `cancel-clear-deleted-files` resets the modal.
  - `confirm-clear-deleted-files` validates, sets the modal to loading, runs the clear operation, then resets the modal only after success.
- Register the new confirmation input with focus restoration so modal validation/error rerenders preserve focus.
- Add the new project action prefix/exact actions to the centralized offline/action blocking policy so they cannot be dispatched while offline.

## Backend/API

- Add a Tauri command that clears all soft-deleted chapters in a project repo in one operation.
- Command input: `installationId`, `projectId`, and `repoName`.
- Register the command through the existing Tauri command export/import and `invoke_handler` wiring.
- Backend behavior:
  - Resolve and validate the local project git repo.
  - Scan `chapters/` for `chapter.json` files whose lifecycle state is `deleted`.
  - Remove only those chapter directories with `git rm -r`.
  - If none are found, return an empty `chapterIds` list without committing.
  - Commit once with message `Clear deleted files`.
  - Return `{ chapterIds: string[] }`.
- Frontend behavior:
  - Do not optimistically remove files before the backend returns; keep the modal open in loading state and update visible state only after a successful command response.
  - Remove returned chapter IDs from the project's chapter list.
  - Reconcile `expandedDeletedFiles` so the deleted-files section closes if no deleted files remain.
  - Persist project cache/state using the existing project persistence path.
  - Show a success notice such as `Deleted files cleared.`
  - Schedule the existing project repo sync/refresh path once, not once per file.
  - On backend failure, keep the modal open, restore `status: "idle"`, show the error in `modal__error`, and leave visible deleted files unchanged.

## Tests

- Projects screen tests:
  - Button appears only when deleted files are expanded.
  - Button is below `Hide deleted files` and above deleted rows.
  - Button is hidden or disabled consistently with permissions/offline/write-blocked states.
  - Modal renders the requested title, copy, input, and `Cancel | Delete all` actions using existing modal classes.
  - `Delete all` remains disabled until project-name confirmation matches.
- App flow tests:
  - Opening, typing, cancelling, and confirming the modal updates/reset state correctly.
  - Confirming with mismatched text keeps the modal open and shows an error.
  - Successful clear removes all deleted chapters from visible state and closes the deleted-files section.
  - Backend failure keeps the modal open, clears loading state, shows the error, and does not remove any visible deleted chapters.
- Rust/backend tests:
  - Clears multiple deleted chapter folders in one commit.
  - Does not remove active chapters.
  - No deleted chapters returns an empty result without creating a commit.

## Assumptions

- Corrected spelling is desired in the modal copy.
- "Clear all" should be one batch backend operation and one git commit.
- Existing unrelated dirty project-import/Tauri changes should be inspected and preserved. Several required files may already be dirty, so implementation must work with those edits instead of overwriting them.
