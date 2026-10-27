/** Frozen source-only adaptive research policy. No glossary or evaluation outcomes. */
import {hash} from './protocol.mjs';
export const POLICY=Object.freeze({version:'adaptive-v1',initialContexts:12,scoutCap:384,windowRadius:90,
 noveltySimilarity:0.18,noveltyFraction:0.15,minNovelContexts:3,maxBooks:3,originalContextsPerBook:2,maxDictionaryCharacters:6000});
const fold=s=>String(s??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const normalized=s=>String(s??'').normalize('NFC').replace(/\s+/gu,' ').trim().toLowerCase();
const stop=new Set('a al algo ante aquel aquella asi aun cada como con cual cuando de del desde donde dos el ella en entre era es esa ese esta este esto fue ha hasta hay la las le lo los mas me mi muy ni no nos o otra otro para pero poco por porque que se ser si sin sino sobre son su sus tan tanto te todo todos tu tus un una uno unos y ya yo'.split(' '));
export const framesFor=(items)=>items.map(p=>({id:String(p.itemId),reference:p.reference?.title??'',
 windows:(p.occurrences??[]).slice(0,2).map(o=>p.text.slice(Math.max(0,o.start-POLICY.windowRadius),Math.min(p.text.length,o.end+POLICY.windowRadius)))}));
function vector(p,forms){const counts=new Map(),skip=new Set(forms.flatMap(f=>fold(f).split(/\s+/u)));
 for(const w of fold(framesFor([p])[0].windows.join(' ')).match(/[a-zñ]+/gu)??[])if(w.length>2&&!stop.has(w)&&!skip.has(w))counts.set(w,(counts.get(w)??0)+1);
 const norm=Math.sqrt([...counts.values()].reduce((n,v)=>n+v*v,0))||1;return new Map([...counts].map(([k,v])=>[k,v/norm]));}
const cosine=(a,b)=>[...a].reduce((n,[k,v])=>n+v*(b.get(k)??0),0);
export function coverageSignal(pool,selected,forms){
 const seen=new Set(selected.map(p=>hash(p.text))),sv=selected.map(p=>vector(p,forms));
 const scored=pool.map(p=>({p,similarity:Math.max(0,...sv.map(v=>cosine(vector(p,forms),v)))}));
 const novel=scored.filter(x=>!seen.has(hash(x.p.text))&&x.similarity<POLICY.noveltySimilarity);
 return {trigger:pool.length>POLICY.initialContexts&&novel.length>=POLICY.minNovelContexts&&novel.length/pool.length>=POLICY.noveltyFraction,
  novelContexts:novel.length,available:pool.length,novelFraction:pool.length?novel.length/pool.length:0,
  rankedNovel:novel.sort((a,b)=>a.similarity-b.similarity||hash(a.p.text).localeCompare(hash(b.p.text))).map(x=>x.p)};
}
export function scoutPool(pool,signal,seed){
 if(pool.length<=POLICY.scoutCap)return pool;
 const chosen=signal.rankedNovel.slice(0,POLICY.scoutCap/2),seen=new Set(chosen.map(p=>hash(p.text)));
 const remaining=pool.filter(p=>!seen.has(hash(p.text))).sort((a,b)=>hash(`${seed}:${a.text}`).localeCompare(hash(`${seed}:${b.text}`)));
 return [...chosen,...remaining.slice(0,POLICY.scoutCap-chosen.length)];
}
const locations=p=>[p.reference,...(p.copies??[])].filter(Boolean).map(r=>({doc:(r.url??'').split('?')[0]||r.title,chapter:r.chapter??'',paragraph:Number(r.paragraph)}));
export function passageExcluded(p,evaluation){const text=normalized(p.text),loc=locations(p);
 return evaluation.some(h=>{const held=normalized(h.text);return text.includes(held)||held.includes(text)||loc.some(a=>locations(h).some(b=>a.doc&&a.doc===b.doc&&a.chapter===b.chapter&&Number.isFinite(a.paragraph)&&Number.isFinite(b.paragraph)&&Math.abs(a.paragraph-b.paragraph)<=1));});}
export function splitLocations(items,seed,n=40){const distinct=[...new Map(items.map(p=>[hash(p.text),p])).values()].sort((a,b)=>hash(`${seed}:${a.text}`).localeCompare(hash(`${seed}:${b.text}`)));
 const evaluation=distinct.slice(0,n),research=distinct.filter(p=>!passageExcluded(p,evaluation));
 const overlap=distinct.length<=n?evaluation.length:0;
 return {evaluation,research:overlap?distinct:research,overlap,holdoutPolicy:'source-location-and-containment',excludedNeighbours:distinct.length-evaluation.length-research.length};}
export function cliticCandidates(forms){const out=new Set();for(const f of forms){const w=f.toLowerCase();if(/(?:ar|er|ir)$/u.test(w))for(const suffix of ['me','te','se','nos','os','lo','la','los','las'])out.add(w+suffix);}return [...out];}
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},arr=items=>({type:'array',items});
const entrySchema=obj({entries:arr(obj({id:str,kind:{type:'string',enum:['word','expression']},sourceTerms:arr(str),generalNote:str,variants:arr(obj({id:str,target:str,note:str}))})),risks:arr(str)});
const proposalSchema=obj({...entrySchema.properties,routing:obj({needsCoverage:{type:'boolean'},needsDictionary:{type:'boolean'},reason:str})});
const instructions='Research Spanish → Vietnamese terminology for Samael Aun Weor from the supplied raw evidence. Produce concise portable glossary entries, preserving every supported distinct meaning, grammatical category and lexical distinction. Use natural contemporary Vietnamese. Prefer 1–3 materially different translations per meaning with Vietnamese usage notes of at most 12 words. Include only corpus-confirmed source forms. Rare supported senses must remain available. Avoid false friends, explanatory paraphrases and invented compounds. Preserve proper names; never invent expansions of initials. Do not bake contextual adjectives into the headword or substitute a defining/comparing concept for the word it explains. Do not correct source typos or source beliefs. Retain a broad category translation alongside a contextual subtype where other uses can exceed that subtype. Source-book provenance is fallible evidence, never a ready-made Vietnamese translation: distinguish printed pairs, machine alignments and matching original passages. State the supported original term and book in generalNote for specialized uses, without claiming first coinage, exclusive origin or direct borrowing without proof. Dictionary meanings require corpus support. Keep factual uncertainties explicit in risks.';
async function provenance(corpus,evidence,seed){const started=Date.now(),sources=[],failures=[];
 try{const pairs=await corpus.originalTerms(evidence.forms);if(pairs===null)failures.push('original-term endpoint unavailable');
 const sorted=(pairs??[]).sort((a,b)=>Number(b.basis==='printed')-Number(a.basis==='printed')||(b.originalCount??0)-(a.originalCount??0));
 const seen=new Set();for(const pair of sorted){if(!pair.bookId||seen.has(pair.bookId))continue;seen.add(pair.bookId);
  try{const original=await corpus.originalSample(pair.bookId,[pair.original,...pair.originalForms],seed,POLICY.originalContextsPerBook);
   if(original.items.length)sources.push({pair,original_passages:original.items.map(p=>({text:p.text,clipped:p.clipped}))});
  }catch(e){failures.push(e.message);}if(sources.length===POLICY.maxBooks)break;}
 }catch(e){failures.push(e.message);}return {sources,failures,seconds:(Date.now()-started)/1000};}
