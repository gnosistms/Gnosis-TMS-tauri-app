// Separate dispatcher appended to the unchanged subscription-only executor.
const targets={vi:'Vietnamese',en:'English'},rubrics=read(`${run}/assessment-only/criteria.json`);
const originVariant=arg('variant','initial'),candidateMethod=originVariant==='initial'?'researched':`researched-${originVariant}`;
const selectedIndices=arg('indices','1,2').split(',').map(Number);
let stopRequested=false;process.on('SIGTERM',()=>{stopRequested=true;});process.on('SIGINT',()=>{stopRequested=true;});
const runningCall=call;call=async(...args)=>{if(stopRequested)throw new Error('Stopped after completed call');return runningCall(...args);};
const bilingualSchema=object({provenance:array(object({sourceForm:string,originalTerm:string,originalLanguage:string,book:string,author:string,relationship:string,evidence:string,uncertainty:string})),
 glossaries:array(object({language:{type:'string',enum:['vi','en']},entries:entrySchema.properties.entries,risks:array(string)}))});
async function bilingualResearch(index){
 const d=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${d}/evidence.json`);
 const researchDir=originVariant==='initial'?'bilingual-research':'bilingual-research-name-distinction';
 if(read(`${d}/${researchDir}/entry.json`))return;
 const content=read(`${d}/source-only/payload.json`),started=Date.now();
 const guard=originVariant==='name-distinction'?' Preserve the lexical content and grammatical role of an attested technical designation. When the source defines, equates or compares this headword with another named doctrinal concept, keep both lexical labels distinct. Do not use a target that translates the defining/comparing concept instead of the actual headword or its documented original designation; that erases the source distinction and can create a tautology. Do not add properties from a definition to the technical-name target. Prefer an established natural rendering of the designation itself.':'';
 const answer=JSON.parse((await call({term:e.term,method:`bilingual-source-research-${originVariant}`,stage:'shared-origin-bilingual-proposal',purpose:'shared source acquisition and two target glossaries; no human targets supplied',effort:'medium',schema:bilingualSchema,
  instructions:'Research the supplied Spanish term from raw corpus and bibliographic evidence. Produce concise usable English and Vietnamese glossaries, sharing the source-meaning and provenance work. Distinguish specialized author usage from ordinary dictionary meanings and grammatical categories. Retain dictionary-attested ordinary meanings in a clearly marked ordinary-use branch even when absent from the bounded author sample; do not let a general dictionary sense override a specialized source meaning. For a borrowed technical name, identify its documented original word, source language, book and author. When the target language equals the attested original-word language, preserve that original technical designation rather than translating the Spanish adaptation anew. Other target languages need natural established terminology that preserves the same designated concept. A near spelling is only a hypothesis: accept a counterpart only when the source context/definition also matches. Distinguish the observed Spanish spelling from verified source-book spelling and explain the discrepancy; do not silently alter corpus forms or assume who introduced an error. A searchable English source edition does not prove a book was first written in English. Printed glossary pairs and actual original passages carry more weight than machine alignment. Document supported provenance without inventing first coinage or an unproven borrowing route. Do not substitute a definition for a technical-name target. Keep corpus-confirmed source forms, noun/adjective distinctions, rare supported meanings and genuine exceptions. Notes may be concise but must carry the distinctions needed in translation. Expected answers and human glossary targets are unavailable. Return exactly one glossary per target language.',
  content:JSON.stringify(content),...(guard?{instructions:'Research the supplied Spanish term from raw corpus and bibliographic evidence. Produce concise usable English and Vietnamese glossaries, sharing the source-meaning and provenance work. Distinguish specialized author usage from ordinary dictionary meanings and grammatical categories. Retain dictionary-attested ordinary meanings in a clearly marked ordinary-use branch even when absent from the bounded author sample; do not let a general dictionary sense override a specialized source meaning. For a borrowed technical name, identify its documented original word, source language, book and author. When the target language equals the attested original-word language, preserve that original technical designation rather than translating the Spanish adaptation anew. Other target languages need natural established terminology that preserves the same designated concept. A near spelling is only a hypothesis: accept a counterpart only when the source context/definition also matches. Distinguish the observed Spanish spelling from verified source-book spelling and explain the discrepancy; do not silently alter corpus forms or assume who introduced an error. A searchable English source edition does not prove a book was first written in English. Printed glossary pairs and actual original passages carry more weight than machine alignment. Document supported provenance without inventing first coinage or an unproven borrowing route. Do not substitute a definition for a technical-name target. Keep corpus-confirmed source forms, noun/adjective distinctions, rare supported meanings and genuine exceptions. Notes may be concise but must carry the distinctions needed in translation. Expected answers and human glossary targets are unavailable. Return exactly one glossary per target language.'+guard}:{})},`${d}/${researchDir}/calls`,'research')).text);
 checkIds(answer.glossaries.map(g=>({id:g.language})),['vi','en']);
 write(`${d}/${researchDir}/entry.json`,{...answer,status:'done',wallSeconds:(Date.now()-started)/1000});
 for(const g of answer.glossaries)write(`${d}/${g.language}/${candidateMethod}/entry.json`,{entries:g.entries,risks:g.risks,provenance:answer.provenance});
}
const accuracy={type:'string',enum:['correct','material_error','uncertain']},compliance={type:'string',enum:['pass','fail','not_applicable','uncertain']};
const bilingualGrade=object({accuracy,naturalness:{type:'string',enum:['acceptable','clear_problem','uncertain']},requiredTerm:compliance,termRendering:string,reason:string});
const baselineGradeSchema=object({items:array(object({id:string,sourceRole:string,grade:bilingualGrade}))});
async function translateLanguage(index,language,method){
 const d=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${d}/evidence.json`),dest=`${d}/${language}/${method}/translations.json`;
 if(read(dest))return read(dest);
 const out=[],glossary=read(`${d}/${language}/${method}/entry.json`),withGlossary=method!=='no-glossary';
 for(let at=0;at<e.evaluation.length;at+=10){
  const passages=e.evaluation.slice(at,at+10).map(p=>({id:String(p.itemId),text:p.text}));
  const neutral=read(`${d}/${language}/no-glossary/translations.json`),map=new Map((neutral??[]).map(r=>[r.id,r]));
  const instructions=method==='no-glossary'
   ? `Translate each full Spanish passage into accurate natural ${targets[language]}. Preserve all content and distinctions without adding explanations. No glossary or research findings are supplied. Return every id exactly once.`
   : `Apply the supplied glossary to each shared ${targets[language]} translation draft, using the Spanish source for meaning. Replace only occurrences of the researched term with accurate natural context-fitting glossary wording, with necessary grammatical adjustments. The draft is not authoritative for the term. Preserve all unrelated wording, names, structure and content. Do not improve unrelated style or add explanations. Return every full resulting passage and id once. You see only one glossary method.`;
  const result=await call({term:e.term,method:`${method}-${language}`,stage:method==='no-glossary'?'neutral-translate':'controlled-translate',purpose:'target-language translation with isolated research exposure',effort:'low',schema:translationSchema,instructions,
   content:JSON.stringify({passages,...(withGlossary?{glossary:glossary.entries,sharedDrafts:passages.map(p=>map.get(p.id))}:{})})},`${d}/${language}/${method}/translation-calls`,'evaluation');
  const rows=JSON.parse(result.text).items;checkIds(rows,passages.map(p=>p.id));out.push(...rows);
 }
 write(dest,out);return out;
}
const gradeInstruction='You are a fresh independent terminology evaluator. You have not seen research, source-book searches, glossary entries, optimization history or previous grades. Assess the exact source term in its grammatical context. Grade meaning accuracy and naturalness independently from adherence to the supplied project-required technical terminology. Do not call an understandable broad paraphrase an accuracy win solely because a canonical name is preferred: report requiredTerm separately. Conversely, the exact name does not excuse an incorrect source meaning or adjective/noun interpretation. Identify the actual rendering of the researched term, not unrelated words elsewhere in the paragraph. Ignore unrelated translation defects. Both versions can be good, both bad or uncertain. A material_error requires a concrete meaning failure; small stylistic differences do not count. Do not assess the truth of the author’s beliefs. Return all ids once.';
async function baselineLanguage(index,language){
 const d=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${d}/evidence.json`),dest=`${d}/${language}/baseline-assessment.json`;
 if(read(dest))return;
 const neutral=await translateLanguage(index,language,'no-glossary'),map=new Map(neutral.map(r=>[r.id,r.translation])),out=[];
 for(let at=0;at<e.evaluation.length;at+=10){
  const batch=e.evaluation.slice(at,at+10).map(p=>({id:String(p.itemId),source:p.text,translation:map.get(String(p.itemId))}));
  const result=await call({term:e.term,method:`baseline-assessment-${language}`,stage:'baseline-terminology-assessment',purpose:'freeze source roles and baseline errors before research',effort:'medium',schema:baselineGradeSchema,instructions:gradeInstruction,
   content:JSON.stringify({term:e.term,targetLanguage:targets[language],projectCriterion:rubrics[e.term][language],items:batch})},`${d}/${language}/baseline-calls`,'acceptance-audit');
  const rows=JSON.parse(result.text).items;checkIds(rows,batch.map(p=>p.id));out.push(...rows);
 }
 write(dest,out);
}
async function entryLanguage(index,language){
 const d=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${d}/evidence.json`),dest=`${d}/${language}/${candidateMethod}-entry-assessment.json`;
 if(read(dest))return;
 const schema=object({requiredMeanings:{type:'string',enum:['complete','incomplete','uncertain']},provenance:{type:'string',enum:['pass','fail','uncertain']},reason:string,missing:array(string)});
 const result=await call({term:e.term,method:`entry-assessment-${language}`,stage:'bilingual-entry-acceptance',purpose:'independent required-meaning and provenance audit',effort:'medium',schema,
  instructions:'Check this glossary against the supplied human acceptance criterion. Assess whether all required meanings and grammar branches have usable targets, and whether the specified source relationship and original term are identified. Keep factual uncertainty separate from a missing meaning. Do not rewrite entries or reward verbosity. You have no research history or method identity.',
  content:JSON.stringify({term:e.term,targetLanguage:targets[language],projectCriterion:rubrics[e.term][language],glossary:read(`${d}/${language}/${candidateMethod}/entry.json`)})},`${d}/${language}/entry-calls`,'acceptance-audit');
 write(dest,JSON.parse(result.text));
}
async function evaluateLanguage(index,language){
 const d=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${d}/evidence.json`),dest=`${d}/${language}/${candidateMethod}-comparison.json`;
 if(read(dest))return;
 await entryLanguage(index,language);
 if(read(`${d}/${language}/${candidateMethod}-entry-assessment.json`).requiredMeanings==='incomplete'){write(`${d}/${language}/${candidateMethod}-rejected.json`,{reason:'Required meaning missing; skip costly translation judging.'});return;}
 const base=read(`${d}/${language}/no-glossary/translations.json`),candidate=await translateLanguage(index,language,candidateMethod),a=new Map(base.map(r=>[r.id,r.translation])),b=new Map(candidate.map(r=>[r.id,r.translation]));
 if(originVariant==='deterministic-name'){
  const priorText=read(`${d}/${language}/researched/translations.json`),priorPath=read(`${d}/${language}/researched-comparison.json`)?`${d}/${language}/researched-comparison.json`:`${d}/${language}/comparison.json`,prior=read(priorPath);
  const freeze=read(`${run}/baseline-freeze.json`),neutralKey=`terms/${String(index).padStart(2,'0')}/${language}/no-glossary/translations.json`;
  const judges=fs.readdirSync(`${d}/${language}/judge-calls`,{withFileTypes:true}).filter(f=>f.isDirectory()).map(f=>read(`${d}/${language}/judge-calls/${f.name}/request.json`)).filter(Boolean);
  const sameCriteria=judges.length>0&&judges.every(q=>JSON.parse(q.content).projectCriterion===rubrics[e.term][language]);
  const sameTexts=priorText&&candidate.length===priorText.length&&candidate.every(p=>priorText.some(q=>q.id===p.id&&q.translation===p.translation));
  if(prior&&sameTexts&&sameCriteria&&freeze?.hashes[neutralKey]===hash(fs.readFileSync(`${run}/${neutralKey}`,'utf8'))){
   write(dest,{...prior,inheritedJudgment:{comparison:priorPath,reason:'Every candidate translation is byte-identical to the previously judged method; source passages, rubric and exact neutral drafts are unchanged.',candidateSha256:hash(JSON.stringify(candidate)),priorCandidateSha256:hash(JSON.stringify(priorText)),newJudgmentCalls:0}});return;
  }
 }
 const schema=object({items:array(object({id:string,sourceRole:string,A:bilingualGrade,B:bilingualGrade}))}),rows=[];
 for(let at=0;at<e.evaluation.length;at+=10){
  const pairs=e.evaluation.slice(at,at+10).map(p=>blindPair({id:String(p.itemId),text:p.text},a.get(String(p.itemId)),b.get(String(p.itemId)),`${manifest.seed}:${index}:${language}`));
  const result=await call({term:e.term,method:`comparison-${language}`,stage:'blind-bilingual-comparison',purpose:'meaning and required-term improvement over no glossary',effort:'medium',schema,instructions:gradeInstruction,
   content:JSON.stringify({term:e.term,targetLanguage:targets[language],projectCriterion:rubrics[e.term][language],items:pairs.map(p=>p.public)})},`${d}/${language}/judge-calls`,'acceptance-audit');
  const answer=JSON.parse(result.text).items;checkIds(answer,pairs.map(p=>p.public.id));rows.push(...answer.map(r=>({...r,candidateSide:pairs.find(p=>p.public.id===r.id).candidateSide})));
 }
 const effect=(ref,cand,key)=>{const [bad,good]=key==='accuracy'?['material_error','correct']:key==='naturalness'?['clear_problem','acceptable']:['fail','pass'];return ref===bad&&cand===good?1:ref===good&&cand===bad?-1:0;};
 const changed=rows.filter(r=>{const ref=r[r.candidateSide==='A'?'B':'A'],cand=r[r.candidateSide];return ['accuracy','requiredTerm','naturalness'].some(k=>effect(ref[k],cand[k],k));}),confirmations=[];
 for(let at=0;at<changed.length;at+=10){
  const chosen=changed.slice(at,at+10),pairs=chosen.map(r=>{const p=e.evaluation.find(p=>String(p.itemId)===r.id);return blindPair({id:r.id,text:p.text},a.get(r.id),b.get(r.id),`${manifest.seed}:${index}:${language}:confirmation`);});
  const result=await call({term:e.term,method:`confirmation-${language}`,stage:'blind-bilingual-confirmation',purpose:'fresh confirmation of every material, required-term or naturalness change',effort:'medium',schema,instructions:gradeInstruction,
   content:JSON.stringify({term:e.term,targetLanguage:targets[language],projectCriterion:rubrics[e.term][language],items:pairs.map(p=>p.public)})},`${d}/${language}/confirmation-calls`,'acceptance-audit');
  const answer=JSON.parse(result.text).items;checkIds(answer,chosen.map(p=>p.id));confirmations.push(...answer.map(r=>({...r,candidateSide:pairs.find(p=>p.public.id===r.id).candidateSide})));
 }
 write(dest,{rows,confirmations,notHumanVerified:true,meaningAndCanonicalTermScoresSeparate:true});
}
try{
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('Subscription authentication required');
 const jobs=selectedIndices.flatMap(index=>Object.keys(targets).map(language=>({index,language}))),phase=name=>command==='all'||command===name;
 if(phase('baseline'))await concurrent(jobs,({index,language})=>baselineLanguage(index,language));
 if(jobFailures)throw new Error('Baseline failed; research not started');
 if(phase('research')){
  const files=jobs.flatMap(({index,language})=>[`terms/${String(index).padStart(2,'0')}/${language}/baseline-assessment.json`,`terms/${String(index).padStart(2,'0')}/${language}/no-glossary/translations.json`]);
  const hashes=Object.fromEntries(files.map(p=>[p,hash(fs.readFileSync(`${run}/${p}`,'utf8'))]));
  if(!read(`${run}/baseline-freeze.json`))write(`${run}/baseline-freeze.json`,{at:new Date().toISOString(),hashes});
  await concurrent(selectedIndices,bilingualResearch);
 }
 if(jobFailures)throw new Error('Research failed; evaluation not started');
 if(phase('evaluate'))await concurrent(jobs,({index,language})=>evaluateLanguage(index,language));
}catch(error){console.error(error);process.exitCode=1;}
