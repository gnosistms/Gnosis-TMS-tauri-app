const extraRoot=path.join(path.dirname(run),'additional-challenges'),extras=read(`${extraRoot}/cases.json`).filter(c=>c.languages.includes(language));
if(read(`${run}/calibration/result.json`)?.passed!==true)throw new Error('Calibration required');
const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('Subscription authentication required');
for(const c of extras){
 const termIndices=c.terms.map(term=>manifest.terms.findIndex(t=>t.source_terms[0]===term)+1);
 if(termIndices.some(i=>!read(`${d(i)}/full-preserved-v2/entry.json`)))throw new Error(`Full glossary for ${c.terms.join(', ')} not ready`);
 const dir=`${extraRoot}/${language}/${c.id}`,neutralFile=`${dir}/no-glossary.json`;
 const saved=read(`${dir}/results.json`);if(saved)continue;
 let neutral=read(neutralFile);
 if(!neutral){neutral=JSON.parse((await call({term:c.terms.join(' / '),method:'no-glossary',stage:'challenge-neutral',purpose:'translate a source-selected coverage challenge without glossary',effort:'low',schema:translationSchema,
  instructions:`Translate this entire Spanish passage accurately and naturally into ${language==='en'?'English':'Vietnamese'}. No glossary, research, or reference translation is supplied. No explanations.`,content:JSON.stringify({passages:[{id:c.id,text:c.source}]})},`${dir}/neutral-calls`,'evaluation')).text).items;checkIds(neutral,[c.id]);write(neutralFile,neutral);}
 const packetCriteria=Object.fromEntries(c.terms.map(t=>[t,rules(t)])),out={case:c.case,terms:c.terms,source:c.source,reference:c.reference,neutral:neutral[0].translation,
  qualification:c.qualification,researchOverlap:[],methods:{}};
 for(let at=0;at<termIndices.length;at++){
  const sample=read(`${d(termIndices[at])}/baseline/stages/sample.json`),present=Object.values(sample?.items??{}).some(p=>p.itemId===c.sourceId||p.text===c.source);
  out.researchOverlap.push({term:c.terms[at],seenInResearchSample:present});
 }
 for(const m of ['full-original','full-preserved','full-preserved-v2']){
  const guides=termIndices.map(i=>read(`${d(i)}/${m}/entry.json`));
  let candidate=read(`${dir}/${m}/translation.json`);
  if(!candidate){candidate=JSON.parse((await call({term:c.terms.join(' / '),method:m,stage:'challenge-apply',purpose:'apply completed full glossary to the identical coverage-challenge neutral draft',effort:'low',schema:translationSchema,
   instructions:`Apply these glossaries conditionally to the researched occurrences in the ${language==='en'?'English':'Vietnamese'} draft using Spanish meaning and grammar. Preserve ordinary adjective uses, distinct source words and actual source categories. Change only researched wording and necessary grammar; retain unrelated draft wording exactly. SourceSenseIds reference sourceMeaningDefinitions; selectionScope restricts choices to kept meanings. Verified designations remain names rather than definitions. Reader notes are separate first-occurrence explanations, not new source content. Return the full passage once.`,content:JSON.stringify({terms:c.terms,guides,passages:[{id:c.id,source:c.source,occurrences:c.occurrences,draft:neutral[0].translation}]})},`${dir}/${m}/translation-calls`,'evaluation')).text).items;checkIds(candidate,[c.id]);write(`${dir}/${m}/translation.json`,candidate);}
  const assessments=[];
  for(let round=0;round<2;round++){
   const pair=blindPair({id:c.id,text:c.source},neutral[0].translation,candidate[0].translation,`${manifest.seed}:challenge:${language}:${m}:${c.id}:${round}`);
   const answer=(await assessPackets(c.terms.join(' / '),[{...pair.public,terms:c.terms,language,criteria:packetCriteria,occurrences:c.occurrences}],`${dir}/${m}/judge-${round}`,'source-selected-challenge'))[0];
   assessments.push({...answer,candidateSide:pair.candidateSide});
  }
  out.methods[m]={translation:candidate[0].translation,judgments:assessments,effects:Object.fromEntries(['accuracy','policy','naturalness'].map(dim=>[dim,confirmedEffect(assessments[0],assessments[1],dim)]))};
 }
 write(`${dir}/results.json`,out);
}
