async function hintsOnly(index){
 const dir=d(index),e=read(`${dir}/evidence.json`),out=`${dir}/${method}/translations.json`;if(read(out))return;
 const neutral=await draft(index),by=new Map(neutral.map(p=>[p.id,p.translation])),requirement=criteria[e.term]?.[language];
 if(!requirement){write(out,neutral);return;}
 const rows=[];
 for(let at=0;at<e.evaluation.length;at+=10){
  const passages=e.evaluation.slice(at,at+10).map(p=>({id:String(p.itemId),source:p.text,occurrences:p.occurrences,draft:by.get(String(p.itemId))}));
  const items=JSON.parse((await call({term:e.term,method,stage:'human-hints-control',purpose:'apply human/inferred project requirements without research or glossary',effort:'low',schema:translationSchema,
   instructions:`Apply the supplied human/inferred project requirements to the researched Spanish occurrences in the ${language==='en'?'English':'Vietnamese'} drafts. No researched glossary, candidate list, dictionary evidence or source-book research is provided. Change only the researched wording and necessary grammar; retain unrelated draft wording exactly. Apply meaning/grammar conditions, and retain a draft that already meets them. Do not add provenance, explanatory notes or other new source content to the passage. Return each full passage once.`,content:JSON.stringify({term:e.term,humanRequirements:requirement,passages})},`${dir}/${method}/translation-calls`,'evaluation')).text).items;
  checkIds(items,passages.map(p=>p.id));rows.push(...items);
 }
 write(out,rows);
}
const hintAuth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${hintAuth.stdout}${hintAuth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('Subscription authentication required');
if(['evaluate','confirm'].includes(phase)&&(read(`${run}/calibration/result.json`)?.passed!==true||read(`${run}/extra-calibration/result.json`)?.passed!==true))throw new Error('Both calibrated fault checks required');
await concurrent(indices.length?indices:manifest.terms.map((_,i)=>i+1),async index=>{
 if(phase==='translate')await hintsOnly(index);else{if(!read(`${d(index)}/${method}/translations.json`))await hintsOnly(index);if(phase==='evaluate')await assessFull(index);else if(phase==='confirm')await confirm(index);else throw new Error('Unknown hints phase');}
});
