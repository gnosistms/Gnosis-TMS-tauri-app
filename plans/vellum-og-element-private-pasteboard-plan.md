# Vellum OGElementPrivate Pasteboard Plan

## Goal

When copying Vellum export data on macOS, put both Vellum pasteboard archive
flavors on the clipboard:

- `co.180g.Vellum.TextEditorContent` for pasting into an open chapter editor.
- `OGElementPrivate` for pasting into Vellum's table of contents.

## Findings

The `OGElementPrivate` archive is not a simple wrapper around
`TextEditorContent`. Its root object is a keyed `NSDictionary` with an
`elements` array containing an `OGTypedTextElement`. The element stores chapter
metadata such as `title`, `typeName = chapter`, inclusion flags, and a body
`NSAttributedString`.

The Vellum table-of-contents payload's body excludes the chapter title. For
Gnosis TMS export, a leading H1 should become the `OGTypedTextElement.title` and
be omitted from that chapter body. The existing editor paste payload should
remain unchanged so direct editor pastes keep the current behavior.

## Implementation

1. Add an `OGElementPrivate` decoded plist builder alongside the existing
   `TextEditorContent` builder.
2. Reuse the existing Vellum run construction and attachment handling so
   footnotes, images, links, subheads, and ruby fallback text remain consistent.
3. Add leading-H1 title extraction for the `OGElementPrivate` builder only.
4. Extend the Tauri pasteboard command to accept and write the optional
   `OGElementPrivate` binary plist in the same pasteboard item.
5. Add focused JS and Rust tests for the new archive and dual pasteboard input.
