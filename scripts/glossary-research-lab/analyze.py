"""Analyze measured calls and blinded preferences, with term-clustered uncertainty."""
import argparse, json, random, statistics, sys
from datetime import datetime
from collections import Counter, defaultdict
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('run',nargs='?',default=str(Path(__file__).parent/'runs/2026-10-12'))
parser.add_argument('--mode',choices=['controlled','independent'],default='controlled')
parser.add_argument('--reference-method',default='baseline-human',choices=['baseline','baseline-human','compact12-precise'])
parser.add_argument('--judge-rubric',choices=['strict','legacy'],default='strict')
args=parser.parse_args();root=Path(args.run)
COST_EXCLUDED={'centro de gravedad','distintos','Disolver','Mundo de las Causas Naturales','solares','infinito espacio'}
ledger=[json.loads(s) for s in (root/'requests.jsonl').read_text().splitlines()] if (root/'requests.jsonl').exists() else []
exposure_file=root/'holdout-exposure-audit.json'
exposures=json.loads(exposure_file.read_text()).get('findings',[]) if exposure_file.exists() else []
exposed={(x['index'],x['method']) for x in exposures}
terms=[]
for term_dir in sorted((root/'terms').glob('*')):
    e=json.loads((term_dir/'evidence.json').read_text())
    terms.append((term_dir,e))

def cost(records):
    return {'calls':len(records),'call_seconds':round(sum(r['seconds'] for r in records),2),
            'input':sum((r.get('usage') or {}).get('input_tokens',0) for r in records),
            'uncached_input':sum(max(0,(r.get('usage') or {}).get('input_tokens',0)-(r.get('usage') or {}).get('cached_input_tokens',0)) for r in records),
            'cached':sum((r.get('usage') or {}).get('cached_input_tokens',0) for r in records),
            'output':sum((r.get('usage') or {}).get('output_tokens',0) for r in records),
            'unknown_usage':sum(r.get('usage') is None for r in records),'failures':sum(r['status']!='ok' for r in records)}

def bootstrap(values):
    if len(values)<2:return None
    rng=random.Random(2070955783)
    draws=sorted(statistics.mean(rng.choices(values,k=len(values))) for _ in range(10000))
    return [round(draws[249],4),round(draws[9749],4)]

summary={'globally_unique_evaluation_texts':len({x['text'] for _,e in terms for x in e['evaluation']}),'term_passage_pairs':sum(len(e['evaluation']) for _,e in terms),'judge_rubric':args.judge_rubric,'reference_method':args.reference_method,'phase_timings':{},'completion':{},'baseline_audits':[],'evaluation_mode':args.mode,'full_text_exposure_audit':exposures,'sampled':len(terms),'zero_hit':[],'sparse':[],'methods':{},'stage_costs':{},'cost_exclusions':sorted(COST_EXCLUDED),'all_measured_cost':cost(ledger),'limitations':[
    'Same-model blind judging is independent by context, not by model family.',
    'Sparse terms necessarily reuse research passages; their quality evidence is not held out.',
    'Interrupted/overlapping controller work is retained in actual cost and excluded from paired savings for affected terms.',
    'Sequential methods experience different service/cache conditions; call-seconds are work, not wall time.',
    'Exploratory multiple comparisons and small term sample cannot prove universal quality equivalence.',
    'Compact methods reuse dictionary evidence; its measured acquisition cost must be included.',
    'The CLI cannot reproduce the native DLE webview or enforce production output-token caps.',
]}
for d,e in terms:
    engine_log=d/'baseline/engine-log.jsonl'
    if engine_log.exists() and e['term'] not in COST_EXCLUDED:
        headings=[x for x in (json.loads(line) for line in engine_log.read_text().splitlines()) if x.get('type')=='heading']
        times=[]
        for a,b in zip(headings,headings[1:]):
            seconds=(datetime.fromisoformat(b['at'].replace('Z','+00:00'))-datetime.fromisoformat(a['at'].replace('Z','+00:00'))).total_seconds()
            if seconds>=0:times.append({'phase':a['text'],'seconds':round(seconds,3)})
        summary['phase_timings'][e['term']]=times
    summary['completion'][e['term']]={m:json.loads((d/m/'entry.json').read_text()).get('status') if (d/m/'entry.json').exists() else 'pending' for m in ['baseline','baseline-human','compact30','compact12','compact12-repair','compact12-repair-nodict','compact12-precise-nodict','compact12-precise','compact12-audited','no-count','curated-proposal']}
    for baseline_method in ['baseline','baseline-human']:
        aggregate=d/baseline_method/'stages/aggregate.json'
        counting=d/baseline_method/'stages/counting.json'
        if aggregate.exists():
            counts=json.loads(aggregate.read_text())['totals']
            occurrences=json.loads(counting.read_text()).get('occurrences',[]) if counting.exists() else []
            unassigned=sum(o.get('entryId')=='unassigned' for o in occurrences)
            summary['baseline_audits'].append({'method':baseline_method,'term':e['term'],'sampled_occurrences':len(occurrences),'unassigned_occurrences':unassigned,'outcomes':counts['outcomes'],'agreement':counts.get('agreement'),
                'counting_valid_for_variant_selection':bool(occurrences) and unassigned==0 and not any(counts['outcomes'].get(k,0) for k in ['failed','notRun'])})
    if not e['population']['distinct']:summary['zero_hit'].append(e['term'])
    elif e['overlap']:summary['sparse'].append({'term':e['term'],'results':len(e['evaluation'])})
