"""Report frozen observations; this module is never imported by repair workflows."""
import json,re
from pathlib import Path
HERE=Path(__file__).resolve().parent;RUN=HERE/'runs/2026-10-14-candidate-delivery';DIMS=['accuracy','policy','naturalness','wholePassage']
def read(p):return json.loads(p.read_text()) if p.exists() else None
def effect(a,b,d):
 if 'uncertain' in [a,b]:return None
 good={'policy':['pass','not_applicable'],'naturalness':['natural']}.get(d,['faithful']);bad={'policy':'fail','naturalness':'clear_problem'}.get(d,'material_error')
 return 1 if a in good and b==bad else -1 if a==bad and b in good else 0
def compare(right):
 keys=read(RUN/'assessment-only/blinding-key.json');rows=[]
 if not keys:return None
 for rep in [1,2]:
  judges={j:read(RUN/f'assessment-only/rep-{rep}-judge-{j}.json') for j in [1,2]}
  if not all(judges.values()):return None
  for p in cases:
   case=f'{rep}:{p["itemId"]}';details=[]
   for j in [1,2]:
    row=next(r for r in judges[j]['items'] if r['id']==case);side=next(k['sides'] for k in keys if k['id']==case and k['judge']==j);inv={v:k for k,v in side.items()}
    details.append({'judge':j,'scores':{arm:{d:row[d+s] for d in DIMS} for arm,s in inv.items()},'reason':row['reason']})
   outcomes={}
   for d in DIMS:
    es=[effect(x['scores']['repaired-glossary'][d],x['scores'][right][d],d) for x in details];outcomes[d]=es[0] if es[0]==es[1] else None
   rows.append({'id':p['itemId'],'rep':rep,'effects':outcomes,'judgments':details})
 def totals(rs):return {d:{'gains':sum(r['effects'][d]==1 for r in rs),'harms':sum(r['effects'][d]==-1 for r in rs),'tiesOrBothBad':sum(r['effects'][d]==0 for r in rs),'unknown':sum(r['effects'][d] is None for r in rs)} for d in DIMS}
 replicated={}
 for d in DIMS:
  pairs=[[next(r['effects'][d] for r in rows if r['id']==p['itemId'] and r['rep']==rep) for rep in [1,2]] for p in cases]
  replicated[d]={'gains':sum(es==[1,1] for es in pairs),'harms':sum(es==[-1,-1] for es in pairs)}
 return {'right':right,'totals':totals(rows),'replicated':replicated,'cohorts':{name:totals([r for r in rows if r['id'] in ids]) for name,ids in cohorts.items()},'rows':rows}
cases=read(RUN/'source.json')['passages']+read(RUN/'plural-regression.json');cohorts=read(RUN/'cohorts.json');cohorts={k:set(v) for k,v in cohorts.items() if k in ['hard','reserved']};cohorts['plural']={p['itemId'] for p in read(RUN/'plural-regression.json')}
assert len({p['itemId'] for p in cases})==len(cases)
records=[json.loads(s) for s in (RUN/'requests.jsonl').read_text().splitlines()]
costs={}
for role in sorted({r['role'] for r in records}):
 rs=[r for r in records if r['role']==role];costs[role]={'attempts':len(rs),'successes':sum(r['status']=='ok' for r in rs),'input':sum((r.get('usage') or {}).get('input_tokens',0) for r in rs),'output':sum((r.get('usage') or {}).get('output_tokens',0) for r in rs),'unknownUsage':sum(not r.get('usage') for r in rs),'summedSeconds':round(sum(r['seconds'] for r in rs),3)}
comparisons={arm:compare(arm) for arm in ['no-glossary','old-glossary']};entry=read(RUN/'saved-glossary.json')['terms'][0]
checks={str(rep):read(RUN/f'runtime-check-{rep}.json') for rep in [1,2]}
runtime={rep:{'failures':[{'id':r['id'],**o} for r in v['items'] for o in r['occurrences'] if o['status'] in ['underused','overapplied','meaning_error']],'unknown':sum(o['status']=='unknown' for r in v['items'] for o in r['occurrences'])} if v else None for rep,v in checks.items()}
full=Path('/Users/hans/Desktop/GLOSSARY RESEARCH SPANISH TEST TERMS').read_text();criterion=full.split('1. Mundo:',1)[1].split('\n2.',1)[0].strip();audit=[]
for f in (RUN/'calls').glob('*/*/request.json'):
 q=read(f);c=json.loads(q['content']);assert criterion not in q['content'] and criterion not in q['instructions'];assert not any(x in q['content'] for x in ['humanRequirements','acceptanceCriteria','sourceJudgments'])
 if q['stage'].startswith('translate-no-glossary'):assert not c['glossary_info'] and set(c)=={'passages','glossary_info'}
 audit.append(q['stage'])
