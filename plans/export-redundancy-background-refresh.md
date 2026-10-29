# Keep the redundancy page still during project refresh

Follow-up to `export-preview-background-scroll.md`, which keeps page 1 of the
project export dialog mounted while the projects page refreshes.

## Problem

Page 2 (Redundancy checks) flickered at the end of a projects refresh. Toggling a
review checkbox changed `book.redundancy.choices` without any render, so neither
the export dialog key (`projects-background-render.js`) nor the projects no-op key
(`main.js`) recorded it. The refresh completion then saw a "changed" dialog and
rebuilt it: thumbnails reloaded, focus and scroll reset.

## Change

1. `setBookRedundancyChoice` reports whether it recorded the choice.
2. The checkbox change handler then issues the existing scoped
   `book-redundancy` render. It leaves the mounted controls in place and keeps
   both comparison keys current, as page 1's scoped preview updates do.

## Status

Complete. A browser regression test toggles choices on page 2, runs background
refresh publications with a project-list change, and verifies the retained
dialog, thumbnail, focus, scroll and choices; a genuine dialog change still
renders. It fails without the fix. Full frontend suite (3,245 + 26 workflow
tests) and all 68 project browser tests pass.
