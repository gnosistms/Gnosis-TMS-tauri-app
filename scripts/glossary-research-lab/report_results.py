"""Build a concise, reproducible report from strict judgments and measured calls."""
import json, subprocess, sys
from pathlib import Path
from collections import Counter, defaultdict
here=Path(__file__).resolve().parent
root=Path(sys.argv[1]) if len(sys.argv)>1 else here/'runs/2026-10-12'
for reference in ['baseline-human','baseline','compact12-precise']:
    subprocess.run([sys.executable,str(here/'analyze.py'),str(root),'--reference-method',reference],check=True,stdout=subprocess.DEVNULL)
a=json.loads((root/'analysis.json').read_text())
h=json.loads((root/'analysis-controlled-vs-baseline-strict.json').read_text())
d=json.loads((root/'analysis-controlled-vs-compact12-precise-strict.json').read_text())
rows=[json.loads(s) for s in (root/'requests.jsonl').read_text().splitlines()]
manifest=json.loads((root/'manifest.json').read_text())
lines=['# Glossary research optimization experiment','',f"Snapshot: {len(rows):,} measured calls. Strict judging; source-only random seed {manifest['seed']}; {a['sampled']} of {manifest['population']} active ES–VI entries.",'']
completion={m:sum(v.get(m) in ['done','no-hits'] for v in a['completion'].values()) for m in ['baseline','baseline-human','compact12-precise','compact12-audited','compact12-precise-nodict']}
# Presence, rather than status spelling, covers explicitly retained zero-hit entries.
completion={m:sum((term/m/'entry.json').exists() for term in (root/'terms').iterdir()) for m in completion}
complete=all(n==30 for n in completion.values()) and all(a['methods'].get(m,{}).get('passages')==750 for m in ['compact12-precise','compact12-audited','compact12-precise-nodict'])
complete=complete and h['methods'].get('baseline-human',{}).get('passages')==750 and d['methods'].get('compact12-precise-nodict',{}).get('passages')==750
complete=complete and all(not a['methods'].get(m,{}).get('absolute',{}).get('unconfirmed_accuracy_differences',0) for m in ['compact12-precise','compact12-audited','compact12-precise-nodict'])
lines += [('Completed full-sample evaluation.' if complete else '**In progress: these are partial results, not a final quality conclusion.**'),'','## Correctness and naturalness','', 'Wins and losses require a clear, material source-based correctness difference. Both accurate versions tie. Naturalness is separate and requires a clear fluency defect to prefer a side. Fresh independent agents grade both complete translations; raw grades and reasons remain saved. Non-tie findings receive a second independent check; disputed preferences become ties. Absolute acceptability/error counts describe the initial grades, so inspect disagreements rather than treating those grades as objective labels. Human candidates are fallible suggestions, never answer keys.','', '| Method vs human-seeded canonical reference | Terms with passages | Passages | Clear wins | Clear losses | Ties | Both acceptable | Both material errors |','|---|---:|---:|---:|---:|---:|---:|---:|']
def naturalness_text(counts):
    return f"{counts.get('win',0)} clear wins, {counts.get('loss',0)} clear losses, {counts.get('tie',0)} ties"
best=a['methods'].get('compact12-precise-nodict')
if best and best['passages']==a['term_passage_pairs']:
    recommendation=['## Recommended default','', 'Use one guarded proposal from up to 12 raw corpus passages, with no routine dictionary lookup or repeated counting/consistency passes. Use every available passage for sparse terms. Preserve lexical labels, semantic categories and proper names; never invent expanded initials or insert definitions/extra attributes into the headword. The CLI supports this directly as `compact12-precise-nodict`, without a human glossary or baseline run.','', f"Against the human-seeded reference: {best['wins_losses_ties'].get('win',0)} confirmed correctness wins, {best['wins_losses_ties'].get('loss',0)} losses, {best['wins_losses_ties'].get('tie',0)} ties. Naturalness: {naturalness_text(best['dimensions']['naturalness'])}. The first independent grades mark {best['absolute'].get('both_acceptable',0)} pairs both acceptable, {best['absolute'].get('both_need_correction',0)} both needing correction, and {best['absolute'].get('uncertain',0)} uncertain.",'', 'The isolated dictionary-removal comparison is reported below. The conditional audit fired on 24 of 29 positive-hit terms; its isolated 142-passage development comparison with the parent had no clear difference. A routine audit has not earned its extra cost. A focused check for a genuinely unresolved issue remains a proposed fallback.','']
    insert=lines.index('## Correctness and naturalness');lines[insert:insert]=recommendation
