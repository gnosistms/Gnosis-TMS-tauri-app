"""Report strict blind comparisons against saved native app research, never rerun it."""
import json, sys
from collections import Counter, defaultdict
from pathlib import Path

here = Path(__file__).resolve().parent
root = Path(sys.argv[1]) if len(sys.argv) > 1 else here / 'runs/2026-10-12-recent-app'
method = sys.argv[2] if len(sys.argv) > 2 else 'compact12-precise-nodict'
load = lambda p: json.loads(p.read_text()) if p.exists() else None
prior = load(root / 'previous-runs.json')
ledger = [json.loads(line) for line in (root / 'requests.jsonl').read_text().splitlines()]
score = lambda rows, key: dict(Counter('tie' if r[key] == 'tie' else 'win' if r[key] == r['candidateSide'] else 'loss' for r in rows))

def cost(rows, native=False):
    keys = ('inputTokens', 'outputTokens', 'cachedTokens') if native else ('input_tokens', 'output_tokens', 'cached_input_tokens')
    usages = rows if native else [r.get('usage') or {} for r in rows]
    return dict(calls=len(rows), seconds=round(sum(r.get('seconds') or 0 for r in rows), 3),
                input=sum(u.get(keys[0]) or 0 for u in usages), output=sum(u.get(keys[1]) or 0 for u in usages),
                cached=sum(u.get(keys[2]) or 0 for u in usages),
                unknown_usage=sum(any(u.get(k) is None for k in keys[:2]) for u in usages),
                failures=sum(r.get('status') != 'ok' for r in rows))

def strings(value):
    if isinstance(value, str): yield value
    elif isinstance(value, dict):
        for v in value.values(): yield from strings(v)
    elif isinstance(value, list):
        for v in value: yield from strings(v)

terms, all_rows, exposure, rows_by_index = [], [], [], {}
for p in prior:
    directory = root / 'terms' / f"{p['index']:02}"
    evidence = load(directory / 'evidence.json')
    judge_dir = directory / method / 'controlled/vs-previous-app/strict'
    verified = load(judge_dir / 'verified-judgments.json')
    rows = verified if verified is not None else load(judge_dir / 'judgments.json') or []
    rows_by_index[p['index']] = rows
    all_rows += rows
    absolute = Counter()
    for r in rows:
        good = lambda side: r.get('accuracy'+side) in ['faithful', 'minor_nuance'] and r.get('naturalness'+side) in ['natural', 'minor_style']
        bad = lambda side: r.get('accuracy'+side) == 'material_error' or r.get('naturalness'+side) == 'clear_problem'
        absolute['both_acceptable'] += good('A') and good('B')
        absolute['both_need_correction'] += bad('A') and bad('B')
        absolute['both_material_errors'] += all(r.get('accuracy'+side) == 'material_error' for side in ['A', 'B'])
        absolute['candidate_material_error'] += r.get('accuracy'+r['candidateSide']) == 'material_error'
        absolute['reference_material_error'] += r.get('accuracy'+('B' if r['candidateSide'] == 'A' else 'A')) == 'material_error'
        absolute['uncertain'] += any(r.get(k) == 'uncertain' for k in ['accuracyA','accuracyB','naturalnessA','naturalnessB'])
        absolute['second_checked'] += r.get('secondCheck') == 'checked'
        absolute['disputed_retied'] += bool(r.get('judgeDisagreement'))
        absolute['unconfirmed'] += any(r[dim] != 'tie' and r.get('secondCheck') != 'checked' for dim in ['accuracy', 'naturalness'])
    native_rows = load(directory / 'previous-app/stages/usage.json') or []
    compact_rows = [r for r in ledger if r['term'] == p['term'] and r['role'] == 'research' and r['method'] == method]
    native_exposed, compact_exposed = set(), set()
    for file in (directory / 'previous-app/stages').glob('*.json'):
        if file.stem in ['usage', 'log', 'meta', 'counting', 'counting2', 'consistency', 'aggregate', 'prose']: continue
        excerpts = list(strings(load(file)))
        for passage in evidence['evaluation']:
            if any(' '.join(passage['text'].split()) in ' '.join(text.split()) for text in excerpts): native_exposed.add(str(passage['itemId']))
    for file in (directory / method / 'calls').rglob('request.json'):
        content = str(load(file).get('content', ''))
        for passage in evidence['evaluation']:
            text = passage['text']
            if text in content or json.dumps(text, ensure_ascii=False)[1:-1] in content: compact_exposed.add(str(passage['itemId']))
    exposure.append(dict(index=p['index'], term=p['term'], native_full_text_ids=sorted(native_exposed), compact_full_text_ids=sorted(compact_exposed)))
    terms.append(dict(index=p['index'], term=p['term'], provisional=p['provisional'], native_model=p['modelId'],
                      research_passages=min(12,len(evidence['research'])), evaluation_passages=len(evidence['evaluation']), judged=len(rows), verified=verified is not None,
                      accuracy=score(rows,'accuracy'), naturalness=score(rows,'naturalness'), absolute=dict(absolute), native_cost=cost(native_rows,True), compact_cost=cost(compact_rows),
                      regressions=[r for r in rows if r['accuracy'] not in ['tie', r['candidateSide']]],
                      wins=[r for r in rows if r['accuracy']==r['candidateSide']],
                      native_exposed=len(native_exposed), compact_exposed=len(compact_exposed)))

