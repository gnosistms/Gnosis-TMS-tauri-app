"""Explicit source-selected coverage additions; original benchmark remains immutable."""
import argparse
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path
from full_research import HERE, ROOT, read, write

def prepare():
    dest=ROOT/'additional-challenges'
    if (dest/'freeze.json').exists():return dest
    source=read(ROOT/'additional-source-challenges.json')
    cases=[]
    for i,row in enumerate(source,1):
        label=row['case'];s=row['source']
        terms=['Íntimo'] if label=='intimo-adjective' else ['ultrasensible','hipersensible'] if label=='ultra-hyper-contrast' else ['alquimistas']
        languages=['vi','en'] if label!='alquimistas-adjective' else ['vi']
        cases.append({'id':f'extra-{i:02}', 'case':label,'terms':terms,'languages':languages,'source':s['text'],
                      'sourceId':s['item_id'],'reference':s['representative'],'occurrences':s['occurrences'],
                      'qualification':'Source selected to cover an explicitly missing construction, not a new random holdout. Actual research overlap is measured when entries finish.'})
    write(dest/'cases.json',cases)
    write(dest/'freeze.json',{'preparedAt':time.time(),'inputs':{'cases.json':hashlib.sha256((dest/'cases.json').read_bytes()).hexdigest()},
        'code':{n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ['lab.mjs','full_research_dispatch.mjs','full_challenges_dispatch.mjs']},
        'knownCaseExpectations':{'intimo-adjective':'ordinary private/close wording, never the specialized divine noun','alquimistas-adjective':'adjective alchemical modifying texts, not people named alchemists','ultra-hyper-contrast':'retain both source labels and contextual readings; a purported exact distinction remains subject to human review'}})
    return dest

def main():
    p=argparse.ArgumentParser();p.add_argument('phase',choices=['prepare','run']);p.add_argument('--language',choices=['vi','en'],default='vi');a=p.parse_args()
    dest=prepare()
    if a.phase=='prepare':print(dest);return
    freeze=read(dest/'freeze.json')
    for name,h in freeze['inputs'].items():assert hashlib.sha256((dest/name).read_bytes()).hexdigest()==h
    for name,h in freeze['code'].items():assert hashlib.sha256((HERE/name).read_bytes()).hexdigest()==h
    base=(HERE/'lab.mjs').read_text();base=base[:base.index("\ntry{\n if(command==='prepare')")]
    full=(HERE/'full_research_dispatch.mjs').read_text();full=full[:full.index('\ntry{\n if(phase===')]
    module=HERE/f'.full-challenges-{os.getpid()}.mjs';module.write_text(base+'\n'+full+'\n'+(HERE/'full_challenges_dispatch.mjs').read_text())
    try:
        subprocess.check_call(['node','--check',str(module)])
        subprocess.check_call(['node',str(module),'challenge','--run',str(ROOT/a.language),'--language',a.language,'--workers','1'])
    finally:module.unlink(missing_ok=True)

if __name__=='__main__':main()
