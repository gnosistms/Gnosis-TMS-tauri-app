# Paper size across book previews

1. Put the shared PDF paper-size selector immediately after export language in
   the step-1 toolbar. Remove the title-only selector; preserve the same saved
   preference and step-2 export setting.
2. Give every browser-rendered book page the selected physical paper dimensions,
   export margins (including copyright verso margins), and proportionally scaled
   text. Fit the canvas to the preview pane without changing its proportions or
   keeping fixed pixel padding/font sizes as the canvas shrinks. Retain the
   existing paragraph editing behavior. Typst title previews already use the
   selected paper size.
3. Verify A5, A4, US Letter/Legal and narrow panes, toolbar placement, retained
   text, shared step-2 preference, and title-preview requests. Update the dev app
   and PR 384 with scoped changes while preserving other local work.

## Implemented and verified

Step 1 has one paper-size selector directly after export language. All selected
sections share it, including the Typst title preview. Physical dimensions live
with the existing paper options. HTML page canvases use container-relative
dimensions, print margins, type, and ornaments; copyright pages use the verso
19mm/22mm A5 margins and 9.2pt body sizing. Browser previews remain editable HTML;
this corrects paper geometry without adding PDF pagination to those editors.

All 14 export browser workflows passed on a fresh isolated Vite server, including
all eight sizes, proportional narrow-pane scaling, bottom alignment, retained
copyright text, selector placement, and the shared step-2 preference. The focused
paper-size workflow also passed against the running dev server. Three existing
dynamic-import fixture checks failed in the initial run against that long-running
server; the fresh server passed those unchanged regressions. This is consistent
with stale dev-module instances; no production code was changed for those checks.

3,079 frontend tests and 25 workflow tests passed. Production build, scoped
ESLint, and whitespace checks passed. The unused-code baseline remains 41 files
and 16 exports. The running dev checkout has every scoped
change, with its other local work preserved; Vite reloaded the updated frontend.
