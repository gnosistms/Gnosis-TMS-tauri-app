"""One post-confirmation treatment, checked on all fatal cases; not fresh confirmation."""
import subprocess,time,json
from htn_runner import HERE,RUN
from efficient_design import read,write
start=time.monotonic()
while not all((RUN/'terms/06/htn-v4'/lang/'htn-assessment-all.json').exists() for lang in ['en','vi']):
 if time.monotonic()-start>7200:raise RuntimeError('v4 fatal assessment not ready')
 time.sleep(10)
diagnostic=read(RUN/'selection-contract-diagnostic.json')
if not diagnostic or any(diagnostic[j]['accuracy'+diagnostic[j]['candidateSide']]!='faithful' for j in ['first','second']):
 raise RuntimeError('Selection contract did not pass its diagnostic; no automatic further repair')
script="""import fs from 'node:fs';import {attachSelectionContract,decisionSignature} from './scripts/glossary-research-lab/htn_core.mjs';
const d='scripts/glossary-research-lab/runs/2026-10-14-htn/terms/06';const signatures={};
for(const lang of ['en','vi']){const prior=JSON.parse(fs.readFileSync(`${d}/htn-v4/${lang}/saved-glossary.json`));const saved=attachSelectionContract(prior);fs.mkdirSync(`${d}/htn-v5/${lang}`,{recursive:true});fs.writeFileSync(`${d}/htn-v5/${lang}/saved-glossary.json`,JSON.stringify(saved,null,2));signatures[lang]=decisionSignature({saved});}
fs.writeFileSync(`${d}/compiled-htn-v5.json`,JSON.stringify({signatures,exposure:'Post-confirmation diagnostic/regression; exposed failure, not fresh held-out validation',change:'One generic selection contract; candidates, scopes and source evidence unchanged'},null,2));"""
subprocess.check_call(['node','--input-type=module','-e',script],cwd=HERE.parents[1])
for lang in ['en','vi']:
 write(RUN/'terms/06/htn-v5'/lang/'human-hints-only-assessment-all.json',read(RUN/'terms/06/htn-v4'/lang/'human-hints-only-assessment-all.json'))
for phase in ['translate','evaluate']:
 subprocess.check_call(['python3',str(HERE/'htn_runner.py'),phase,'--indices','6','--method','htn-v5','--source-context','neighbors','--role','all','--workers','1'])
subprocess.check_call(['python3',str(HERE/'htn_report.py')])
write(RUN/'selection-contract-regression.json',{'seconds':time.monotonic()-start,'method':'htn-v5','exposure':'Post-confirmation diagnostic/regression, not independent confirmation','note':'All original v4 results retained. Same source context, baseline and human-hints outputs reused. No new research call or candidate added.'})
