# Target popup usage notes and development save compatibility

1. Remove usage notes from target-language hover cards. Keep the indented usage
   notes beside translation choices in source-language cards. Preserve global
   translator notes and footnotes and discard the proposed variant-list label.
2. Identify the actual version blocking glossary saves, including the running
   native binary and the development launcher. Repair the development checkout
   against verified release code while preserving existing local work and the
   shared repository compatibility checks for projects, glossaries, and QA lists.
3. Run focused popup and version checks, verify the development app reports the
   compatible version, and inspect the running application without creating
   artificial glossary edits or losing an unsaved term draft.

## Findings and changes

- The visible app was the installed release 0.8.129, which predates the popup
  changes. Its repeated top label was from that bundled UI, not the working
  renderer. The development binary was still 0.8.128.
- The cached Spanish–Vietnamese glossary remote head records writer version
  0.8.129, explaining the development app's save compatibility failure.
- Verified 73 release paths: 70 reverse-patch checks passed; the three remaining
  files contain reviewed formatting-only changes or existing macOS test shortcut
  differences. Rust formatting confirms the backend exception matches the release.
- Backed up all six metadata files to
  `/private/tmp/gnosis-dev-version-129-c1664dd1`, then changed only their version
  values from 0.8.128 to 0.8.129.
- The launcher now enables verified metadata repair and refuses stale versions
  by default. Explicit old-version testing remains possible. Repository save/sync
  compatibility checks are unchanged across projects, glossaries, and QA lists.
- Target cards omit usage notes; source cards retain indented notes beside each
  translation choice. Translator-note and footnote grouping remains in place.

## Validation

- 41 focused glossary tests, 3 existing browser popup tests, and 16 version/launcher
  tests pass. ESLint and scoped whitespace checks pass.
- Chrome verified target usage-note suppression, source usage-note indentation,
  all combinations of global notes/footnotes, and 14px/4px section/label spacing.
- Native development build completed successfully at 0.8.129. The installed app
  had no open text editor; it was quit cleanly before starting the corrected dev
  session, avoiding simultaneous app instances against the same data.
