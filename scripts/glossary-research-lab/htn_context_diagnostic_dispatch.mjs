const diagnosticInput=inp(6),diagnosticPassage=diagnosticInput.test.find(p=>String(p.itemId)==='f7904d60cae49569'),diagnosticResults={source:diagnosticPassage,arms:{},case:'Does delivering the same neighboring source context fix the alleged fatal triangle selection error? Original held-out result retained; this recheck is diagnostic, not fresh confirmation.'};
for(const arm of ['no-glossary','human-hints-only','htn']){
 const content={passages:[{id:String(diagnosticPassage.itemId),text:diagnosticPassage.text,contextBefore:diagnosticPassage.contextBefore,contextAfter:diagnosticPassage.contextAfter}]};
 if(arm==='human-hints-only')content.humanTerminologyRequirements=requirements.fatal;
 if(arm==='htn')content.glossary_info=consumerHints(read(`${dir(6)}/htn-v2/en/saved-glossary.json`),diagnosticPassage.text);
 const out=await ask(6,'equal-context-diagnostic-'+arm,translationSchema,`Use the surrounding source context to disambiguate. Translate only the main text accurately and naturally into English, preserving the source claims and distinctions. No added explanation. ${arm==='htn'?read(`${run}/consumer-rules.json`).rules:''}`,content,'translation','low');validateTranslations(out.items,content.passages);diagnosticResults.arms[arm]=out.items[0];
}
const sourceLabels=[loadStage(6,'source-labels-1').find(x=>x.id===String(diagnosticPassage.itemId)),loadStage(6,'source-labels-2').find(x=>x.id===String(diagnosticPassage.itemId))];
const p=blindPair({id:String(diagnosticPassage.itemId),text:diagnosticPassage.text},diagnosticResults.arms['no-glossary'].translation,diagnosticResults.arms.htn.translation,'context-triangle');const packet={...p.public,term:'fatal',language:'en',criteria:requirements.fatal,sourceJudgments:sourceLabels,sourceContext:{before:diagnosticPassage.contextBefore,after:diagnosticPassage.contextAfter}};
diagnosticResults.judgments=await grade(6,'equal-context-diagnostic-grade',[packet]);write(`${run}/context-delivery-diagnostic.json`,diagnosticResults);
