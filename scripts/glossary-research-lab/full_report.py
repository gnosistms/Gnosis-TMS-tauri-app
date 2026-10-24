"""Report observed full-procedure comparisons; missing cases never become passes."""
from collections import Counter
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE / 'runs/2026-10-13-full-preservation'
METHODS = ('full-original', 'full-preserved', 'full-preserved-v2')
DIMS = ('accuracy', 'policy', 'naturalness')

def read(path):
    return json.loads(path.read_text()) if path.exists() else None

def main():
    report = {'languages': {}, 'limitations': [
        'AI applies frozen human/inferred criteria; judgments are provisional where domain evidence is disputed.',
        'Confirmed gains and harms require two independent blind assessments agreeing in direction.',
        'Same no-glossary drafts serve both methods. Full research is shared; preservation adds zero research calls.',
        'Reused development and sparse overlapping passages establish behavior, not fresh out-of-sample generalization.',
        'No stage is removed; step-specific uncovered cases continue to block retirement.',
        'Observed subscription-runner tokens include its runtime prompt and repeated web turns; these are not app token estimates.'
    ]}
    examples = []
    for language in ('vi', 'en'):
        run = ROOT/language
        manifest = read(run/'manifest.json')
        terms = []; totals = {m: {dim: Counter() for dim in DIMS} for m in METHODS}
        requests = [json.loads(line) for line in (run/'requests.jsonl').read_text().splitlines()] if (run/'requests.jsonl').exists() else []
        role_cost = {}
        for r in requests:
            bucket = role_cost.setdefault(r['role'], {'calls': 0, 'failedCalls': 0, 'inputTokens': 0, 'cachedInputTokens': 0, 'outputTokens': 0, 'callSeconds': 0, 'unknownUsage': 0})
            bucket['calls'] += 1;bucket['failedCalls'] += r['status'] != 'ok';bucket['callSeconds'] += r['seconds']
            usage = r.get('usage')
            if not usage: bucket['unknownUsage'] += 1;continue
            for name, field in [('inputTokens','input_tokens'),('cachedInputTokens','cached_input_tokens'),('outputTokens','output_tokens')]:bucket[name] += usage.get(field) or 0
        for index, term in enumerate(manifest['terms'], 1):
            folder = run/'terms'/f'{index:02}'
            evidence = read(folder/'evidence.json')
            entry = read(folder/'baseline/entry.json')
            row = {'index': index, 'term': term['source_terms'][0], 'historical': term.get('historical',False),
                   'explicitOrInferredCriterion': row_criterion(run,term['source_terms'][0],language),
                   'passages': len(evidence['evaluation']), 'overlappingPassages': evidence.get('overlap',0),
                   'fullStatus': entry.get('status') if entry else 'pending', 'methods': {}}
            repair = read(folder/'full-preserved/preservation.json')
            if repair: row['preservation'] = {'changes':dict(Counter(c['kind'] for c in repair['changes'])), 'unresolved':repair['unresolved']}
            for method in METHODS:
                confirmed = read(folder/method/'confirmed.json')
                judgments = read(folder/method/'judgments.json')
                counts = {dim:Counter() for dim in DIMS}
                if confirmed is not None:
                    for c in confirmed:
                        for dim in DIMS:counts[dim][str(c['effects'][dim])] += 1;totals[method][dim][str(c['effects'][dim])] += 1
                        if any(c['effects'].values()):
                            p = next(p for p in evidence['evaluation'] if str(p['itemId']) == c['id'])
                            baseline = next(p['translation'] for p in read(folder/'no-glossary.json') if p['id']==c['id'])
                            candidate = next(p['translation'] for p in read(folder/method/'translations.json') if p['id']==c['id'])
                            examples.append({'language':language,'index':index,'term':row['term'],'method':method,'id':c['id'],'source':p['text'],'reference':p['reference'],
                                             'baseline':baseline,'candidate':candidate,'effects':c['effects'],'first':c['first'],'second':c['second']})
                row['methods'][method] = {'complete':confirmed is not None,'assessed':len(judgments or []),'confirmed':len(confirmed or []),'effects':counts}
            terms.append(row)
        report['languages'][language] = {'calibration':read(run/'calibration/result.json'),'terms':terms,'totals':totals,'roleCost':role_cost,'extraCalibration':read(run/'extra-calibration/result.json'),
                                        'fullResearchTiming':read(run/'phase-research-full-preserved-.json')}
    (ROOT/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'confirmed-examples.json').write_text(json.dumps(examples,ensure_ascii=False,indent=2)+'\n')
    lines = ['# Full research: original and preserved findings', '',
             'This report includes only completed observations. Missing results are pending or untestable, never passes. Semantic accuracy, required terminology and naturalness remain separate.', '']
    for language,data in report['languages'].items():
        lines += [f'## {language.upper()}', '',f"Calibration: {data['calibration']['presentations']} presentations, passed={data['calibration']['passed']}.",'',
                  '| Term | Evaluated passages | Original: meaning + / − | Revised preservation: meaning + / − | Revised preservation: policy + / − | Status |',
                  '|---|---:|---:|---:|---:|---|']
        for t in data['terms']:
            def effect(method,dim):
                d=t['methods'][method]
                return f"{d['effects'][dim].get('1',0)} / {d['effects'][dim].get('-1',0)}" if d['complete'] else 'pending'
            complete=all(t['methods'][m]['complete'] for m in ('full-original','full-preserved-v2'))
            status='complete' if complete else t['fullStatus']
            if t['overlappingPassages']: status += '; overlap'
            lines.append(f"| {t['term']} | {t['passages']} | {effect('full-original','accuracy')} | {effect('full-preserved-v2','accuracy')} | {effect('full-preserved-v2','policy')} | {status} |")
        lines += ['', 'Observed subscription-runner costs (all retries included):','', '| Role | Calls | Failed | Input tokens | Output tokens | Sum of call seconds |', '|---|---:|---:|---:|---:|---:|']
        for role,c in data['roleCost'].items(): lines.append(f"| {role} | {c['calls']} | {c['failedCalls']} | {c['inputTokens']} | {c['outputTokens']} | {c['callSeconds']:.1f} |")
        lines += ['']
    lines += ['## Limits', ''] + ['- '+s for s in report['limitations']]
    lines += ['', 'Full translation examples and both independent reasons are recorded in `confirmed-examples.json`. No production change or step retirement is implied by this report.','']
    (ROOT/'RESULTS.md').write_text('\n'.join(lines))
    print(json.dumps({lang:{'completeTerms':sum(all(t['methods'][m]['complete'] for m in METHODS) for t in v['terms']),'totalTerms':len(v['terms']),'totals':v['totals']} for lang,v in report['languages'].items()}))

def row_criterion(run,term,language):
    return read(run/'assessment-only/criteria.json').get(term,{}).get(language,{}).get('origin')

if __name__ == '__main__':main()
