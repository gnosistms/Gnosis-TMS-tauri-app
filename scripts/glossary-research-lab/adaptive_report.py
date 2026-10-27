"""Report the frozen automatic-policy confirmation and every measured attempt."""
import argparse, csv, hashlib, json, random, statistics
from collections import Counter, defaultdict
from pathlib import Path
from no_glossary_metrics import summarize as benefit_summary, paired as paired_benefit

parser=argparse.ArgumentParser();parser.add_argument('--run',type=Path,default=Path(__file__).resolve().parent/'runs/2026-10-13-adaptive')
args=parser.parse_args();run=args.run.resolve();here=Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text())if p.exists()else None
manifest=load(run/'manifest.json');freeze=load(run/'policy-freeze.json')
ledger=[json.loads(s)for s in(run/'requests.jsonl').read_text().splitlines()]if(run/'requests.jsonl').exists()else[]
def cost(rows):
    return dict(calls=len(rows),seconds=round(sum(r['seconds']for r in rows),3),input=sum((r.get('usage')or{}).get('input_tokens',0)for r in rows),
                cached=sum((r.get('usage')or{}).get('cached_input_tokens',0)for r in rows),output=sum((r.get('usage')or{}).get('output_tokens',0)for r in rows),
                failures=sum(r['status']!='ok'for r in rows),unknown_usage=sum(r.get('usage')is None for r in rows))
def score(rows,dimension):return dict(Counter('tie'if r[dimension]=='tie'else'win'if r[dimension]==r['candidateSide']else'loss'for r in rows))
fmt=lambda s:f"{s.get('win',0)} / {s.get('loss',0)} / {s.get('tie',0)}"
def comparison(directory,reference,method='adaptive-v1'):
    p=directory/f'{method}/controlled'/f'vs-{reference}'/'strict'
    verified=load(p/'verified-judgments.json');rows=verified if verified is not None else load(p/'judgments.json')or[]
    return dict(accuracy=score(rows,'accuracy'),naturalness=score(rows,'naturalness'),judged=len(rows),
                verified=verified is not None,rows=rows,disputes=sum(bool(r.get('judgeDisagreement'))for r in rows))
def completeness(directory,reference):
    result=load(directory/'completeness'/f'vs-{reference}'/'adaptive-v1/result.json')
    if result is None:return None
    rows=result['rows'];side=result['candidateSide'];other='A'if side=='B'else'B'
    return dict(requirements=len(rows),candidate_gaps=sum(r[side]=='material_gap'for r in rows),reference_gaps=sum(r[other]=='material_gap'for r in rows),
                candidate_only_gaps=sum(r[side]=='material_gap'and r[other]=='covered'for r in rows),
                candidate_only_covered=sum(r[side]=='covered'and r[other]=='material_gap'for r in rows),
                shared_gaps=sum(r[side]==r[other]=='material_gap'for r in rows),uncertain=sum(r[side]=='uncertain'or r[other]=='uncertain'for r in rows),rows=rows)
