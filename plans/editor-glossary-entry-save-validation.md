# Require a translation before saving an editor glossary entry

1. Disable Save to glossary when either term is blank, including whitespace.
   Keep Research meanings available with only a source term.
2. Update button state in place while typing either field and guard the save
   action against incomplete entries.
3. Extend the existing editor browser check for blank, filled and cleared fields;
   run the relevant unit/browser tests, lint and whitespace checks.

Completed: Save to glossary requires nonblank source and target terms, updates
immediately as either field changes, and rejects incomplete direct save actions.
Research meanings still needs only the source. Eight existing unit tests and all
five editor glossary browser checks passed, including whitespace, Enter, clearing
either field, preserving focus and saving a populated pair. ESLint and whitespace
checks passed.

## Follow-up: emphasize both glossary actions
1. Use the shared orange primary style for Save to glossary and Research meanings.
2. Order actions Cancel, Save to glossary, Research meanings; retain validation.
3. Update existing order assertions and verify the editor modal workflows.

Completed: both actions use the shared primary button style, with Research
meanings last on the right. Eight unit tests and five browser tests passed;
existing blank-field validation remains covered. ESLint and whitespace checks passed.

## Follow-up: explain the missing translation on hover
1. Add a target-language-specific hint around the disabled Save action, using
   the shared tooltip styling; native disabled buttons do not show tooltips.
2. Update that hint in place when the translation is entered, cleared or contains
   only spaces, preserving the enabled action's existing tooltip and focus.
3. Verify actual tooltip visibility and the existing modal workflows.

Completed: hovering disabled Save with a blank translation shows “Enter a
[target language name] translation to save a glossary entry.” The shared tooltip
appears on its wrapper so it works with a native disabled button; filling the
translation restores the enabled button's existing tooltip. Eight unit tests and
five browser checks passed, including actual hover rendering, spaces and clearing.
ESLint and whitespace checks passed.
