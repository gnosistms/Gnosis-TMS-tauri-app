# Non-Space-Delimited Glossary Matching Plan

## Context

Glossary highlighting currently builds a matcher from glossary terms, tokenizes row text, then compares whole tokens. That works for space-delimited languages, but fails for Japanese because text such as `主の祈り` can become one token. A glossary term like `祈り` will not match inside it.

## Plan

1. Add a language helper in `src-ui/app/editor-glossary-highlighting.js`.
   - Define `NON_SPACE_DELIMITED_LANGUAGE_CODES`.
   - Add a helper that checks the primary language subtag so `ja-JP` behaves like `ja`.
   - Start with `zh`, `ja`, `th`, `lo`, `km`, `my`, `bo`, and `dz`.

2. Add a substring matcher for non-space-delimited languages.
   - Normalize base text and term text with the existing `normalizeGlossaryToken`.
   - Search candidate terms longest-first.
   - Produce the same match shape currently consumed by `buildHighlightMarkup`.
   - Prevent overlapping matches, preferring longer terms.

3. Preserve the current token matcher for space-delimited languages.
   - Keep whole-token matching for languages such as English and Spanish.
   - Avoid changing Latin-language partial-word behavior in this pass.

4. Wire matcher selection in `findLongestGlossaryMatches`.
   - Use substring matching when the matcher language is non-space-delimited.
   - Use the existing token matcher otherwise.

5. Update target-presence checks.
   - Update `textContainsGlossaryTerm` to use the same matching behavior.
   - This prevents source highlights from being incorrectly marked as missing when a Japanese target term appears embedded in a sentence.

6. Add focused tests in `src-ui/app/editor-glossary-highlighting.test.js`.
   - Japanese target term `祈り` highlights inside `主の祈りを唱える`.
   - Longer Japanese term `主の祈り` wins over shorter `祈り`.
   - Source highlight is not marked as an error when the Japanese target term appears without spaces.
   - Existing space-delimited matching still avoids partial-word matches.

7. Verify.
   - Run the focused glossary highlighting tests.
   - Run `npm test`, because glossary highlighting is used by editor rendering and visible row patching.
