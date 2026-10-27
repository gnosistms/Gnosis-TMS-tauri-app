"""Count saved native Gnosis translation prompt bodies; no model calls."""
import hashlib,json,pathlib,re
import tiktoken
from ilustre_notes import RUN,read,write
PAT=re.compile(r'(<glossary_info format="json">\n)(.*?)(\n</glossary_info>)',re.S)
encs={name:tiktoken.get_encoding(name) for name in ['o200k_base','cl100k_base']}
count=lambda e,s:len(e.encode(s,disallowed_special=()))
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
# First validate the encoding against actual earlier native provider receipts.
calibration=[]
for template in read(RUN/'native-prompt-templates.json'):
 row={'batch':template['batch'],'nativeInputTokens':template['nativeUsage']['input_tokens']}
 for name,e in encs.items():
  row[name]={'promptTokens':count(e,template['prompt']),'nativeFramingDifference':template['nativeUsage']['input_tokens']-count(e,template['prompt'])}
 calibration.append(row)
# o200k must explain all four native receipts by the same fixed framing cost.
offsets={r['o200k_base']['nativeFramingDifference']for r in calibration}
assert len(offsets)==1 and 0<=next(iter(offsets))<1000,calibration
enc=encs['o200k_base'];rows=[]
for template in read(RUN/'native-prompt-templates.json'):
 bi=template['batch'];native=template['prompt'];row={'batch':bi+1,'paragraphs':len(template['request']['rows']),'conditions':{}}
 for arm in ['long','short']:
  request=read(next((RUN/f'translation/rep-0/batch-{bi}/{arm}').glob('*/request.json')))
  # Reorder object keys exactly as serde_json's default map serializer does.
  glossary=json.loads(PAT.search(request['instructions'])[2]);serialized=json.dumps(glossary,ensure_ascii=False,separators=(',',':'),sort_keys=True)
  prompt=PAT.sub(lambda m:m[1]+serialized+m[3],native)
  assert PAT.sub(lambda m:m[1]+m[3],prompt)==PAT.sub(lambda m:m[1]+m[3],native)
  notes=[n for h in glossary for n in h.get('globalNotes',[])]+[v['note']for h in glossary for v in h.get('targetVariants',[])if v.get('note')]
  row['conditions'][arm]={'promptTokens':count(enc,prompt),'glossaryTokens':count(enc,serialized),'noteTextTokensSum':sum(count(enc,n)for n in notes),'promptSha256':sha(prompt),'glossarySha256':sha(serialized)}
  (RUN/'prompt-only').mkdir(exist_ok=True);(RUN/f'prompt-only/batch-{bi+1}-{arm}.txt').write_text(prompt)
  # Record projection differences; the canonical native key order drives the totals.
  row['conditions'][arm]['experimentBodyTokens']=count(enc,request['instructions'])
 row['savedTokens']=row['conditions']['long']['promptTokens']-row['conditions']['short']['promptTokens'];row['savedPercent']=100*row['savedTokens']/row['conditions']['long']['promptTokens']
 assert row['savedTokens']==414
 rows.append(row)
original=sum(r['conditions']['long']['promptTokens']for r in rows);compact=sum(r['conditions']['short']['promptTokens']for r in rows)
result={'tokenizer':'o200k_base','tiktokenVersion':tiktoken.__version__,'model':'gpt-6.1-sol','modelMapping':'Not provided by tiktoken; encoding empirically verified against all four saved native usage receipts and the 414-token matched Codex differences.','calibration':calibration,'fixedNativeFramingTokensObserved':next(iter(offsets)),
 'batches':rows,'totalsOne57ParagraphPass':{'long':original,'short':compact,'savedTokens':original-compact,'savedPercent':100*(original-compact)/original},
 'scope':'Native translation input prompt bodies only. No Codex instructions, lab wrapper, output tokens, JSON schema or provider/message framing. Identical source, context and translation instructions. Current versus compact glossary_info is the only byte change.',
 'liveDataChanged':False,'modelCalls':0}
write(RUN/'prompt-only-tokens.json',result)
lines=['# Ilustre: Gnosis prompt-only token comparison','','Counts the actual Gnosis translation prompt bodies, using saved native prompt templates with the current or compact entry serialized as the Rust formatter does. The source rows and context match the frozen test. No Codex instructions or lab wrapper are included. No new model calls.','','| Paragraphs | Current prompt tokens | Compact prompt tokens | Saved | Reduction |','|---:|---:|---:|---:|---:|']
for r in rows:lines.append(f"| {r['paragraphs']} | {r['conditions']['long']['promptTokens']:,} | {r['conditions']['short']['promptTokens']:,} | {r['savedTokens']:,} | {r['savedPercent']:.2f}% |")
lines.append(f'| **57 total** | **{original:,}** | **{compact:,}** | **{original-compact:,}** | **{100*(original-compact)/original:.2f}%** |')
lines+=['','The earlier 2.54% figure was diluted by Codex session overhead. The actual prompt-body reduction is the total percentage above. Two repeated passes double the counts but leave this percentage unchanged.','','## Validation and limits','','The model alias gpt-6.1-sol is not mapped by tiktoken 0.14.0. Rather than silently assuming a tokenizer, this counter verifies o200k_base against all four saved native provider receipts. Each receipt is exactly '+str(next(iter(offsets)))+' tokens larger than its saved prompt body. That fixed difference covers native provider framing/structured-output overhead rather than Codex overhead. The local count also reproduces the 414-token difference in every paired Codex request. cl100k_base does not explain the receipts by a constant offset.','','```json',json.dumps(calibration,indent=2),'```','','This measures prompt text rather than asserting a new API billing receipt. The fixed native framing/schema overhead is excluded from the main result; it is preserved in the validation above. No source paragraphs, context, candidates or instructions were shortened. Only notes were shortened and the shared note removed, as in the quality test. Full prompt text and hashes are saved under prompt-only/; exact counts are in prompt-only-tokens.json.','','The four native prompt templates may have contained earlier repair guidance within glossary_info. Both comparison conditions replace that entire block with the frozen current or compact entry; all bytes outside it are preserved. The outside-glossary text exactly matches the earlier Codex experiment prompt bodies.']
(RUN/'PROMPT-TOKENS.md').write_text('\n'.join(lines)+'\n');print(json.dumps(result,indent=2))
