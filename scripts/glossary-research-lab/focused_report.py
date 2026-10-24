"""Consolidate the user-selected four-term comparison and measured stage costs."""
import json
from collections import Counter, defaultdict
from pathlib import Path
from no_glossary_metrics import summarize as benefit_summary, paired as paired_benefit

here = Path(__file__).resolve().parent
recent = here / 'runs/2026-10-12-recent-app'
added = here / 'runs/2026-10-12-focused'
method = 'compact12-precise-nodict'
load = lambda p: json.loads(p.read_text()) if p.exists() else None
ledger = lambda p: [json.loads(s) for s in (p/'requests.jsonl').read_text().splitlines()]
cost = lambda rs: dict(calls=len(rs), seconds=round(sum(r.get('seconds',0) for r in rs),3),
                      input=sum((r.get('usage') or {}).get('input_tokens',0) for r in rs),
                      output=sum((r.get('usage') or {}).get('output_tokens',0) for r in rs),
                      cached=sum((r.get('usage') or {}).get('cached_input_tokens',0) for r in rs),
                      unknown_usage=sum(r.get('usage') is None for r in rs),
                      failures=sum(r.get('status')!='ok' for r in rs))
score = lambda rows,key: dict(Counter('tie' if r[key]=='tie' else 'win' if r[key]==r['candidateSide'] else 'loss' for r in rows))
fmt = lambda s: f"{s.get('win',0)} / {s.get('loss',0)} / {s.get('tie',0)}"
escape = lambda s: str(s if s is not None else '').replace('|','\\|').replace('\n',' ')
native = load(recent / f'analysis-recent-{method}.json')
terms, all_rows = [], []
for label,root,index,reference in [('vanidad',recent,2,'previous-app'),('mundos',added,1,'baseline-human'),('Íntimo',recent,1,'previous-app'),('fatal',added,2,'baseline-human')]:
    directory = root/'terms'/f'{index:02}'
    evidence = load(directory/'evidence.json')
    judges = directory/method/'controlled'/f'vs-{reference}'/'strict'
    verified = load(judges/'verified-judgments.json')
    rows = verified if verified is not None else load(judges/'judgments.json') or []
    all_rows += rows
    measured = ledger(root)
    compact_cost = cost([r for r in measured if r['term']==label and r['role']=='research' and r['method']==method])
    if reference=='previous-app':
        prior = next(t for t in native['terms'] if t['term']==label)
        ref_cost = prior['native_cost']
        exposure = dict(reference_full_text=prior['native_exposed'], compact_full_text=prior['compact_exposed'])
        reference_label = 'Saved app result'+(' (different model)' if prior['native_model']!='gpt-6.1-sol' else '')
    else:
        ref_cost = cost([r for r in measured if r['term']==label and r['role']=='research' and r['method']==reference])
        audit = load(added/'holdout-exposure-audit.json') or {'findings':[]}
        exposed = defaultdict(set)
        for finding in audit['findings']:
            if finding['index']==index:
                for ids in finding['exposed_full_evaluation_passages_by_stage'].values(): exposed[finding['method']].update(ids)
        exposure = dict(reference_full_text=len(exposed[reference]), compact_full_text=len(exposed[method]))
        reference_label = 'Fresh original procedure + human candidates'
    good = lambda r,s:r.get('accuracy'+s) in ('faithful','minor_nuance') and r.get('naturalness'+s) in ('natural','minor_style')
    bad = lambda r,s:r.get('accuracy'+s)=='material_error' or r.get('naturalness'+s)=='clear_problem'
    absolute = dict(both_acceptable=sum(good(r,'A') and good(r,'B') for r in rows),
                    both_need_correction=sum(bad(r,'A') and bad(r,'B') for r in rows),
                    uncertain=sum(any(r.get(k)=='uncertain' for k in ('accuracyA','accuracyB','naturalnessA','naturalnessB')) for r in rows),
                    disputed_retied=sum(bool(r.get('judgeDisagreement')) for r in rows))
    complete = verified is not None and len(rows)==len(evidence['evaluation']) and all(r[d]=='tie' or r.get('secondCheck')=='checked' for r in rows for d in ('accuracy','naturalness'))
    terms.append(dict(term=label,root=str(root),index=index,reference=reference,reference_label=reference_label,
                      corpus_passages=evidence['population']['distinct'], research_passages=min(12,len(evidence['research'])),
                      expected=len(evidence['evaluation']), judged=len(rows), complete=complete,
                      accuracy=score(rows,'accuracy'), naturalness=score(rows,'naturalness'), absolute=absolute,
                      compact_cost=compact_cost, reference_cost=ref_cost, exposure=exposure,
                      differences=[r for r in rows if r['accuracy']!='tie' or r['naturalness']!='tie']))
