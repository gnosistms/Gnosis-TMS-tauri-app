# Recent Gnosis VN research test

**Complete.**

Tested the unchanged `compact12-precise-nodict` against saved previous app research for all eight distinct terms in the local Gnosis VN ES–VI history (September 25–October 12, 2026). Seven prior runs are completed; Segunda Cámara is a review-only proposal. Optimized research received no saved targets, notes, sibling entries or prior research evidence. Original app research was imported after fresh compact entries were generated.

Across 219 comparisons: **2 / 2 / 215 correctness wins / losses / ties**. Naturalness: 1 / 4 / 214. Clear differences require material correctness defects; both good versions tie. A second fresh blind judge checks non-ties, and disputed differences become ties. First absolute grades: 201 both acceptable, 1 both needing correction, 2 uncertain.

| Term | Prior result | Research passages | Evaluation passages | Correctness W / L / T | Naturalness W / L / T | Both acceptable |
|---|---|---:|---:|---|---|---:|
| Íntimo | completed; different model | 12 | 40 / 40 | 2 / 0 / 38 | 1 / 0 / 39 | 35 |
| vanidad | completed | 12 | 40 / 40 | 0 / 0 / 40 | 0 / 0 / 40 | 38 |
| vanidoso | completed | 12 | 12 / 12 | 0 / 0 / 12 | 0 / 0 / 12 | 12 |
| Segunda Cámara | provisional | 12 | 40 / 40 | 0 / 0 / 40 | 0 / 0 / 40 | 40 |
| Regenerar | completed | 1 | 40 / 40 | 0 / 2 / 38 | 0 / 4 / 36 | 30 |
| regeneración | completed | 12 | 40 / 40 | 0 / 0 / 40 | 0 / 0 / 40 | 39 |
| regenerador | completed | 5 | 5 / 5 | 0 / 0 / 5 | 0 / 0 / 5 | 5 |
| regenerativo | completed | 2 | 2 / 2 | 0 / 0 / 2 | 0 / 0 / 2 | 2 |

| Subset | Comparisons | Correctness W / L / T | Naturalness W / L / T |
|---|---:|---|---|
| Completed previous results | 179 | 2 / 2 / 175 | 1 / 4 / 174 |
| Completed previous results, same model | 139 | 0 / 2 / 137 | 0 / 4 / 135 |
| Provisional previous proposal | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| No detected full-text exposure to either research method | 43 | 2 / 0 / 41 | 1 / 0 / 42 |

With the focused recall repair below, the assembled recent-term result is **2 / 0 / 217 correctness** and **1 / 0 / 218 naturalness**. Initial absolute grades: 208 both acceptable, 0 both needing correction, 2 uncertain. This replaces Regenerar only; the other seven outputs are reused unchanged.

## One focused repair: attached-pronoun forms

The initial Regenerar search supplied 41 passages; reserving 40 left only one for research. The two confirmed correctness losses confused personal reform with physical recreation/regeneration. This is a source-coverage weakness under the holdout protocol, not evidence that the omitted counting/consistency stages are necessary.

The source-only repair mechanically generated attached-pronoun forms and confirmed regenerarse, regenerarnos, regenerarlo, regenerarla, regenerarlos in the corpus. The expanded search supplied 74 passages and 34 nonreserved passages. The same research instructions, schema, reasoning effort and 12-passage cap were retained; the 40 evaluation texts were unchanged. Full-text containment in either direction was excluded from the repair evidence. No dictionary, human targets, saved source aliases, loss-case texts or new research model stage was added.

| Repair comparison | Confirmed complete | Passages | Correctness W / L / T | Naturalness W / L / T |
|---|---|---:|---|---|
| Versus previous-app | True | 40 | 0 / 0 / 40 | 0 / 0 / 40 |
| Versus compact12-precise-nodict | True | 40 | 5 / 0 / 35 | 0 / 0 / 40 |

Exploratory assembled policy (unchanged outputs for seven terms; repaired Regenerar): 219 comparisons, 2 / 0 / 217 correctness and 1 / 0 / 218 naturalness. This is a repair developed on observed regressions, not a new independent confirmation sample.

Repair acquisition: 1 replacement research call, 51.9 model seconds, 12,592 input and 1,090 output tokens. Conservatively including the original attempt too, the seven completed-term experiments cost 8 research calls, 278.4 model seconds, 96,886 input and 5,225 output tokens: 96.52% less summed model work and 98.65% fewer outputs than native per-run logs.

A practical next rule is to check attached-pronoun forms when an infinitive has too few usable contexts. This repair was tested on Regenerar only; it does not establish a universal gate or solve irregular-conjugation recall. The artificial 40-passage reservation contributed to the original one-context shortage.

## Compared with the earlier random sample

| Test | Reference | Terms with passages | Comparisons | Correctness W / L / T |
|---|---|---:|---:|---|
| Earlier random sample | Fresh original method with human candidate list | 29 | 750 | 31 / 0 / 719 |
| Recent researched terms | Saved previous app outputs | 8 | 219 | 2 / 2 / 215 |

