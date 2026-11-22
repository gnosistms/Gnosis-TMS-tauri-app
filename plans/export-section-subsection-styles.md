# Chapter titles, sections and subsections in exports

1. Compare each chapter and book export with the implementation before H3. Keep chapter-title handling and heading semantics, and assign the former section and subsection presentation to H2 and H3.
2. Align the print and editor previews, contents options, navigation and clipboard formats with those roles. Preserve saved book preferences and source row styles.
3. Verify the generated formats, including PDF typography for Latin and other scripts, book contents links, and Vellum's native subhead levels. Run the affected frontend, browser and native tests.

## Verification

The pre-H3 Latin and Japanese PDF samples match the new section and subsection samples pixel for pixel. The generated EPUB’s navigation links resolve to the H2 and H3 elements, and its optional printed contents link to the H2. Regression tests check DOCX outline levels and sizes, RTF and TXT formatting, Vellum subhead levels, the saved contents preference, and the removal of the chapter WordPress heading note from the export panel.
