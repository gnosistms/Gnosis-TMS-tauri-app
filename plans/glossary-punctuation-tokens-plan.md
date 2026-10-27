# Glossary matching: quotes, dots, and hyphens as tokens (policy v2)

Status: implemented 2026-09-03.

## Problem

The glossary matcher (Rust `ai/mod.rs` tokenizer feeding
`ai/glossary_matcher.rs`; JS `editor-glossary-highlighting.js` feeding
`glossary-token-matcher.js`) keyed on letters, marks, and digits only, lower-
cased. Every other character was a separator. So `"Yo"` equalled bare `yo`,
`I.A.O.` equalled `I A O`, and `auto-realización` equalled `auto realización`.
Glossaries that distinguish the quoted psychological "Yo" from the pronoun, or
dotted mantras/abbreviations from their bare letters, could not express that
distinction; the ES-EN glossary worked around it with article-bound surfaces
(`el "Yo"` → `el yo`, `del yo`, ...).

## Rule (both runtimes, pinned by the shared golden fixture)

- Tokens are maximal runs of one of four classes:
  1. word: `\p{L}\p{M}\p{N}` — normalized by lower-casing (unchanged);
  2. quote: `" “ ” „ ‚ « » ‹ › ' ‘ ’ 「 」 『 』` — normalized to `"`;
  3. dot: `.` `…` — normalized to `.`;
  4. hyphen: `-` `‐ ‑ ‒ –` (hyphen-minus, Unicode hyphens, figure dash, en
     dash) — normalized to `-`.
- Everything else (em dash `—`, comma, parentheses, whitespace, `¡!¿?`, ...)
  stays a boundary. A run of one punctuation class is a single token, so
  `I... A... O...` = `I… A… O…` = `I.A.O.`; a run spanning two classes
  (`".`) is two tokens.
- Quote styles are one class on purpose: a glossary written with straight
  quotes must match text set with guillemets, curly quotes, or CJK corner
  brackets.
- A glossary term compiles only if it has at least one word token; `...` or
  `"` alone never becomes a candidate. Punctuation-only text is tokenized but
  can never match.
- Selection is unchanged (globally longest greedy). A quoted or dotted surface
  has more tokens than its bare form, so it wins its span; the bare form still
  matches elsewhere.
- Grapheme mode (frontend, CJK) applies the same classes per grapheme, merging
  adjacent units of the same class into one token.

`GLOSSARY_MATCHER_POLICY_VERSION` moves 1 → 2 in both runtimes; the fixture's
`policyVersion` matches. The frontend derived-glossary revision key includes
the version, so cached derived entries regenerate under the new tokenizer.

## Behaviour change to be aware of

A hyphenated glossary surface no longer matches the unhyphenated text form and
vice versa (`self-remembering` ≠ `self remembering`), and a two-word term no
longer matches across a hyphen or a sentence-ending dot. Glossaries that want
both forms list both surfaces (the ES-EN glossary already does for most, e.g.
`Yo-Cristo` / `yo Cristo`, `I.A.O` / `I.A.O.` / `I. A. O.`).

## Files

- `src-tauri/src/ai/mod.rs` — token regex, punctuation normalization,
  matchable-term guard, tests.
- `src-tauri/src/ai/glossary_matcher.rs` — policy version 2; test helper guard.
- `src-ui/app/editor-glossary-highlighting.js` — word and grapheme tokenizers,
  matchable-term guard on candidate build and containment checks.
- `src-ui/app/glossary-token-matcher.js` — policy version 2.
- `tests/fixtures/glossary-matching/golden.json` — policyVersion 2; the two
  separator cases rewritten; new quoted, dotted, and CJK-quoted cases.
- `src-ui/app/editor-glossary-highlighting.test.js` — containment assertions.
- `plans/glossary-matching-semantics.md` — token boundary section.

Out of scope: `glossary-ruby.js` ruby-annotation comparison keeps its own
word regex (it compares ruby base text to variants, not glossary-to-text
matching). QA lists have no source-term matcher, so no parity change.
