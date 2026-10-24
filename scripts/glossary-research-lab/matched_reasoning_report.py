"""External reconciliation; no workflow imports this module or its criteria."""
import json,re,datetime
from pathlib import Path
from collections import Counter
from zoneinfo import ZoneInfo
HERE=Path(__file__).resolve().parent;RUN=HERE/'runs/2026-10-14-equal-compute';OLD=HERE/'runs/2026-10-14-htn';BLIND=HERE/'runs/2026-10-14-htn-blind'
def read(p):return json.loads(p.read_text()) if p.exists() else None
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
DIMS=['accuracy','policy','naturalness','wholePassage']
def effect(a,b,dim):
 good={'policy':['pass','not_applicable'],'naturalness':['natural']}.get(dim,['faithful']);bad={'policy':'fail','naturalness':'clear_problem'}.get(dim,'material_error')
 if 'uncertain' in [a,b]:return None
 return 1 if a in good and b==bad else -1 if a==bad and b in good else 0
def compare(cohort,left,right):
 suffix='-budgeted' if cohort=='budgeted' else '';keys=read(RUN/f'assessment-only/blinding-key{suffix}.json');rows=[]
 if not keys:return None
 for rep in [1,2]:
  judges={j:read(RUN/f'assessment-only/{"budgeted-" if suffix else ""}rep-{rep}-judge-{j}.json') for j in [1,2]}
  if not all(judges.values()):return None
  for p in read(RUN/'source.json')['passages']:
   pid=str(p['itemId']);case=f'{rep}:{pid}';scores={};judgments=[]
   for j in [1,2]:
    row=next(r for r in judges[j]['items'] if r['id']==case);k=next(k['sides'] for k in keys if k['id']==case and k['judge']==j);inverse={arm:side for side,arm in k.items()}
    judgments.append({'judge':j,'scores':{arm:{d:row[d+side] for d in DIMS} for arm,side in inverse.items()},'reason':row['reason']})
   for d in DIMS:
    es=[effect(x['scores'][left][d],x['scores'][right][d],d) for x in judgments];scores[d]=es[0] if es[0]==es[1] else None
   rows.append({'id':pid,'rep':rep,'effects':scores,'judgments':judgments})
 totals={d:{'gains':sum(r['effects'][d]==1 for r in rows),'harms':sum(r['effects'][d]==-1 for r in rows),'tiesOrBothBad':sum(r['effects'][d]==0 for r in rows),'uncertainOrUnconfirmed':sum(r['effects'][d] is None for r in rows)} for d in DIMS}
 replicated={}
 for d in DIMS:
  values=[]
  for p in read(RUN/'source.json')['passages']:
   es=[next(r['effects'][d] for r in rows if r['id']==str(p['itemId']) and r['rep']==rep) for rep in [1,2]];values.append(es[0] if es[0]==es[1] else None)
  replicated[d]={'gains':values.count(1),'harms':values.count(-1),'tiesOrBothBad':values.count(0),'uncertainOrNotReplicated':values.count(None)}
 return {'left':left,'right':right,'presentations':len(rows),'totals':totals,'replicated':replicated,'rows':rows}
def cost(records):
 return {'attempts':len(records),'successful':sum(x['status']=='ok' for x in records),'inputTokens':sum((x.get('usage') or {}).get('input_tokens',0) for x in records),'cachedInputTokens':sum((x.get('usage') or {}).get('cached_input_tokens',0) for x in records),'outputTokens':sum((x.get('usage') or {}).get('output_tokens',0) for x in records),'unknownUsageAttempts':sum(not x.get('usage') for x in records),'summedSeconds':round(sum(x['seconds'] for x in records),3)}
