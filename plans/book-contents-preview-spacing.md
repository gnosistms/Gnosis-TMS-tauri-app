# Match table-of-contents preview spacing to PDF export

1. Compare the PDF's gnosis-contents block spacing and actual rendered font
   baselines with the page-1 preview, including chapter/H1 entries and wrapping.
2. Match heading/body leading, trim browser line-box excess, retain PDF-style
   inter-entry margins without collapsing the title-to-list gap, and provide
   compact spacing on webviews without text-box trimming.
3. Verify measured browser/PDF spacing with the cached print fonts, inspect
   proofs, test chapter-only/H1/wrapped entries and paper scaling, run frontend
   checks, then update the dev app and PR 384.

The preview previously added a full browser line box to the PDF's block margins.
Chapter rows now use heading leading; H1 rows keep body leading. Trimming matches
Typst's cap-to-baseline boxes, and a flow-root keeps the explicit title gap from
collapsing into the first entry's margin. The editable title's minimum height and
1px underline no longer add print spacing. Webviews without text-box support
compensate for full line boxes in their entry margins instead.

Measured an A5 proof built from the actual gnosis-contents rules with the bundled
Typst binary and cached Alegreya/Crimson Pro fonts. Before the fix, an eight-entry
sample drifted almost 68pt by its last entry. Afterward, all first baselines were
within 0.1pt of the PDF, including two wrapped entries; consecutive chapter gaps
were 18.82pt in the browser versus 18.83pt in print. The untrimmed fallback's
inter-entry gaps were within 0.03pt. PDF, adjusted browser and fallback PNGs were
visually checked. HTML pagination/page numbers remain approximate as before.

All 30 export browser workflows, 3,093 frontend unit/screen tests and 25 workflow
tests passed. The new layout check covers chapter-only/H1 contents, wrapped
entries, title clearance and A5/A4 scaling. Both contents workflows also passed
against the running dev checkout. Build and whitespace checks passed; unused-code
counts retain the existing 41-file / 16-export baseline. All scoped changes are
mirrored into the dev app while preserving other work.
