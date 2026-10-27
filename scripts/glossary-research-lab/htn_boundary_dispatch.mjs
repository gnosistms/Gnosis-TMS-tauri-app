const boundary=read(`${run}/sun-boundary.json`),passages=boundary.passages;
const result={case:boundary.case,criteria:boundary.criteria,source:passages[0],method,languages:{}};
const boundaryLabels=[];
for(const judge of [1,2]){const out=await ask(1,`sun-boundary-source-${judge}`,LABEL_SCHEMA,'Interpret the Spanish researched word and the category of all explicitly listed members. No target translations or proposed entry are provided. Record genuine uncertainty; do not correct the source cosmology or numbers. Each id once.',{term:'mundo',passages:passages.map(p=>({id:String(p.itemId),text:p.text,occurrences:p.occurrences}))},'source-label');checkIds(out.items,passages.map(p=>String(p.itemId)));boundaryLabels.push(out.items[0]);}
result.sourceJudgments=boundaryLabels;
for(const language of boundary.languages){
 const rows={};for(const arm of ['no-glossary','human-hints-only','htn']){
  const dest=`${dir(1)}/boundary-${method}/${language}/${arm}.json`,old=read(dest);if(old){rows[arm]=old;continue;}
  const saved=arm==='htn'?read(`${dir(1)}/${method}/${language}/saved-glossary.json`):null;
  const content={passages:passages.map(p=>({id:String(p.itemId),text:p.text}))};if(arm==='htn')content.glossary_info=consumerHints(saved,passages[0].text);if(arm==='human-hints-only')content.humanTerminologyRequirements=requirements.mundo;
  const answer=await ask(1,`sun-boundary-translate-${method}-${language}-${arm}`,translationSchema,`Translate the full Spanish passage accurately and naturally into ${language==='en'?'English':'Vietnamese'}. Preserve every source number, name and claim. No explanations or additional facts in the body. ${arm==='htn'?read(`${run}/consumer-rules.json`).rules:''}`,content,'translation','low');validateTranslations(answer.items,content.passages);write(dest,answer.items);rows[arm]=answer.items;
 }
 const scored={};for(const arm of ['human-hints-only','htn']){
  const pair=blindPair({id:String(passages[0].itemId),text:passages[0].text},rows['no-glossary'][0].translation,rows[arm][0].translation,`boundary:${method}:${language}:${arm}`);
  const packet={...pair.public,term:'mundo',language,criteria:requirements.mundo+' '+boundary.criteria,sourceJudgments:boundaryLabels};
  const first=(await grade(1,`sun-boundary-grade-${method}-${language}-${arm}`,[packet]))[0];
  const opposite={...packet,A:packet.B,B:packet.A};const second=(await grade(1,`sun-boundary-confirm-${method}-${language}-${arm}`,[opposite]))[0];
  first.candidateSide=pair.candidateSide;second.candidateSide=pair.candidateSide==='A'?'B':'A';scored[arm]={first,second,effects:Object.fromEntries(['accuracy','policy','naturalness'].map(d=>[d,selectionEffect(first,d)===selectionEffect(second,d)?selectionEffect(first,d):0]))};
 }
 result.languages[language]={translations:rows,assessments:scored};
}
write(`${run}/sun-boundary-${method}-result.json`,result);
