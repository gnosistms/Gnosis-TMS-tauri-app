# Keep Review sections open

1. Render Last update and AI Review with static headers and unconditional content.
   Remove their chevrons, collapse tooltips, buttons, and expanded-state attributes.
   Ignore old collapsed state so both sections are visible immediately.
2. Update existing unit/browser selectors to identify the sections directly.
   Verify existing review rendering with a previously collapsed section state and
   run the affected sidebar and browser checks.

Status: complete. Both sections render static headers and unconditional content,
including when old state marks them collapsed. All 40 sidebar unit tests and four
standard/grouped Review browser checks pass. Scoped ESLint and whitespace checks
pass.
