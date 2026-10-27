"""External-only acceptance; no output is supplied to HTN repair."""
import json,hashlib,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;RUN=HERE/'runs/2026-10-14-candidate-delivery';OLD=HERE/'runs/2026-10-14-htn'
assert (RUN/'translations-final-frozen.json').exists(),'Freeze final entry and translations before external evaluation'
frozen=json.loads((RUN/'translations-final-frozen.json').read_text())
for name,h in frozen['files'].items():assert hashlib.sha256((RUN/name).read_bytes()).hexdigest()==h
def read(p):return json.loads(p.read_text())
def write(n,v):p=RUN/'assessment-only'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
criteria=Path('/Users/hans/Desktop/GLOSSARY RESEARCH SPANISH TEST TERMS').read_text().split('1. Mundo:',1)[1].split('\n2.',1)[0].strip()
labels=[read(OLD/'terms/01'/f'source-labels-{j}.json') for j in [1,2]];source=read(RUN/'source.json');source['passages']+=read(RUN/'plural-regression.json');packets=[];maps=[]
for rep in [1,2]:
 translations={a:read(RUN/f'translations/{a}-{rep}.json')+read(RUN/f'translations/plural-{a}-{rep}.json') for a in ['no-glossary','old-glossary','repaired-glossary']}
 for judge in [1,2]:
  for p in source['passages']:
   pid=str(p['itemId']);sides=dict(zip('ABC',sorted(translations,key=lambda a:hashlib.sha256(f'{rep}:{judge}:{pid}:{a}'.encode()).hexdigest())))
   packets.append({'rep':rep,'judge':judge,'packet':{'id':f'{rep}:{pid}','term':'mundo','source':p['text'],'before':p['contextBefore'],'after':p['contextAfter'],'sourceJudgments':[next((x for x in l if x['id']==pid),None) for l in labels],'criteria':criteria,**{side:next(t['translation'] for t in translations[arm] if t['id']==pid) for side,arm in sides.items()}}})
   maps.append({'rep':rep,'judge':judge,'id':f'{rep}:{pid}','sides':sides})
write('packets.json',packets);write('blinding-key.json',maps)
write('controls.json',read(HERE/'runs/2026-10-14-equal-compute/assessment-only/controls.json'))
write('freeze.json',{'criterionAccess':'External evaluator only; never sent to repair/translation','workflowsFrozen':frozen})
subprocess.check_call(['python3',str(HERE/'candidate_repair.py'),'evaluate','--workers','1'])