def combine_cost(items,key):
    return {field: round(sum(t[key][field] for t in items),3) for field in ['calls','seconds','input','output','cached','unknown_usage','failures']}

complete = all(t['judged']==t['evaluation_passages'] and t['verified'] and not t['absolute'].get('unconfirmed') for t in terms)
completed = [t for t in terms if not t['provisional']]
same_model = [t for t in completed if t['native_model']=='gpt-6.1-sol']
summary = dict(complete=complete, method=method, terms=terms, accuracy=score(all_rows,'accuracy'), naturalness=score(all_rows,'naturalness'),
               absolute=dict(sum((Counter(t['absolute']) for t in terms),Counter())), native_completed=combine_cost(completed,'native_cost'), compact_completed=combine_cost(completed,'compact_cost'),
               native_same_model=combine_cost(same_model,'native_cost'), compact_same_model=combine_cost(same_model,'compact_cost'),
               experiment_roles={role:cost([r for r in ledger if r['role']==role]) for role in sorted({r['role'] for r in ledger})})
subset_rows = {
    'Completed previous results': [r for t in completed for r in rows_by_index[t['index']]],
    'Completed previous results, same model': [r for t in same_model for r in rows_by_index[t['index']]],
    'Provisional previous proposal': [r for t in terms if t['provisional'] for r in rows_by_index[t['index']]],
    'No detected full-text exposure to either research method': [r for t,x in zip(terms,exposure) for r in rows_by_index[t['index']] if r['id'] not in set(x['native_full_text_ids']+x['compact_full_text_ids'])],
}
summary['subsets'] = {name:dict(passages=len(rows),accuracy=score(rows,'accuracy'),naturalness=score(rows,'naturalness')) for name,rows in subset_rows.items()}
repair_method = 'compact12-clitics-precise-nodict'
repair_directory = root / 'terms/05' / repair_method
if (repair_directory / 'entry.json').exists():
    repair = dict(method=repair_method, term='Regenerar', evidence=load(repair_directory / 'evidence.json')['repair'],
                  cost=cost([r for r in ledger if r['role']=='research' and r['method']==repair_method]), comparisons={})
    for reference in ['previous-app',method]:
        judge_dir = repair_directory / 'controlled' / f'vs-{reference}/strict'
        confirmed = load(judge_dir / 'verified-judgments.json')
        rows = confirmed if confirmed is not None else load(judge_dir / 'judgments.json') or []
        ready = confirmed is not None and len(rows)==40 and not any(r[dim]!='tie' and r.get('secondCheck')!='checked' for r in rows for dim in ['accuracy','naturalness'])
        good = lambda r,side:r.get('accuracy'+side) in ['faithful','minor_nuance'] and r.get('naturalness'+side) in ['natural','minor_style']
        bad = lambda r,side:r.get('accuracy'+side)=='material_error' or r.get('naturalness'+side)=='clear_problem'
        initial_absolute = dict(both_acceptable=sum(good(r,'A') and good(r,'B') for r in rows),
                                both_need_correction=sum(bad(r,'A') and bad(r,'B') for r in rows),
                                uncertain=sum(any(r.get(k)=='uncertain' for k in ['accuracyA','accuracyB','naturalnessA','naturalnessB']) for r in rows))
        repair['comparisons'][reference] = dict(complete=ready, passages=len(rows), accuracy=score(rows,'accuracy'), naturalness=score(rows,'naturalness'), initial_absolute=initial_absolute)
        if reference=='previous-app' and ready:
            assembled = [r for index,rs in rows_by_index.items() if index!=5 for r in rs]+rows
            old_absolute = next(t['absolute'] for t in terms if t['index']==5)
            assembled_absolute = {key:summary['absolute'].get(key,0)-old_absolute.get(key,0)+value for key,value in initial_absolute.items()}
            repair['assembled_policy'] = dict(passages=len(assembled), accuracy=score(assembled,'accuracy'), naturalness=score(assembled,'naturalness'), initial_absolute=assembled_absolute)
    conservative = {k:round(summary['compact_completed'][k]+repair['cost'][k],3) for k in summary['compact_completed']}
    repair['completed_research_including_original_attempt'] = conservative
    summary['repair'] = repair
