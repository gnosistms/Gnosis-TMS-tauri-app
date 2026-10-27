/** Source-derived inventory and fresh blind entry assessment, never router input. */
import {hash,checkIds} from './protocol.mjs';
import {framesFor} from './adaptive.mjs';
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},arr=items=>({type:'array',items});
const inventorySchema=obj({requirements:arr(obj({id:str,kind:{type:'string',enum:['sense','grammar','provenance']},labelSpanish:str,descriptionEnglish:str,evidenceIds:arr(str)})),limitations:arr(str)});
const grade={type:'string',enum:['covered','material_gap','uncertain']};
const gradeSchema=obj({items:arr(obj({id:str,A:grade,B:grade,reason:str}))});
export async function assessCompleteness({index,evidence,reference,candidate,sourceProvenance,seed,call,write,read,dir,method,referenceMethod}){
 const root=`${dir}/completeness/vs-${referenceMethod}`,file=`${root}/${method}/result.json`;if(read(file))return;
 const sourceDir=`${dir}/completeness/source`,heldIds=new Set(evidence.evaluation.map(p=>String(p.itemId)));
 const extra=evidence.research.filter(p=>!heldIds.has(String(p.itemId))).sort((a,b)=>hash(`${seed}:inventory:${a.text}`).localeCompare(hash(`${seed}:inventory:${b.text}`))).slice(0,Math.max(0,100-evidence.evaluation.length));
 const frames=framesFor([...evidence.evaluation,...extra]),books=sourceProvenance??[];
 const source={term:evidence.term,forms:evidence.forms,frames,sourceBooks:books.map((b,i)=>({id:`book:${i}`,...b}))};
 let inventory=read(`${sourceDir}/inventory.json`);
 if(!inventory){const answer=await call({term:evidence.term,method:'source-inventory',stage:'completeness-inventory',purpose:'independent source-only sense/grammar/provenance requirements',effort:'medium',schema:inventorySchema,
   instructions:'Independently describe the materially distinct meanings and grammatical uses of the Spanish headword actually supported by these source windows. No glossary or research conclusions are supplied. Produce concise Spanish labels and English descriptions, never Vietnamese translations. Distinguish ordinary, specialized and rare meanings when source evidence supports them. Source-book pairs/original passages can establish a terminology relationship, not first coinage, exclusivity or direct borrowing by themselves. Include a provenance requirement only when the evidence supports a specialized relationship important to interpreting the term. Every requirement needs at least one supplied passage or book id. Do not invent senses from unrelated nearby words, infer relative frequency from a purposive sample or demand every possible dictionary meaning. A truncated ambiguous window is insufficient: record uncertainty. Include meaningful requirements only, without duplicates.',content:JSON.stringify(source)},`${sourceDir}/calls`,'completeness');
  inventory=JSON.parse(answer.text);const known=new Set([...frames.map(f=>f.id),...books.map((_,i)=>`book:${i}`)]);
  if(new Set(inventory.requirements.map(r=>r.id)).size!==inventory.requirements.length||inventory.requirements.some(r=>!r.evidenceIds.length||r.evidenceIds.some(id=>!known.has(id))))throw new Error('Invalid source inventory evidence ids');
  write(`${sourceDir}/source.json`,source);write(`${sourceDir}/inventory.json`,inventory);
 }
 const swapped=parseInt(hash(`${seed}:${index}:entry-completeness`).slice(0,8),16)%2===1,candidateSide=swapped?'A':'B';
 const content={source,requirements:inventory.requirements,glossaryA:swapped?candidate.entries:reference.entries,glossaryB:swapped?reference.entries:candidate.entries};
 const instructions='Independently assess both Spanish → Vietnamese glossary entries against each source-derived requirement. You have not seen the search or research process and do not know which method produced either glossary. Grade covered if at least one usable natural target and adequate context guidance expresses the evidenced meaning/category; equivalent good wordings are equally covered. Grade material_gap only for a clear missing meaning, wrong semantic category, unusable/misleading target, or missing supported specialized provenance relationship required to interpret the term. Do not require the same target wording or number/order of variants. A broad target is sufficient if it faithfully expresses the idea; unwarranted narrowing is a gap. Notes can distinguish grammatical uses without separate rows. Origin caveats are appropriate, not gaps. Unsupported or ambiguous requirements should be uncertain. Return every requirement id exactly once and explain concrete gaps from source evidence, without invented frequency claims.';
 const first=JSON.parse((await call({term:evidence.term,method,stage:'completeness-blind',purpose:'blind entry completeness assessment',effort:'medium',schema:gradeSchema,instructions,content:JSON.stringify(content)},`${root}/${method}/calls`,'completeness')).text).items;
 checkIds(first,inventory.requirements.map(r=>r.id));
 const flagged=first.filter(r=>r.A==='material_gap'||r.B==='material_gap');let second=[];
 if(flagged.length){const check={...content,requirements:inventory.requirements.filter(r=>flagged.some(f=>f.id===r.id)),glossaryA:content.glossaryB,glossaryB:content.glossaryA};
  second=JSON.parse((await call({term:evidence.term,method,stage:'completeness-confirm',purpose:'fresh blind check of all material completeness gaps',effort:'medium',schema:gradeSchema,instructions,content:JSON.stringify(check)},`${root}/${method}/confirmation-calls`,'completeness')).text).items;
  checkIds(second,flagged.map(r=>r.id));}
 const rows=first.map(r=>{const check=second.find(c=>c.id===r.id),result={...r,candidateSide};for(const side of ['A','B'])if(r[side]==='material_gap'&&check?.[side==='A'?'B':'A']!=='material_gap')result[side]='uncertain';return {...result,secondCheck:check??null};});
 write(file,{inventoryRequirements:inventory.requirements.length,sourcePassages:frames.length,candidateSide,rows,referenceMethod,method,
  note:'Source inventory is sampled, not exhaustive. Independent means fresh contexts, not different model families. Material gaps require fresh confirmation.'});
}
