# Shared PDF attribution spacing

1. Add a body-relative minimum trailing gap to populated attributions in the
   shared chapter renderer, covering standalone PDFs and composed books.
2. Use collapsible block spacing so larger following spacing wins and the gap is
   discarded at page boundaries. Preserve quote attachment and typography.
3. Run native PDF regressions and compile/render representative short, multiline,
   consecutive, and page-boundary quotations to check spacing and pagination.

Completed:
- Attributions use a full-width block with `below: 1.5em`, measured in body-text
  units. Normal paragraph spacing was already 0.78em; the new minimum adds 8.28pt
  at the current 11.5pt body size, approximately half a line.
- Compiled and visually checked short/multiline attributions, consecutive quotes,
  following headings, and explicit/natural page breaks. Measurements confirm the
  gap above attribution stays unchanged, larger following spacing wins, and no
  trailing gap carries to the next page. A 16pt proof confirms font-size scaling.
- All 64 native PDF tests pass with the bundled Typst runtime and cached fonts,
  including the composed-book compile. `cargo check --lib`, scoped rustfmt, and
  whitespace checks pass.
