"""One final evaluation queue; waits for completed equal-context translations."""
import subprocess,time,json
from htn_runner import HERE,RUN
from htn_prepare import TERMS
started=time.monotonic();pending={i for i in range(1,8)};failures=[]
while pending:
 ready=[i for i in sorted(pending) if all((RUN/'terms'/f'{i:02}'/('htn-v4' if arm=='htn' else 'context-baseline')/lang/(arm+'.json')).exists() for lang in TERMS[i-1][1] for arm in ['no-glossary','human-hints-only','htn'])]
 if not ready:
  if time.monotonic()-started>7200:raise RuntimeError('Final translations incomplete after bounded two-hour wait: '+str(sorted(pending)))
  time.sleep(10);continue
 for i in ready:
  p=subprocess.run(['python3',str(HERE/'htn_runner.py'),'evaluate','--indices',str(i),'--method','htn-v4','--source-context','neighbors','--role','all','--workers','1'])
  if p.returncode:failures.append({'index':i,'code':p.returncode})
  pending.remove(i)
  subprocess.run(['python3',str(HERE/'htn_report.py')])
(RUN/'final-pipeline.json').write_text(json.dumps({'seconds':time.monotonic()-started,'failures':failures,'note':'Per-term completeness comes from result denominators, not controller exit status.'},indent=2))
