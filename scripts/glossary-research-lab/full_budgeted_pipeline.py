"""Finish the registered initial candidate-budget cohort as checkpoints become ready."""
import concurrent.futures,json,subprocess,time
from full_research import HERE,ROOT,read,write
COHORT={'vi':[1,2,3,4,17],'en':[1,2,4,5,6,7,13]}

def process(language,index):
    entry=read(ROOT/language/'terms'/f'{index:02}'/'full-budgeted-raw/entry.json')
    if not entry.get('entries'):return {'language':language,'index':index,'status':'untestable','reason':entry.get('status')}
    for phase in ('compile','translate','evaluate','confirm'):
        r=subprocess.run(['python3',str(HERE/'full_budgeted.py'),phase,'--language',language,'--indices',str(index),'--workers','1'])
        if r.returncode:return {'language':language,'index':index,'status':'failed','phase':phase}
    return {'language':language,'index':index,'status':'complete'}

def main():
    pending={(l,i) for l,ids in COHORT.items() for i in ids};running={};results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        while pending or running:
            for f in list(running):
                if f.done():
                    key=running.pop(f)
                    try:r=f.result()
                    except Exception as e:r={'language':key[0],'index':key[1],'status':'failed','reason':str(e)}
                    results.append(r);print(json.dumps(r),flush=True)
            for key in sorted(pending):
                if len(running)>=2:break
                l,i=key
                if (ROOT/l/'terms'/f'{i:02}'/'full-budgeted-raw/entry.json').exists():pending.remove(key);running[pool.submit(process,l,i)]=key
            write(ROOT/'budgeted-pipeline-status.json',{'results':results,'pending':sorted(pending),'running':list(running.values())})
            if pending or running:time.sleep(5)
    raise SystemExit(int(any(r['status']=='failed' for r in results)))

if __name__=='__main__':main()
