# Chapter-Scoped Preview Language

## Problem

Preview mode currently preserves the previously selected preview language when
opening another chapter. That leaks language choice across files, projects, and
teams, which is wrong when different teams target different languages.

## Approach

1. Default preview mode to the chapter target language when no chapter-scoped
   preview language exists.
2. Preserve preview language only while reloading the same open chapter.
3. Persist an explicit preview language selection on the chapter's local editor
   metadata so reopening that chapter restores its own choice.
4. Add focused tests for target-language default and same-chapter preservation.

## Verification

- `node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/editor-preview*.test.js src-ui/app/editor-state-flow.test.js`
- `npm test`
