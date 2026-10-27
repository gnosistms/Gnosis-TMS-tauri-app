# Release 0.8.126

1. Bump release metadata from 0.8.125 to 0.8.126 across the package, Tauri,
   Cargo, lockfile, and bundled-notices files.
2. Add user-facing notes for the changes since 0.8.125: Glossary Research
   (#351, Focused research by default, Full diagnostic research under
   Advanced), input-method typing in search boxes (#357), natural ordering and
   kept search in project search (#352), the AI Assistant composer fix (#355),
   and the Windows modal focus ring (#356).
3. Run release-version consistency, frontend/workflow, lint, build, formatting,
   and lockfile checks before committing the release metadata.
4. Merge the release PR, create and push annotated tag `v0.8.126` on the merge
   commit, then verify the release workflow and published assets.