for m,x in a['methods'].items():
    w=x['wins_losses_ties'];absolute=x['absolute'];lines.append(f"| {m} | {x['terms']} | {x['passages']} | {w.get('win',0)} | {w.get('loss',0)} | {w.get('tie',0)} | {absolute.get('both_acceptable',0)} | {absolute.get('both_material_errors',0)} |")
for title,analysis,method in [('Human candidate advantage over unseeded original',h,'baseline-human'),('Dictionary removal vs otherwise identical precise parent',d,'compact12-precise-nodict')]:
    x=analysis['methods'].get(method)
    if x:lines+=['',f"{title}: {x['passages']} passages; {x['wins_losses_ties'].get('win',0)} clear wins, {x['wins_losses_ties'].get('loss',0)} clear losses, {x['wins_losses_ties'].get('tie',0)} ties."]
lines+=['','## Effective research cost','', 'Paired acquisition cost includes shared dictionary evidence and inherited proposal work. Seed preparation, translation and judging are separate. Six terms affected by interrupted/overlapping early controllers are excluded from paired savings; their quality results remain. Model-call seconds measure total concurrent work, not user-visible elapsed latency.','', '| Method | Paired terms | Calls saved | Model work saved | Known input saved | Known uncached input saved | Known output saved |','|---|---:|---:|---:|---:|---:|---:|']
fmt=lambda x:'—' if x is None else f'{100*x:.1f}%'
for m,x in a['methods'].items():
    s=x['savings'];lines.append('| '+m+' | '+str(x['cost_terms'])+' | '+' | '.join(fmt(s[k]) for k in ['calls','call_seconds','input','uncached_input','output'])+' |')
lines+=['','## Subgroups and concrete regressions','']
for m in ['compact12-precise','compact12-audited','compact12-precise-nodict']:
    x=a['methods'].get(m)
    if not x:continue
    lines.append(f"### {m}")
    lines+=['',f"Second checks: {x['absolute'].get('second_judge_checked',0)}; disputed findings retied: {x['absolute'].get('second_judge_disagreement',0)}. Naturalness: {naturalness_text(x['dimensions']['naturalness'])}. Absolute material errors: candidate {x['absolute'].get('candidate_material_error',0)}, reference {x['absolute'].get('reference_material_error',0)}. Uncertain comparisons: {x['absolute'].get('uncertain',0)}.",f"Term-mean net correctness: {x['term_mean_net_preference']}; term-cluster bootstrap 95% interval {x['term_bootstrap_95ci']}. This is exploratory uncertainty, not a formal equivalence test."]
    for group in ['development','confirmation','sparse_overlap','no_detected_full_text_exposure']:
        g=x['groups'][group];lines.append(f"- {group}: {g['terms']} terms, {g['passages']} passages, {g['wins_losses_ties']}; net-loss terms: {', '.join(g['accuracy_regressions']) or 'none'}.")
    losses=[]
    for term in sorted((root/'terms').iterdir()):
        file=term/m/'controlled/vs-baseline-human/strict/verified-judgments.json'
        if not file.exists():file=file.with_name('judgments.json')
        if not file.exists():continue
        for row in json.loads(file.read_text()):
            if row['accuracy'] not in ['tie',row['candidateSide']]:losses.append((term.name,row['id'],row['reason']))
    if losses:lines+=['','Clear-loss reasons (agent judgments requiring inspection):']+[f'- Term {i}, passage {pid}: {reason}' for i,pid,reason in losses[:15]]
    lines.append('')
