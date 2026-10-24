# Why the experimental mundo entry omitted planet

Investigation: 2026-10-14. This finding concerns the experimental criteria-blind
HTN entry, not a verified failure in the original full procedure or production.

## Verified chain

1. Source research retained the planetary meaning (s2) and quoted Earth,
   Hercólubus and the Moon. Its dictionary input also described a planet use.
   The necessary evidence was available; this was not a failed search.
2. The target proposal explicitly rejected planet because contemporary astronomy
   excludes the Moon, which s2 also includes. Its prompt preferred one useful
   wording per operational sense, allowing variants only for materially different
   grammar or collocation. This encouraged using broad world for every application.
3. The independent candidate audit caught this without human criteria. It said
   rejection because of the Moon confuses contextual validity with coverage of the
   whole sense. It cited Earth's explicit nuestro planeta Tierra and Hercólubus's
   planetary description, requesting contextual validity for planet and broader
   selection of world where needed.
4. Repair received that audit and both source witnesses. It acknowledged planet
   fits Earth and Hercólubus, but kept the rejected disposition and omitted it from
   variants. Its prompt also required preserving every candidate disposition,
   conflicting with correcting a rejection. The audit itself requested recording
   contextual validity without explicitly requiring a serialized candidate.
5. validateProposal requires some variant for every sense. World covered s2, so
   the missing contextual candidate passed. No structured audit obligation was
   checked against actual delivered targets.
6. Frequency measurement chose among an already incomplete list. It could neither
   discover nor count planet. Sorting did not delete it; it was absent beforehand.

Vietnamese hành tinh suffered the same rejection pattern. The matched comparison's
glossary.json is structurally identical to the blind HTN's en/saved-glossary.json.

## Records

- Initial rejection: scripts/glossary-research-lab/runs/2026-10-14-htn-blind/terms/01/proposal.json:362.
- Independent detection: scripts/glossary-research-lab/runs/2026-10-14-htn-blind/terms/01/candidate-audit.json:40.
- Failed repair: scripts/glossary-research-lab/runs/2026-10-14-htn-blind/terms/01/bounded-target-repair.json:382.
- Coverage validation: scripts/glossary-research-lab/htn_core.mjs:83.
- Prompts: scripts/glossary-research-lab/htn_blind_runtime.mjs.

The full-procedure prompt in the canonical research checkout includes safeguards
to retain passed candidates and account for repeated open-reading renderings:
/Users/hans/Desktop/AI-Projects/GnosisTMS-research/src-ui/app/glossary-research-prompts.js:290.
This does not establish how the full procedure would handle planet. Experimental
compression weakened an existing obligation without proving it unnecessary.

## Consequences and correction

The recorded matched scores and costs remain observations of this deficient entry.
They do not show extra translation reasoning is preferable to a candidate-complete
glossary with effective notes. The earlier recommendation to favor translation
workflow changes was premature. Retain outputs and test a repaired glossary through
ordinary translation before making that comparison.

Preserve the obligation within existing target research, audit and compilation:

- Supported contextual subsets can warrant candidates. Exclusions narrow their
  scope rather than globally rejecting them. Several candidates may serve one
  broad meaning. Contextual validity and preferred selection are separate.
- Turn audit findings into structured delivery obligations linked to target,
  language, supported application, evidence and exclusions. A prose acknowledgment
  is not resolution; a delivered candidate with scope, or explicit unresolved
  status, is required.
- Allow evidence-based revisions to prior dispositions. Validate issue closure
  against compiled fields and retain the check after frequency sorting.
- Distinguish missing from available-but-underused candidates before repairing
  notes/order. Ordinary-translation tests, bounded retries and reporting remain
  required. The existing audit already detected this omission; an additional
  detection call was not necessary for this case.

These are design corrections, not implemented or validated production behavior.
Note experiments were paused while this investigation was completed.
