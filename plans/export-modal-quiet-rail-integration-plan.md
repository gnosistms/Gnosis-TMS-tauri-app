# Export Modal Quiet Rail Integration Plan

## Goal

Integrate the approved Quiet Rail export modal design into the production app while
preserving every existing export path and defaulting behavior. Reuse the app's shared
CSS tokens and component styles so global design changes continue to propagate.

## Functional invariants

- Preserve every file, clipboard, WordPress.com, and team-copy export option.
- Preserve project-page language selection, PDF paper size, PDF font inspection and
  download disclosure, export progress/cancellation, errors, and busy states.
- Preserve footnote-link and custom-HTML toggles exactly where currently supported.
- Preserve WordPress connection, create/overwrite, search, post selection, warnings,
  and submission behavior.
- Preserve the remembered WordPress overwrite default: when a prior successful export
  stored a post, reopening or reselecting WordPress restores overwrite mode and the
  remembered post ID.
- Preserve team/project loading, empty, unavailable, and selected-target states.

## Design and CSS strategy

- Keep the existing production modal surface classes (`card`, `modal-card`, and
  `modal-card--editor-export`) and shared button, field, checkbox, message, and
  chevron classes.
- Refine the current two-pane layout rather than introduce a parallel modal system.
- Add one shared custom listbox renderer and behavior module for dropdowns whose open
  panel must be app-styled. The trigger will reuse `field__input`; option visuals will
  share declarations with the existing language-picker options.
- Use existing CSS variables for every color, border, radius, shadow, focus ring, and
  selected state. Avoid literal colors where an app token already exists.
- Keep WordPress choice controls scoped to the existing WordPress export classes and
  use app tokens for the custom radio indicator and selected surface.

## Implementation

1. Add the shared listbox markup helper and delegated keyboard/click behavior.
2. Render export language, PDF paper size, team, and project selectors through the
   shared listbox while keeping their existing flow functions as state owners.
3. Update export action routing for listbox selections without changing export state
   semantics.
4. Apply the approved Quiet Rail header, accordion, WordPress choice-list, and fixed
   layout using the shared production classes and tokens.
5. Update renderer, action, behavior, source-style, and WordPress-default tests.

## Verification

- Run focused export modal, export flow, WordPress flow, team-copy, listbox behavior,
  and modal source-style tests.
- Run the full frontend unit suite.
- Run the unused-export audit if the full suite passes.
- Inspect the final diff for duplicated literals, unnecessary selectors, and unrelated
  file changes.
