# General title-page typography

Apply to every book/title page, with no book-specific strings or manual title
breaks. Disable inherited body justification/expanded word spacing in title-page
content. Use automatic balanced title wrapping, tighter title leading, and 14pt
subtitles. Preserve inline formatting, Unicode, and explicit author line breaks.

1. Validate automatic wrapping against short, long, Vietnamese, and other-script
   titles using the actual bundled typesetter and fonts.
2. Update the native title-page renderer and editable preview consistently.
3. Add focused coverage, render and inspect representative A5 output, and verify
   related export/editing workflows.
4. Update PR 384 and rebuild/restart the original dev checkout with all local
   changes retained.

## Implemented

Title pages locally disable justification and expanded word spacing. A measured
layout finds the narrowest centered column preserving the full-width line count;
it retains Unicode, inline styles and explicit breaks, and fits unbreakable long
words within the available width. No book-specific strings or forced breaks are
present in production code. Title leading is 0.6em (down from inherited 0.78em);
subtitles use 14pt. The preview has an editable, automatically wrapping title and
the matching title/subtitle hierarchy.

Validation: all 58 native PDF tests passed with actual typesetting enabled;
3,072 frontend tests and 25 workflow tests passed; all 12 export browser workflows
passed, including balanced wrapping, editable title persistence, and retained
selection during background refresh. Nine varied title examples were compiled
and visually/quantitatively inspected for line balance, diacritic separation,
and page bounds. Build, ESLint, strict all-target Clippy, Rust formatting and
whitespace checks passed.

The original dev watcher rebuilt and relaunched the native app; its executable
is newer than the changed renderer source. Both checkouts contain the fix.