The reference, term mix, models, and exposure differ. This comparison tests whether the compact result generalizes to recently studied terms; differences in win rate are descriptive, not a causal improvement or deterioration estimate. The recent terms are correlated families, not eight independent random draws.

## Research time and tokens

| Term | Native calls | Compact calls | Native model seconds | Compact model seconds | Native input | Compact input | Native output | Compact output |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Íntimo | 25 | 1 | 907.2 | 36.3 | 76,860 | 12,248 | 38,626 | 885 |
| vanidad | 59 | 1 | 1950.4 | 29.1 | 174,787 | 12,371 | 81,962 | 521 |
| vanidoso | 22 | 1 | 563.5 | 30.8 | 44,368 | 12,473 | 24,455 | 533 |
| Segunda Cámara | 16 | 1 | 378.1 | 46.6 | 40,221 | 12,479 | 16,202 | 859 |
| Regenerar | 75 | 1 | 1624.8 | 28.6 | 306,665 | 11,385 | 91,036 | 452 |
| regeneración | 58 | 1 | 1501.2 | 36.1 | 202,007 | 12,857 | 76,216 | 635 |
| regenerador | 24 | 1 | 831.7 | 37.7 | 76,649 | 11,531 | 44,365 | 722 |
| regenerativo | 30 | 1 | 625.3 | 27.8 | 75,478 | 11,429 | 29,457 | 387 |

Seven completed prior runs: 97.61% fewer calls; 97.17% less summed model-call time; 91.19% fewer known input tokens; 98.93% fewer output tokens. Native unknown-usage calls: 0; compact: 0.

Six completed prior runs using the same model: 97.76% fewer calls; 97.32% less summed model-call time; 91.81% fewer known input tokens; 99.06% fewer output tokens. Native unknown-usage calls: 0; compact: 0.

Native usage is measured in the app; compact usage is measured through Codex CLI. Fixed CLI input overhead is present only in the compact calls, and model/runtime differences prevent a controlled timing comparison. Summed call time excludes unmeasured idle/review time and is not end-to-end app wall time. Family stages may be shared or inherited in native sibling studies. Native per-run usage is direct logged usage, not a reconstruction of shared family acquisition costs. Provisional Segunda Cámara is excluded from completed-run savings.

## Corpus exposure

| Term | Evaluation passages contained in saved app evidence | Contained in compact research |
|---|---:|---:|
| Íntimo | 2 | 0 |
| vanidad | 35 | 0 |
| vanidoso | 12 | 12 |
| Segunda Cámara | 40 | 0 |
| Regenerar | 40 | 0 |
| regeneración | 40 | 0 |
| regenerador | 5 | 5 |
| regenerativo | 2 | 2 |

Saved app runs did not reserve this sample. Sparse compact terms necessarily reuse their available passages. Literal full-text checks can miss partial/reformatted overlap. Controlled translation uses a shared neutral draft and can preserve shared mistakes. Judges are fresh-context independent, not a different model family or a human panel. Initial absolute grades remain subjective even when relative differences are confirmed.

## Confirmed differences

### Íntimo: 2 confirmed win cases

- Passage 999d14b7068ee75b: “Trabajamos en íntima relación” nói về sự phối hợp mật thiết giữa các Huynh đệ; A chuyển thành liên hệ “nội tâm”, làm thay đổi loại quan hệ được mô tả.
- Passage 674d626e5da719bd: “Vida íntima con el sexo opuesto” chỉ đời sống thân mật với người khác giới; B dịch thành “đời sống bên trong”, sai nghĩa và khiến cụm này khó hiểu.

### Regenerar: 2 confirmed loss cases

- Passage f6726e63a22331a0: Trong ngữ cảnh điều trị nhằm thay đổi người đồng tính, “cải hóa” giữ nghĩa tác giả muốn nói; “tái tạo họ” gợi việc tạo lại con người, sai nghĩa và thiếu tự nhiên.
- Passage 16336a441e066f1b: Đoạn nguồn dùng regenerarse để nói việc thay đổi bản thân theo lời khuyên của tác giả; “sửa mình” giữ ý ấy, còn “được tái tạo” và “họ không tái tạo” làm lệch nghĩa.

## Experiment usage

| Role | Calls | Known input | Known output | Unknown usage |
|---|---:|---:|---:|---:|
| evaluation | 76 | 974,934 | 94,424 | 0 |
| judge | 38 | 537,783 | 36,940 | 0 |
| research | 9 | 109,365 | 6,084 | 0 |

Compare the actual entry wording in [ENTRIES-compact12-precise-nodict.md](/Users/hans/Desktop/AI-Projects/GnosisTMS/scripts/glossary-research-lab/runs/2026-10-12-recent-app/ENTRIES-compact12-precise-nodict.md). Native references are reconstructed report defaults; later unsaved manual edits are not recoverable from these checkpoints. Raw native stages and hashes, fresh compact calls, usage, passages, translations, blind maps and confirmed judgments are preserved in `runs/2026-10-12-recent-app/`. Production app code and glossary files are unchanged.