write_json = lambda p,v:p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
write_json(root / f'analysis-recent-{method}.json',summary)
write_json(root / 'previous-app-exposure-audit.json',dict(check='Literal normalized full-text containment; not all shorter, reformatted or semantic overlap is detectable. Previous app research had no new holdout.', findings=exposure))
entry_lines = ['# Recent term glossary entries', '', 'Fresh compact output versus reconstructed saved app report defaults. These are research candidates, not correctness labels; inspect the blind comparison report for quality evidence.', '']
for t in terms:
    directory = root / 'terms' / f"{t['index']:02}"
    entry_lines += [f"## {t['term']}", '', '| Method | Source forms (first six) | Target | Usage note |', '|---|---|---|---|']
    escape = lambda value:str(value or '').replace('|', '\\|').replace('\n',' ')
    entry_methods = [('previous-app','Previous app'+(' (provisional)' if t['provisional'] else '')), (method,'Fresh compact')]
    if (directory / repair_method / 'entry.json').exists():entry_methods.append((repair_method,'Compact with source-form repair'))
    for m,label in entry_methods:
        for entry in load(directory / m / 'entry.json')['entries']:
            sources = ', '.join(entry['sourceTerms'][:6]) + (' …' if len(entry['sourceTerms']) > 6 else '')
            for v in entry['variants']:
                entry_lines.append('| '+' | '.join(escape(x) for x in [label,sources,v['target'],v.get('note','')])+' |')
    entry_lines.append('')
(root / f'ENTRIES-{method}.md').write_text('\n'.join(entry_lines)+'\n')
fmt = lambda counts: f"{counts.get('win',0)} / {counts.get('loss',0)} / {counts.get('tie',0)}"
lines=['# Recent Gnosis VN research test','', '**Complete.**' if complete else '**In progress; partial judgments are not a final conclusion.**','',
       f'Tested the unchanged `{method}` against saved previous app research for all eight distinct terms in the local Gnosis VN ES–VI history (September 25–October 12, 2026). Seven prior runs are completed; Segunda Cámara is a review-only proposal. Optimized research received no saved targets, notes, sibling entries or prior research evidence. Original app research was imported after fresh compact entries were generated.','',
       f"Across {len(all_rows)} comparisons: **{fmt(summary['accuracy'])} correctness wins / losses / ties**. Naturalness: {fmt(summary['naturalness'])}. Clear differences require material correctness defects; both good versions tie. A second fresh blind judge checks non-ties, and disputed differences become ties. First absolute grades: {summary['absolute'].get('both_acceptable',0)} both acceptable, {summary['absolute'].get('both_need_correction',0)} both needing correction, {summary['absolute'].get('uncertain',0)} uncertain.",'',
       '| Term | Prior result | Research passages | Evaluation passages | Correctness W / L / T | Naturalness W / L / T | Both acceptable |', '|---|---|---:|---:|---|---|---:|']
