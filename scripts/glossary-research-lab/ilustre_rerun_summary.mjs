import fs from 'node:fs';
import { buildStudioDraft, finalUsage, entryTrialsAreCurrent } from '../../src-ui/app/glossary-research-studio-workflow.js';
const run=process.argv[2],s=JSON.parse(fs.readFileSync(`${run}/study.json`,'utf8'));
const draft=buildStudioDraft(s);
fs.writeFileSync(`${run}/entry-summary.json`,JSON.stringify({draft,usage:finalUsage(s),entryTrialsCurrent:entryTrialsAreCurrent(s),
 candidates:s.candidates,meanings:s.meanings,paragraphs:s.passages.length,assignmentCounts:Object.fromEntries(s.meanings.map(m=>[m.id,s.assignments.filter(a=>a.meaningId===m.id).length])),
 noteResearch:s.steps['6'].value.research,noteRepairReports:Object.values(s.reports).filter(r=>r.kind==='usage-notes')},null,2)+'\n');
