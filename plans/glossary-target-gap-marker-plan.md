# Target glossary forms that grammar can split

## Problem

Spanish places an adjective before a noun phrase; Vietnamese places it after the
head noun, which can be inside the glossary form:

- Source: "el tremendo batallar de las antítesis"
- Glossary: "sự giằng co giữa các mặt đối lập"
- Correct translation: "sự giằng co **dữ dội** giữa các mặt đối lập"

Three parts of the app fail this today:

1. The step 8/9 reviewer reports the split form as an error.
2. Even when the reviewer passes it, `assessTrial` requires the candidate text
   verbatim (`exactOccurrences`), so the occurrence still fails with "Confirmed
   target form is not present at a distinct target span".
3. In the editor, `sourceCandidateHasTargetMatch` flags the source term as having
   no translation, and the target text is not underlined.

## Notation: a gap marker, not regular expressions

A standalone `…` between two words of a target variant marks where the target
language may place words that modify the term:
"sự giằng co … giữa các mặt đối lập". The tokenizer already treats `...` and `…`
as the same token, so either can be typed.

- The gap matches zero to four words. Matching zero words means the gapped form
  also matches the unsplit wording, so it replaces the plain variant instead of
  sitting beside it.
- The inserted words may be separated only by spaces. No comma, period, dash,
  quote or line break inside a gap, so a gap cannot reach into the next clause.
- Target variants only. Source terms keep exact matching. The shared trie
  (`glossary-token-matcher.js`), the Rust matcher and the golden fixture do not
  change: only the editor and the studio match target text.
- A variant may contain more than one gap.

Why not regular expressions:

- Matching is token-based. The tokenizer handles case folding, NFC, quote, dot
  and hyphen classes, inline markup and ruby annotations. A character regex
  would bypass all of that or have to re-implement it. Rust and JS regex
  dialects also differ.
- Target variants are read by people (glossary editor, tooltips, TMX export) and
  by the AI translator as hints. Regex syntax would show up in all of them.
- Square brackets are already taken: ruby notation is `base[ruby: annotation]`,
  and 7 of the 9,055 target variants in the local glossaries use literal brackets
  ("[IMAGE]", "khử [cái Tôi] thành cát bụi của vũ trự"). None of the 9,055
  contains a standalone `…` between words.
- The AI does not have to write a pattern. The gap position comes from the split
  it actually produced (see Change 5).

## Changes

1. **Gap-aware target matching** (`editor-glossary-highlighting.js`). One helper
   finds target occurrences of a variant with gaps. It is used by
   `targetTextContainsCandidateVariant` (the missing-translation check),
   `buildRowTargetMatcher` (target underlines) and the studio's target-side
   `exactOccurrences` calls. Gapped occurrences join the same longest-first
   selection as plain ones. The underline covers the term's words, the inserted
   words stay plain, and both pieces share one tooltip. A variant with ruby
   annotation keeps the existing exact-ruby path; gaps and ruby in one variant are
   out of scope.
2. **Translator prompt** (`src-tauri/src/ai/mod.rs` glossary rules, beside the
   ruby sentence). One sentence: a standalone `…` in a target variant marks where
   the target language may place words that modify the term; with no such
   modifier, join the parts directly. The studio contract version stays: the
   sentence only matters for a form with a gap, adding a gap already changes
   the trial signatures, and a new app version marks step 9 stale anyway.
3. **Reviewer rule** (step 8/9 assessment prompt in
   `glossary-research-studio-testing.js`). When target grammar places a
   translation of a word that modifies the source term (an adjective, adverb,
   quantifier, possessive or demonstrative before or after it) inside the
   confirmed form, the split form is a correct rendering. The rest of the form
   must stay unchanged and in order. Quote the whole span including the inserted
   words.
4. **Split acceptance** (`assessTrial`). When the candidate is not found as
   written, look for its words in order with one run of one to four inserted
   words between two of them, under the gap rules above. A passing verdict on
   that span passes the occurrence, and the choice records where the split falls
   and the inserted words.
5. **Adding the marker to the entry.** When an occurrence passes with a split,
   the candidate's text gets `…` at that position. This is applied like a
   repair: the entry changes and the next validation round re-tests under the
   existing signature rules, which also checks that the translator copes with the
   marker. The activity log and report say what changed, for example "Allowed
   words between 'sự giằng co' and 'giữa các mặt đối lập', because Vietnamese
   places modifiers there ('dữ dội')". The human can edit or remove it with
   Edit glossary entry.
6. **Parity.** QA list terms are not matched in text; they reach the AI reviewer
   as hints. There is nothing to mirror.

### Why the marker comes from steps 8 and 9 rather than an earlier step

Step 6 could guess from the corpus that a term takes modifiers. But the need
depends on the target grammar and the shape of the chosen target form, and the
matcher needs the exact gap position. A guess would add gaps to terms that never
split, and each gap widens what the editor underlines. The first translation that
actually splits the term shows both the need and the position, and the reviewer
confirms that the split is grammatical.

## Tests

- Matcher: gap with zero to four words, too many words, punctuation in the gap,
  several gaps, `...` equal to `…`, plain variants unchanged.
- Editor: the gapped variant clears the missing-translation flag and underlines
  both pieces, not the inserted words.
- Prompt: the Rust glossary rules contain the marker sentence.
- Studio: a split rendering passes when the reviewer passes it, fails when the
  reviewer fails it or the gap breaks the rules, records the split, and adds the
  marker to the candidate. `testMeanings` and `testCompleteEntry` run with a
  split translation through to a passing, gapped entry.

## Commits

1. Gap-aware target matching in the editor.
2. Translator prompt sentence.
3. Studio reviewer rule, split acceptance and marker introduction.
