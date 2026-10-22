# Preview content navigation

1. Give preview images, captions, footnotes, separators and custom HTML the same
   row/language navigation metadata as body text and headings, with the hover hint
   "Double-click to edit." Keep this metadata out of published exports.
2. Generalize the existing delegated preview navigation handler to all preview
   content blocks, retaining ordinary link navigation and the existing scroll owner.
3. Verify renderer metadata/export isolation and real double-click navigation for
   each content type, including preview language overrides and filtered rows.

Status: complete. Include this fix before resuming the requested PR/app update.

All preview block types now carry their source row, language and hover hint;
the delegated double-click handler uses that shared contract. Ordinary link clicks
keep their navigation behavior. Removed the old single-click notice badge.

Verification: 53 focused unit tests and all seven Chrome browser navigation tests
pass. Browser tests cover each block type, a source-language preview override,
virtualized rows and translate filters that would otherwise hide the target.
Renderer tests also cover footnotes without body text and keep editor attributes
out of HTML and WordPress exports. Production build and whitespace checks pass;
focused ESLint has no errors (three existing unused-variable warnings).

## Shared tooltip follow-up

Replace native title hints with the existing data-tooltip contract and shared
base.css tooltip styling. Suppress the containing image tooltip while its caption
tooltip is hovered, and verify the styled hint appears for every preview type.

Status: complete. All preview hints use the existing data-tooltip mechanism and
base.css appearance. Only the caption hint appears when hovering a caption, without
also displaying its parent image hint. The 54 focused unit tests and all seven
Chrome tests pass; browser checks verify shared pseudo-element tooltip content and
visibility on hover, absence of native title hints, and working double-click jumps.
Focused ESLint and whitespace checks pass.
