# Chapter, section and subsection headings

1. Expose H1, H2 and H3 in the row style picker with the requested tooltips. All three styles are selectable on any editable text row. Save and reload H3 through the existing row style pipeline and include it in heading filters and previews.
2. Preserve a third heading level when importing HTML and DOCX and in formats that already render heading styles.
3. Reserve H1 for the WordPress post title. A standalone chapter keeps H2 and H3. A whole-book post nests chapter titles, sections and subsections at H2, H3 and H4. Apply these levels during serialization and describe them in the export dialog.
4. Verify the row controls, persistence and heading markup for single-chapter and combined exports. Run the relevant native and frontend suites.

## Release 0.8.149

1. Preserve every existing document's saved row styles. Editors can change individual rows manually.
2. Commit the heading changes and release metadata, then verify the release pull request on macOS locally and in CI.
3. Tag the merged commit and verify the published macOS and Windows packages, updater manifest and release notes.
