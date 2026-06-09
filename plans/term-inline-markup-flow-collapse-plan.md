# Term Inline Markup Flow Collapse Plan

## Scope

Collapse the glossary and QA term inline-markup flows behind a shared
`repo-resource/term-inline-markup-flow.js` pure factory while keeping the existing
public exports and operations-injection seams.

## Steps

1. Extract the shared button sync/toggle engine with descriptor hooks for textarea
   detection, button applicability, draft update, and autosize height.
2. Rewrite glossary and QA modules as thin descriptor adapters.
3. Preserve existing glossary coverage and add QA coverage for the adapter-specific
   text-field draft update and autosize behavior.
4. Run focused tests, full `npm test`, and `npm run audit:unused`.
