"""External reconciliation of the blind runtime; never imported by it."""
import json,re,time
from pathlib import Path
from collections import Counter
HERE=Path(__file__).resolve().parent
RUN=HERE/'runs/2026-10-14-htn-blind';OLD=HERE/'runs/2026-10-14-htn'
def read(p):return json.loads(p.read_text()) if p.exists() else None
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def metrics(rows):
 return {dim:{'gains':sum(r['effects'][dim]==1 for r in rows),'harms':sum(r['effects'][dim]==-1 for r in rows),'tiesOrUnconfirmed':sum(r['effects'][dim]==0 for r in rows),'candidateStatuses':dict(Counter(r['first'][dim+r['first']['candidateSide']] for r in rows))} for dim in ['accuracy','policy','naturalness']}
def costs(root):
 records=[json.loads(x) for x in (root/'requests.jsonl').read_text().splitlines()] if (root/'requests.jsonl').exists() else []
 return {role:{'attempts':len(g),'successful':sum(r['status']=='ok' for r in g),'inputTokens':sum((r.get('usage') or {}).get('input_tokens',0) for r in g),'cachedInputTokens':sum((r.get('usage') or {}).get('cached_input_tokens',0) for r in g),'outputTokens':sum((r.get('usage') or {}).get('output_tokens',0) for r in g),'unknownUsageAttempts':sum(not r.get('usage') for r in g),'summedCallSeconds':round(sum(r['seconds'] for r in g),2)} for role in sorted({r['role'] for r in records}) for g in [[r for r in records if r['role']==role]]}
def text_values(v):
 if isinstance(v,str):yield v
 elif isinstance(v,list):
  for x in v:yield from text_values(x)
 elif isinstance(v,dict):
  for x in v.values():yield from text_values(x)
