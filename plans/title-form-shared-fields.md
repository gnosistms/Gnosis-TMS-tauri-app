# Shared title-page form controls

Use the existing field__input, field__textarea and field__label classes for all
title-page text controls. Remove their duplicate visual CSS, retaining only form
spacing. Change blank-field placeholders to "Enter title", "Enter subtitle",
"Enter author" and "Enter translator". Verify existing title editing/Enter and
preview behavior, then update the dev checkout and PR 384.

Implemented using the shared controls and labels, with local margin spacing only.
All six composer tests and the two existing live-title browser workflows passed;
the four blank placeholders and shared classes were checked in the dev browser,
and the form was visually inspected. Build, scoped lint and whitespace checks
passed. The dev checkout has the updated form and styling.