for t in terms:
    lines.append(f"| {t['term']} | {'provisional' if t['provisional'] else 'completed'}{'; different model' if t['native_model']!='gpt-6.1-sol' else ''} | {t['research_passages']} | {t['judged']} / {t['evaluation_passages']} | {fmt(t['accuracy'])} | {fmt(t['naturalness'])} | {t['absolute'].get('both_acceptable',0)} |")
lines += ['', '| Subset | Comparisons | Correctness W / L / T | Naturalness W / L / T |', '|---|---:|---|---|']
for name,x in summary['subsets'].items():lines.append(f"| {name} | {x['passages']} | {fmt(x['accuracy'])} | {fmt(x['naturalness'])} |")
if summary.get('repair',{}).get('assembled_policy'):
    x=summary['repair']['assembled_policy']
    lines += ['',f"With the focused recall repair below, the assembled recent-term result is **{fmt(x['accuracy'])} correctness** and **{fmt(x['naturalness'])} naturalness**. Initial absolute grades: {x['initial_absolute']['both_acceptable']} both acceptable, {x['initial_absolute']['both_need_correction']} both needing correction, {x['initial_absolute']['uncertain']} uncertain. This replaces Regenerar only; the other seven outputs are reused unchanged."]
if summary.get('repair'):
    repair = summary['repair']
    lines += ['', '## One focused repair: attached-pronoun forms','',
              'The initial Regenerar search supplied 41 passages; reserving 40 left only one for research. The two confirmed correctness losses confused personal reform with physical recreation/regeneration. This is a source-coverage weakness under the holdout protocol, not evidence that the omitted counting/consistency stages are necessary.', '',
              f"The source-only repair mechanically generated attached-pronoun forms and confirmed {', '.join(repair['evidence']['confirmedForms'])} in the corpus. The expanded search supplied {repair['evidence']['population']['distinct']} passages and {repair['evidence']['availableNonreserved']} nonreserved passages. The same research instructions, schema, reasoning effort and 12-passage cap were retained; the 40 evaluation texts were unchanged. Full-text containment in either direction was excluded from the repair evidence. No dictionary, human targets, saved source aliases, loss-case texts or new research model stage was added.", '',
              '| Repair comparison | Confirmed complete | Passages | Correctness W / L / T | Naturalness W / L / T |', '|---|---|---:|---|---|']
    for reference,x in repair['comparisons'].items():lines.append(f"| Versus {reference} | {x['complete']} | {x['passages']} | {fmt(x['accuracy'])} | {fmt(x['naturalness'])} |")
    if repair.get('assembled_policy'):
        x=repair['assembled_policy']
        lines += ['',f"Exploratory assembled policy (unchanged outputs for seven terms; repaired Regenerar): {x['passages']} comparisons, {fmt(x['accuracy'])} correctness and {fmt(x['naturalness'])} naturalness. This is a repair developed on observed regressions, not a new independent confirmation sample."]
    n,c=summary['native_completed'],repair['completed_research_including_original_attempt']
    lines += ['',f"Repair acquisition: {repair['cost']['calls']} replacement research call, {repair['cost']['seconds']:.1f} model seconds, {repair['cost']['input']:,} input and {repair['cost']['output']:,} output tokens. Conservatively including the original attempt too, the seven completed-term experiments cost {c['calls']} research calls, {c['seconds']:.1f} model seconds, {c['input']:,} input and {c['output']:,} output tokens: {100*(1-c['seconds']/n['seconds']):.2f}% less summed model work and {100*(1-c['output']/n['output']):.2f}% fewer outputs than native per-run logs.", '',
              'A practical next rule is to check attached-pronoun forms when an infinitive has too few usable contexts. This repair was tested on Regenerar only; it does not establish a universal gate or solve irregular-conjugation recall. The artificial 40-passage reservation contributed to the original one-context shortage.']