new_ledger = ledger(added)
groups = defaultdict(list)
for r in new_ledger: groups[(r['role'],r['method'],r['stage'])].append(r)
stage_costs = [dict(role=k[0],method=k[1],stage=k[2],**cost(v)) for k,v in sorted(groups.items())]
summary = dict(complete=all(t['complete'] for t in terms), terms=terms, accuracy=score(all_rows,'accuracy'), naturalness=score(all_rows,'naturalness'), stage_costs=stage_costs,
               additional_experiment_cost=cost(new_ledger),
               seed_preparation_cost=cost([r for r in new_ledger if r['role']=='seed-preparation']))
trials=[]
for root,index,m in [(recent,1,'compact12-diverse-precise-nodict'),(recent,1,'compact12-provenance-precise-nodict'),
                     (recent,2,'compact12-diverse-precise-nodict'),(recent,2,'compact12-spanishdict-precise'),(recent,2,'compact12-coverage-spanishdict-precise'),
                     (added,1,'compact12-diverse-precise-nodict'),(added,1,'compact12-scope-precise-nodict'),(added,1,'compact12-scope-spanishdict-precise'),
                     (added,2,'compact12-diverse-precise-nodict'),(added,2,'compact12-webdict-precise-nodict'),
                     (added,2,'compact12-spanishdict-precise'),(added,2,'compact30-diverse-spanishdict-precise'),(added,2,'compact12-coverage-spanishdict-precise')]:
    directory=root/'terms'/f'{index:02}';evidence=load(directory/'evidence.json');entry=load(directory/m/'entry.json')
    if entry is None: continue
    measured=ledger(root)
    comparisons=[]
    for reference_dir in sorted((directory/m/'controlled').glob('vs-*')):
        p=reference_dir/'strict';confirmed=load(p/'verified-judgments.json');rows=confirmed if confirmed is not None else load(p/'judgments.json') or []
        complete=confirmed is not None and len(rows)==len(evidence['evaluation']) and all(r[k]=='tie' or r.get('secondCheck')=='checked' for r in rows for k in ('accuracy','naturalness'))
        comparisons.append(dict(reference=reference_dir.name.removeprefix('vs-'),complete=complete,passages=len(rows),accuracy=score(rows,'accuracy'),naturalness=score(rows,'naturalness')))
    trials.append(dict(term=evidence['term'],method=m,root=str(root),index=index,cost=cost([r for r in measured if r['role']=='research' and r['term']==evidence['term'] and r['method']==m]),comparisons=comparisons))
summary['trials']=trials
selected=[]
selected_rows=[]
for term,m in [('vanidad','compact12-coverage-spanishdict-precise'),('mundos','compact12-scope-spanishdict-precise'),
               ('Íntimo','compact12-provenance-precise-nodict'),('fatal','compact12-coverage-spanishdict-precise')]:
    t=next(t for t in terms if t['term']==term)
    trial=next(t for t in trials if t['term']==term and t['method']==m)
    comparison=next((c for c in trial['comparisons'] if c['reference']==t['reference']),None)
    p=Path(t['root'])/'terms'/f"{t['index']:02}"/m/'controlled'/f"vs-{t['reference']}"/'strict'
    rows=load(p/'verified-judgments.json') or []
    selected_rows+=rows
    selected.append(dict(term=term,method=m,cost=trial['cost'],comparison=comparison,reference=t['reference_label'],
                         both_need_correction=sum(all(r.get('accuracy'+s)=='material_error' or r.get('naturalness'+s)=='clear_problem' for s in ('A','B')) for r in rows),
                         disputed_retied=sum(bool(r.get('judgeDisagreement')) for r in rows)))
