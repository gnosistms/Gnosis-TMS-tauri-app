# Ilustre: complete reduced-budget studio research

Research Spanish **ilustre** into English in Test team 32's research glossary, using the current studio defaults and the Samael Aun Weor corpus. Start a fresh study; preserve other studies and their glossary entries. Review forms, exact collisions, dictionary and corpus evidence, source provenance, meaning assignments and translation candidates before focused and full-entry validation. Keep the original paragraph evidence, record automated timing and input/output tokens, and distinguish actual translation consequences from classification differences. Use only the app to mutate research data. Make any necessary fixes reviewable with focused tests, preserving existing code and notes. Complete the study in the test glossary if validation and collision review permit it. Keep the computer awake while work runs.

Pay particular attention to whether the word describes a distinguished person, functions as an honorific or has another attested use. Check rather than assume whether similar-looking verb forms belong to this study. Judge idiomatic English in context; do not force all occurrences to one synonym.

## Live observations

- Study `7220ba92-7544-4b70-8b0e-3eed46e090c0`, Spanish → English, same research test glossary.
- Exact source forms `ilustre` (32 paragraphs) and `ilustres` (25); complete population is 57 paragraphs / 57 occurrences, all retained.
- Live DLE lookup succeeded without a CAPTCHA. It supports distinguished lineage, distinction/celebrity and honorific dignity; Latin origin is `illustris`.
- Bounded corpus discovery inspected 16 passages and found ordinary distinction, including application to condemned black magicians without moral approval. It missed two verb occurrences.
- Full-sample meaning assignment correctly returned both verb occurrences unmatched. Used the app's review flow to add an explicit conjugated-verb definition and assign both cases. DLE `https://dle.rae.es/ilustrar` independently verifies illumination of understanding and clarification, and its conjugation table includes `ilustre` and `ilustres`. No source paragraph was dropped and no additional corpus scan was needed. Counts: lineage 3, distinction 45, honorific 7, verb 2.
- Component check rejected speculative word splitting. Optional borrowed-author / additional web-source searches were skipped because existing dictionary evidence resolves ordinary lexical origin and no specialized borrowing question requires them. This is an explicit human research choice, not a claim that no author used the word.
- Split review found no expression that needs a separate entry; routine titles, family descriptions and the two verb uses can be handled by grammar and contextual notes. Skipped optional collocation research on that basis.

- Initial focused tests used 20 selected paragraphs (3 lineage, 10 distinction, 5 honorific, 2 verb). “Distinguished” passed the adjective tests; one honorific paragraph needed a retry while four passing examples were reused. The AI also accepted “clarify matters for us” for the Morpheus passage. Human review prefers “enlighten us” to retain illumination of understanding in that context, so deselected “clarify” for this meaning through step 6 and rechecked only the affected verb tests. This is a wording/semantic nuance refinement, not a claim that the initial translation was wholly wrong.

- Full-entry pass 1 exposed a mistaken source assignment for `a506362adff56675`: “Vástago ilustre de un representante...” had been assigned to inherited lineage, causing a faithful “distinguished scion” rendering to fail. The automated repair then over-specified the shared note to enforce lineage. Paused that repair run, loaded three source neighbors on each side, and changed the occurrence to ordinary personal distinction through Review meaning. The reviewed example is now explicitly included in focused sampling. Corrected counts: lineage 2, distinction 46, honorific 7, verb 2.
- Replaced the mistaken inherited-rank repair with a reusable note preserving the adjective's actual referent. Clarified the general note so equivalent Spanish honorifics need not be mechanically duplicated in English; an earlier focused retry had unnecessarily demanded both Mr. and Don. These are human research judgments, not source-code changes. Revalidate after the note edits.
- Timing/token interpretation: all completed requests are instrumented. The paused second validation pass included interrupted requests whose final provider usage may be unavailable; recorded usage must not be presented as exact billed totals.
- Focused validation completed in three runs (99.169 s, 13.933 s and 81.287 s). The second run reused adjective tests and checked the changed verb choice; the third rechecked the corrected source assignment and translator notes. Final focused selection: 2 lineage, 10 distinction, 5 honorific and 2 verb paragraphs.
- Subsequent full-entry validation found two stylistic/construction findings: literal “distinguished bones” and an over-stacked dedication title. The coordinated repair keeps the same two target forms, permits metonymic distinction to be expressed through the people whose bones they are, and gives guidance on natural English honorary titles. This is narrower than adding new lexical senses. Review actual output before accepting it; awkward English is not automatically evidence that the selected Spanish meaning is wrong.

## Validation outcome and recorded efficiency

- Full-entry pass 4 passed **57/57 occurrences in 57/57 paragraphs**, using one unchanged entry across the four batches. This is the full matching corpus for these exact forms, not a reduced final sample. Counts: **distinguished 55**, **enlighten 2**; both retained. No exact source-variant collisions were found at step 10b.
- The final Morpheus rendering is “We must ask Morpheus to enlighten us and awaken us in the suprasensible worlds.” The reviewed descendant is “The distinguished son of a man who represented his department in that country’s National Chamber.” The bones passage expresses distinguished beings whose bones remain buried, preserving metonymic distinction through an English construction. The dedication uses distinguished professor with the doctoral title.
- Up to entry saving, recorded automated step time totals **610.562 s (10.18 min)**, excluding human review. Completed-request usage totals **220,983 input + 37,771 output = 258,754 recorded tokens**. Interrupted calls may be undercounted; this is not an exact billing statement. No same-word old-procedure baseline was run, so there is no defensible percentage speedup or quality-loss comparison for ilustre.

| Work | Automated seconds | Recorded input tokens | Recorded output tokens |
| --- | ---: | ---: | ---: |
| Forms / exact collisions / sample | 34.513 | 6,376 | 1,137 |
| Dictionary / discovery / component check / meaning inventory | 49.017 | 8,038 | 1,703 |
| Meaning assignments / split review | 39.898 | 21,764 | 2,009 |
| Translation candidates / spellings | 22.902 | 4,621 | 822 |
| Focused validation, three runs | 194.389 | 36,736 | 7,899 |
| Complete-entry validation, including paused run and repairs | 269.843 | 143,448 | 24,201 |

- Focused + full-entry validation account for about **82% of recorded tokens** and **76% of automated elapsed time**. Step 9 alone uses about **65% of recorded tokens**. This run suggests investigating assessor false positives, source-assignment review before repairs, and full reruns after small stylistic note edits. These are investigation findings, not implemented algorithm changes. The initial small discovery sample did miss the two verb occurrences; full-sample assignment and review recovered both before final testing.
- Instrumented saves total **10.444 s** up to saving, about **1.7%** of the summed step time. Step 9 records 43 saves totaling roughly 3.7 s while validation is running, increasing to 4.434 s by stage completion. Saving is not the dominant measured cost in this small study; this does not settle CPU behavior in much larger studies.
- Optional borrowed-author, additional-web, and collocation searches were skipped by human review, not run and declared empty. The full dictionary and corpus records remain available in the piecewise evidence store. No source code was changed during this research.

## Completed save

- Step 11 saved term `01a1487b-2e12-77c3-9c37-dfb70a20bfbb`; verified its local glossary JSON and the approved research snapshot. Source variants: ilustre / ilustres. Target variants: distinguished / enlighten, with the validated usage notes and the general note. No colliding existing entry was overwritten.
- Step 12 has no split studies; **Study complete. All research remains saved.** is visible in the app. The study remains open for review.