for method in ['baseline-human','no-count','compact30','compact12','compact12-repair','compact12-repair-nodict','compact12-precise-nodict','compact12-precise','compact12-audited','curated-proposal']:
    details=[];base_records=[];variant_records=[]
    for d,e in terms:
        controlled=args.mode=='controlled'
        file=d/method/('controlled' if controlled else '')/(f'vs-{args.reference_method}' if args.reference_method!='baseline' else '')/('strict' if args.judge_rubric=='strict' else '')/'judgments.json'
        if not file.exists():continue
        verified=file.with_name('verified-judgments.json')
        entry_file=d/method/'entry.json'
        entry=json.loads(entry_file.read_text()) if entry_file.exists() else {}
        reused=entry.get('reuses','').split(':')[0]
        if reused.startswith('compact') and ':' in entry.get('reuses',''):
            inherited=d/reused
            inherited=inherited/('controlled' if controlled else '')/(f'vs-{args.reference_method}' if args.reference_method!='baseline' else '')/('strict' if args.judge_rubric=='strict' else '')/'verified-judgments.json'
            own_translation=d/method/('controlled' if controlled else '')/'translations.json'
            parent_translation=d/reused/('controlled' if controlled else '')/'translations.json'
            if inherited.exists() and own_translation.exists() and parent_translation.exists() and json.loads(own_translation.read_text())==json.loads(parent_translation.read_text()):verified=inherited
        judgments=json.loads((verified if verified.exists() else file).read_text());n=len(judgments)
        if not n:continue
        scores={dim:Counter({'win':0,'loss':0,'tie':0}) for dim in ['winner','accuracy','naturalness']}
        absolute=Counter()
        for row in judgments:
            if args.judge_rubric=='strict':
                good=lambda side:row.get('accuracy'+side) in ['faithful','minor_nuance'] and row.get('naturalness'+side) in ['natural','minor_style']
                bad=lambda side:row.get('accuracy'+side)=='material_error' or row.get('naturalness'+side)=='clear_problem'
                absolute['both_acceptable']+=good('A') and good('B')
                absolute['both_accuracy_acceptable']+=all(row.get('accuracy'+side) in ['faithful','minor_nuance'] for side in ['A','B'])
                absolute['both_material_errors']+=all(row.get('accuracy'+side)=='material_error' for side in ['A','B'])
                absolute['candidate_material_error']+=row.get('accuracy'+row['candidateSide'])=='material_error'
                absolute['reference_material_error']+=row.get('accuracy'+('B' if row['candidateSide']=='A' else 'A'))=='material_error'
                absolute['both_need_correction']+=bad('A') and bad('B')
                absolute['candidate_acceptable']+=good(row['candidateSide'])
                absolute['reference_acceptable']+=good('B' if row['candidateSide']=='A' else 'A')
                absolute['uncertain']+=any(row.get(k)=='uncertain' for k in ['accuracyA','accuracyB','naturalnessA','naturalnessB'])
                absolute['unconfirmed_accuracy_differences']+=row['accuracy']!='tie' and row.get('secondCheck')!='checked'
                absolute['unconfirmed_naturalness_differences']+=row['naturalness']!='tie' and row.get('secondCheck')!='checked'
                absolute['second_judge_checked']+=row.get('secondCheck')=='checked'
                absolute['second_judge_disagreement']+=bool(row.get('judgeDisagreement'))
                absolute['rubric_adjusted']+=bool(row.get('rubricAdjusted'))
            for dim in scores:
                outcome='tie' if row[dim]=='tie' else 'win' if row[dim]==row['candidateSide'] else 'loss'
                scores[dim][outcome]+=1
        details.append({'index':int(d.name),'term':e['term'],'evaluation_mode':'controlled' if controlled else 'independent','n':n,'held_out':not e['overlap'],'full_text_exposure':any((int(d.name),m) in exposed for m in [method,args.reference_method,'baseline' if args.reference_method=='baseline-human' else args.reference_method]),'scores':{k:dict(v) for k,v in scores.items()},
                        'absolute':dict(absolute),'net_preference':(scores['winner']['win']-scores['winner']['loss'])/n})
        own=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']==method]
        baseline=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']==args.reference_method]
        if args.reference_method=='compact12-precise':
            baseline+=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']=='baseline' and r['stage']=='dictionary']
        if args.reference_method=='baseline-human':
            reuse=json.loads((d/'baseline-human/reuse.json').read_text()).get('stages',[]) if (d/'baseline-human/reuse.json').exists() else []
            baseline+=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']=='baseline' and (r['stage'] in reuse or (r['stage']=='frequency' and 'parts' in reuse and 'everyday Spanish' in r['purpose']))]
        base_records+=baseline if e['term'] not in COST_EXCLUDED else []
        if method in ['no-count','curated-proposal']:own+=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']=='baseline' and r['stage'] not in ['counting','counting2','consistency','footnotes','summary']]
        elif method=='baseline-human':
            reuse=json.loads((d/method/'reuse.json').read_text()).get('stages',[])
            own+=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']=='baseline' and (r['stage'] in reuse or (r['stage']=='frequency' and 'parts' in reuse and 'everyday Spanish' in r['purpose']))]
        elif method.startswith('compact'):
            entry=json.loads((d/method/'entry.json').read_text())
            if entry.get('parentMethod'):
                own+=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']==entry['parentMethod']]
            elif entry.get('reuses','').split(':')[0].startswith('compact') and ':' in entry.get('reuses',''):
                inherited=entry['reuses'].split(':')[0]
                own=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']==inherited]
            if not method.endswith('nodict'):own+=[r for r in ledger if r['term']==e['term'] and r['role']=='research' and r['method']=='baseline' and r['stage']=='dictionary']
        variant_records+=own if e['term'] not in COST_EXCLUDED else []
    if not details:continue
    values=[r['net_preference'] for r in details]
    score=Counter({'win':0,'loss':0,'tie':0})
    for r in details:score.update(r['scores']['winner'])
    base,candidate=cost(base_records),cost(variant_records)
    savings={k:round(1-candidate[k]/base[k],4) if base[k] else None for k in ['calls','call_seconds','input','uncached_input','output']}
    summary['methods'][method]={'terms':len(details),'passages':sum(d['n'] for d in details),'wins_losses_ties':dict(score),
            'dimensions':{dim:dict(sum((Counter(d['scores'][dim]) for d in details),Counter())) for dim in ['accuracy','naturalness']},'absolute':dict(sum((Counter(d['absolute']) for d in details),Counter())),'term_mean_net_preference':round(statistics.mean(values),4),'term_bootstrap_95ci':bootstrap(values),
            'held_out_terms':sum(d['held_out'] for d in details),'cost_excluded_terms':[d['term'] for d in details if d['term'] in COST_EXCLUDED],'cost_terms':sum(d['term'] not in COST_EXCLUDED for d in details),'baseline_cost':base,'effective_method_cost':candidate,
            'savings':savings,'terms_details':details,
            'accuracy_regressions':[d['term'] for d in details if d['scores']['accuracy'].get('loss',0)>d['scores']['accuracy'].get('win',0)]}
