"""Finish the frequency-order, rubric-blind amended benchmark with bounded queues."""
import subprocess,time,json,hashlib
from concurrent.futures import ThreadPoolExecutor
from htn_runner import HERE,RUN
from htn_prepare import TERMS
from efficient_design import read,write
start=time.monotonic()
while not all((RUN/'terms'/f'{i:02}'/'blind-end-check.json').exists() for i in range(1,8)):
 if time.monotonic()-start>1800:raise RuntimeError('Blind check incomplete; missing/invalid proposals are not passes')
 time.sleep(10)
def process(i):
 d=RUN/'terms'/f'{i:02}';languages=TERMS[i-1][1]
 subprocess.check_call(['python3',str(HERE/'htn_amended.py'),'frequency','--indices',str(i),'--workers','1'])
 if not all((d/'htn-v7'/l/'frequency.json').exists() for l in languages):return {'index':i,'stage':'frequency','status':'incomplete'}
 for l in languages:
  prior=read(d/'htn-v4'/l/'human-hints-only-assessment-all.json')
  if prior is not None:write(d/'htn-v7'/l/'human-hints-only-assessment-all.json',prior)
 for phase in ['translate','evaluate']:
  subprocess.check_call(['python3',str(HERE/'htn_runner.py'),phase,'--indices',str(i),'--workers','1','--method','htn-v7','--source-context','neighbors','--consumer-rules','consumer-rules-frequency.json','--role','all'])
  if phase=='translate' and not all((d/'htn-v7'/l/'htn.json').exists() for l in languages):return {'index':i,'stage':phase,'status':'incomplete'}
 return {'index':i,'status':'finished' if all((d/'htn-v7'/l/f'{arm}-assessment-all.json').exists() for l in languages for arm in ['htn','human-hints-only']) else 'incomplete'}
with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(process,[6,5,1,2,3,4,7]))
write(RUN/'amended-pipeline.json',{'seconds':time.monotonic()-start,'results':results,'method':'htn-v7','blindCheck':'Development only, no acceptance rubric/verdict/source labels; one proposed notes/order repair','frequency':'Independent source sample; two occurrence-level candidate-use judgments, unresolved choices retained','sourceContext':'Identical source neighbors in all arms; exact baseline/hints outputs reused','priorRegime':'v4 retained as diagnostic; final amended regime is frequency order and blind final-check notes'})
subprocess.check_call(['python3',str(HERE/'htn_report.py')])
