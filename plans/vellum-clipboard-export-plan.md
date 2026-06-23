# Vellum Clipboard Export Plan

## Goal

Add a Vellum copy-and-paste export option on macOS. The export should generate Vellum's proprietary `co.180g.Vellum.TextEditorContent` pasteboard payload for the current editor preview, write it to the macOS pasteboard, and include plain text / HTML fallbacks where useful. Windows and Linux builds must remain buildable and should not advertise the Vellum-only option.

## Steps

1. Inspect the captured Vellum pasteboard archive and identify a maintainable payload strategy. Done.
2. Add a native Tauri command that accepts either decoded XML plist text or binary plist base64, converts/validates it, and writes custom pasteboard data on macOS. Done.
3. Add a frontend helper that calls the native command with the Vellum payload plus optional fallbacks. Done.
4. Add focused Rust tests for plist conversion, payload validation, and an ignored live macOS pasteboard smoke test. Done.
5. Add a frontend Vellum archive builder for current preview text and common inline/block formatting. Done.
6. Add a macOS-only Vellum option under Copy and paste, and route submit through the native Vellum writer. Done.
7. Add UI and flow tests for mac-only visibility and Vellum submit behavior. Done.
8. Run the relevant Rust and frontend checks. Done.
9. Experiment with Apple `CTRubyAnnotation` attributes in the Vellum attributed-string payload so ruby base text is exported without flattening the annotation into visible body text. Done.