for method,result in summary['methods'].items():
    result['groups']={}
    for name,predicate in [('development',lambda d:d['index']<=20),('confirmation',lambda d:d['index']>20),('held_out',lambda d:d['held_out']),('sparse_overlap',lambda d:not d['held_out']),('no_detected_full_text_exposure',lambda d:d['held_out'] and not d['full_text_exposure'])]:
        group=[d for d in result['terms_details'] if predicate(d)]
        count=Counter()
        for d in group:count.update(d['scores']['winner'])
        result['groups'][name]={'terms':len(group),'passages':sum(d['n'] for d in group),'wins_losses_ties':dict(count),
                'term_mean_net_preference':round(statistics.mean(d['net_preference'] for d in group),4) if group else None,
                'term_bootstrap_95ci':bootstrap([d['net_preference'] for d in group]),
                'accuracy_regressions':[d['term'] for d in group if d['scores']['accuracy'].get('loss',0)>d['scores']['accuracy'].get('win',0)]}
by_stage=defaultdict(list)
for r in ledger:
    if r['role']=='research':by_stage[f"{r['method']}:{r['stage']}"].append(r)
summary['stage_costs']={k:cost(v) for k,v in by_stage.items()}
(root/f'analysis-{args.mode}-vs-{args.reference_method}-{args.judge_rubric}.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
if args.mode=='controlled' and args.reference_method=='baseline-human' and args.judge_rubric=='strict':(root/'analysis.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k not in ['stage_costs','sparse']},ensure_ascii=False,indent=2))
