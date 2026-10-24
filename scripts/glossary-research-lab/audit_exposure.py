"""Conservatively audit full reserved passages embedded in larger research inputs."""
import json, sys
from collections import defaultdict
from pathlib import Path
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).parent/'runs/2026-10-12'
findings=[]
for directory in sorted((root/'terms').iterdir()):
    evidence=json.loads((directory/'evidence.json').read_text())
    if evidence['overlap']:continue
    for method in sorted(p for p in directory.iterdir() if p.is_dir()):
        hits=defaultdict(set)
        for request_file in (method/'calls').rglob('request.json'):
            request=json.loads(request_file.read_text());content=str(request.get('content',''))
            for passage in evidence['evaluation']:
                text=passage['text'];escaped=json.dumps(text,ensure_ascii=False)[1:-1]
                if text in content or escaped in content:hits[request['stage']].add(str(passage['itemId']))
        if hits:findings.append({'term':evidence['term'],'index':int(directory.name),'method':method.name,'exposed_full_evaluation_passages_by_stage':{key:sorted(value) for key,value in hits.items()}})
result={'check':'literal full-text containment in saved research requests, including failed/retried attempts; shorter or reformatted overlapping excerpts may be missed','findings':findings}
(root/'holdout-exposure-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({'method_term_exposures':len(findings),'terms':sorted({x['index'] for x in findings})}))