terms=[];all_rows=[];benefit_rows=[];paired_ref=[];paired_adaptive=[]
no_glossary_rows={'adaptive-v1':[],'baseline-human':[]};no_glossary_paired=[]
for index,t in enumerate(manifest['terms'],1):
    d=run/'terms'/f'{index:02}';e=load(d/'evidence.json');entry=load(d/'adaptive-v1/entry.json');reference=load(d/'baseline-human/entry.json');route=load(d/'adaptive-v1/route.json')or{}
    main=comparison(d,'baseline-human');benefit=comparison(d,'adaptive-initial-only');comp=completeness(d,'baseline-human');comp_benefit=completeness(d,'adaptive-initial-only')
    neutral={m:comparison(d,'no-glossary',m)for m in no_glossary_rows}
    # The primary yardstick contains only verified comparisons; partial first-pass preferences are not benefits.
    primary={m:benefit_summary(c['rows']if c['verified']else[])for m,c in neutral.items()}
    for m,c in neutral.items():
        if c['verified']:no_glossary_rows[m]+=[{**r,'id':f'{index:02}:{r["id"]}'}for r in c['rows']]
    paired=paired_benefit(neutral['adaptive-v1']['rows']if neutral['adaptive-v1']['verified']else[],neutral['baseline-human']['rows']if neutral['baseline-human']['verified']else[])
    no_glossary_paired += [{**r,'id':f'{index:02}:{r["id"]}'}for r in paired['rows']]
    expected=len(e['evaluation']);testable=bool(e['population']['distinct']and e['research'])
    neutral_done=not expected or all(c['verified']and c['judged']==expected for c in neutral.values())
    done=not testable or bool(entry and reference and main['verified']and main['judged']==expected and comp is not None and neutral_done)
    routed=route.get('branch')in('coverage','dictionary');benefit_done=not routed or (benefit['verified']and benefit['judged']==expected and comp_benefit is not None)
    records=[r for r in ledger if r['term']==e['term']]
    ref_records=[r for r in records if r['role']=='research'and r['method']=='baseline-human'];adaptive_records=[r for r in records if r['role']=='research'and r['method']=='adaptive-v1']
    all_rows+=main['rows'];benefit_rows+=benefit['rows']
    if testable and entry and reference:paired_ref+=ref_records;paired_adaptive+=adaptive_records
    known_benefit=bool(benefit['accuracy'].get('win',0)or benefit['naturalness'].get('win',0)or(comp_benefit or{}).get('candidate_only_covered',0))
    missed=route.get('branch')=='compact'and(comp or{}).get('candidate_only_gaps',0)>0
    terms.append(dict(index=index,term=e['term'],population=e['population']['distinct'],research=len(e['research']),expected=expected,overlap=e['overlap'],
                      entry_status=(entry or{}).get('status','pending'),reference_status=(reference or{}).get('status','pending'),route=route,
                      complete=done,benefit_complete=benefit_done,comparison=main,completeness=comp,routing_benefit=benefit,
                      no_glossary=neutral,no_glossary_benefit=primary,no_glossary_complete=neutral_done,no_glossary_paired=paired,
                      completeness_benefit=comp_benefit,demonstrated_escalation_benefit=known_benefit,possible_missed_escalation=missed,
                      reference_cost=cost(ref_records),adaptive_cost=cost(adaptive_records),
                      adaptive_wall_seconds=(entry or{}).get('wallSeconds'),reference_wall_seconds=(reference or{}).get('wallSeconds')))
groups=defaultdict(list)
for r in ledger:groups[(r['term'],r['role'],r['method'],r['stage'])].append(r)
stages=[dict(term=k[0],role=k[1],method=k[2],stage=k[3],**cost(v))for k,v in sorted(groups.items(),key=lambda p:str(p[0]))]
checks={f:hashlib.sha256((here/f).read_bytes()).hexdigest()==h for f,h in freeze['codeHashes'].items()}
summary=dict(complete=all(t['complete']and t['benefit_complete']for t in terms),policy_hashes_match=checks,seed=manifest['seed'],eligible_population=manifest['population'],
             terms=terms,accuracy=score(all_rows,'accuracy'),naturalness=score(all_rows,'naturalness'),routing_benefit_accuracy=score(benefit_rows,'accuracy'),
             routing_benefit_naturalness=score(benefit_rows,'naturalness'),routes=dict(Counter(t['route'].get('branch',t['entry_status'])for t in terms)),
             expected=sum(t['expected']for t in terms),judged=len(all_rows),globally_unique_passages=len({p['text']for t in terms for p in load(run/'terms'/f"{t['index']:02}"/'evidence.json')['evaluation']}),
             baseline_cost=cost(paired_ref),adaptive_cost=cost(paired_adaptive),all_attempts=cost(ledger),stage_costs=stages,
             role_costs={role:cost([r for r in ledger if r['role']==role])for role in {r['role']for r in ledger}},
             phase_timings=load(run/'phase-timings.json')or[],exposure=load(run/'holdout-exposure-audit.json'),
             missed_escalation_terms=[t['term']for t in terms if t['possible_missed_escalation']],
             demonstrated_benefit_terms=[t['term']for t in terms if t['demonstrated_escalation_benefit']])
