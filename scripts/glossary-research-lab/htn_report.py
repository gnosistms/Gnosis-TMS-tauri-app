"""Reconcile the seven-term prototype; no missing/ambiguous case can be reported as passed."""
import json,hashlib,time
from pathlib import Path
from collections import Counter
from htn_prepare import RUN,TERMS
from efficient_design import read,write
DIMENSIONS=['accuracy','policy','naturalness']
def metrics(rows):
 result={d:{'gains':sum(r['effects'][d]==1 for r in rows),'harms':sum(r['effects'][d]==-1 for r in rows),'tiesOrUnconfirmed':sum(r['effects'][d]==0 for r in rows)} for d in DIMENSIONS}
 for dim in DIMENSIONS:
  actual=[r['first'][dim+r['first']['candidateSide']] for r in rows]
  result[dim]['candidateStatuses']=dict(Counter(actual));result[dim]['disagreements']=sum(r['second'] is not None and r['first'][dim+r['first']['candidateSide']]!=r['second'][dim+r['second']['candidateSide']] for r in rows)
 result['wholePassageCandidateStatuses']=dict(Counter(r['first']['wholePassage'+r['first']['candidateSide']] for r in rows))
 def passage_effect(j):
  side=j['candidateSide'];other='B' if side=='A' else 'A';a=j['wholePassage'+side];b=j['wholePassage'+other]
  return 1 if (a,b)==('faithful','material_error') else -1 if (a,b)==('material_error','faithful') else 0
 effects=[passage_effect(r['first']) if r['second'] is not None and passage_effect(r['first'])==passage_effect(r['second']) else 0 for r in rows]
 result['wholePassageConfirmedEffects']={'gains':effects.count(1),'harms':effects.count(-1),'tiesOrUnconfirmed':effects.count(0)}
 return result

def structural(i,lang,method):
 d=RUN/'terms'/f'{i:02}';input=read(d/'input.json');saved=read(d/method/lang/'saved-glossary.json')
 if not saved:return {'status':'not_run'}
 fields=saved['terms'][0];targets=fields['targetTerms'];notes=fields['notesToTranslators'];inv=read(d/'inventory.json');checks={}
 forms={x.casefold() for x in fields['sourceTerms']}
 if i==1:checks['planet_available']=any('planet' in x.lower() if lang=='en' else 'hành tinh' in x.lower() for x in targets)
 if i==2:checks['related_derivatives_proposed']=any('supra' in x['term'].lower() for x in inv['relatedStudies'])
 if i==3:checks['related_vanidoso_proposed']=any('vanidos' in x['term'].lower() for x in inv['relatedStudies'])
 if i==4:
  checks.update(canonical_name='Hooltanpanas' in targets,observed_and_correct_source_forms={'hooltampanas','hooltanpanas'}<=forms,gurdjieff_in_general_notes='gurdjieff' in notes.lower())
 if i==5:
  checks.update(canonical_singular=any(x.casefold()=='hasnamuss' for x in targets),canonical_plural=any(x.casefold()=='hasnamussen' for x in targets),gurdjieff_in_general_notes='gurdjieff' in notes.lower(),hanasmussen_recognized='hanasmussen' in forms,janasmussen_recognized='janasmussen' in forms)
 if i==7:
  canonical='Innermost' if lang=='en' else 'Đấng Nội Tại';checks['required_noun_available']=any(x.casefold()==canonical.casefold() for x in targets);checks['dayspring_in_general_notes']='dayspring of youth' in notes.lower()
 return {'status':'pass' if all(checks.values()) else 'fail','checks':checks,'targets':targets,'sourceForms':fields['sourceTerms'],'relatedStudies':inv['relatedStudies']}

