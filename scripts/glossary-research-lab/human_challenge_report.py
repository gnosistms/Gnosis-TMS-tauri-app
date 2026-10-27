"""Report criterion-based corrections against exact no-glossary translations."""
import argparse
import hashlib
import json
from pathlib import Path


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def totals(records):
    return {'calls': len(records), 'seconds': round(sum(r['seconds'] for r in records), 3),
            'input': sum((r.get('usage') or {}).get('input_tokens', 0) for r in records),
            'cached': sum((r.get('usage') or {}).get('cached_input_tokens', 0) for r in records),
            'output': sum((r.get('usage') or {}).get('output_tokens', 0) for r in records),
            'unknownUsage': sum(not r.get('usage') for r in records)}


def summarize(baseline, comparison, method):
    errors = {r['id'] for r in baseline if r['confirmedError']}
    if not comparison:
        return {'baselineErrors': len(errors), 'pending': True}
    events = [r for r in comparison['events'] if r['method'] == method and r['confirmed']]
    corrected = {r['id'] for r in events if r['firstEffect'] == 1 and r['id'] in errors}
    introduced = {r['id'] for r in events if r['firstEffect'] == -1}
    additional = {r['id'] for r in events if r['firstEffect'] == 1 and r['id'] not in errors}
    rows = {r['id']: r for r in comparison['rows']}
    uncertain = set()
    uncorrected = set()
    for key in errors - corrected:
        grade = next(v['accuracy'] for v in rows[key]['versions'] if v['method'] == method)
        (uncertain if grade == 'uncertain' or grade == 'correct' else uncorrected).add(key)
    both_good = both_bad = unresolved = 0
    for row in comparison['rows']:
        grades = {v['method']: v['accuracy'] for v in row['versions']}
        pair = [grades['no-glossary'], grades[method]]
        both_good += pair == ['correct', 'correct']
        both_bad += pair == ['error', 'error']
        unresolved += 'uncertain' in pair
    return {'baselineErrors': len(errors), 'confirmedCorrections': len(corrected),
            'uncorrectedErrors': len(uncorrected), 'unresolvedKnownErrors': len(uncertain),
            'confirmedIntroducedErrors': len(introduced), 'otherConfirmedGains': len(additional),
            'allConfirmedNetGains': len(corrected) + len(additional) - len(introduced),
            'bothGood': both_good, 'bothBad': both_bad, 'uncertainPairs': unresolved,
            'correctedIds': sorted(corrected), 'introducedIds': sorted(introduced),
            'pending': False, 'notHumanVerified': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, required=True)
    args = parser.parse_args()
    run = args.run.resolve()
    manifest = read(run / 'manifest.json')
    records = [json.loads(s) for s in (run / 'requests.jsonl').read_text().splitlines()] if (run / 'requests.jsonl').exists() else []
    terms = []
    examples = []
    for index, term in enumerate(manifest['terms'], 1):
        name = term['source_terms'][0]
        directory = run / 'terms' / f'{index:02}'
        evidence = read(directory / 'evidence.json')
        baseline = read(directory / 'assessment-only/baseline.json', [])
        item = {'term': name, 'baselineComplete': len(baseline) == len(evidence['evaluation']),
                'confirmedBaselineErrors': sum(r['confirmedError'] for r in baseline),
                'uncertainBaselineCases': sum(r['accuracy'] == 'uncertain' for r in baseline),
                'methods': {}, 'entryAudits': {}}
        methods = ['selected', 'meaning-first', 'all-source-onecall', 'operational-definition',
                   'meaning-cards', 'specificity-boundary', 'dictionary-completion', 'form-balanced']
        completed = [read(p) for p in sorted((directory / 'assessment-only').glob('*comparison.json'))]
        completed = [c for c in completed if c and len(c.get('rows', [])) == len(evidence['evaluation'])]
        for method in methods:
            if not (directory / method / 'entry.json').exists():
                continue
            comparison = read(directory / f'assessment-only/{"comparison" if method in ["selected", "meaning-first"] else method + "-comparison"}.json')
            if method == 'selected' and not comparison:
                comparison = next((c for c in reversed(completed)
                                   if all(any(v['method'] == 'selected' for v in r['versions']) for r in c['rows'])), None)
            item['methods'][method] = summarize(baseline, comparison, method)
            audit = read(directory / f'assessment-only/{method}-entry.json')
            item['entryAudits'][method] = audit
            item['methods'][method]['allEntryCriteriaPass'] = bool(audit) and all(c['status'] == 'pass' for c in audit['checks'])
            item['methods'][method]['rejectedBeforeFullJudging'] = bool(read(directory / f'assessment-only/{method}-rejected.json'))
            item['methods'][method]['assessmentOnlyGateReview'] = read(directory / f'assessment-only/{method}-gate-review.json')
        original = read(directory / 'source-only/request.json')
        actual = list((directory / 'meaning-first/calls').glob('*/request.json'))
        if actual:
            requests = [read(p) for p in actual]
            item['researchEvidenceUnchanged'] = all(r['content'] == original['content'] and r['effort'] == original['effort'] and r['instructions'].startswith(original['instructions']) for r in requests)
        else:
            item['researchEvidenceUnchanged'] = None
        terms.append(item)
        neutral = {r['id']: r['translation'] for r in read(directory / 'no-glossary/controlled/translations.json')}
        sources = {str(r['itemId']): r for r in evidence['evaluation']}
        selected = {r['id']: r['translation'] for r in read(directory / 'selected/controlled/translations.json')}
        translated_methods = {method: {r['id']: r['translation'] for r in read(directory / method / 'controlled/translations.json', [])}
                              for method in methods if method != 'selected'}
        for row in baseline:
            if not row['confirmedError']:
                continue
            examples.append({'term': name, 'id': row['id'], 'source': sources[row['id']]['text'],
                             'reference': sources[row['id']]['reference'], 'noGlossary': neutral[row['id']],
                             'selected': selected[row['id']],
                             'newMethods': {m: values.get(row['id']) for m, values in translated_methods.items() if row['id'] in values},
                             'baselineAssessment': row, 'notHumanVerified': True})
    freeze = read(run / 'baseline-freeze.json')
    frozen_valid = bool(freeze) and all(hashlib.sha256((run / p).read_bytes()).hexdigest() == h for p, h in freeze['hashes'].items())
    first_new = min((r['startedAt'] for r in records if r['role'] == 'research'), default=None)
    assessment = totals([r for r in records if r['role'] == 'acceptance-audit'])
    report = {'terms': terms, 'complete': False,
              'research': totals([r for r in records if r['role'] == 'research']),
              'researchByMethod': {m: totals([r for r in records if r['role'] == 'research' and r['method'] == m]) for m in sorted({r['method'] for r in records if r['role'] == 'research'})},
              'translation': totals([r for r in records if r['role'] == 'evaluation']), 'assessment': assessment,
              'baselineFreezeValid': frozen_valid, 'baselineFrozenBeforeResearch': bool(freeze and first_new and freeze['at'] <= first_new),
              'notHumanVerified': True,
              'limitations': 'Exploratory human-criterion assessment of prior frozen samples; same-model fresh sessions remain correlated. Required meanings are supplied to assessors only. No corpus-wide prevalence or generalization claim. Selected means the prior chosen compact method, not the full human-seeded original pipeline. Naturalness grades exist but changes in this four-term protocol have not been separately confirmed; the displayed correction metrics measure meaning accuracy. Reusing operational-definition cards removes the candidate-list interface but does not save its inherited research cost.'}
    (run / 'analysis-human-challenge.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    (run / 'human-review-errors.json').write_text(json.dumps(examples, ensure_ascii=False, indent=2) + '\n')
    lines = ['# Four-term human-criterion experiments', '',
             'The primary yardstick is improvement over exact no-glossary drafts. Domain criteria are assessment inputs only. These are AI-assessed findings awaiting human review; earlier unrestricted votes remain unchanged.', '',
             '| Term | Confirmed baseline errors | Method | Corrected | Still wrong | Unresolved | New errors | Entry criteria all pass |',
             '|---|---:|---|---:|---:|---:|---:|---|']
    for term in terms:
        for method, score in term['methods'].items():
            pending = score['pending']
            values = [('rejected' if score['rejectedBeforeFullJudging'] else 'pending') if pending else str(score[key]) for key in ['confirmedCorrections', 'uncorrectedErrors', 'unresolvedKnownErrors', 'confirmedIntroducedErrors']]
            lines.append(f"| {term['term']} | {term['confirmedBaselineErrors']} | {method} | {' | '.join(values)} | {score['allEntryCriteriaPass']} |")
    lines += ['', 'Research-only new calls: ' + json.dumps(report['research']) + '. Inherited source acquisition and coverage calls are recorded separately in inherited-costs.json; adding a proposal to an existing selected workflow is not a cost saving.', '',
              'All forty passages per term are retained for regression checks. Both-good and both-bad cases receive no success credit. Unresolved errors are not counted as corrected. Human-review-errors.json contains source text, exact neutral wording, method translations and independent reasons.', '',
              'Research separation: ' + str(all(t['researchEvidenceUnchanged'] is True for t in terms)) + '; frozen baseline intact: ' + str(frozen_valid) + '; frozen before new research: ' + str(report['baselineFrozenBeforeResearch']) + '.', '', report['limitations']]
    (run / 'HUMAN_CHALLENGE_RESULTS.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({k: report[k] for k in ['complete', 'research', 'baselineFreezeValid', 'baselineFrozenBeforeResearch']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
