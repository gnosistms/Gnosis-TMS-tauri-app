# Use glossary buttons for book inclusion

1. Reuse the glossary editor's minus/plus button and icon classes for export
   exclusion/inclusion, with the requested standard tooltips and accessible names.
   Keep unavailable-language chapters disabled and retain their explanation.
2. Remove the old text-button styling and update existing rendering assertions.
3. Verify include/exclude behavior and scroll retention, mirror changes into the
   running dev checkout, and update the existing export-formatting PR.

Completed: reused the shared button/icon classes and tooltip helper; preserved
disabled chapter explanations through accessible descriptions. All 3,084 frontend
tests, 25 workflow tests and the three relevant selection/inclusion/scroll browser
checks pass. JavaScript lint and whitespace checks pass. Changes are mirrored into
the running dev checkout.
