/** Read-only audit of saved full-pipeline evidence; no inference or production writes. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditFrozen,auditSaved,SAFEGUARDS,retirementGate} from './full_research_contracts.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(here,'runs/2026-10-13-full-preservation');
const load=p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null;
const key=s=>String(s??'').normalize('NFC').toLowerCase().trim();
const rows=[];
for(const parent of ['2026-10-12','2026-10-12-focused']){
 const root=path.join(here,'runs',parent),manifest=load(path.join(root,'manifest.json'));
 for(let i=0;i<manifest.terms.length;i++)for(const method of ['baseline','baseline-human']){
  const dir=path.join(root,'terms',String(i+1).padStart(2,'0'),method),stages={};
  if(!fs.existsSync(path.join(dir,'stages')))continue;
  for(const f of fs.readdirSync(path.join(dir,'stages')).filter(f=>f.endsWith('.json')))stages[f.slice(0,-5)]=load(path.join(dir,'stages',f));
  const proposal=stages.confirmedProposal??stages.proposal,entry=load(path.join(dir,'entry.json'));
  if(!proposal||!stages.frozen)continue;
  const frozenIssues=auditFrozen(proposal,stages.frozen),saveIssues=entry?auditSaved(stages,entry):[];
  const finalTargets=new Set((entry?.entries??[]).flatMap(e=>e.variants.map(v=>key(v.target))));
  const labels=new Map();
  for(const e of proposal.entries)for(const v of e.variants)for(const sense of v.senses??[]){const k=key(sense);if(!labels.has(k))labels.set(k,new Set());labels.get(k).add(v.target);}
  const uncoveredLabels=entry?[...labels].filter(([,targets])=>![...targets].some(t=>finalTargets.has(key(t)))).map(([label,targets])=>({label,proposedTargets:[...targets],status:'all proposed renderings absent; inspect evidence and disposition'})):[];
  const proposalIds=new Set(proposal.entries.flatMap(e=>e.variants.map(v=>v.id)));
  const actualFootnotes=(stages.footnotes??[]).filter(n=>n.note?.trim());
  const narrowed=(stages.consistency?.narrowed??[]).filter(n=>proposalIds.has(n.variantId));
  rows.push({parent,index:i+1,term:manifest.terms[i].source_terms[0],method,complete:!!entry,
   frozenIssues,saveIssues,uncoveredLabels,actualFootnotes:actualFootnotes.length,narrowed:narrowed.length,
   source:dir,limitations:['Metadata loss does not by itself prove wrong translation; contextual sensitivity tests are required.',
    'A proposal label is an AI research finding, not automatically an approved human meaning criterion.']});
 }
}
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'saved-flow-audit.json'),JSON.stringify(rows,null,2));
const gates=SAFEGUARDS.map(s=>retirementGate(s,{cases:{},noGlossaryComparisonComplete:false,randomRegressionComplete:false,confirmedNewMeaningErrors:0}));
fs.writeFileSync(path.join(output,'step-retirement-status.json'),JSON.stringify(gates,null,2));
const lines=['# Full research preservation: local audit','',
 'Start from the full procedure. No stage removal is approved. No new live research or translation comparison has run.', '',
 `Saved full-run records inspected: ${rows.length}. Frozen records losing structured meaning metadata: ${rows.filter(r=>r.frozenIssues.length).length}.`, '',
 'These are data-flow findings, not measured translation defects. A short note can sometimes preserve the same meaning; the domain-specific mutation controls must test that distinction.', '',
 '| Term | Reference | Freeze issues | Save/scope issues | Meaning labels with no final target |',
 '|---|---|---:|---:|---:|',...rows.map(r=>`| ${r.term} | ${r.parent}/${r.method} | ${r.frozenIssues.length} | ${r.saveIssues.length} | ${r.uncoveredLabels.length} |`), '',
 '## Observable paths to validate', '',
 '- Proposal variants have sense labels and corpus explanations; the real freeze helper omits those fields while keeping short notes.',
 '- A consistency narrowing is displayed separately; verify that the saved selection note or structured consumer scope actually incorporates it.',
 '- Reader explanations generated late in research must be checked through the real save payload. Intermediate report display is insufficient.',
 '- Rarity pruning can leave an entire proposed meaning without a surviving target. Determine whether that meaning is required, unsupported, intentionally merged or mistakenly lost.', '',
 '## Acceptance gates', '',
 'Every safeguard is blocked until its named case, injected fault, acceptable control, actual result, consumer preservation and no-glossary baseline are complete. Random wins cannot override a failed named case. AI judges apply frozen human/inferred criteria; contested cases remain pending human review.', '',
 'Live tests remain pending execution approval after automatic review rejected sending the earlier corpus batch to ChatGPT. The earlier one-call experiment is parked and untested.' ];
fs.writeFileSync(path.join(output,'AUDIT.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({savedFullRecords:rows.length,freezeAffected:rows.filter(r=>r.frozenIssues.length).length,scopeAffected:rows.filter(r=>r.saveIssues.length).length,
 labelsWithoutFinalTargets:rows.filter(r=>r.uncoveredLabels.length).length,retirementGates:gates.length,allGatesBlocked:gates.every(g=>g.status==='blocked')}));