summary['selected_policy']=dict(complete=all(t['comparison'] and t['comparison']['complete'] for t in selected),terms=selected,
                                accuracy=score(selected_rows,'accuracy'),naturalness=score(selected_rows,'naturalness'))
selected_methods={t['term']:t['method'] for t in selected}
focused_research=[r for root in (recent,added) for r in ledger(root) if r['role']=='research' and r['term'] in selected_methods and r['method']!='baseline-human']
chosen_research=[r for r in focused_research if r['method']==selected_methods[r['term']]]
summary['selected_policy']['cost']=cost(chosen_research)
default_then_selected=[r for r in focused_research if r['method'] in (method,selected_methods[r['term']])]
summary['default_then_selected_cost']=cost(default_then_selected)
selected_groups=defaultdict(list)
for r in chosen_research: selected_groups[(r['term'],r['stage'])].append(r)
summary['selected_policy']['stages']=[dict(term=k[0],stage=k[1],**cost(v)) for k,v in sorted(selected_groups.items())]
summary['all_focused_optimization_attempts']=cost(focused_research)
fresh_reference=[r for r in new_ledger if r['role']=='research' and r['method']=='baseline-human']
fresh_selected=[r for r in chosen_research if r['term'] in ('mundos','fatal')]
summary['fresh_paired_cost']=dict(reference=cost(fresh_reference),selected=cost(fresh_selected),
                                 default_then_selected=cost([r for r in default_then_selected if r['term'] in ('mundos','fatal')]))
summary['complete']=summary['complete'] and summary['selected_policy']['complete']
neutral_rows=[];neutral_terms=[]
for chosen in selected:
    t=next(t for t in terms if t['term']==chosen['term'])
    p=Path(t['root'])/'terms'/f"{t['index']:02}"/chosen['method']/'controlled/vs-no-glossary/strict/verified-judgments.json'
    rows=load(p)
    verified=rows is not None and len(rows)==t['expected']
    accepted=rows if verified else []
    neutral_rows+=accepted
    neutral_terms.append(dict(term=t['term'],method=chosen['method'],complete=verified,expected=t['expected'],
                              accuracy=benefit_summary(accepted),naturalness=benefit_summary(accepted,'naturalness'),
                              differences=[r for r in accepted if r['accuracy']!='tie'or r['naturalness']!='tie']))
summary['no_glossary']=dict(complete=all(t['complete']for t in neutral_terms),terms=neutral_terms,
                           accuracy=benefit_summary(neutral_rows),naturalness=benefit_summary(neutral_rows,'naturalness'))
control_dir=recent/'terms/02/no-glossary-revision/controlled/vs-no-glossary/strict'
control_rows=load(control_dir/'verified-judgments.json')
glossary_rows=load(recent/'terms/02/compact12-coverage-spanishdict-precise/controlled/vs-no-glossary/strict/verified-judgments.json')or[]
summary['vanidad_attention_control']=dict(complete=control_rows is not None and len(control_rows)==40,
    accuracy=benefit_summary(control_rows or[]),naturalness=benefit_summary(control_rows or[],'naturalness'),
    glossary_minus_control=paired_benefit(glossary_rows,control_rows or[]),
    cost=cost([r for r in ledger(recent)if r['method']=='no-glossary-revision']),
    revision_cost=cost([r for r in ledger(recent)if r['method']=='no-glossary-revision'and r['role']=='evaluation']),
    phase=load(recent/'revision-control-phase.json'),
    differences=[r for r in control_rows or[]if r['accuracy']!='tie'or r['naturalness']!='tie'])