lines+=['## Stage measurements','', 'All attempted unseeded canonical research calls, including exploratory interruptions/retries; these totals are not the paired savings denominator.','', '| Stage | Calls | Model work (min) | Input tokens | Output tokens |','|---|---:|---:|---:|---:|']
for key,x in sorted(a['stage_costs'].items(),key=lambda item:-item[1]['call_seconds']):
    if not key.startswith('baseline:'):continue
    lines.append(f"| {key.split(':',1)[1]} | {x['calls']} | {x['call_seconds']/60:.1f} | {x['input']:,} | {x['output']:,} |")
lines+=['','## Total experiment usage','', '| Role | Calls | Known input | Known output | Unknown usage calls |','|---|---:|---:|---:|---:|']
roles=defaultdict(list)
for row in rows:roles[row['role']].append(row)
for role,rs in roles.items():lines.append(f"| {role} | {len(rs)} | {sum((r.get('usage') or {}).get('input_tokens',0) for r in rs):,} | {sum((r.get('usage') or {}).get('output_tokens',0) for r in rs):,} | {sum(r.get('usage') is None for r in rs)} |")
lines+=['','## Interpretation limits','', '- The initially zero-hit term stops before the canonical engine. Its alias recall and full original workflow are untested; targeted variants or an example are needed before concluding that no usable corpus context exists.', '- 750 term-passage comparisons (deduplicated within each term) across 29 positive-hit terms; 14 terms supply 40 passages, 15 are sparse, and one zero-hit term is retained. Do not pad sparse samples or infer quality for the zero-hit term.', '- Corpus search windows overlap. A literal full-text exposure audit detects reserved passages embedded inside some larger research windows. The separate no-detected-exposure group is conservative and cannot exclude shorter overlapping excerpts.', '- Controlled translation uses a shared neutral Vietnamese carrier; each method changes only the researched term and required grammar. This reduces unrelated translator variation but can preserve shared errors. Absolute grades expose both-bad ties. Independent full-translation pilots are retained separately.', '- Judges are independent by fresh context, not by model family or human expertise. They see only sources and randomized translations, never glossary data or method names.', '- The CLI adds substantial fixed per-call input overhead. Output-token savings and removed stages are stronger evidence for native-app savings than a literal extrapolation of CLI input savings.', '- Native DLE webview retrieval and production output-token caps cannot be reproduced. Retrieval failures are recorded; canonical Wiktionary and measured dictionary-only web fallback remain.', '- Account subscription limits are shared. Per-request CLI usage is measured; account-wide percentage changes cannot be attributed solely to this experiment.', '- Original V.M. counting assigns 41 occurrences to no entry while reporting complete agreement. This is an audited canonical defect, not a trustworthy selection result. No production fix was made.', '- Clear differences are checked twice; original ties are not exhaustively rejudged, so false-negative ties can remain. Corpus beliefs and human glossary choices are not truth labels.', '- Existing glossary files and production app code were not modified. Optimized research received no prior human targets, notes, exclusions, or seeded-reference outputs.','', 'See [PROCEDURE.md](PROCEDURE.md) for the conditional proposal and tested/proposed distinction, and [README.md](README.md) for commands, method definitions, provenance, and resumability. Raw evidence, stage timings, prompts, outputs, blind maps, judgments, exposure audit, and analyses are under `runs/2026-10-12/`.']
(here/'RESULTS.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'complete':complete,'completion':completion,'quality':{m:{'terms':x['terms'],'passages':x['passages'],'scores':x['wins_losses_ties']} for m,x in a['methods'].items()}},ensure_ascii=False))
