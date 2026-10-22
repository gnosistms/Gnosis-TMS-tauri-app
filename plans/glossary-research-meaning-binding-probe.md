# Blind feasibility test: meaning recognition and target binding

Hans's 2026-10-14 steering: test whether the AI can independently recognize the
planet meaning of mundo and prefer the appropriate English rendering before
spending more on the full benchmark. Per-word acceptance criteria remain outside
every runtime call. Broader benchmark scheduling is stopped, with results retained.

1. Freeze raw existing source paragraphs, occurrences/neighbors, the independently
   established Spanish meaning inventory, and source-only no-glossary outputs.
   Include physical-object cases, realms/society/idioms and the Sun/stars boundary.
2. Ask two fresh agents directly what the expression means and which English
   rendering they independently prefer. Provide no target candidates or acceptance
   criteria. Check an existing no-glossary rendering only after the open choice.
3. Separately classify each source occurrence against the source-only meanings,
   using two independently shuffled inventories. Allow ambiguity/unknown rather
   than forcing every occurrence into an existing meaning.
4. Independently construct preferred English renderings for each meaning from its
   defining features and genuine witnesses, without external expected targets.
   Compare two proposals; disputed mappings remain unknown.
5. Translate using agreed meaning-to-target bindings. Emit marked translation
   segments so code can check every source occurrence's selected meaning and
   actual rendered span against its mapping. Test the checker by injecting a wrong
   target, missing occurrence and wrong binding. This verifies compliance, not
   source interpretation, target quality or passage fidelity.
6. Only the external analysis reads human criteria. Report whether recognition,
   target judgment, binding or delivery fails; distinguish acceptable synonyms from
   preferred project wording. Retain failed/unknown cases and all costs. A feasible
   prototype is not proof of reliable performance on future words.

Use the authorized ChatGPT subscription with isolated contexts and tools disabled.
No production changes, no word-specific usage-note patch and no safeguard removal.

The probe is bounded to fourteen model calls including one protocol repair, including independent repeated
judgments, one source refinement, and one bound translation. Repetitions are for
feasibility measurement. The production design can place source-first preferred
rendering and binding fields inside its existing source/target/consumer tasks.

Observed so far: two unprimed direct calls independently prefer planet for five
clear occurrences where the no-glossary output uses world. They agree on preserving
a broader category for the list containing the Sun. A plural case yields planet/world
preference disagreement. Two fresh reviews of existing translations often accept
world as best/equivalent. This is task-dependent preference, not evidence that the
model considers every such world materially wrong. Source-only classifiers expose
overlapping Earth/globe and planetary meanings and the missing mixed celestial
category. One source-only refinement is activated by those observed inventory defects.

One additional bound-translation treatment preserves the already agreed unprimed
source-specific choices instead of using a single preferred target for a broad
meaning. No new target-selection inference or human hint is added. This tests whether
the earlier independent preference survives delivery, and exposes the difference
between semantic category agreement and context-specific preferred wording.

The first source-precommit translation revealed a routing defect: an occurrence with
a disputed direct preference borrowed another occurrence's target via their shared
broad meaning. The deterministic check rejected it. The corrected eligibility gate
requires an agreed occurrence-specific target id and excludes the disputed paragraph.
A fault-injection test reproduces the defect. One changed-input translation call is
permitted; the original failure and its costs remain recorded. Aggregate translation
output cannot bypass the exact request-signature cache when bindings change.

Status: focused feasibility probe complete. Two direct readings agree on planet in
five clear cases; fresh baseline reviews often accept world. A flat lexical-meaning
binding mechanically passes but preserves world. Source-specific precommitment
preserves the five preferred planet choices and the Sun boundary, with a final
mechanical pass on 12 paragraphs / 16 occurrences. The remaining 13 paragraphs
are unresolved/unserved. Six actual-output fault injections and eight pure tests
pass. Fourteen calls, 298,323 input and 48,255 output tokens including repetitions
and the initial routing failure; no efficiency claim. Equal-compute no-glossary
control and future-word generalization remain required.