def main():
 records=[json.loads(x) for x in (RUN/'requests.jsonl').read_text().splitlines()];costs={}
 for arm,regex in [('no-glossary',r'^no-glossary-[12]-'),('glossary',r'^glossary-[12]-'),('no-glossary-budgeted',r'^no-glossary-budgeted-[12]-')]:
  costs[arm]=cost([x for x in records if re.search(regex,x['stage'])]);costs[arm]['totalTokens']=costs[arm]['inputTokens']+costs[arm]['outputTokens']
 costs['externalEvaluation']=cost([x for x in records if x['role']=='judge'])
 primary=compare('primary','glossary','no-glossary');budgeted=compare('budgeted','glossary','no-glossary-budgeted')
 shared={arm:compare('primary',arm,'one-pass') for arm in ['glossary','no-glossary']}
 verifications={arm:{str(rep):read(RUN/'workflows'/arm/str(rep)/'verification.json') for rep in [1,2]} for arm in ['no-glossary','glossary','no-glossary-budgeted']}
 requirements=read(OLD/'requirements.json');violations=[];audits=[]
 for f in (RUN/'calls').glob('*/*/request.json'):
  q=read(f);content=json.loads(q['content']);arm='glossary' if q['stage'].startswith('glossary-') else 'no-glossary';leaks=[name for name,text in requirements.items() if text in q['content'] or text in q['instructions']]
  forbidden=[s for s in ['humanRequirements','sourceJudgments','acceptanceCriteria','MANDATORY PROJECT CONSTRAINTS'] if s in q['content']]
  if arm=='no-glossary':
   if content.get('sourceMeaningInventory') or content.get('glossary_info'):forbidden.append('research/glossary in no-glossary context')
  entry={'stage':q['stage'],'arm':arm,'leaks':leaks,'forbidden':forbidden,'effort':q['effort'],'sourceIds':[p['id'] for p in content['passages']],'instructions':q['instructions']};audits.append(entry)
  if leaks or forbidden:violations.append(entry)
 shapes={('analysis' if a['stage'].endswith('analysis') else 'translation',a['instructions']) for a in audits}
 setup=[json.loads(x) for x in (BLIND/'requests.jsonl').read_text().splitlines()];research=[x for x in setup if x['term']=='mundo' and (x['role']=='research' or x['stage'].startswith('initial-development') or x['stage'].startswith('frequency-en-'))]
 extra=cost(research);extra['note']='Historical shared bilingual source/target research, development checking and English frequency measurement for the supplied artifact; not a cold English-only estimate. Raw corpus/dictionary acquisition and meaning-refinement costs are additional and incompletely attributed.'
 complete=primary is not None and budgeted is not None;ratio=costs['glossary']['totalTokens']/costs['no-glossary-budgeted']['totalTokens'] if costs['no-glossary-budgeted']['totalTokens'] else None
 result={'complete':complete,'scope':'25 previously exposed English mundo paragraphs / 34 occurrences, two repetitions per arm. Same source/term focus in both workflows; no new holdouts.','primary':primary,'budgeted':budgeted,'sharedVsOnePass':shared,'costs':costs,'historicalGlossarySetup':extra,'glossaryToBudgetedNoGlossaryTokenRatio':ratio,'isolationAudit':{'requests':len(audits),'passed':not violations,'violations':violations,'uniqueInstructionPairs':len(shapes),'note':'Identical analysis and translation instructions; same source orders per repetition. Only source research/glossary data and the explicitly registered budget-control effort differ. Fresh contexts/tools disabled; criteria external.'},'calibration':read(RUN/'assessment-only/calibration-result.json'),'protocol':{arm:{rep:{'passed':v['passed'],'errors':v['errors'],'unresolved':len(v['unresolved'])} if v else None for rep,v in reps.items()} for arm,reps in verifications.items()},'limits':['Nominal reasoning schedule matched; consumed tokens are measured rather than claimed identical. High-effort no-glossary control supplies a conservative compute bracket.','No generalization claim beyond this small, previously exposed English cohort; source/term focus is shared and deliberately controlled.','Model graders are provisional and source judgments are not human gold labels.','Candidate preference and approved surface-form consistency can fail; literal compliance is separate from linguistic quality.','Full glossary research costs are additional and not amortized or fully attributed.','No production or research-procedure change made.']}
 result['comparatorCompleteness']={'status':'deficient','missingSupportedCandidate':'planet','finding':'Initial proposal rejected a contextually valid candidate; independent audit detected this, but repair kept it rejected and compilation checked only broad sense coverage. This comparison does not establish the performance of a candidate-complete repaired glossary.','provenance':'plans/glossary-research-mundo-candidate-omission.md','recommendation':'Withdraw preference for translation-workflow changes over glossary repair until ordinary translation with a repaired entry is tested.'}
 write(RUN/'results.json',result)
 lines=['# Glossary value beyond extra reasoning','',f'Updated {datetime.datetime.now(ZoneInfo("Asia/Saigon")).strftime("%Y-%m-%d %H:%M:%S")} Asia/Saigon (UTC+07). Status: '+('complete' if complete else 'in progress')+'.','','All 25 paragraphs / 34 occurrences are translated; no uncertainty-based exclusions. Human criteria are available only to the separate external evaluator. Two independently ordered graders assess each repetition. Ten mirrored fault/acceptable-alternative controls pass.','','The primary comparison uses one source-analysis call and one translation call per repetition, gpt-6.1-sol, medium effort, two repetitions per arm. Only the glossary arm receives source research and the frozen glossary. The budget control uses the identical no-glossary workflow at high effort, with no feedback, glossary, former choices or criteria.','','| Comparison (glossary minus control) | Meaning gains / harms | Policy gains / harms | Naturalness gains / harms | Full passage gains / harms |','|---|---:|---:|---:|---:|']
 for name,v in [('Matched schedule, 50 presentations',primary),('Higher-reasoning no-glossary, 50 presentations',budgeted)]:
  if v:lines.append('| '+name+' | '+' | '.join(f'{v["totals"][d]["gains"]} / {v["totals"][d]["harms"]}' for d in DIMS)+' |')
 lines+=['','Gains/harms require agreement between both judges. Replicated effects additionally require the same direction in both independent workflow repetitions. Ties can include both sides failing; uncertainty is separate.']
 for name,v in [('Primary',primary),('Budget control',budgeted)]:
  if v:lines+=['',name+' replicated effects: '+', '.join(f'{d}: +{v["replicated"][d]["gains"]}/−{v["replicated"][d]["harms"]}' for d in DIMS)+'.']
 if complete:
  lines+=['','## Comparator completeness correction','','A later provenance audit found that the tested experimental entry omitted planet despite source support and an independent audit flagging its contextual validity. Repair acknowledged that finding but did not deliver the candidate; compilation checked only broad sense coverage. The results below concern this deficient entry. They do not establish that extra translation reasoning is preferable to a candidate-complete glossary with effective usage notes. The earlier recommendation to favor translation-workflow changes was premature and is withdrawn pending that test. See plans/glossary-research-mundo-candidate-omission.md.']
 if complete:
  lines+=['','## Decision','','No repeatable glossary quality benefit was demonstrated on this English mundo cohort once extra reasoning was controlled. The higher-reasoning no-glossary control matched glossary meaning and terminology at a similar total-token budget. The primary comparison\'s three terminology gains did not repeat and disappeared against that control. Isolated whole-passage and naturalness differences went both ways; neither repeated. Both workflows used source-first selection, preserved preferences and deterministic checks; this comparison does not isolate the value of that shared mechanism and does not justify rejecting or removing it. Its production adoption remains unvalidated. Additional compute is acceptable within reason for demonstrated quality improvements; compute matching is a control for attribution, not a design ceiling. This conclusion is limited to these previously exposed cases and does not establish that glossaries lack value generally.']
 lines+=['','## Compute','', '| Arm | Successful calls | Input | Output | Total tokens | Unknown-usage attempts | Summed call seconds |','|---|---:|---:|---:|---:|---:|---:|']
 for arm in ['no-glossary','glossary','no-glossary-budgeted']:
  c=costs[arm];lines.append(f'| {arm} | {c["successful"]} | {c["inputTokens"]:,} | {c["outputTokens"]:,} | {c["totalTokens"]:,} | {c["unknownUsageAttempts"]} | {c["summedSeconds"]} |')
 if ratio:lines+=['',f'Glossary / higher-reasoning no-glossary total-token ratio: {ratio:.3f}. Input and output tokens have different computational costs; this is a measured budget bracket, not exact FLOP equivalence. Summed call time is not wall time. One interrupted primary no-glossary call has unknown usage; it remains recorded.']
 lines+=['',f'Supplied glossary historical setup: {extra["attempts"]} recorded calls, {extra["inputTokens"]:,} input and {extra["outputTokens"]:,} output tokens, plus incompletely attributed acquisition/refinement. These costs are additional to the application table.','','## Compliance and isolation','',f'Workflow request audit: {len(audits)} saved requests; passed={not violations}. Criteria never enter either workflow or the higher-reasoning control.','']
 for arm,reps in result['protocol'].items():
  for rep,v in reps.items():
   if v:lines.append(f'- {arm}, repetition {rep}: literal check passed={v["passed"]}; {len(v["errors"])} errors; {v["unresolved"]} unverified source choices.')
 lines+=['','The second glossary analysis supplies preferred renderings and incompatible synonym lists in acceptedForms. Its raw failed literal check is retained; external linguistic scores do not certify that contract. No output is repaired using evaluator results.','','## Limits','']+['- '+x for x in result['limits']]
 (RUN/'RESULTS.md').write_text('\n'.join(lines)+'\n');print(json.dumps({'complete':complete,'primary':primary['totals'] if primary else None,'budgeted':budgeted['totals'] if budgeted else None,'costs':costs,'ratio':ratio,'isolationPassed':not violations},ensure_ascii=False))
if __name__=='__main__':main()