def norm(s):return re.sub(r'\W+','',s.casefold())
def main():
 manifest=read(RUN/'manifest.json');criteria=read(OLD/'requirements.json');rows=[];examples=[];exposure={};audit=[]
 for i,t in enumerate(manifest['terms'],1):
  d=RUN/'terms'/f'{i:02}';source=read(d/'source.json');old=read(OLD/'terms'/f'{i:02}'/'input.json');frozen=read(d/'research-frozen.json');term=source['term'];requests=[]
  for f in d.glob('calls/*/*/request.json'):
   q=read(f);requests.append(q)
   body=q.get('content','');leaks=[name for name,value in criteria.items() if value in body or value in q.get('instructions','')]
   keys=[k for k in ['humanRequirements','sourceJudgments','expectedTargets','acceptanceCriteria','MANDATORY PROJECT CONSTRAINTS'] if k in body]
   audit.append({'term':term,'stage':q['stage'],'rubricMatches':leaks,'forbiddenMarkers':keys})
  source_strings=[norm(s) for q in requests if not q['stage'].startswith(('frequency','final-translation','final-source-only')) for s in text_values(json.loads(q['content'])) if len(s)>40]
  exposed=[str(p['itemId']) for p in old['test'] if p['role']=='confirmation' and any(norm(p['text']) in s for s in source_strings)]
  exposure[term]={'confirmationExposedIds':exposed,'method':'Normalized complete passage containment in actual research/development request strings, including neighbors and original/retrieval metadata; partial excerpts are not counted as complete exposure.'}
  for lang in source['languages']:
   records=read(OLD/'terms'/f'{i:02}'/'htn-blind-v1'/lang/'htn-assessment-all.json') or [];saved=read(d/lang/'saved-glossary.json') or read(d/lang/'unsorted-glossary.json');inv=frozen['source']['inventory'] if frozen else None;checks={}
   if saved:
    field=saved['terms'][0];targets=field['targetTerms'];notes=field['notesToTranslators'];forms={s.casefold() for s in field['sourceTerms']}
    if i==1:checks['planet_available']=any(('planet' if lang=='en' else 'hành tinh') in x.casefold() for x in targets)
    if i==2:checks['related_suprasensible']=any('supra' in x['term'].casefold() for x in inv['relatedStudies'])
    if i==3:checks['related_vanidoso']=any('vanidos' in x['term'].casefold() for x in inv['relatedStudies'])
    if i==4:checks={'canonical_name':'Hooltanpanas' in targets,'source_forms':{'hooltanpanas','hooltampanas'}<=forms,'gurdjieff_in_general_notes':'gurdjieff' in notes.casefold()}
    if i==5:checks={'canonical_singular':any(x.casefold()=='hasnamuss' for x in targets),'prescribed_plural':any(x.casefold()=='hasnamussen' for x in targets),'gurdjieff_in_general_notes':'gurdjieff' in notes.casefold(),'hanasmussen_match':'hanasmussen' in forms,'janasmussen_match':'janasmussen' in forms}
    if i==7:checks={'prescribed_noun':any(x.casefold()==('Innermost' if lang=='en' else 'Đấng Nội Tại').casefold() for x in targets),'dayspring_in_general_notes':'dayspring of youth' in notes.casefold()}
   frequency=read(d/lang/'frequency.json');row={'index':i,'term':term,'language':lang,'expected':len(old['test']),'assessed':len(records),'complete':len(records)==len(old['test']) and {r['id'] for r in records}=={str(p['itemId']) for p in old['test']},'metrics':metrics(records),'structuralChecks':checks,'verification':read(d/'final-self-verification.json'),'frequency':{k:frequency[k] for k in ['sampleParagraphs','totalOccurrences','confirmedAssigned','countsBeforeSort','order','sparseOverlap']} if frequency else None,'targets':saved['terms'][0]['targetTerms'] if saved else [],'unresolvedResearchCount':len(frozen['unresolved']) if frozen else None};rows.append(row)
   baseline=read(OLD/'terms'/f'{i:02}'/'context-baseline'/lang/'no-glossary.json');candidate=read(d/f'final-translation-{lang}.json')
   for r in records:
    if any(r['effects'].values()):
     p=next(p for p in old['test'] if str(p['itemId'])==r['id']);examples.append({'term':term,'language':lang,'role':p['role'],'id':r['id'],'source':p['text'],'reference':p['reference'],'baseline':next(x['translation'] for x in baseline if x['id']==r['id']),'candidate':next(x['translation'] for x in candidate if x['id']==r['id']),'effects':r['effects'],'first':r['first'],'second':r['second']})
 result={'method':'htn-blind-v1','complete':all(r['complete'] for r in rows),'rows':rows,'exposure':exposure,'isolationAudit':{'requests':len(audit),'passed':all(not a['rubricMatches'] and not a['forbiddenMarkers'] for a in audit),'violations':[a for a in audit if a['rubricMatches'] or a['forbiddenMarkers']],'limitation':'Exact rubric/marker audit plus fresh contexts and disabled tools; source acquisition and general design were informed by prior human cases. Original-book candidate mappings are unverified retrieval metadata, not acceptance requirements.'},'blindRuntimeCosts':costs(RUN),'externalAndSupersededCosts':costs(OLD),'calibration':{k:v for k,v in read(OLD/'calibration.json').items() if k!='rows'},'limits':['No production changes and no original safeguard retired.','No matched cold-run speed/token comparison; imported evidence acquisition costs are not fully attributed.','Sample preferred-use frequency is not exhaustive corpus prevalence or correctness.','Source-unseen confirmation is separate from rubric blindness; overlaps are disclosed.','Configured app model, shared-glossary collisions and broader historical/random regressions remain untested in this corrected regime.','Quality verdicts are provisional model judgments under human criteria; contested cases require human review.']}
 write(RUN/'results.json',result);write(RUN/'confirmed-examples.json',examples)
 lines=['# Criteria-blind HTN benchmark','',f'Updated {time.strftime("%Y-%m-%d %H:%M:%S UTC",time.gmtime())}. Status: '+('complete' if result['complete'] else 'in progress; missing assessments are not passes')+'.','','The human criteria are supplied only to the external evaluator after HTN results freeze. The primary baseline is identical-source, identical-neighbor translation with no glossary. Earlier criterion-aware v4/v7 results are superseded diagnostics.','','| Term | Language | Assessed / expected | Meaning gains / harms | Policy gains / harms | Naturalness gains / harms | Structural checks |','|---|---|---:|---:|---:|---:|---|']
 for r in rows:
  m=r['metrics'];failed=[k for k,v in r['structuralChecks'].items() if not v];lines.append(f'| {r["term"]} | {r["language"]} | {r["assessed"]} / {r["expected"]} | {m["accuracy"]["gains"]} / {m["accuracy"]["harms"]} | {m["policy"]["gains"]} / {m["policy"]["harms"]} | {m["naturalness"]["gains"]} / {m["naturalness"]["harms"]} | '+(', '.join(failed) if failed else 'pass' if r['structuralChecks'] else 'none / pending')+' |')
 lines+=['','Gains/harms require agreement from two independently ordered assessments. Ties include unconfirmed differences; both sides failing is no improvement. A structural pass is not a translation-quality pass.','','Isolation audit: '+str(result['isolationAudit']['requests'])+' saved runtime requests; '+('passed' if result['isolationAudit']['passed'] else 'FAILED')+'. See results.json for scope, exposure, frequency uncertainty and per-language status.','','## Limits','']+['- '+s for s in result['limits']]
 lines+=['','## Recorded cost','', '| Regime | Role | Attempts | Input tokens | Cached | Output | Unknown usage |','|---|---|---:|---:|---:|---:|---:|']
 for regime,key in [('Blind runtime','blindRuntimeCosts'),('External + superseded','externalAndSupersededCosts')]:
  for role,c in result[key].items():lines.append(f'| {regime} | {role} | {c["attempts"]} | {c["inputTokens"]} | {c["cachedInputTokens"]} | {c["outputTokens"]} | {c["unknownUsageAttempts"]} |')
 lines+=['','Detailed source/output pairs and both judgments: confirmed-examples.json. All failed/superseded attempts are retained; summed call time is not wall time.']
 (RUN/'RESULTS.md').write_text('\n'.join(lines)+'\n');print(json.dumps({'complete':result['complete'],'assessed':sum(r['assessed'] for r in rows),'expected':sum(r['expected'] for r in rows),'requestsAudited':len(audit),'isolationPassed':result['isolationAudit']['passed']}))
if __name__=='__main__':main()
