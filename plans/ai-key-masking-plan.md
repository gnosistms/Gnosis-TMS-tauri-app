# Mask saved AI keys

Saved keys must never appear as readable or copyable text in AI Settings. A newly
entered replacement remains visible until saving and the existing provider key
check succeed; failures retain the draft for correction.

1. Separate editable key drafts from the saved-key indicator. Discard plaintext
   returned by local key reads rather than retaining it in settings state.
2. Render saved keys as an empty password input with a fixed masked placeholder,
   block copy/cut/drag from that saved field, and keep replacement/removal usable.
3. Clear drafts after successful verification and mask keys on reload/provider
   switches. Keep pending-read protections for new drafts.
4. Test loading, verification success/failure, replacement and removal, plus browser
   checks that saved plaintext is absent and clipboard events are blocked.

Status: complete.

Saved plaintext is discarded from settings state; the saved password field has an
empty value and fixed masked placeholder, without a reveal action. Copy, cut and
drag events are blocked for saved fields. Entering a replacement shows a text
draft, and successful saving/key verification clears it. Failed saves/checks keep
the draft. An explicit Remove key action preserves key removal without submitting
a placeholder as a credential.

Validation: all 2,033 frontend tests and four browser checks passed. The browser
checks used installed Chrome and an isolated Vite server to avoid stale HMR modules
on the shared server. Screenshot inspected. ESLint has no errors in changed
production files (two existing warnings), whitespace checks pass, and the unused
code audit reports only existing unrelated findings.
