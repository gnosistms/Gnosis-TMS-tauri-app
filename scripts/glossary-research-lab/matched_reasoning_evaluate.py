"""Prepare external-only criteria and blind evaluation packets after workflow freeze."""
import json,hashlib,subprocess,argparse
from pathlib import Path
HERE=Path(__file__).resolve().parent;RUN=HERE/'runs/2026-10-14-equal-compute';OLD=HERE/'runs/2026-10-14-htn';PROBE=HERE/'runs/2026-10-14-meaning-binding'
def read(p):return json.loads(p.read_text())
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
p=argparse.ArgumentParser();p.add_argument('--cohort',choices=['primary','budgeted'],default='primary');args=p.parse_args();suffix='-budgeted' if args.cohort=='budgeted' else ''
assert (RUN/'workflows-frozen.json').exists(),'Both workflow outputs must be frozen first'
if suffix:assert (RUN/'budgeted-workflows-frozen.json').exists(),'Budgeted no-glossary outputs must freeze before evaluation'
source=read(RUN/'source.json');baseline=read(PROBE/'source.json')['baseline'];labels=[read(OLD/'terms/01'/f'source-labels-{j}.json') for j in [1,2]]
full=Path('/Users/hans/Desktop/GLOSSARY RESEARCH SPANISH TEST TERMS').read_text();criteria=full.split('1. Mundo:',1)[1].split('\n2.',1)[0].strip()
controls=[]
def control(name,text,candidates,statuses):
 for mirrored in [False,True]:
  order=['z','x','y'] if mirrored else ['x','y','z'];sides={side:key for side,key in zip('ABC',order)}
  controls.append({'packet':{'id':name+('-mirrored' if mirrored else ''),'term':source['term'],'source':text,'before':[],'after':[],'sourceJudgments':[],'criteria':criteria,**{side:candidates[key] for side,key in sides.items()}},'expected':{dim+side:value for side,key in sides.items() for dim,value in statuses[key].items()}})
def status(accuracy,policy):return {'accuracy':accuracy,'policy':policy,'wholePassage':accuracy}
control('physical','El núcleo de nuestro mundo Tierra está formado por materiales físicos.',{'x':'The core of our world, Earth, is made of physical materials.','y':'The core of our planet Earth is made of physical materials.','z':'The core of our spiritual realm is made of physical materials.'},{'x':status('faithful','fail'),'y':status('faithful','pass'),'z':status('material_error','fail')})
control('sun','Nuestro Sistema Solar tiene cuatro mundos: Tierra, Venus, Marte y Sol.',{'x':'Our Solar System has four planets: Earth, Venus, Mars and the Sun.','y':'Our Solar System has four worlds: Earth, Venus, Mars and the Sun.','z':'Our Solar System has four celestial bodies: Earth, Venus, Mars and the Sun.'},{'x':status('material_error','fail'),'y':status('faithful','pass'),'z':status('faithful','pass')})
control('realm','Estos mundos suprasensibles son planos de conciencia, no cuerpos celestes.',{'x':'These supersensible planets are planes of consciousness, not celestial bodies.','y':'These supersensible realms are planes of consciousness, not celestial bodies.','z':'These supersensible worlds are planes of consciousness, not celestial bodies.'},{'x':status('material_error','fail'),'y':status('faithful','pass'),'z':status('faithful','pass')})
control('everyone','Todo el mundo me escucha.',{'x':'All the planets listen to me.','y':'Everyone listens to me.','z':'Everybody listens to me.'},{'x':status('material_error','fail'),'y':status('faithful','pass'),'z':status('faithful','pass')})
control('number','Nuestro Sistema Solar tiene cuatro mundos: Tierra, Venus, Marte y Sol.',{'x':'Our Solar System has three worlds: Earth, Venus, Mars and the Sun.','y':'Our Solar System has four worlds: Earth, Venus, Mars and the Sun.','z':'Our Solar System has four celestial bodies: Earth, Venus, Mars and the Sun.'},{'x':status('material_error','pass'),'y':status('faithful','pass'),'z':status('faithful','pass')})
write(RUN/'assessment-only/controls.json',controls)
packets=[];maps=[]
for rep in [1,2]:
 translations={arm:read(RUN/'workflows'/arm/str(rep)/'translations.json') for arm in ['no-glossary','glossary']}
 if suffix:translations['no-glossary-budgeted']=read(RUN/'workflows/no-glossary-budgeted'/str(rep)/'translations.json')
 else:translations['one-pass']=baseline
 for judge in [1,2]:
  for p in source['passages']:
   pid=str(p['itemId']);order=sorted(translations,key=lambda arm:hashlib.sha256(f'{rep}:{judge}:{pid}:{arm}'.encode()).hexdigest());sides=dict(zip('ABC',order));caseId=f'{rep}:{pid}'
   packets.append({'judge':judge,'rep':rep,'packet':{'id':caseId,'term':source['term'],'source':p['text'],'before':p['contextBefore'],'after':p['contextAfter'],'sourceJudgments':[next((x for x in l if x['id']==pid),None) for l in labels],'criteria':criteria,**{side:next(t['translation'] for t in translations[arm] if t['id']==pid) for side,arm in sides.items()}}})
   maps.append({'id':caseId,'rep':rep,'judge':judge,'sides':sides})
write(RUN/f'assessment-only/packets{suffix}.json',packets);write(RUN/f'assessment-only/blinding-key{suffix}.json',maps)
write(RUN/f'assessment-only/freeze{suffix}.json',{'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (RUN/'assessment-only').glob('*.json') if not p.name.startswith('freeze')},'criteriaSource':'Desktop/GLOSSARY RESEARCH SPANISH TEST TERMS','criterionAccess':'External evaluator only; workflows frozen before preparation; no feedback to either workflow'})
subprocess.check_call(['python3',str(HERE/'matched_reasoning.py'),'evaluate','--workers','2','--cohort',args.cohort])
