# Assistant composer retains sent text

## Scope

Investigate the Windows Shift+Return send path and prevent a sent prompt from
being restored to the composer. Preserve focus and any new draft typed while a
reply is pending. Do not change provider requests or stored conversations.

## Plan

1. Reproduce sending with browser fixtures and mocked assistant responses;
   inspect draft state around composer replacement and change events.
2. Fix draft event handling at the smallest responsible boundary.
3. Verify repeated sends, pending replies, and new drafts with browser coverage
   plus the existing assistant tests. Record platform limitations.

## Result

Reproduced the reported text restoration in Chrome using Shift+Enter and mocked
assistant replies. Replacing the focused composer fires a change event carrying
the old text after the send flow clears the draft. The assistant draft handler
now accepts input events only, so this blur commit cannot repopulate state.

Validation: the regression failed before the fix and passed after it. Four
browser checks passed, covering repeated sends, focus, a new draft while a reply
is pending, persisted transcript rendering, and transcript scroll while typing.
All 190 related unit tests passed, as did ESLint for the changed handler and
diff whitespace checks. Browser validation used macOS Chrome with mocked AI
responses; native Windows WebView verification remains outstanding.