async function spanishDictionary(evidence,fetchImpl){const started=Date.now(),attempts=[];
 const lemmas=[...new Set([evidence.term.toLowerCase(),...evidence.forms.filter(f=>f.length<evidence.term.length).sort((a,b)=>a.length-b.length)])].slice(0,2);
 for(const lemma of lemmas){const url=new URL('https://es.wiktionary.org/w/api.php');url.search=new URLSearchParams({action:'parse',page:lemma,prop:'wikitext',format:'json'});
  try{const response=await fetchImpl(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const raw=await response.json(),text=raw.parse?.wikitext?.['*']??'';
   const at=text.search(/^==\s*\{\{lengua\|es\}\}\s*==/mu);if(at<0)throw new Error('No Spanish section');
   const section=text.slice(at).split(/\n==\s*\{\{lengua\|/u)[0].split(/\n====\s*Traducciones\s*====/u)[0];if(!/;\d+/u.test(section))throw new Error('No numbered definitions');
   return {text:`Published Spanish Wiktionary (CC BY-SA 4.0), https://es.wiktionary.org/wiki/${encodeURIComponent(lemma)}:\n${section.slice(0,POLICY.maxDictionaryCharacters)}`,lemma,attempts,seconds:(Date.now()-started)/1000,sourceHash:hash(section),truncated:section.length>POLICY.maxDictionaryCharacters};
  }catch(e){attempts.push({lemma,error:e.message});}}
 return {text:'',attempts,seconds:(Date.now()-started)/1000};}
export async function runAdaptive({evidence,corpus,model,write,dest,seed,fetchImpl=fetch}){
 const started=Date.now(),pool=evidence.research,selected=pool.slice(0,POLICY.initialContexts);
 const source=await provenance(corpus,evidence,seed);write(`${dest}/source-provenance.json`,source);
 if(!pool.length){write(`${dest}/entry.json`,{entries:[],risks:['No independent research passages'],status:'no-research-texts',wallSeconds:(Date.now()-started)/1000});return;}
 const payload=(items,dictionary='')=>({term:evidence.term,corpusForms:evidence.forms,dictionary,passages:items.map(p=>({text:p.text,reference:p.reference?.title??''})),sourceProvenance:source.sources});
 const initial=JSON.parse((await model.call({stage:'adaptive-initial',purpose:'one compact proposal with generic routing signals',effort:'medium',schema:proposalSchema,
  instructions:instructions+' Set needsCoverage only for a concrete unresolved source meaning or grammatical use that more corpus contexts could resolve. Set needsDictionary only for an unresolved lexical/category distinction. Do not request more work solely because there are several valid translations, a term is frequent, or a historical assertion cannot be proven. Give a brief concrete routing reason. All currently supplied source passages may already be the entire available sample.',content:JSON.stringify(payload(selected))})).text);
 write(`${dest}/initial.json`,initial);
 const signal=coverageSignal(pool,selected,evidence.forms),reasons=[];
 if(initial.routing.needsCoverage)reasons.push('proposal requests source coverage');
 if(initial.routing.needsDictionary)reasons.push('proposal requests dictionary');
 if(signal.trigger)reasons.push('unrepresented source-context diversity');
 const escalate=pool.length>selected.length&&reasons.length>0;
 const dictionaryOnly=!escalate&&initial.routing.needsDictionary;
 const route={policy:POLICY,branch:escalate?'coverage':dictionaryOnly?'dictionary':'compact',reasons,proposalDecision:initial.routing,
  novelty:{available:signal.available,novelContexts:signal.novelContexts,novelFraction:signal.novelFraction},sourceBooks:source.sources.length,sourceLookupSeconds:source.seconds,scoutPopulation:pool.length,scoutSampled:0};
 write(`${dest}/route.json`,route);
 let final=initial;
 if(escalate||dictionaryOnly){const dictionary=await spanishDictionary(evidence,fetchImpl);write(`${dest}/dictionary.json`,dictionary);let items=selected;
  if(escalate){const sampled=scoutPool(pool,signal,seed);route.scoutSampled=sampled.length;
   const scout=JSON.parse((await model.call({stage:'adaptive-coverage',purpose:'source-only sense coverage and context selection',effort:'medium',schema:obj({meanings:arr(obj({labelSpanish:str,evidenceIds:arr(str)})),selectedIds:arr(str),uncertainties:arr(str)}),
    instructions:'Survey these Spanish headword windows. Identify materially different evidenced meanings and grammatical uses, including rare clear senses. Use Spanish labels; do not propose Vietnamese translations. Choose at most twelve distinct supplied passage ids to cover the meanings and useful contrasts. Dictionary definitions are fallible; distinguish definitions not observed here. Do not infer meanings from unrelated nearby words. Windows can be insufficient: record uncertainty. Avoid filling the budget with repeated dominant uses. Every evidence/selected id must be supplied.',
    content:JSON.stringify({term:evidence.term,forms:evidence.forms,sourceDictionary:dictionary.text,frames:framesFor(sampled)})})).text);
   const known=new Map(sampled.map(p=>[String(p.itemId),p]));if(!scout.selectedIds.length||scout.selectedIds.length>12||new Set(scout.selectedIds).size!==scout.selectedIds.length||[...scout.selectedIds,...scout.meanings.flatMap(m=>m.evidenceIds)].some(id=>!known.has(id)))throw new Error('Invalid adaptive scout ids');
   items=scout.selectedIds.map(id=>known.get(id));write(`${dest}/coverage.json`,scout);write(`${dest}/selected-evidence.json`,items);
  }
  final=JSON.parse((await model.call({stage:'adaptive-final',purpose:'final proposal after one automatic targeted escalation',effort:'medium',schema:entrySchema,instructions,content:JSON.stringify(payload(items,dictionary.text))})).text);
 }
 write(`${dest}/route.json`,route);write(`${dest}/entry.json`,{entries:final.entries,risks:final.risks,status:'done',wallSeconds:(Date.now()-started)/1000,route:route.branch});
}
