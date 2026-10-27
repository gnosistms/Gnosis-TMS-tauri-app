"""Summarize receipts and retain every blinded source/translation pair for audit."""
import collections,json,pathlib,statistics
from ilustre_notes import RUN,read,write,digest
records=[json.loads(l) for l in (RUN/'requests.jsonl').read_text().splitlines()]
input=read(RUN/'input.json');pairs=read(RUN/'blind/packets.json');mapping={m['id']:m for m in read(RUN/'blind/mapping.json')}
primary=[g for p in sorted((RUN/'judging').glob('primary-*/grades.json')) for g in read(p)]
assert len(primary)==len(pairs)==114
confirmation={g['id']:g for p in (RUN/'judging').glob('confirmation-*/grades.json') for g in read(p)}
metrics={}
for arm in ['long','short']:
 rows=[r for r in records if r['role']=='evaluation' and r['method']=='notes-'+arm and r['status']=='ok']
 assert len(rows)==8
 metrics[arm]={'calls':len(rows),'seconds':sum(r['seconds'] for r in rows),'inputTokens':sum(r['usage']['input_tokens'] for r in rows),'cachedInputTokens':sum(r['usage'].get('cached_input_tokens',0) for r in rows),'outputTokens':sum(r['usage']['output_tokens'] for r in rows)}
 metrics[arm]['totalTokens']=metrics[arm]['inputTokens']+metrics[arm]['outputTokens']
paired=[]
for rep in range(2):
 for batch in range(4):
  rows={r['method']:r for r in records if r['role']=='evaluation' and r['stage']==f'rep-{rep}-batch-{batch}' and r['status']=='ok'}
  a,b=rows['notes-long'],rows['notes-short'];paired.append({'rep':rep,'batch':batch,'paragraphs':len(input['batches'][batch]),'longSeconds':a['seconds'],'shortSeconds':b['seconds'],'secondsSaved':a['seconds']-b['seconds'],'inputSaved':a['usage']['input_tokens']-b['usage']['input_tokens']})
counts={k:collections.Counter() for k in ['accuracyLong','accuracyShort','naturalnessLong','naturalnessShort','accuracyWinner','naturalnessWinner']}
reviews=[]
for packet in pairs:
 id=packet['id'];m=mapping[id];short=m['shortSide'];long='B' if short=='A' else 'A';g=next(x for x in primary if x['id']==id);c=confirmation.get(id)
 for dimension in ['accuracy','naturalness']:
  for arm,side in [('Long',long),('Short',short)]:counts[dimension+arm][g[dimension+side]]+=1
  winner=g[dimension+'Winner'];counts[dimension+'Winner']['short' if winner==short else 'long' if winner==long else winner]+=1
 reviews.append({'id':id,'paragraphId':m['paragraphId'],'rep':m['rep'],'source':packet['source'],'context':packet['sourceContext'],'long':packet[long],'short':packet[short],
  'primary':{'accuracyLong':g['accuracy'+long],'accuracyShort':g['accuracy'+short],'naturalnessLong':g['naturalness'+long],'naturalnessShort':g['naturalness'+short], 'accuracyWinner':'short' if g['accuracyWinner']==short else 'long' if g['accuracyWinner']==long else g['accuracyWinner'],'reason':g['reason']},
  'confirmationReversed':c})
judges=[r for r in records if r['role']=='judge' and r['status']=='ok']
result={'translation':metrics,'paired':paired,'primaryQuality':{k:dict(v) for k,v in counts.items()},'confirmationCount':len(confirmation),
 'judgingOverhead':{'calls':len(judges),'seconds':sum(r['seconds'] for r in judges),'inputTokens':sum(r['usage']['input_tokens'] for r in judges),'outputTokens':sum(r['usage']['output_tokens'] for r in judges)},
 'unchangedLiveFiles':{p:digest(p)==h for p,h in input['liveFiles'].items()}}
write(RUN/'comparison.json',result);write(RUN/'paired-review.json',reviews)
lines=['# Ilustre notes: controlled Codex comparison','','Two repetitions of the same 57 paragraphs per condition. Same gpt-6.1-sol model, low reasoning, candidate text/order, source and source neighbors. Four batches of 15/15/15/12 in each repetition. Alternating/reversed condition order; sequential execution. Translation and judge sessions are isolated and subscription-only.','','| Measure, both repetitions | Current | Compact | Savings |','|---|---:|---:|---:|']
for key,label in [('inputTokens','Input tokens'),('cachedInputTokens','Cached input tokens (included above)'),('outputTokens','Output tokens'),('totalTokens','Input + output tokens'),('seconds','Summed request seconds')]:
 a,b=metrics['long'][key],metrics['short'][key];saved=a-b;percent=f'{saved/a*100:.2f}%' if a else 'n/a';lines.append(f'| {label} | {a:,.3f} | {b:,.3f} | {saved:,.3f} ({percent}) |')
lines+=['','Times include Codex CLI/runtime and service latency. These are not native Gnosis API timings. Input usage includes the fixed Codex session overhead and source context, so the whole-request percentage is smaller than the note-only percentage. No monetary cost is inferred from subscription tokens. Output tokens include any reasoning tokens counted by the CLI.','','## Quality review','','Source-based blinded review, not compliance with the long note. Calibration has two deliberate semantic errors (verb/adjective and invented noble birth) plus an identical correct pair. Any flagged material error or clear fluency defect receives a fresh independent review with A/B reversed. The final source review is recorded separately below.','', '```json',json.dumps(result['primaryQuality'],indent=2),'```','','## Paired request timings','','| Repetition | Batch | Paragraphs | Current seconds | Compact seconds | Saved seconds |','|---|---|---:|---:|---:|---:|']
for p in paired:lines.append(f"| {p['rep']+1} | {p['batch']+1} | {p['paragraphs']} | {p['longSeconds']:.3f} | {p['shortSeconds']:.3f} | {p['secondsSaved']:.3f} |")
lines+=['','## Compact candidate notes','','**distinguished:** '+input['compactNotes'][0],'','**enlighten:** '+input['compactNotes'][1],'','The compact condition omits the shared general note. This measures the combined reduction, not shortening only one candidate note. Both conditions retain current repetition of candidate notes across ilustre and ilustres.','','## Review records','','All 114 pairs, context, blinded grades and reversed confirmation grades are saved in `paired-review.json`. Raw prompts, answers and token receipts are under `translation/` and `judging/`. `comparison.json` contains exact machine-readable totals. The two live source files match their initial hashes: '+str(all(result['unchangedLiveFiles'].values()))+'.','','Reviewer overhead, excluded from translation savings: '+json.dumps(result['judgingOverhead'])+'.','','## Final source review and limitations','','Pending final inspection. Do not treat a reviewer flag or fluency preference alone as proven loss caused by shortening. Two generations per condition and one word cannot establish a universal length rule.']
(RUN/'REPORT.md').write_text('\n'.join(lines)+'\n')
print(json.dumps(result,indent=2))