lines += ['', '## Compared with the earlier random sample','', '| Test | Reference | Terms with passages | Comparisons | Correctness W / L / T |', '|---|---|---:|---:|---|',
          '| Earlier random sample | Fresh original method with human candidate list | 29 | 750 | 31 / 0 / 719 |',
          f"| Recent researched terms | Saved previous app outputs | {len(terms)} | {len(all_rows)} | {fmt(summary['accuracy'])} |",'',
          'The reference, term mix, models, and exposure differ. This comparison tests whether the compact result generalizes to recently studied terms; differences in win rate are descriptive, not a causal improvement or deterioration estimate. The recent terms are correlated families, not eight independent random draws.','',
          '## Research time and tokens','', '| Term | Native calls | Compact calls | Native model seconds | Compact model seconds | Native input | Compact input | Native output | Compact output |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
for t in terms:
    n,c=t['native_cost'],t['compact_cost']
    lines.append(f"| {t['term']} | {n['calls']} | {c['calls']} | {n['seconds']:.1f} | {c['seconds']:.1f} | {n['input']:,} | {c['input']:,} | {n['output']:,} | {c['output']:,} |")
for label,group in [('Seven completed prior runs',completed),('Six completed prior runs using the same model',same_model)]:
    n,c=combine_cost(group,'native_cost'),combine_cost(group,'compact_cost')
    savings={k:round(100*(1-c[k]/n[k]),2) if n[k] else None for k in ['calls','seconds','input','output']}
    lines += ['',f"{label}: {savings['calls']}% fewer calls; {savings['seconds']}% less summed model-call time; {savings['input']}% fewer known input tokens; {savings['output']}% fewer output tokens. Native unknown-usage calls: {n['unknown_usage']}; compact: {c['unknown_usage']}."]
lines += ['', 'Native usage is measured in the app; compact usage is measured through Codex CLI. Fixed CLI input overhead is present only in the compact calls, and model/runtime differences prevent a controlled timing comparison. Summed call time excludes unmeasured idle/review time and is not end-to-end app wall time. Family stages may be shared or inherited in native sibling studies. Native per-run usage is direct logged usage, not a reconstruction of shared family acquisition costs. Provisional Segunda Cámara is excluded from completed-run savings.','', '## Corpus exposure','', '| Term | Evaluation passages contained in saved app evidence | Contained in compact research |', '|---|---:|---:|']
for t in terms: lines.append(f"| {t['term']} | {t['native_exposed']} | {t['compact_exposed']} |")
lines += ['', 'Saved app runs did not reserve this sample. Sparse compact terms necessarily reuse their available passages. Literal full-text checks can miss partial/reformatted overlap. Controlled translation uses a shared neutral draft and can preserve shared mistakes. Judges are fresh-context independent, not a different model family or a human panel. Initial absolute grades remain subjective even when relative differences are confirmed.','', '## Confirmed differences','']
for t in terms:
    for label,key in [('Loss','regressions'),('Win','wins')]:
        if t[key]:
            lines.append(f"### {t['term']}: {len(t[key])} confirmed {label.lower()} cases")
            lines += ['']+[f"- Passage {r['id']}: {r['reason']}" for r in t[key]][:12]+['']
lines += ['## Experiment usage','', '| Role | Calls | Known input | Known output | Unknown usage |', '|---|---:|---:|---:|---:|']
for role,c in summary['experiment_roles'].items():lines.append(f"| {role} | {c['calls']} | {c['input']:,} | {c['output']:,} | {c['unknown_usage']} |")
lines += ['', f"Compare the actual entry wording in [ENTRIES-{method}.md]({root / f'ENTRIES-{method}.md'}). Native references are reconstructed report defaults; later unsaved manual edits are not recoverable from these checkpoints. Raw native stages and hashes, fresh compact calls, usage, passages, translations, blind maps and confirmed judgments are preserved in `runs/2026-10-12-recent-app/`. Production app code and glossary files are unchanged."]
(root / f'RESULTS-{method}.md').write_text('\n'.join(lines)+'\n')
if method=='compact12-precise-nodict':(here / 'RECENT_RESULTS.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'complete':complete,'comparisons':len(all_rows),'accuracy':summary['accuracy'],'naturalness':summary['naturalness'],'terms':[{k:t[k] for k in ['term','accuracy','judged','verified']} for t in terms]},ensure_ascii=False))
