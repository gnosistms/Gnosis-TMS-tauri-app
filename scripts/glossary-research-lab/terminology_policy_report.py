"""Keep worlds' semantic, term-choice and naturalness gains separate."""
import argparse
import hashlib
import json
from pathlib import Path

from bilingual_origins_report import score_axis
from human_challenge_report import read, totals


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, required=True)
    args = parser.parse_args()
    run = args.run.resolve()
    source_run = run.parent / '2026-10-13-human-challenge-v2'
    directory = run / 'terms/01/vi'
    evidence = read(run / 'terms/01/evidence.json')
    baseline = read(directory / 'baseline-assessment.json')
    freeze = read(run / 'baseline-freeze.json')
    freeze_valid = bool(freeze) and all(hashlib.sha256((run / p).read_bytes()).hexdigest() == h for p, h in freeze['hashes'].items())
    records = [json.loads(line) for line in (run / 'requests.jsonl').read_text().splitlines()]
    research = [json.loads(line) for line in (source_run / 'requests.jsonl').read_text().splitlines()]
    research = [r for r in research if r['term'] == 'mundos' and r['method'] in ['priority-policy', 'modifier-scope'] and r['role'] == 'research']
    rows = []
    examples = []
    neutral = {r['id']: r['translation'] for r in read(directory / 'no-glossary/translations.json')}
    sources = {str(r['itemId']): r for r in evidence['evaluation']}
    for method in ['selected', 'priority-policy', 'modifier-scope', 'modifier-scope-guard']:
        comparison = read(directory / f'{method}-comparison.json')
        assessment = read(directory / f'{method}-entry-assessment.json')
        rows.append(dict(method=method, entryAssessment=assessment,
                         rejectedBeforeTranslation=bool(assessment and assessment['requiredMeanings'] == 'incomplete' and method != 'selected'),
                         axes={a: score_axis(baseline, comparison, a) for a in ['accuracy', 'requiredTerm', 'naturalness']}))
        candidate = {r['id']: r['translation'] for r in read(directory / method / 'translations.json', [])}
        for row in baseline:
            if row['grade']['requiredTerm'] == 'fail' or row['grade']['naturalness'] == 'clear_problem':
                examples.append(dict(id=row['id'], method=method, source=sources[row['id']]['text'],
                                     reference=sources[row['id']]['reference'], noGlossary=neutral[row['id']],
                                     candidate=candidate.get(row['id']), frozenBaselineAssessment=row,
                                     comparison=next((r for r in comparison['rows'] if r['id'] == row['id']), None) if comparison else None,
                                     confirmation=next((r for r in comparison['confirmations'] if r['id'] == row['id']), None) if comparison else None))
    request_check = {}
    for method, parent_method in [('priority-policy', 'specificity-boundary'), ('modifier-scope', 'priority-policy')]:
        parent_paths = list((source_run / 'terms/04' / parent_method / 'calls').glob('*/request.json'))
        new_paths = list((source_run / 'terms/04' / method / 'calls').glob('*/request.json'))
        if not parent_paths or not new_paths:
            continue
        parent, new = read(parent_paths[0]), read(new_paths[0])
        request_check[method] = dict(sameSourcePayload=parent['content'] == new['content'], sameEffort=parent['effort'] == new['effort'],
                             genericInstructionsAppended=new['instructions'].startswith(parent['instructions']),
                             schemaFactorVerified=({k: v for k, v in new['schema']['properties'].items() if k != 'selectionPolicy'} == parent['schema']['properties']) if method == 'priority-policy' else new['schema'] == parent['schema'])
    candidate_method = 'modifier-scope' if (source_run / 'terms/04/modifier-scope/entry.json').exists() else 'priority-policy'
    entry = read(source_run / 'terms/04' / candidate_method / 'entry.json')
    raw = read(source_run / 'terms/04' / candidate_method / 'raw-proposal.json')
    transmitted = None
    if entry and raw:
        policy = entry['selectionPolicy']
        notes = '\n'.join(r['generalNote'] for r in entry['entries'])
        transmitted = (policy['defaultRuleSpanish'] in notes and all(x['conditionSpanish'] in notes for x in policy['exceptions'])
                       and sum('Política de selección:' in r['generalNote'] for r in entry['entries']) == 1
                       and [r['variants'] for r in entry['entries']] == [r['variants'] for r in raw['entries']])
    application_checks = []
    previous = [read(p) for p in (directory / 'modifier-scope/translation-calls').glob('*/request.json')]
    for p in (directory / 'modifier-scope-guard/translation-calls').glob('*/request.json'):
        current = read(p)
        batch_ids = [r['id'] for r in json.loads(current['content'])['passages']]
        parent = next((q for q in previous if [r['id'] for r in json.loads(q['content'])['passages']] == batch_ids), None)
        application_checks.append(dict(batchIds=batch_ids, sameEntrySourcesAndDrafts=bool(parent and parent['content'] == current['content']),
                                       sameSchemaAndEffort=bool(parent and parent['schema'] == current['schema'] and parent['effort'] == current['effort']),
                                       genericInstructionsAppended=bool(parent and current['instructions'].startswith(parent['instructions']))))
    report = dict(rows=rows, baselineFreezeValid=freeze_valid,
                  baselineFrozenBeforeResearch=bool(research and freeze['at'] <= min(r['startedAt'] for r in research)),
                  frozenBaselineCounts={a: {g: sum(r['grade'][a] == g for r in baseline) for g in sorted({r['grade'][a] for r in baseline})}
                                        for a in ['accuracy', 'requiredTerm', 'naturalness']},
                  researchFactorChecks=request_check, policyTransmittedOnceWithTargetsUnchanged=transmitted,
                  reportedPolicyMethod=candidate_method,
                  applicationGuardFactorChecks=application_checks,
                  newProposalResearch=totals(research), evaluation=totals(records),
                  translationByMethod={m: totals([r for r in records if r['role'] == 'evaluation' and r['method'] == m])
                                       for m in sorted({r['method'] for r in records if r['role'] == 'evaluation'})},
                  researchByMethod={m: totals([r for r in research if r['method'] == m]) for m in sorted({r['method'] for r in research})},
                  inheritedEntryAudit=read(source_run / 'terms/04/assessment-only' / f'{candidate_method}-entry.json'),
                  notHumanVerified=True, complete=all(r['rejectedBeforeTranslation'] or not r['axes']['accuracy']['pending'] for r in rows),
                  limitations='Exploratory reuse of forty previously inspected passages, mostly singular mundo despite the requested plural headword. Fresh sessions use the same model. Initial baseline diagnoses are provisional; gains and losses require two subsequent blind checks. Term-choice gains are not automatically semantic accuracy gains. Summed model time is not wall-clock elapsed time. Research costs exclude inherited acquisition; evaluation costs include all executed attempts and explicitly unknown usage.')
    (run / 'analysis-terminology-policy.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    (run / 'human-review-policy.json').write_text(json.dumps(examples, ensure_ascii=False, indent=2) + '\n')
    lines = ['# Mundos: default-and-exceptions experiment', '',
             'Every result is a difference from the exact frozen no-glossary draft. The researcher receives no expected sense, target word or assessment findings. Preserve semantic accuracy, project term-choice adherence and naturalness as separate measures.', '',
             'Frozen baseline diagnosis: ' + json.dumps(report['frozenBaselineCounts'], ensure_ascii=False) + '.', '',
             '| Method | Entry completeness | Meaning gains / harms | Term-choice gains / harms | Naturalness gains / harms |',
             '|---|---|---|---|---|']
    for row in rows:
        def cell(axis):
            s = row['axes'][axis]
            return 'rejected' if row['rejectedBeforeTranslation'] else 'pending' if s['pending'] else f"{s['wins']} / {s['losses']}"
        audit = row['entryAssessment'] or {}
        lines.append(f"| {row['method']} | {audit.get('requiredMeanings', 'pending')} | {cell('accuracy')} | {cell('requiredTerm')} | {cell('naturalness')} |")
    lines += ['', 'Wins or losses require both blind assessments to identify a clear change. Ties, uncertain cases and both-bad cases receive no success credit. The prior selected method is evaluated as a historical control even if its entry fails the newly explicit criterion.', '',
              'New proposal cost: ' + json.dumps(report['newProposalResearch']) + '. Evaluation cost: ' + json.dumps(report['evaluation']) + '.', '',
              'Frozen baseline intact: ' + str(freeze_valid) + '; frozen before research: ' + str(report['baselineFrozenBeforeResearch']) + '; rule transmitted once without changing targets: ' + str(transmitted) + '.', '',
              'Research-factor checks: ' + json.dumps(request_check) + '.', '', report['limitations']]
    lines += ['', 'The application guard reuses modifier-scope research and tests only a generic source-category and idiomatic-phrase safeguard in the controlled translator. It adds zero research calls; it does not repair or certify the standalone entry’s missing broader-celestial guidance. Actual request factor checks: ' + json.dumps(application_checks) + '.']
    lines += ['', 'Measured controlled-translation costs by method (four ten-passage batches each): ' + json.dumps(report['translationByMethod']) + '.']
    if entry:
        lines += ['', 'Generated source-derived selection policy (' + candidate_method + '):', '', '```json', json.dumps(entry['selectionPolicy'], ensure_ascii=False, indent=2), '```']
    (run / 'TERMINOLOGY_POLICY_RESULTS.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({k: report[k] for k in ['complete', 'baselineFreezeValid', 'baselineFrozenBeforeResearch', 'policyTransmittedOnceWithTargetsUnchanged']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