summary['source_form_audit']=load(run/'source-form-audit.json')
summary['no_glossary']={m:{'accuracy':benefit_summary(rows),'naturalness':benefit_summary(rows,'naturalness')}for m,rows in no_glossary_rows.items()}
summary['no_glossary_paired']=paired_benefit(no_glossary_rows['adaptive-v1'],no_glossary_rows['baseline-human'])
summary['evaluation_amendment']=load(run/'evaluation-amendment-no-glossary.json')
summary['no_glossary_phase_timings']=load(run/'no-glossary-phase-timings.json')or[]
summary['overlap_quality_phase_timings']=load(run/'overlap-quality-phase-timings.json')or[]
summary['translation_only_phase']=load(run/'translation-only-phase.json')
summary['no_glossary_complete']=all(t['no_glossary_complete']for t in terms)
def cluster_interval(values):
    if len(values)<2:return None
    rng=random.Random(manifest['seed']);draws=sorted(statistics.mean(rng.choices(values,k=len(values)))for _ in range(10000))
    return [draws[249],draws[9749]]
for m in no_glossary_rows:
    values=[t['no_glossary_benefit'][m]['net_gain_per_100']for t in terms if t['expected']and t['no_glossary'][m]['verified']and t['no_glossary'][m]['judged']==t['expected']]
    summary['no_glossary'][m]['equal_term_mean_net_gain_per_100']=statistics.mean(values)if values else None
    summary['no_glossary'][m]['term_clustered_95_interval_per_100']=cluster_interval(values)
values=[t['no_glossary_paired']['net_effect_difference_per_100']for t in terms if t['expected']and t['no_glossary_complete']]
summary['no_glossary_paired']['equal_term_mean_difference_per_100']=statistics.mean(values)if values else None
summary['no_glossary_paired']['term_clustered_95_interval_per_100']=cluster_interval(values)
summary['baseline_counting_audits']=[]
for t in terms:
    d=run/'terms'/f"{t['index']:02}"/'baseline-human/stages';aggregate=load(d/'aggregate.json');counting=load(d/'counting.json')
    if aggregate:
        occurrences=(counting or{}).get('occurrences',[]);unassigned=sum(o.get('entryId')=='unassigned'for o in occurrences)
        totals=aggregate['totals'];outcomes=totals['outcomes']
        summary['baseline_counting_audits'].append(dict(term=t['term'],occurrences=len(occurrences),unassigned=unassigned,outcomes=outcomes,agreement=totals.get('agreement'),
                                                       valid_for_variant_selection=bool(occurrences)and unassigned==0 and not any(outcomes.get(k,0)for k in('failed','notRun'))))
net=[(t['comparison']['accuracy'].get('win',0)-t['comparison']['accuracy'].get('loss',0))/t['expected']for t in terms if t['expected']and t['comparison']['verified']]
if len(net)>1:
    rng=random.Random(manifest['seed']);draws=sorted(statistics.mean(rng.choices(net,k=len(net)))for _ in range(10000));summary['term_clustered_net_interval']=[draws[249],draws[9749]]