def main():
 exposure=read(RUN/'exposure-audit.json');rows=[];examples=[]
 for i,(term,languages) in enumerate(TERMS,1):
  d=RUN/'terms'/f'{i:02}';input=read(d/'input.json')
  for lang in languages:
   for method in ['htn-v2','htn-v3','htn-v4','htn-v5','htn-v7']:
    if method in ['htn-v3','htn-v4','htn-v5','htn-v7'] and not (d/method/lang/'saved-glossary.json').exists():continue
    for arm in ['htn','human-hints-only']:
     if method=='htn-v3' and arm=='human-hints-only':continue
     for role in ['development','confirmation']:
      file=d/method/lang/f'{arm}-assessment-{role}.json';records=read(file);expected=[str(p['itemId']) for p in input['test'] if p['role']==role]
      if records is None:
       combined=read(d/method/lang/f'{arm}-assessment-all.json')
       if combined is not None:records=[r for r in combined if r['id'] in set(expected)]
      complete=records is not None and len(records)==len(expected) and {r['id'] for r in records}==set(expected)
      independentIds=set(expected)-set(exposure[term]['confirmationNotIndependentIds']) if role=='confirmation' else set(expected)
      independent=[r for r in records or [] if r['id'] in independentIds]
      rows.append({'term':term,'language':lang,'method':method,'arm':arm,'role':role,'expected':len(expected),'assessed':len(records or []),'complete':complete,'effects':metrics(records or []),'independentConfirmationEffects':metrics(independent) if role=='confirmation' else None,'notIndependentIds':sorted(set(expected)-independentIds),'structural':structural(i,lang,method) if arm=='htn' else None})
      for r in records or []:
       if any(r['effects'][d] for d in DIMENSIONS):
        p=next(p for p in input['test'] if str(p['itemId'])==r['id']);baselineVersion='context-baseline' if method in ['htn-v4','htn-v5','htn-v7'] else 'htn-v1';base=read(d/baselineVersion/lang/'no-glossary.json');candidate=read(d/(method if arm=='htn' else baselineVersion)/lang/(arm+'.json'))
        examples.append({'term':term,'language':lang,'method':method,'arm':arm,'role':role,'id':r['id'],'source':p['text'],'reference':p['reference'],'baseline':next(x['translation'] for x in base if x['id']==r['id']),'candidate':next(x['translation'] for x in candidate if x['id']==r['id']),'effects':r['effects'],'first':r['first'],'second':r['second']})
 records=[json.loads(x) for x in (RUN/'requests.jsonl').read_text().splitlines() if x]
 costs={}
 for role in sorted({r['role'] for r in records}):
  group=[r for r in records if r['role']==role];costs[role]={'attempts':len(group),'successful':sum(r['status']=='ok' for r in group),'summedSeconds':round(sum(r['seconds'] for r in group),2),'inputTokens':sum((r.get('usage') or {}).get('input_tokens',0) for r in group),'cachedInputTokens':sum((r.get('usage') or {}).get('cached_input_tokens',0) for r in group),'outputTokens':sum((r.get('usage') or {}).get('output_tokens',0) for r in group),'unknownUsageAttempts':sum(not r.get('usage') for r in group)}
 result={'at':time.time(),'criteriaSource':str(Path('/Users/hans/Desktop/GLOSSARY RESEARCH SPANISH TEST TERMS')),'model':'gpt-6.1-sol subscription','rows':rows,'costsIncludingFailedAndSupersededAttempts':costs,'calibration':{k:v for k,v in read(RUN/'calibration.json').items() if k!='rows'},'limitations':['Prototype, no production glossary writes. Original full safeguards not retired.','Human requirements are supplied to proposal generation and hints-only control; source-only labels precede trial outputs.','All quality judgments are provisional model assessments under frozen human criteria, not human validation.','Production Gnosis matching, hint construction and glossary rules are used with a subscription model and adapted response transport; configured application provider is not tested. Final v4 sends identical neighboring source context to all arms; earlier paragraph-only results are diagnostic.','Diagnostic sample is not a corpus-wide frequency estimate. Unknown/ambiguous and not-run remain visible.','Hooltanpanas has only two source paragraphs and no independent confirmation passage.','One fatal confirmation paragraph has a punctuation-normalized research duplicate, excluded from independent confirmation metrics.','Full frequency/counting, shared-glossary collision and broader historical/random regression equivalence remain unproved; no step removed.','Failed and superseded development calls are included in totals; unknown usage is disclosed. Imported source dictionary cost is not zero and is not yet fully attributed.']}
 result['postConfirmationSelectionDiagnostic']=read(RUN/'selection-contract-diagnostic.json')
 result['postConfirmationSelectionRegression']=read(RUN/'selection-contract-regression.json')
 result['numericFaultControl']=read(RUN/'number-fault-control.json')
 result['sunBoundary']={m:read(RUN/f'sun-boundary-{m}-result.json') for m in ['htn-v3','htn-v4']}
 result['limitations'].append('v5, where present, is a post-confirmation diagnostic/regression on fatal after an exposed failure; it is not a fresh held-out result. Human-hints outputs and their same-context assessment are reused unchanged.')
 result['finalMethod']='htn-v7'
 result['amendedPipeline']=read(RUN/'amended-pipeline.json')
 result['finalChecks']={term:{'blindCheck':read(RUN/'terms'/f'{i:02}'/'blind-end-check.json'),'blindInputAudit':read(RUN/'terms'/f'{i:02}'/'blind-end-check-input-audit.json'),'frequency':{lang:read(RUN/'terms'/f'{i:02}'/'htn-v7'/lang/'frequency.json') for lang in languages}} for i,(term,languages) in enumerate(TERMS,1)}
 result['limitations'].append('Final v7 repair contexts receive existing glossary guidance and source/translation pairs, but not the acceptance rubric, grader verdicts or source labels. Verbatim rubric blocks are stripped. This is rubric blindness, not independent rediscovery of the earlier requirement-aware candidates. Ordering uses two-judge preferred-use counts in an independent uniform sample; unresolved counts remain visible, rare zero-count variants remain, and corpus-wide prevalence is not claimed.')
 write(RUN/'results.json',result);write(RUN/'confirmed-examples.json',examples)
 primary=[r for r in rows if r['method']=='htn-v7']
 lines=['# Seven-term HTN prototype results','',f'Updated {time.strftime("%Y-%m-%d %H:%M:%S UTC",time.gmtime())}. Final frequency-order / rubric-blind-check status: '+('complete' if len(primary)==44 and all(r['complete'] for r in primary) else 'in progress / incomplete')+'.','', 'Fixed criteria: Desktop/GLOSSARY RESEARCH SPANISH TEST TERMS. Primary baseline: translation without glossary. Human-hints-only is a secondary attribution control. Final version is v7; earlier preference-order trials are retained in results.json.','', '| Term | Language | Version | Role | Assessed / expected | Meaning + / − | Policy + / − | Naturalness + / − |','|---|---|---|---|---:|---:|---:|---:|']
 for r in rows:
  if r['arm']!='htn' or r['method']!='htn-v7':continue
  e=r['effects'];lines.append(f'| {r["term"]} | {r["language"]} | {r["method"]} | {r["role"]} | {r["assessed"]} / {r["expected"]} | {e["accuracy"]["gains"]} / {e["accuracy"]["harms"]} | {e["policy"]["gains"]} / {e["policy"]["harms"]} | {e["naturalness"]["gains"]} / {e["naturalness"]["harms"]} |')
 lines+=['','## Evaluator and scope','',f'{result["calibration"]["presentations"]} mirrored fault/acceptable-alternative presentations: '+('passed' if result['calibration']['passed'] else 'failed')+'. Pure engine tests are separate; see htn_core.test.mjs.','']
 lines+=['- '+x for x in result['limitations']]
 lines+=['','## Cost, including failed and superseded attempts','', '| Role | Attempts | Success | Input | Cached input | Output | Unknown usage | Summed seconds |','|---|---:|---:|---:|---:|---:|---:|---:|']
 for k,v in costs.items():lines.append(f'| {k} | {v["attempts"]} | {v["successful"]} | {v["inputTokens"]} | {v["cachedInputTokens"]} | {v["outputTokens"]} | {v["unknownUsageAttempts"]} | {v["summedSeconds"]} |')
 lines+=['','Summed call time is not wall time. Service throttling and timeouts prevent a clean latency comparison. Token totals include Codex runtime overhead; they are not direct estimates of application API cost.','','Detailed statuses, human-hints comparison, independent-confirmation exclusions and structural checks are in results.json. Before/after excerpts with two judgments are in confirmed-examples.json.']
 (RUN/'RESULTS.md').write_text('\n'.join(lines)+'\n')
 print(json.dumps({'completeRows':sum(r['complete'] for r in rows),'totalRows':len(rows),'examples':len(examples),'attempts':len(records)},ensure_ascii=False))
if __name__=='__main__':main()
