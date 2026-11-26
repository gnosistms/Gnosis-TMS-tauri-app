# Glossary Research: author's own equivalents and clashes with neighbouring words

Status: proposed 2026-10-20, not implemented (waiting for Hans).

## Why

Test run "étnico" (ES→EN, focused research, gpt-6.1-sol, 2026-10-20). The tool proposed spiritual / the spiritual / ethnic / racial. The coordinating AI then added "higher" and "divine" by hand at the review pause. Hans: if an AI has to add candidates, the procedure is deficient. Two general gaps explain why the additions seemed needed:

1. **The author's own equivalents were not offered as candidates.** The 21 passages include «Principios Étnicos o divinales» and «principios étnicos superiores, es decir, … los principios anímicos y espirituales». The proposal used "higher" in its own definition but never weighed the author's glosses as translations.
2. **No check for clashes with neighbouring words.** "spiritual" is the established rendering of *espiritual*, and the author lists both in one series: «principios anímicos, étnicos o espirituales». The tool's own counting translations then read "the spiritual, soul-related, or spiritual principles" (lecture-209:30) and "soul-related, spiritual, or spiritual principles" (lecture-114:75). The focused route has no glossary and no related-word step, so it cannot see this.

## Proposed changes (general, no word-specific hints)

1. **Author glosses as candidates.** In the focused route, after sampling: find passages where the author equates the term with other words (patterns such as "X o Y", "X, es decir, Y", "X (Y)", "X, o sea Y", and lists where the term alternates with synonyms). Report these glosses. The proposal must consider the established translations of each gloss as candidates, and say why it accepts or rejects each.
2. **Series check.** When the term appears in a coordinated series with other words ("A, B o C"), each proposed translation is checked against the translations of the other members, both established glossary entries and ordinary renderings. A candidate that equals a co-member's translation in the same series is flagged as a clash in the report and at the review pause. It is never chosen silently.
3. **Counting output check.** After counting, scan the counting translations for the same English word repeated within one coordinated series. Report each case as a clash, quoting the passage.

## Not in scope

No change to existing runs or their checkpoints; no saved glossary data changes; no hardcoded words.