(run/'analysis-adaptive.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
with(run/'stage-measurements.csv').open('w',newline='')as f:
    fields=['term','role','method','stage','calls','seconds','input','cached','output','failures','unknown_usage'];writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(stages)
lines=['# Automatic glossary research validation','', '**Complete.**'if summary['complete']else'**In progress. Partial counts are not final evidence.**','',
       f"Frozen policy adaptive-v1; model {freeze['model']}; random seed {manifest['seed']}; thirty uniformly sampled entries from {manifest['population']} eligible entries after excluding all earlier tests. Rules and code hashes were frozen before drawing the sample. Hash verification: {all(checks.values())}. Human glossary fields are confined to isolated reference candidate preparation; adaptive outputs were frozen before that extraction.",'',
       '## Required yardstick: improvement over no glossary','',
       'A glossary succeeds only by improving the actual translations made with no glossary. Ties earn no credit. The same frozen neutral draft is the control for both methods; it was produced before either entry was supplied. There is no extra baseline translation call or empty-glossary editing pass. Independent blind judges compare each glossary-assisted translation with that exact draft, and a second fresh judge must confirm every claimed clear gain or harm. Research policy and outputs stay frozen after this user-requested evaluation amendment.','',
       'The primary measure is confirmed correctness gains minus confirmed correctness harms, alongside the separate harm count and naturalness effects. A net-zero result demonstrates no net benefit on this sample. Raw tie counts, agreement with another glossary and entry completeness cannot establish success. Positive sample net benefit is an observation, not proof of universal benefit; term-clustered intervals show uncertainty.','',
       '| Method | Verified passages | Correctness gains | Correctness harms | Net gain | Net gain / 100 passages | Ties (no credit) | Naturalness gains / harms / net |',
       '|---|---:|---:|---:|---:|---:|---:|---|']
for m,v in summary['no_glossary'].items():
    a,n=v['accuracy'],v['naturalness'];rate='pending'if a['net_gain_per_100']is None else f"{a['net_gain_per_100']:.2f}"
    lines.append(f"| {m} | {a['passages']} / {summary['expected']} | {a['gains']} | {a['harms']} | {a['net_gain']:+} | {rate} | {a['ties']} | {n['gains']} / {n['harms']} / {n['net_gain']:+} |")
    if v['term_clustered_95_interval_per_100']is not None:lines += ['',f"{m}: equal-term mean net correctness gain per 100 = {v['equal_term_mean_net_gain_per_100']:.2f}; term-clustered bootstrap 95% interval {v['term_clustered_95_interval_per_100']}.",'']
p=summary['no_glossary_paired']
lines+=['',f"Paired method effect difference (adaptive minus human-seeded full research): {p['net_effect_difference']:+} across {p['passages']} jointly verified passages. Each passage contributes +1 for a gain over its neutral draft, −1 for a harm, or 0 for a tie; method effects are then compared on the same passage. Never subtract totals from different passage sets. Baseline grade disagreements across independent comparisons: {p['baseline_grade_disagreements']}. These grades are evaluator judgments, not ground truth.",'',
        '| Adaptive effect / full-reference effect | Passages |','|---|---:|']
for label,count in sorted(p['matrix_candidate_reference'].items()):lines.append(f'| {label} | {count} |')
lines+=['', '| Term | Verified adaptive / full | Adaptive correctness gains / harms / net | Full correctness gains / harms / net | Paired net difference |', '|---|---|---|---|---:|']
for t in terms:
    a,b=[t['no_glossary_benefit'][m]for m in no_glossary_rows]
    lines.append(f"| {t['term']} | {a['passages']} / {b['passages']} of {t['expected']} | {a['gains']} / {a['harms']} / {a['net_gain']:+} | {b['gains']} / {b['harms']} / {b['net_gain']:+} | {t['no_glossary_paired']['net_effect_difference']:+} |")
lines+=['','No-hit terms have no quality evidence and are excluded from benefit estimates. Partial/unverified zeros in this table mean pending evidence, never a finding of no benefit. Both-acceptable ties and shared unresolved errors are distinguished in analysis-adaptive.json; grade-state counts reflect initial independent grades, whereas gain/harm directions require confirmation.','',
       '## Secondary comparison between glossary methods','',
       f"Adaptive vs human-seeded full research correctness wins / losses / ties: **{fmt(summary['accuracy'])}**. Naturalness: **{fmt(summary['naturalness'])}**. Judged {summary['judged']} / {summary['expected']} term-passage pairs, with {summary['globally_unique_passages']} globally unique texts. Non-ties require material differences and fresh blind confirmation; disagreements become ties. This comparison explains relative behavior; it cannot demonstrate that either method improves over no glossary.",'',
       '## Automatic routing','',
       'Every positive-hit term gets a bounded independent source-book lookup and one proposal from at most twelve source passages. Explicit proposal uncertainty or sufficiently unrepresented lexical contexts trigger one coverage scout and final proposal; a dictionary-only branch handles unresolved lexical distinctions when no extra contexts exist. Direct Spanish dictionary acquisition removes translations/other languages, is capped, and records failure. The scout reads at most 384 bounded source windows, prioritizing novel contexts then a reproducible sample. No term-specific exceptions or expected Vietnamese answers are supplied. A novelty signal is lexical, not proof of an additional meaning.','',
       f"Observed branches: {json.dumps(summary['routes'],ensure_ascii=False)}. Escalation-vs-initial correctness: {fmt(summary['routing_benefit_accuracy'])}; naturalness: {fmt(summary['routing_benefit_naturalness'])}. Completeness benefits are assessed separately. A routed case with no demonstrated benefit is not proof that escalation was unnecessary.",'',
       '| Term | Corpus passages | Research pool | Evaluation | Route | Correctness W / L / T | Naturalness W / L / T | Sparse overlap |',
       '|---|---:|---:|---:|---|---|---|---:|']
for t in terms:lines.append(f"| {t['term']} | {t['population']} | {t['research']} | {t['comparison']['judged']} / {t['expected']} | {t['route'].get('branch',t['entry_status'])} | {fmt(t['comparison']['accuracy'])} | {fmt(t['comparison']['naturalness'])} | {t['overlap']} |")
lines+=['','## Independent entry completeness','',
        'A fresh source-only agent derives meanings, grammatical distinctions and evidenced specialized provenance from up to one hundred source windows and independent source-book evidence, without seeing either entry. Another fresh agent sees randomized entries plus those requirements. Every claimed material gap receives a fresh second check with sides reversed. Coverage means an adequate usable translation/context rule; equivalent good wordings qualify equally. This inventory is sampled rather than exhaustive and never enters research/routing.','',
        '| Term | Requirements | Adaptive gaps | Reference gaps | Shared gaps | Uncertain | Escalation completeness gains |', '|---|---:|---:|---:|---:|---:|---:|']
for t in terms:
    c=t['completeness'];b=t['completeness_benefit']
    if c:lines.append(f"| {t['term']} | {c['requirements']} | {c['candidate_gaps']} | {c['reference_gaps']} | {c['shared_gaps']} | {c['uncertain']} | {(b or{}).get('candidate_only_covered',0)} |")
lines+=['',f"Possible missed escalations (compact branch with confirmed adaptive-only gap): {', '.join(summary['missed_escalation_terms'])or'none detected yet'}. Demonstrated escalation benefits: {', '.join(summary['demonstrated_benefit_terms'])or'none detected yet'}.",'', '## Measured research cost','',
        'All adaptive calls include initial proposals, scouts and fallback proposals. Failed attempts and unknown usage stay in the ledger. Source-only/local retrieval, human seed preparation, translation, judging and completeness assessment are separate roles/costs. Input includes cached tokens. Summed call seconds measure model work, not elapsed user latency. The two methods share the frozen runtime/model; the original procedure includes automatic human-review freeze, not human review time.','',
        '| Term | Reference calls | Adaptive calls | Reference model seconds | Adaptive model seconds | Reference input | Adaptive input | Reference output | Adaptive output |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
for t in terms:
    r,c=t['reference_cost'],t['adaptive_cost'];lines.append(f"| {t['term']} | {r['calls']} | {c['calls']} | {r['seconds']:.1f} | {c['seconds']:.1f} | {r['input']} | {c['input']} | {r['output']} | {c['output']} |")
r,c=summary['baseline_cost'],summary['adaptive_cost']
lines+=['',f"Paired research: reference {r['calls']} calls, {r['seconds']:.1f} model seconds, {r['input']:,} input / {r['output']:,} output; adaptive {c['calls']} calls, {c['seconds']:.1f} seconds, {c['input']:,} input / {c['output']:,} output."]
if summary['complete']and all(r[k]>0 for k in('seconds','input','output')):lines+=['',f"Savings: {100*(1-c['seconds']/r['seconds']):.2f}% summed model seconds; {100*(1-c['input']/r['input']):.2f}% input; {100*(1-c['output']/r['output']):.2f}% output."]
lines+=['','| Role | Calls | Model seconds | Input | Cached input | Output | Failures | Unknown usage |','|---|---:|---:|---:|---:|---:|---:|---:|']
for role,c in sorted(summary['role_costs'].items()):lines.append(f"| {role} | {c['calls']} | {c['seconds']} | {c['input']} | {c['cached']} | {c['output']} | {c['failures']} | {c['unknown_usage']} |")
lines += ['', '| Controller phase | Elapsed seconds | Exit code |', '|---|---:|---:|']
for phase in summary['phase_timings']:lines.append(f"| {phase['phase']} | {phase['seconds']} | {phase['exitCode']} |")
for phase in summary['no_glossary_phase_timings']:lines.append(f"| no-glossary {phase['method']} {phase['phase']} | {phase['seconds']} | {phase['exitCode']} |")
phase=summary['translation_only_phase']
if phase:lines.append(f"| early neutral/adaptive translations (same frozen functions/checkpoints) | {phase.get('seconds','running')} | {phase.get('exitCode','pending')} |")
lines+=['','## Confirmed defects and differences','']
for t in terms:
    for m,c in t['no_glossary'].items():
        if not c['verified']:continue
        changes=[r for r in c['rows']if r['accuracy']!='tie'or r['naturalness']!='tie']
        if changes:
            lines += [f"### {t['term']}: {m} versus no glossary",'']+[f"- {r['id']}: {r['reason']}"for r in changes]+['']
audit=summary['source_form_audit']
if audit:
    lines+=['### Mechanical source-form validation','',f"A separate local audit checked {len(audit['rows'])} emitted source forms. It found {len(audit['unsupported'])} zero-hit spellings. Source-only token inflections can generate invalid whole-phrase combinations; labeling those combinations as confirmed is too permissive. The frozen v1 outputs retain these defects for honest evaluation. A generic corpus membership filter is a cheap necessary guard for a follow-up version; it must not use human glossary aliases.",'']
    lines += [f"- {r['term']}: {r['sourceForm']} — no corpus passages."for r in audit['unsupported']]+['']
for t in terms:
    defects=[r for r in t['comparison']['rows']if r['accuracy']!='tie'or r['naturalness']!='tie']
    if defects:lines += [f"### {t['term']}",'']+[f"- {r['id']}: {r['reason']}"for r in defects]+['']
    comp=t['completeness']
    if comp:
        gaps=[r for r in comp['rows']if r['A']=='material_gap'or r['B']=='material_gap']
        if gaps:lines += [f"### {t['term']} completeness",'']+[f"- {r['id']}: {r['reason']}"for r in gaps]+['']
lines+=['## Limits and reproducibility','',
        'Sparse terms necessarily reuse evidence and are reported separately from disjoint terms. Source-location/adjacent-paragraph and normalized containment filtering suppresses common context leakage; the saved exposure audit is still required and cannot rule out every shorter/reformatted excerpt. Zero-hit entries are retained, not replaced or translated from the old glossary. Capped source scouts can miss rare meanings. Fresh-context same-model judges are independent of research, not a different model family or human panel. Controlled drafts can retain shared unrelated translation errors. Ties alone do not establish entry completeness or universal equivalence. The confirmation policy stays unchanged after seeing new quality findings; later repairs must retain these original results.','',
        f"Run artifacts: {run}. See analysis-adaptive.json, stage-measurements.csv, phase-timings.json, policy-freeze.json, optimized-freeze.json and per-term prompts, routes, sources, entries, translations and verified judgments. All work uses subscription authentication; production glossary/app files are untouched."]
(here/'ADAPTIVE_RESULTS.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({**{k:summary[k]for k in('complete','expected','routes')},'no_glossary':{m:{'accuracy':v['accuracy'],'naturalness':v['naturalness']}for m,v in summary['no_glossary'].items()}},ensure_ascii=False))