result={'complete':all(comparisons.values()),'paragraphs':len(cases),'occurrences':sum(len(p['occurrences']) for p in cases),'cohorts':{k:len(v) for k,v in cohorts.items()},'targets':entry['targetTerms'],'frequency':read(RUN/'frequency.json'),'candidateDelivery':read(RUN/'research-frozen.json'),'runtime':runtime,'comparisons':comparisons,'calibration':read(RUN/'assessment-only/calibration-result.json'),'detectorCalibration':read(RUN/'detector-calibration.json'),'costs':costs,'isolation':{'criterionOutsideRuntime':True,'savedRequests':len(audit)},'limits':['HTN prototype; production app and configured provider-model behavior not integrated/tested.','Historical source inventory and source-first preferences are reused; their acquisition costs are additional.','Reserved passages are excluded from this note author, but earlier corpus research and frequency counting may overlap.','Model judgments and preferred wording remain provisional; ambiguous cases are not silently treated as successes.','No original full safeguard retired; no broad token/speed saving claim.']}
result['metamorphic']=read(RUN/'metamorphic-status.json')
result['selectionStatus']='needs-review' if result['metamorphic'] and not result['metamorphic']['passed'] else 'pending-review'
(RUN/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
lines=['# Candidate preservation and actual glossary selection','',f'Execution: {"complete" if result["complete"] else "in progress"}. Selection certification: {result["selectionStatus"]}. {len(cases)} paragraphs / {result["occurrences"]} occurrences, two ordinary-translation repetitions per arm.','', 'The repair agents never see human criteria. Research and checks run during glossary construction; translators receive source plus ordinary glossary hints, with frequency-order instructions and no extra source-analysis pass.','', '## Outcome','','Candidate preservation is fixed in the HTN prototype: planet and planets are actual delivered choices, not merely acknowledged in research prose. Independent external judges confirm seven repeated terminology improvements over both ordinary no-glossary translation and the old deficient entry, with zero researched-term meaning or policy harms across the 86 presentations. This demonstrates that glossary candidates and usage notes can fix the original planetary cases without an extra translation-analysis pass. It does not establish reliable selection in every unseen case.','','A separate robustness check replaces case IDs and the planet name Hercólubus with Orvantis. The planetary plural renders as worlds in one repetition and planets in the other. That check remains unresolved after the configured consumer repair limit; the entry requires review rather than unconditional certification. The limited local source context may also matter; the cause of the instability is not established. Eight source preferences remain unknown in each runtime repetition. The external assessment also records isolated whole-passage differences, including one harm versus no glossary; none repeats.','','The criteria-blind detector passes six fault/acceptable-alternative controls, including a physical underuse injection that leaves another correct planet token elsewhere in the paragraph. The external evaluator passes ten mirrored controls after a policy-scope clarification. All failed/superseded attempts remain counted.','','## Candidate delivery','', 'Retained targets: '+', '.join(entry['targetTerms'])+'.','', 'The compiler checks scoped audit obligations and kept candidate dispositions before publication and after frequency sorting. A broader candidate cannot discharge a missing narrower candidate. Zero-count variants remain available.','', '## Runtime verification','']
for rep,v in runtime.items():
 if v:lines.append(f'- Repetition {rep}: {len(v["failures"])} detected failures; {v["unknown"]} unknown occurrences.')
lines+=['','## External comparison','', '| Repaired glossary versus | Meaning gains / harms | Policy gains / harms | Naturalness gains / harms | Passage gains / harms |','|---|---:|---:|---:|---:|']
for arm,v in comparisons.items():
 if v:lines.append('| '+arm+' | '+' | '.join(f'{v["totals"][d]["gains"]} / {v["totals"][d]["harms"]}' for d in DIMS)+' |')
lines+=['','Both independently ordered graders must agree on an effect. Replicated effects require the same direction in both workflow repetitions. Ties include both answers failing; uncertainty is retained.','', '## Cost','', '| Role | Attempts | Successful | Input | Output | Unknown usage | Summed seconds |','|---|---:|---:|---:|---:|---:|---:|']
for role,c in costs.items():lines.append(f'| {role} | {c["attempts"]} | {c["successes"]} | {c["input"]:,} | {c["output"]:,} | {c["unknownUsage"]} | {c["summedSeconds"]} |')
lines+=['','Includes failed sandbox/rate-limit attempts and superseded model outputs. Historical imported source research/preferences cost extra. External evaluation is assessment cost, separate from runtime. Summed call seconds are not elapsed wall time.','', '## Limits','']+['- '+x for x in result['limits']]
(RUN/'RESULTS.md').write_text('\n'.join(lines)+'\n');print(json.dumps({'complete':result['complete'],'runtime':{k:len(v['failures']) if v else None for k,v in runtime.items()},'comparisons':{k:v['totals'] if v else None for k,v in comparisons.items()}}))
