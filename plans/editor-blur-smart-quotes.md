# Smart quotes when leaving an unchanged editor

The reported paragraph retained imported straight quotes when marked reviewed.
Adding a Vietnamese footnote subsequently converted both body and note: quote
normalization currently runs only for languages with changed text content.

1. Let an explicit text-editor blur include its language in save normalization,
   even when the wording is unchanged. Keep automatic saves limited to changed
   languages so untouched source and teammate text remain stable.
2. Route body, footnote, and caption blur through that option and preserve the
   existing focus guards, write queue, and row-scoped rendering.
3. Verify unchanged body blur, edited text, footnotes/captions, and untouched
   sibling languages with focused unit and browser regressions. Use a separate
   browser fixture server; leave the running native dev app alone.

## Result

- Explicit body, footnote, and caption blur now supplies its language to quote
  normalization, including when the editor's wording is unchanged. Automatic
  saves retain the changed-language guard.
- All 2,980 frontend unit tests passed; six focused Chrome browser regressions
  passed, including unchanged/edited body blur, persisted and reopened quotes,
  unchanged source text, unchanged review flags, and footnote focus/scroll cases.
- Scoped ESLint reported no errors and six pre-existing warnings. The tests ran
  against mocked Tauri data on port 1467 without launching a native application.
- Repeated validation on the isolated PR branch from current main: 2,980 frontend
  tests, 25 workflow tests, and all six browser regressions passed. Full ESLint
  reported no errors (70 existing warnings). The unused-code audit retained the
  existing three files, five browser imports, and seven exports reported before
  this change.