summary['reference_comparison_complete']=summary['complete']
summary['complete']=summary['complete']and summary['no_glossary']['complete']
(added/'analysis-focused.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
lines = ['# Four selected glossary terms','', '**Complete.**' if summary['complete'] else '**In progress. Partial findings are not a final conclusion.**','',
         'The unchanged compact method uses one glossary proposal from up to 12 source passages, with no routine dictionary, counting, consistency, origin or family research. Human targets and translator notes are never supplied to it. The references for vanidad and Íntimo are saved app outputs; mundos and fatal use the frozen original research procedure with isolated human-prepared candidate lists and explicitly forbidden translations removed. These reference types must not be treated as one controlled baseline.','',
         f"Confirmed correctness wins / losses / ties: **{fmt(summary['accuracy'])}**. Naturalness: **{fmt(summary['naturalness'])}**. Wins/losses require a clear material correctness difference; equally good translations tie. Fresh blind judges receive only source+A/B translations. A second fresh judge checks all non-ties; disagreements become ties.",'',
         '| Term | Reference | Source corpus passages | Research sample | Judged / reserved | Correctness W / L / T | Naturalness W / L / T | Both acceptable initially |',
         '|---|---|---:|---:|---:|---|---|---:|']
for t in terms:
    lines.append(f"| {t['term']} | {t['reference_label']} | {t['corpus_passages']:,} | {t['research_passages']} | {t['judged']} / {t['expected']} | {fmt(t['accuracy'])} | {fmt(t['naturalness'])} | {t['absolute']['both_acceptable']} |")
selected_lines=['## Tested repairs on these four cases','',
                f"The selected repairs have **{fmt(summary['selected_policy']['accuracy'])}** confirmed correctness wins / losses / ties, and **{fmt(summary['selected_policy']['naturalness'])}** naturalness wins / losses / ties. Completion: **{summary['selected_policy']['complete']}**. References remain the same as in the unchanged-method table below.",'',
                '| Term | Tested change | Correctness W / L / T | Naturalness W / L / T | Confirmed complete | Both need correction initially |',
                '|---|---|---|---|---|---:|']
labels={'vanidad':'Short source-only coverage scout + Spanish dictionary', 'mundos':'Diverse contexts + scope guard + Spanish dictionary',
        'Íntimo':'Diverse contexts + bounded source-book provenance', 'fatal':'Short source-only coverage scout + Spanish dictionary'}
for t in selected:
    c=t['comparison'] or {}
    selected_lines.append(f"| {t['term']} | {labels[t['term']]} | {fmt(c.get('accuracy',{}))} | {fmt(c.get('naturalness',{}))} | {c.get('complete',False)} | {t['both_need_correction']} |")
selected_lines += ['', '## Entry completeness, assessed separately','',
                   '| Term | Finding in selected output | Evidence and limit |', '|---|---|---|',
                   '| Íntimo | Distinguishes the divine noun (Đấng Nội Tại) from adjectives (nội tại / sâu thẳm bên trong); identifies Innermost in The Dayspring of Youth. | Printed source-book glossary pair and original passages, independent of the Gnosis Vietnamese glossary. Establishes the source relationship, not first coinage, exclusive origin or a proven direct borrowing route. |',
                   '| fatal | Includes harmful/disastrous uses, fate and inevitability; reserves lethal translations for source-supported death contexts. | The scout finds previously unsampled inevitability contexts. Avoids treating Spanish fatal as uniformly equivalent to English fatal. |',
                   '| vanidad | Explains appearance and reputation concern; retains rare futility, transient things and empty speech senses. | Source counterexamples require rare exceptions; a blanket ban on futility would reduce accuracy. |',
                   '| mundos | Includes hành tinh for planetary contexts and thiên thể where the broader celestial category is required, alongside cõi / thế giới. | A fresh Spanish-only audit of 100 exact-plural contexts finds 29 celestial/world contexts, 31 higher/inner realms and 26 infernal realms. The 29 are not all proven planets: this supports a substantial planetary/celestial branch, not one universal default or a count of Vietnamese target use. |', '',
                   'The primary [Dayspring text](https://glorian.org/books/the-dayspring-of-youth/yoga-teachings) independently contains Innermost. Expected answers from the user were kept outside all research/scout prompts. The source-sense audit was conducted after research as assessment evidence and did not guide the selected worlds entry.','',
                   '## Selected research cost','', '| Term | Calls | Model seconds | Input tokens | Output tokens |', '|---|---:|---:|---:|---:|']
for t in selected:
    c=t['cost'];selected_lines.append(f"| {t['term']} | {c['calls']} | {c['seconds']:.1f} | {c['input']:,} | {c['output']:,} |")
selected_lines += ['', '| Term | Stage | Calls | Model seconds | Input tokens | Output tokens |', '|---|---|---:|---:|---:|---:|']
for c in summary['selected_policy']['stages']:
    selected_lines.append(f"| {c['term']} | {c['stage']} | {c['calls']} | {c['seconds']:.1f} | {c['input']:,} | {c['output']:,} |")
c=summary['selected_policy']['cost'];a=summary['all_focused_optimization_attempts'];paired=summary['fresh_paired_cost'];r=paired['reference'];s=paired['selected'];d=summary['default_then_selected_cost'];f=paired['default_then_selected']
selected_lines += ['', f"Selected policy: {c['calls']} calls, {c['seconds']:.1f} summed model seconds, {c['input']:,} input and {c['output']:,} output tokens. Bounded local source/dictionary retrieval takes roughly a second per lookup and is recorded separately in evidence metadata.", '',
                   f"Within the comparable fresh mundos/fatal runtime, the original human-seeded procedure took {r['calls']} calls, {r['seconds']:.1f} summed model seconds, {r['input']:,} input and {r['output']:,} output tokens. The selected repairs took {s['calls']} calls, {s['seconds']:.1f} seconds, {s['input']:,} input and {s['output']:,} output tokens: {100*(1-s['seconds']/r['seconds']):.2f}% less model work, {100*(1-s['input']/r['input']):.2f}% less input and {100*(1-s['output']/r['output']):.2f}% less output. These are measured model-call sums, not a claim about elapsed app latency.", '',
                   f"If escalation follows an initial default proposal, charge that too: default plus selected fallback on all four terms is {d['calls']} calls, {d['seconds']:.1f} seconds, {d['input']:,} input and {d['output']:,} output tokens. For the comparable fresh pair, this conservative path uses {f['calls']} calls and still saves {100*(1-f['seconds']/r['seconds']):.2f}% model work, {100*(1-f['input']/r['input']):.2f}% input and {100*(1-f['output']/r['output']):.2f}% output. The six-call figure assumes the appropriate branch is selected up front; it does not include a validated free routing oracle.", '',
                   f"The experiment actually spent {a['calls']} optimization research calls, {a['seconds']:.1f} seconds, {a['input']:,} input and {a['output']:,} output tokens across these four terms, including initial attempts and rejected repairs. These costs are not hidden by reporting only the selected policy. Reference research, seed preparation, translation, judging and the post-research sense audit are separate ledger roles.", '',
                   'These repairs are supported development cases. A general automatic router and its decision thresholds have not yet been validated. Keep the one-call default, escalate for missing sense coverage or source provenance, and preserve broader category options. Increasing raw passage count alone did not solve fatal; a generic category warning alone did not solve mundos.','', '## Unchanged compact method','']
neutral_lines=['## Required success test: improvement over no glossary','',
               'The user requires actual translation improvement over no glossary. Each selected entry is compared with its exact saved neutral drafts on the same forty passages. Ties earn no credit. Fresh independent blind judges assess clear correctness and fluency; another fresh judge confirms every non-tie. These are exploratory selected cases, not the new frozen random confirmation. Earlier W/L/T against saved app/full research show relative behavior only and cannot establish glossary success.','',
               '| Term | Verified passages | Correctness gains | Harms | Net gain | Naturalness gains / harms / net |', '|---|---:|---:|---:|---:|---|']
for t in neutral_terms:
    a,n=t['accuracy'],t['naturalness']
    if t['complete']:neutral_lines.append(f"| {t['term']} | {a['passages']} / {t['expected']} | {a['gains']} | {a['harms']} | {a['net_gain']:+} | {n['gains']} / {n['harms']} / {n['net_gain']:+} |")
    else:neutral_lines.append(f"| {t['term']} | pending / {t['expected']} | pending | pending | pending | pending |")
a=summary['no_glossary']['accuracy'];neutral_lines+=['',f"Verified selected-entry effects: {a['gains']} correctness gains, {a['harms']} harms, net {a['net_gain']:+}, on {a['passages']} of 160 passages. No-glossary assessment complete: {summary['no_glossary']['complete']}. Net zero means no net benefit demonstrated on this sample; it is not a success because another glossary also ties.",'']
for t in neutral_terms:
    if t['differences']:neutral_lines += [f"### {t['term']}: changes against no glossary",'']+[f"- {r['id']}: {r['reason']}"for r in t['differences']]+['']
control=summary['vanidad_attention_control'];a=control['accuracy'];p=control['glossary_minus_control']
neutral_lines+=['### Exploratory control: focused revision without research','',
    'The controlled glossary translation is a second, term-focused revision of the neutral draft. A source-only revision with the same term focus, no glossary targets and no research tests whether extra attention can provide the observed improvement. This control is selected after seeing the vanidad gain; it is an exploratory alternative, not a validated universal skip rule. The primary no-glossary baseline remains unchanged.','',
    f"Vanidad source-only revision: {a['gains']} confirmed correctness gains, {a['harms']} harms, net {a['net_gain']:+}, on {a['passages']} of 40 passages. Complete: {control['complete']}. Glossary-minus-control paired net correctness effect: {p['net_effect_difference']:+} across {p['passages']} jointly verified passages. Same-passage effect matrix: {json.dumps(p['matrix_candidate_reference'],ensure_ascii=False)}. A shared gain shows that extra revision can supply the benefit without research; it does not prove that every glossary insight or unseen passage is redundant.",'']
if control['differences']:neutral_lines += [f"- {r['id']}: {r['reason']}"for r in control['differences']]+['']
lines[4:4]=neutral_lines+selected_lines
lines += ['', '## Research cost','', 'Summed model-call seconds measure work, not elapsed app time. Native app and CLI input overhead differ; only the two fresh references share the compact runtime and model. Human candidate preparation/auditing is listed separately below. Every attempted call remains in the ledger, including failures and unknown usage.', '',
          '| Term | Reference calls | Compact calls | Reference seconds | Compact seconds | Reference input | Compact input | Reference output | Compact output |',
          '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
for t in terms:
    r,c=t['reference_cost'],t['compact_cost']
    lines.append(f"| {t['term']} | {r['calls']} | {c['calls']} | {r['seconds']:.1f} | {c['seconds']:.1f} | {r['input']:,} | {c['input']:,} | {r['output']:,} | {c['output']:,} |")
s=summary['seed_preparation_cost']
lines += ['',f"Additional reference preparation/audit: {s['calls']} calls, {s['seconds']:.1f} seconds, {s['input']:,} input and {s['output']:,} output tokens. This overhead belongs to the human-seeded reference, not the optimized method.", '',
          '## Added-term stage measurements','', '| Role | Method | Stage | Calls | Seconds | Input | Output | Unknown usage | Failures |', '|---|---|---|---:|---:|---:|---:|---:|---:|']
for s in stage_costs:
    lines.append('| '+' | '.join(escape(s[k]) for k in ['role','method','stage','calls','seconds','input','output','unknown_usage','failures'])+' |')
lines += ['', '## Confirmed differences','']
if not any(t['differences'] for t in terms): lines += ['No confirmed differences yet.','']
for t in terms:
    if t['differences']:
        lines += [f"### {t['term']}",'']
        lines += [f"- {r['id']}: {r['reason']}" for r in t['differences']]+['']
lines += ['## Focused repair experiments','',
          'The four acceptance criteria are assessed separately from translation votes. An entry may tie on forty passages while missing an origin, rare sense or common contextual translation. User-provided expected answers were not sent to research or scout agents. Repairs use source evidence only and are development on these selected cases, not a new independent confirmation sample.','',
          '| Term | Intervention | Reference | Confirmed complete | Passages | Correctness W / L / T | Naturalness W / L / T |', '|---|---|---|---|---:|---|---|']
for t in trials:
    for c in t['comparisons']:
        lines.append(f"| {t['term']} | {t['method']} | {c['reference']} | {c['complete']} | {c['passages']} | {fmt(c['accuracy'])} | {fmt(c['naturalness'])} |")
lines += ['', '| Term | Repair | Research calls | Model seconds | Input | Output |', '|---|---|---:|---:|---:|---:|']
for t in trials:
    c=t['cost'];lines.append(f"| {t['term']} | {t['method']} | {c['calls']} | {c['seconds']:.1f} | {c['input']:,} | {c['output']:,} |")
lines += ['', 'Diversity retains the 12-passage cap and unchanged research instructions. The scope guard adds only a general warning against narrowing categories. The bounded provenance branch adds printed/aligned source-book pairs and up to six original passages; it distinguishes a verified pair from proof of borrowing. The small dictionary branch fetches only the published Spanish section, removing translation tables and other languages. The 30-context branch changes only the passage cap and preserves the first twelve. The coverage branch uses one bounded Spanish-only sense scout over nonreserved headword windows, then at most twelve full contexts in the unchanged proposal prompt. Failed/rejected trials are retained in measured experiment costs.','',
          'The DLE web-enabled fatal trial failed to obtain definitions and used 113,598 input tokens (88,320 cached); it is rejected as an acquisition path. Direct Spanish dictionary fetches used about one second and no model acquisition call. The short coverage scout is an additional model call and must be charged, even when it replaces much larger counting/discovery work.','',
          'Vanidad counterexamples: fresh judges confirmed that applying personal vanity to empty speech or futility changes the source idea. The phrase “comprender la futilidad de aquello, la vanidad de aquello” is one source example. Thus the usual appearance/reputation sense should not become a categorical ban on rare futility translations. Mundos likewise needs a broad option alongside hành tinh: one source list includes the Sun among thirteen mundos.']
lines += ['## Evidence limitations','', '| Term | Full reserved passages detected in reference research | Detected in compact research |', '|---|---:|---:|']
for t in terms: lines.append(f"| {t['term']} | {t['exposure']['reference_full_text']} | {t['exposure']['compact_full_text']} |")
lines += ['', 'Saved app research did not reserve this evaluation sample. Literal containment checks can miss shorter or reformatted overlap. Controlled translation uses a shared neutral draft and may retain shared errors; ties alone do not establish that both versions are correct. Initial absolute grades supplement relative comparisons. Independent judging means fresh contexts, not a different model family or human panel. Íntimo’s saved reference used a different model. User-selected terms and exploratory repairs cannot establish universal equivalence.','',
          'Earlier results: the random sample had 31 correctness wins, zero losses and 719 ties over 750 comparisons against fresh human-seeded references. The recent eight-term comparison initially had two wins, two losses and 215 ties; a source-form recall repair for Regenerar removed the confirmed losses in the exploratory follow-up. These are different term sets and references, not directly comparable win rates.','',
          f'Inspect [the four-term entry wording]({added / "ENTRIES.md"}) and [the recent-term report]({here / "RECENT_RESULTS.md"}). Raw source samples, prompts, usage, translations and confirmed judgments are saved with each run. No glossary entries or production app files were changed.']
(here/'FOCUSED_RESULTS.md').write_text('\n'.join(lines)+'\n')
entries=['# Four-term glossary entry comparison','', 'Research outputs are candidates; use the blind evaluation for quality judgments.','']
for t in terms:
    entries += [f"## {t['term']}",'','| Method | Source forms | Target | Note |','|---|---|---|---|']
    for m,label in [(t['reference'],t['reference_label']),(method,'Compact')]:
        entry=load(Path(t['root'])/'terms'/f"{t['index']:02}"/m/'entry.json')
        for row in (entry or {}).get('entries',[]):
            for variant in row['variants']:
                entries.append('| '+' | '.join(escape(s) for s in [label,', '.join(row['sourceTerms']),variant['target'],variant.get('note','')])+' |')
    for trial in trials:
        if trial['term']!=t['term']: continue
        entry=load(Path(trial['root'])/'terms'/f"{trial['index']:02}"/trial['method']/'entry.json')
        for row in entry['entries']:
            for variant in row['variants']:
                entries.append('| '+' | '.join(escape(s) for s in [trial['method'],', '.join(row['sourceTerms']),variant['target'],variant.get('note','')])+' |')
    entries.append('')
(added/'ENTRIES.md').write_text('\n'.join(entries)+'\n')
print(json.dumps({k:summary[k] for k in ['complete','accuracy','naturalness']},ensure_ascii=False))
