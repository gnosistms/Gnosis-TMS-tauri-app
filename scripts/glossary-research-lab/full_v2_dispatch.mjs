import {preserveFullFindings as preserveV2,consumerGuide as guideV2} from './full_carrythrough_v2.mjs';
function compileV2(index){
 const dir=d(index),entry=read(`${dir}/baseline/entry.json`);if(!entry)throw new Error('Original full research not ready');
 const stages={};for(const name of fs.readdirSync(`${dir}/baseline/stages`).filter(n=>n.endsWith('.json')))stages[name.slice(0,-5)]=read(`${dir}/baseline/stages/${name}`);
 const preserved=preserveV2(stages,entry);write(`${dir}/${method}/entry.json`,guideV2(preserved));write(`${dir}/${method}/preservation.json`,preserved.preservation);
 write(`${dir}/${method}/input-freeze.json`,{originalEntryHash:hash(entry),stagesHash:hash(stages)});
}
if(phase==='compile'){for(const index of indices.length?indices:manifest.terms.map((_,i)=>i+1))compileV2(index);}
else{
 const auth=spawnSync('codex',['login','status'],{encoding:'utf8'});if(!`${auth.stdout}${auth.stderr}`.includes('Logged in using ChatGPT'))throw new Error('Subscription authentication required');
 if(read(`${run}/calibration/result.json`)?.passed!==true||read(`${run}/extra-calibration/result.json`)?.passed!==true)throw new Error('Both domain calibrations required');
 await concurrent(indices.length?indices:manifest.terms.map((_,i)=>i+1),async index=>{
  if(phase==='translate')await translation(index);else if(phase==='evaluate')await assessFull(index);else if(phase==='confirm')await confirm(index);else throw new Error('Unknown v2 phase');
 });
}
