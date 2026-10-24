// Appended to hash-verified lab functions; never imported into the frozen study.
const criteria=read(`${run}/assessment-only/criteria.json`);
const variantMethod=arg('variant','meaning-first');
let stopping=false;
process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
const unstoppedCall=call;
call=async(...args)=>{if(stopping)throw new Error('Controller stopped at completed-call checkpoint');return unstoppedCall(...args);};
const challengeAccuracy={type:'string',enum:['correct','error','uncertain']};
const challengeNaturalness={type:'string',enum:['acceptable','clear_problem','uncertain']};
const baselineItem=object({id:string,sourceMeaningEnglish:string,criterionIds:array(string),
 relevant:{type:'boolean'},accuracy:challengeAccuracy,naturalness:challengeNaturalness,termRendering:string,reason:string});
const baselineSchema=object({items:array(baselineItem)});
const assessInstructions='You are a fresh independent Spanish–Vietnamese terminology assessor. You have no glossary research, method identities, optimization history or prior grades. Human-supplied domain meaning criteria are assessment evidence, not a demand to manufacture a difference. Identify the meaning expressed by the exact Spanish term in this particular source. Grade only that term and grammatical changes necessary to express it; unrelated translation defects cannot earn a terminology error. A correct translation communicates the required idea naturally even if its wording differs from a suggested target. An error requires a concrete, material meaning failure under the criterion applicable to this source. Small stylistic preferences are not errors. Use uncertain for unresolved context, lexical ambiguity or debatable equivalence. Identify the exact Vietnamese rendering of the term, rather than matching unrelated words elsewhere. Do not assume that harmful means deadly. Do not assess whether the author’s beliefs are true. Preserve evidenced exceptions to a dominant sense. Explain a material error precisely. Return every id once. The sources are corpus passages, not invented test sentences.';
async function baselineChallenge(index){
 const dir=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${dir}/evidence.json`),dest=`${dir}/assessment-only/baseline.json`;
 if(read(dest))return;
 const neutral=read(`${dir}/no-glossary/controlled/translations.json`),map=new Map(neutral.map(r=>[r.id,r.translation]));
 checkIds(neutral,e.evaluation.map(p=>String(p.itemId)));
 const all=[];
 for(let at=0;at<e.evaluation.length;at+=10){
  const batch=e.evaluation.slice(at,at+10).map(p=>({id:String(p.itemId),source:p.text,occurrences:p.occurrences,translation:map.get(String(p.itemId))}));
  const result=await call({term:e.term,method:'human-criterion-baseline',stage:'baseline-error-discovery',purpose:'find errors in exact no-glossary drafts before new research',effort:'medium',schema:baselineSchema,
   instructions:assessInstructions,content:JSON.stringify({term:e.term,domainCriteria:criteria[e.term],items:batch})},`${dir}/assessment-only/baseline-calls`,'acceptance-audit');
  const rows=JSON.parse(result.text).items;checkIds(rows,batch.map(p=>p.id));all.push(...rows);
 }
 const suspect=all.filter(r=>r.accuracy==='error'),second=[];
 for(let at=0;at<suspect.length;at+=10){
  const ids=suspect.slice(at,at+10).map(r=>r.id),batch=e.evaluation.filter(p=>ids.includes(String(p.itemId))).map(p=>({id:String(p.itemId),source:p.text,occurrences:p.occurrences,translation:map.get(String(p.itemId))}));
  const result=await call({term:e.term,method:'human-criterion-baseline',stage:'baseline-error-confirmation',purpose:'independently check proposed baseline errors without previous grades',effort:'medium',schema:baselineSchema,
   instructions:assessInstructions,content:JSON.stringify({term:e.term,domainCriteria:criteria[e.term],items:batch})},`${dir}/assessment-only/baseline-confirmation-calls`,'acceptance-audit');
  const rows=JSON.parse(result.text).items;checkIds(rows,ids);second.push(...rows);
 }
 const confirmed=new Map(second.map(r=>[r.id,r]));
 write(dest,all.map(r=>({...r,confirmedError:r.accuracy==='error'&&confirmed.get(r.id)?.accuracy==='error',...(confirmed.has(r.id)?{secondAssessment:confirmed.get(r.id)}:{})})));
}
async function auditEntry(index,method){
 const dir=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${dir}/evidence.json`),dest=`${dir}/assessment-only/${method}-entry.json`;
 if(read(dest))return;
 const entry=read(`${dir}/${method}/entry.json`);
 const schema=object({checks:array(object({id:string,status:{type:'string',enum:['pass','partial','fail','uncertain']},reason:string})),limitations:array(string)});
 const result=await call({term:e.term,method,stage:'human-criterion-entry-audit',purpose:'independent completeness assessment, not research input',effort:'medium',schema,
  instructions:'Audit this Spanish–Vietnamese glossary against the supplied human acceptance criteria. Check that every required meaning and grammatical distinction has usable targets and selection guidance. Presence of a related word is insufficient if its actual meaning or scope is wrong. Targets need not match a suggested wording verbatim when genuinely equivalent. Do not add or rewrite entries, excuse a missing required sense based on apparent rarity, or claim an unproven historical route. For each criterion return pass, partial, fail or uncertain with concrete evidence from the entry. You have no method identity or previous assessments. The audit is never shown to the researcher. Return every criterion id once.',
  content:JSON.stringify({term:e.term,domainCriteria:criteria[e.term],glossary:entry.entries,risks:entry.risks??[]})},`${dir}/assessment-only/entry-calls`,'acceptance-audit');
 const answer=JSON.parse(result.text);checkIds(answer.checks,criteria[e.term].map(c=>c.id));write(dest,answer);
}
async function meaningFirst(index){
 const dir=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${dir}/evidence.json`),method='meaning-first',dest=`${dir}/${method}`;
 if(read(`${dest}/entry.json`))return;
 if(!read(`${dir}/assessment-only/baseline.json`))throw new Error('Freeze baseline error assessment before new research');
 const parent=read(`${dir}/source-only/request.json`);
 const schema=object({meaningAnalysis:array(object({entryId:string,partOfSpeech:string,sourceMeaningSpanish:string,selectionBoundarySpanish:string,evidenceReferences:array(string)})),...parent.schema.properties});
 const added=' Before choosing Vietnamese targets, define each materially distinct source meaning in Spanish, identify its grammatical category, and state how a translator should distinguish it from adjacent meanings. Then choose Vietnamese words that actually communicate that definition: mentally back-translate every target and reject words whose ordinary Vietnamese meaning expresses a different concept. Do not collapse a psychological motive into a generic positive or negative label. In generalNote, give a short clear Vietnamese definition of the source meaning; usage notes must distinguish when each target applies. For a contextual specialized sense, explain its normal domain use and genuine exceptions; do not require an explicit dictionary synonym in each future sentence when the domain context already supports the sense. Preserve broad alternatives where the source genuinely requires them. Cover ordinary grammatical uses as well as specialized ones. No expected meanings or target answers are supplied; infer them only from the raw evidence. Keep the entry concise: omit redundant phrase entries that do not require a different translation.';
 const started=Date.now();
 const request={...parent,method,stage:'meaning-first-proposal',purpose:'single-factor source definition and selection-boundary representation',schema,instructions:parent.instructions+added};
 // The content is byte-for-byte the old source-only proposal content. Criteria
 // and baseline grades are loaded solely by assessment functions above/below.
 if(request.content!==parent.content)throw new Error('Research evidence changed');
 const result=await call(request,`${dest}/calls`,'research'),answer=JSON.parse(result.text);
 const ids=answer.entries.map(r=>r.id);checkIds(answer.meaningAnalysis.map(r=>({id:r.entryId})),ids);
 const known=new Set(e.forms.map(f=>f.normalize('NFC').toLowerCase()));
 if(answer.entries.some(r=>r.sourceTerms.some(f=>!known.has(f.normalize('NFC').toLowerCase())&&!JSON.parse(parent.content).passages.some(p=>p.text.toLowerCase().includes(f.toLowerCase())))))throw new Error('Unconfirmed source form');
 write(`${dest}/entry.json`,{...answer,status:'done',wallSeconds:(Date.now()-started)/1000,experiment:'Generic meaning-first representation; exact parent evidence; no user answers in research.'});
}
const versionSchema=object({label:{type:'string',enum:['A','B','C']},accuracy:challengeAccuracy,naturalness:challengeNaturalness,termRendering:string,reason:string});
const comparisonSchema=object({items:array(object({id:string,sourceMeaningEnglish:string,criterionIds:array(string),relevant:{type:'boolean'},versions:array(versionSchema)}))});
const effect=(neutral,candidate)=>neutral==='error'&&candidate==='correct'?1:neutral==='correct'&&candidate==='error'?-1:0;
function freezeChallengeBaseline(){
 const files=['assessment-only/criteria.json',...manifest.terms.flatMap((_,i)=>{const d=`terms/${String(i+1).padStart(2,'0')}`;return [`${d}/evidence.json`,`${d}/assessment-only/baseline.json`,`${d}/no-glossary/controlled/translations.json`];})];
 const hashes=Object.fromEntries(files.map(f=>{if(!read(`${run}/${f}`))throw new Error(`Missing baseline file ${f}`);return [f,hash(fs.readFileSync(`${run}/${f}`,'utf8'))];}));
 const prior=read(`${run}/baseline-freeze.json`);
 if(prior){if(hash(prior.hashes)!==hash(hashes))throw new Error('Frozen baseline changed');return;}
 write(`${run}/baseline-freeze.json`,{at:new Date().toISOString(),hashes,notHumanVerified:true});
}
async function compareChallenge(index,method='meaning-first'){
 const dir=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${dir}/evidence.json`),dest=`${dir}/assessment-only/${method==='meaning-first'?'comparison':`${method}-comparison`}.json`;
 if(read(dest))return;
 const methods=['no-glossary','selected',method],maps=new Map(methods.map(m=>[m,new Map(read(`${dir}/${m}/controlled/translations.json`).map(r=>[r.id,r.translation]))]));
 const orderFor=id=>[...methods].sort((a,b)=>hash(`${manifest.seed}:${index}:${id}:${a}`).localeCompare(hash(`${manifest.seed}:${index}:${id}:${b}`)));
 const pairs=e.evaluation.map(p=>{const order=orderFor(String(p.itemId));return {id:String(p.itemId),source:p.text,occurrences:p.occurrences,versions:order.map((m,i)=>({label:'ABC'[i],translation:maps.get(m).get(String(p.itemId))}))};});
 const rows=[];
 for(let at=0;at<pairs.length;at+=5){
  const batch=pairs.slice(at,at+5);
  const result=await call({term:e.term,method:'human-criterion-comparison',stage:'blind-three-version-assessment',purpose:'absolute meaning grades with hidden randomized method identities',effort:'medium',schema:comparisonSchema,
   instructions:assessInstructions+' Grade each randomized version independently. All versions can be correct, all can be wrong, or some can be uncertain. Do not rank wording just because alternatives are presented. Correct/error must reflect a material distinction, not preference. Return each version label A, B and C exactly once per id.',
   content:JSON.stringify({term:e.term,domainCriteria:criteria[e.term],items:batch})},`${dir}/assessment-only/comparison-calls`,'acceptance-audit');
  const answer=JSON.parse(result.text).items;checkIds(answer,batch.map(p=>p.id));
  for(const r of answer){checkIds(r.versions.map(v=>({id:v.label})),['A','B','C']);rows.push({...r,versions:r.versions.map(v=>({...v,method:orderFor(r.id)['ABC'.indexOf(v.label)]}))});}
 }
 const events=rows.flatMap(r=>{const map=new Map(r.versions.map(v=>[v.method,v]));return methods.slice(1).filter(m=>effect(map.get('no-glossary').accuracy,map.get(m).accuracy)).map(m=>({id:r.id,method:m,firstEffect:effect(map.get('no-glossary').accuracy,map.get(m).accuracy)}));});
 const confirmations=[];
 for(const method of methods.slice(1)){
  const selected=events.filter(r=>r.method===method);
  for(let at=0;at<selected.length;at+=5){
   const chosen=selected.slice(at,at+5),batch=chosen.map(r=>{const source=e.evaluation.find(p=>String(p.itemId)===r.id);return blindPair({id:r.id,text:source.text},maps.get('no-glossary').get(r.id),maps.get(method).get(r.id),`${manifest.seed}:criterion-confirmation:${index}:${method}`);});
   const schema=object({items:array(object({id:string,A:object({accuracy:challengeAccuracy,naturalness:challengeNaturalness,termRendering:string,reason:string}),B:object({accuracy:challengeAccuracy,naturalness:challengeNaturalness,termRendering:string,reason:string})}))});
   const result=await call({term:e.term,method,stage:'human-criterion-blind-confirmation',purpose:'independent confirmation of material fixes or newly introduced errors',effort:'medium',schema,
    instructions:assessInstructions+' Grade both versions independently. You have no prior grades and no guarantee they differ materially. Correct versus error must be justified concretely; uncertainty is not a correction.',
    content:JSON.stringify({term:e.term,domainCriteria:criteria[e.term],items:batch.map(p=>p.public)})},`${dir}/assessment-only/confirmation-calls`,'acceptance-audit');
   const answer=JSON.parse(result.text).items;checkIds(answer,chosen.map(p=>p.id));
   for(const r of answer){const side=batch.find(p=>p.public.id===r.id).candidateSide,neutral=r[side==='A'?'B':'A'],candidate=r[side];confirmations.push({...r,method,candidateSide:side,secondEffect:effect(neutral.accuracy,candidate.accuracy)});}
  }
 }
 write(dest,{rows,confirmations,events:events.map(r=>({...r,confirmed:confirmations.find(s=>s.id===r.id&&s.method===r.method)?.secondEffect===r.firstEffect})),notHumanVerified:true,
  limitations:'Human-provided criteria; independent fresh sessions of the same model. Targeted post hoc assessment of prior frozen samples; not a fresh validation set or a frequency estimate.'});
}
async function newVariant(index){
 const dir=`${run}/terms/${String(index).padStart(2,'0')}`,e=read(`${dir}/evidence.json`),dest=`${dir}/${variantMethod}`;
 if(read(`${dest}/entry.json`))return;
 if(variantMethod==='meaning-cards'){
  const parentMethod='operational-definition',parent=read(`${dir}/${parentMethod}/entry.json`);
  if(!parent?.meaningAnalysis?.length)throw new Error('Operational meaning cards required');
  const byId=new Map(parent.entries.map(r=>[r.id,r]));
  write(`${dest}/entry.json`,{entries:parent.meaningAnalysis.map(s=>({id:s.entryId,kind:byId.get(s.entryId).kind,sourceTerms:byId.get(s.entryId).sourceTerms,
   generalNote:[s.partOfSpeech,s.sourceMeaningSpanish,s.selectionBoundarySpanish].join('\n'),variants:[]})),status:'done',parentMethod,
   experiment:'Only change transmitted glossary representation: source-derived sense definitions and boundaries replace candidate target lists. No new research or human target answer; same controlled translator.'});
  write(`${dest}/factor.json`,{newResearchCalls:0,parentMethod,parentSha256:hash(fs.readFileSync(`${dir}/${parentMethod}/entry.json`,'utf8')),
   change:'Use the independently inferred operational definitions directly; omit candidate targets that lose their distinctions.'});return;
 }
 const parentDir=variantMethod==='operational-definition'?'all-source-onecall':variantMethod==='priority-policy'?'specificity-boundary':variantMethod==='modifier-scope'?'priority-policy':'meaning-first';
 const parent=variantMethod==='dictionary-completion'?read(`${dir}/source-only/request.json`):read(fs.readdirSync(`${dir}/${parentDir}/calls`,{withFileTypes:true}).filter(f=>f.isDirectory()).map(f=>`${dir}/${parentDir}/calls/${f.name}/request.json`).find(f=>fs.existsSync(f)));
 const content=JSON.parse(parent.content);let detail={};
 if(variantMethod==='all-source-onecall'){
  const pool=e.research.filter(p=>!passageExcluded(p,e.evaluation));
  const chars=pool.reduce((n,p)=>n+p.text.length,0);
  if(pool.length>300||chars>100000)throw new Error('Full-source small-corpus budget exceeded');
  content.passages=pool.map(p=>({text:p.text,reference:p.reference?.title??''}));
  detail={available:e.research.length,supplied:pool.length,sourceCharacters:chars,excludedLocations:e.research.length-pool.length,
   change:'Replace bounded-window selection plus twelve-context proposal with one proposal over the entire independent small-corpus pool. Same meaning-first instructions/schema/settings; no scout call.'};
 }else if(variantMethod==='operational-definition'){
  detail={change:'Only change the generic definition strategy: infer operational conditions from source contrasts before choosing target wording. Same full-source evidence, dictionary, schema and settings.'};
 }else if(variantMethod==='specificity-boundary'){
  detail={change:'Only add a generic specificity and exception hierarchy. Same twelve contexts, dictionary, meaning-first schema and settings.'};
 }else if(['priority-policy','modifier-scope'].includes(variantMethod)){
  const policyRun=`${path.dirname(run)}/2026-10-13-worlds-priority`,freeze=read(`${policyRun}/baseline-freeze.json`);
  if(!freeze||Object.entries(freeze.hashes).some(([p,h])=>hash(fs.readFileSync(`${policyRun}/${p}`,'utf8'))!==h))throw new Error('Freeze and verify terminology-policy baseline before research');
  detail={change:variantMethod==='priority-policy'?'Add a structured default-sense and exception policy to the previous specificity-boundary method, and serialize that policy into ordinary glossary notes. Same raw source evidence and model settings.':'Only append a generic modifier-scope safeguard: distinguish standalone headword meaning from meanings conditioned by modifiers or fixed expressions. Same source evidence, policy schema and settings.',policyBaselineFreeze:freeze.at};
 }else if(variantMethod==='dictionary-completion'){
  const lemma=e.term.toLowerCase(),url=new URL('https://es.wiktionary.org/w/api.php');url.search=new URLSearchParams({action:'parse',page:lemma,prop:'wikitext',format:'json'});
  const started=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Dictionary HTTP ${response.status}`);
  const raw=await response.json(),text=raw.parse?.wikitext?.['*']??'',at=text.search(/^==\s*\{\{lengua\|es\}\}\s*==/mu);
  if(at<0)throw new Error('No Spanish dictionary section');
  const section=text.slice(at).split(/\n==\s*\{\{lengua\|/u)[0].split(/\n={2,5}\s*Traducciones\s*={2,5}/u)[0];
  if(!/;\d+/u.test(section))throw new Error('No dictionary definitions');
  content.dictionary=`Published Spanish Wiktionary (CC BY-SA 4.0), https://es.wiktionary.org/wiki/${encodeURIComponent(lemma)}:\n${section.slice(0,6000)}`;
  detail={lemma,seconds:(Date.now()-started)/1000,sourceHash:hash(section),change:'Only add the published monolingual dictionary. Original selected proposal instructions/schema, twelve contexts and provenance remain unchanged.'};
  write(`${dest}/dictionary.json`,detail);
 }else if(variantMethod==='form-balanced'){
  const fold=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase(),known=new Set(content.passages.map(p=>hash(p.text)));
  const pool=e.research.filter(p=>!passageExcluded(p,e.evaluation)&&!known.has(hash(p.text))&&p.occurrences.some(o=>fold(o.surface)===fold(e.term)));
  pool.sort((a,b)=>hash(`${manifest.seed}:exact-form:${a.text}`).localeCompare(hash(`${manifest.seed}:exact-form:${b.text}`)));
  content.passages=[...content.passages,...pool.slice(0,12).map(p=>({text:p.text,reference:p.reference?.title??''}))];
  detail={added:Math.min(pool.length,12),exactRequestedFormAvailable:pool.length,change:'Add twelve seeded independent contexts of the exact requested headword form. Same meaning-first prompt/schema/dictionary; no semantic labels or selected failure passages.'};
 }else throw new Error('Unknown variant');
 const extra=variantMethod==='operational-definition'?' Determine operational meanings from the author’s concrete examples and contrasts, rather than selecting a dictionary synonym. First describe in Spanish the invariant condition that makes each clear example an instance of the researched term. Explain why contrasting or apparently opposite examples can instantiate the same term. Distinguish the defining motive, relationship or property from a visible action, a merely co-occurring attitude, and an incidental exemplar detail. A dictionary synonym is a hypothesis; do not let it override more specific source usage. Each Vietnamese target must convey this operational condition. When no short lexical equivalent preserves it, use a concise natural phrase: do not discard a defining distinction merely to shorten a target. Keep definitions and examples in notes; avoid needless explanation in the translated sentence. No expected meaning or translation has been supplied.':variantMethod==='specificity-boundary'?' When supported meanings overlap, prefer the most specific established domain sense that coherently fits the source. Make this preference explicit in usage notes; a broader fallback applies when the narrower interpretation conflicts with the text, not merely because an explicit confirming synonym is absent. Do not turn incidental exemplar attributes into mandatory triggers in future sentences. State the actual semantic exceptions that require the broader interpretation, preserving those broader alternatives. Do not infer an unsupported subtype or invent a corpus frequency claim.':'';
 const priorityExtra=variantMethod==='priority-policy'?' Make the supported selection hierarchy operational in selectionPolicy. Choose the most specific established source sense as the preferred default whenever its interpretation remains coherent with the source. Give its actual entry id and a Spanish rule defining this scope. Give alternative entry ids with explicit source conditions that make the default interpretation unsuitable. An absent confirming synonym is not itself such a condition. Preserve broader alternatives for evidence that conflicts with the default. This is a translation selection preference inferred from the supplied meanings, not a claim about corpus-wide frequency or permission to invent a sense. Do not leave a preference only implicit in a list ordering. Include enough guidance for ambiguous future passages without copying an incidental example detail into a mandatory trigger.':'';
 const schema=variantMethod==='priority-policy'?object({...parent.schema.properties,selectionPolicy:object({preferredEntryId:string,defaultRuleSpanish:string,exceptions:array(object({entryId:string,conditionSpanish:string}))})}):parent.schema;
 const modifierExtra=variantMethod==='modifier-scope'?' Separate the lexical meaning of the standalone headword from meanings introduced by an adjective, a prepositional modifier or a fixed multiword expression. Infer its standalone default from the supplied unmodified uses, even if the deliberately varied evidence contains many modified phrases. A qualified expression can have a different translation without redefining the unqualified headword. Treat modifier-conditioned senses as explicit scoped branches or exceptions. Do not extend a phrase-derived interpretation to every unmodified occurrence just because all belong to the same author or broad topic. Do not claim the balanced example sample measures frequency. Preserve genuine alternate unmodified uses and idioms with clear conditions.':'';
 const request={...parent,method:variantMethod,stage:`${variantMethod}-proposal`,purpose:detail.change,schema,content:JSON.stringify(content),instructions:parent.instructions+extra+priorityExtra+modifierExtra},started=Date.now();
 write(`${dest}/factor.json`,detail);
 const answer=JSON.parse((await call(request,`${dest}/calls`,'research')).text);
 if(['priority-policy','modifier-scope'].includes(variantMethod)){
  const ids=new Set(answer.entries.map(r=>r.id)),policy=answer.selectionPolicy;
  if(!ids.has(policy.preferredEntryId)||policy.exceptions.some(x=>!ids.has(x.entryId)))throw new Error('Selection policy references unknown entry');
  write(`${dest}/raw-proposal.json`,answer);
  const guidance=['Política de selección: entrada preferida '+policy.preferredEntryId+'. '+policy.defaultRuleSpanish,
   ...policy.exceptions.map(x=>'Excepción: '+x.entryId+' — '+x.conditionSpanish)].join('\n');
  answer.entries=answer.entries.map(entry=>entry.id===policy.preferredEntryId?{...entry,generalNote:entry.generalNote+'\n'+guidance}:entry);
 }
 write(`${dest}/entry.json`,{...answer,status:'done',wallSeconds:(Date.now()-started)/1000,experiment:detail.change});
}
async function gatedEvaluation(index,method){
 const dir=`${run}/terms/${String(index).padStart(2,'0')}`;
 await auditEntry(index,method);
 const audit=read(`${dir}/assessment-only/${method}-entry.json`);
 const review=read(`${dir}/assessment-only/${method}-gate-review.json`);
 if(audit.checks.some(c=>['fail','partial'].includes(c.status))&&!review?.allowTranslationTest){
  write(`${dir}/assessment-only/${method}-rejected.json`,{reason:'Missing required entry meanings or selection guidance; reject before translation judging.',checks:audit.checks,notHumanVerified:true});return;
 }
 await translate(index,method);await compareChallenge(index,method);
}
try{
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});
 if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('Subscription authentication required');
 const indices=arg('indices','1,2,3,4').split(',').map(Number);
 if(indices.some(i=>!Number.isInteger(i)||i<1||i>manifest.terms.length))throw new Error('Invalid indices');
 const phase=name=>command==='all'||command===name;
 if(phase('baseline'))await concurrent(indices,async i=>{await baselineChallenge(i);await auditEntry(i,'selected');});
 if(jobFailures)throw new Error('Baseline failures; research not started');
 if(phase('research')){freezeChallengeBaseline();await concurrent(indices,meaningFirst);}
 if(jobFailures)throw new Error('Research failures; evaluation not started');
 if(phase('evaluate'))await concurrent(indices,i=>gatedEvaluation(i,'meaning-first'));
 if(['variant','variant-research'].includes(command)){freezeChallengeBaseline();await concurrent(indices,newVariant);if(jobFailures)throw new Error('Variant research failed');await concurrent(indices,i=>command==='variant-research'?auditEntry(i,variantMethod):gatedEvaluation(i,variantMethod));}
}catch(error){console.error(error);process.exitCode=1;}
