# Redundant-image chapter rows

PR #384 follow-up. Use the current page-1 chapter numbers and titles in image
review, add "Chapters that include this image:", reuse page-1 rounded chapter
row styling, and label inclusion controls "Include in export".

1. Resolve chapter labels from the current book items via the shared numbering
   and title helpers, including edited titles, exclusions and unnumbered chapters.
   Preserve fallback labels for non-chapter sections/cached occurrences.
2. Wrap each chapter label and its control in the same shared rounded row shell
   as page 1. Preserve mounted image controls through footnote progress and title
   updates; relabel inclusion controls throughout redundancy review.
3. Verify the page-1-to-review data flow with browser coverage for optional
   numbering, exclusion and reordering. Visually inspect, integrate the verified
   files into the running dev checkout, and update PR #384.

Complete. The image list uses the same numbering/title helpers and rounded row
shell as page 1. Both image and footnote inclusion labels read "Include in
export". Title/ARIA updates preserve mounted image checkboxes during progress.
All 3,124 frontend tests and 25 workflow tests passed. Six focused review browser
workflows passed against the real dev source, including edited titles, exclusion,
optional numbering, reordering, shared border radii, and saved inclusion choices.
The rendered layout was visually inspected. Build, ESLint and whitespace checks
passed; the unused-file audit retains the existing 41-file baseline. The three
related source/test files were backed up and integrated into the running dev
checkout, preserving unrelated local work.
