"""Consume completed full-research checkpoints without changing frozen research/scoring."""
import argparse
import concurrent.futures
import json
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE / 'runs/2026-10-13-full-preservation'
RUNNER = 'full_research.py'
METHODS = ('full-original', 'full-preserved')
REPORT_NAME = 'pipeline-status.json'

def read(p):
    return json.loads(p.read_text()) if p.exists() else None

def process(language, index):
    run = ROOT / language
    folder = run / 'terms' / f'{index:02}'
    entry = read(folder / 'baseline/entry.json')
    if not entry.get('entries'):
        return {'language': language, 'index': index, 'status': 'untestable', 'reason': entry.get('status')}
    for phase in ('compile', 'translate', 'evaluate', 'confirm'):
        methods = METHODS[:1] if phase == 'compile' else METHODS
        for method in methods:
            cmd = ['python3', str(HERE/RUNNER), phase, '--language', language,
                   '--indices', str(index), '--method', method, '--workers', '1']
            result = subprocess.run(cmd)
            if result.returncode:
                return {'language': language, 'index': index, 'status': 'failed', 'phase': phase, 'method': method}
    return {'language': language, 'index': index, 'status': 'complete'}

def main():
    parser = argparse.ArgumentParser()
    global RUNNER, METHODS, REPORT_NAME
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--runner', choices=['full_research.py','full_v2.py'], default='full_research.py')
    args = parser.parse_args()
    RUNNER = args.runner
    if RUNNER == 'full_v2.py':
        METHODS = ('full-preserved-v2',)
        REPORT_NAME = 'v2-pipeline-status.json'
    start = time.time()
    pending = {(language, index) for language in ('vi', 'en') for index, _ in enumerate(read(ROOT/language/'manifest.json')['terms'], 1)}
    running = {}; results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        while pending or running:
            for future in list(running):
                if future.done():
                    key = running.pop(future)
                    try: result = future.result()
                    except Exception as e: result = {'language': key[0], 'index': key[1], 'status': 'failed', 'reason': str(e)}
                    results.append(result)
                    (ROOT/REPORT_NAME).write_text(json.dumps({'results': results, 'pending': sorted(pending), 'running': list(running.values())}, indent=2)+'\n')
                    print(json.dumps(result), flush=True)
            for key in sorted(pending):
                if len(running) >= args.workers: break
                language, index = key
                if (ROOT/language/'terms'/f'{index:02}'/'baseline/entry.json').exists():
                    pending.remove(key); running[pool.submit(process, language, index)] = key
            for language in ('vi', 'en'):
                done = ROOT/language/'phase-research-full-preserved-.json'
                if done.exists() and done.stat().st_mtime >= start:
                    for key in sorted(pending):
                        if key[0] == language and not (ROOT/language/'terms'/f'{key[1]:02}'/'baseline/entry.json').exists():
                            pending.remove(key);results.append({'language': language, 'index': key[1], 'status': 'research-incomplete'})
            if pending or running: time.sleep(5)
    (ROOT/REPORT_NAME).write_text(json.dumps({'results': results, 'pending': [], 'running': []}, indent=2)+'\n')
    raise SystemExit(int(any(r['status'] in ('failed', 'research-incomplete') for r in results)))

if __name__ == '__main__': main()
