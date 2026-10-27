# macOS glossary footnote shortcut

Use Command+F for inserting the hovered glossary term's footnote on macOS,
retaining Ctrl+F on Windows/Linux. Update the hover hint to show the matching
modifier. Footnote insertion continues to take priority only while an eligible
term is hovered; otherwise the ordinary Find shortcut keeps working.

1. Update platform-aware shortcut matching and its hover hint.
2. Verify matching, rejected modifiers, and ordinary Find behavior on each platform.
3. Mirror the changes into the running dev checkout and commit/push the fix.

Complete. Shortcut matching and the hover hint now use the platform's primary
modifier. Focused keyboard/tooltip tests passed, including incorrect modifiers,
composition/repeat guards, and ordinary Find behavior. Browser workflows verified
the hint, insertion, and footnote focus on macOS and Windows. All 3,097 frontend
unit/screen tests and 25 workflow tests passed, along with focused ESLint and
whitespace checks. The dev checkout received the changes and Vite reloaded them.
