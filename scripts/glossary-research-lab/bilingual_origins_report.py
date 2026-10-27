"""Report independent bilingual research tests against frozen no-glossary drafts."""
import argparse
import hashlib
import json
from pathlib import Path

from human_challenge_report import read, totals


def effect(before, after, axis):
    bad, good = ('material_error', 'correct') if axis == 'accuracy' else (
        ('clear_problem', 'acceptable') if axis == 'naturalness' else ('fail', 'pass'))
    return 1 if (before, after) == (bad, good) else -1 if (before, after) == (good, bad) else 0


def grades(row, axis):
    side = row['candidateSide']
    return row['B' if side == 'A' else 'A'][axis], row[side][axis]


def score_axis(baseline, comparison, axis):
    if comparison is None:
        return {'pending': True}
    frozen = {r['id']: r['grade'][axis] for r in baseline}
    confirmation = {r['id']: r for r in comparison['confirmations']}
    result = dict(pending=False, wins=0, losses=0, ties=0, unresolved=0,
                  frozenBaselineCorrections=0, bothBad=0, notApplicable=0,
                  correctedIds=[], lostIds=[])
    bad = 'material_error' if axis == 'accuracy' else 'clear_problem' if axis == 'naturalness' else 'fail'
    for row in comparison['rows']:
        before, after = grades(row, axis)
        change = effect(before, after, axis)
        if change:
            checked = confirmation.get(row['id'])
            if checked is None or effect(*grades(checked, axis), axis) != change:
                result['unresolved'] += 1
                continue
            result['wins' if change == 1 else 'losses'] += 1
            result['correctedIds' if change == 1 else 'lostIds'].append(row['id'])
            result['frozenBaselineCorrections'] += change == 1 and frozen.get(row['id']) == bad
        elif 'uncertain' in (before, after) or before != after:
            result['unresolved'] += 1
        else:
            result['ties'] += 1
            result['bothBad'] += before == bad
            result['notApplicable'] += before == 'not_applicable'
    result['net'] = result['wins'] - result['losses']
    return result


def locate(directory, method, suffix):
    current = directory / f'{method}-{suffix}.json'
    legacy = directory / f'{suffix}.json'
    return read(current) if current.exists() else read(legacy) if method == 'researched' else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, required=True)
    args = parser.parse_args()
    run = args.run.resolve()
    manifest = read(run / 'manifest.json')
    records = [json.loads(line) for line in (run / 'requests.jsonl').read_text().splitlines()]
    freeze = read(run / 'baseline-freeze.json')
    freeze_valid = all(hashlib.sha256((run / p).read_bytes()).hexdigest() == h for p, h in freeze['hashes'].items())
    rows = []
    examples = []
    for index, term in enumerate(manifest['terms'], 1):
        directory = run / 'terms' / f'{index:02}'
        evidence = read(directory / 'evidence.json')
        for language in manifest['target_languages']:
            destination = directory / language
            baseline = read(destination / 'baseline-assessment.json')
            for method in ['researched', 'researched-name-distinction', 'researched-deterministic-name']:
                entry = read(destination / method / 'entry.json')
                if entry is None:
                    continue
                comparison = locate(destination, method, 'comparison')
                item = dict(term=term['source_terms'][0], language=language, method=method,
                            evaluationPassages=len(evidence['evaluation']),
                            researchEvaluationOverlap=evidence['overlap'],
                            entryAssessment=locate(destination, method, 'entry-assessment'),
                            baselineMeaningErrors=sum(r['grade']['accuracy'] == 'material_error' for r in baseline),
                            baselineCanonicalFailures=sum(r['grade']['requiredTerm'] == 'fail' for r in baseline),
                            inheritedJudgment=comparison.get('inheritedJudgment') if comparison else None,
                            axes={a: score_axis(baseline, comparison, a) for a in ['accuracy', 'requiredTerm', 'naturalness']})
                rows.append(item)
                if comparison:
                    neutral = {r['id']: r['translation'] for r in read(destination / 'no-glossary/translations.json')}
                    candidate = {r['id']: r['translation'] for r in read(destination / method / 'translations.json')}
                    sources = {str(r['itemId']): r for r in evidence['evaluation']}
                    representatives = set()
                    for role in ['noun', 'adject']:
                        chosen = next((r for r in comparison['rows'] if role in r['sourceRole'].lower()), None)
                        if chosen:
                            representatives.add(chosen['id'])
                    for row in comparison['rows']:
                        changed = any(effect(*grades(row, a), a) for a in ['accuracy', 'requiredTerm', 'naturalness'])
                        if changed or row['id'] in representatives:
                            examples.append(dict(term=item['term'], language=language, method=method,
                                                 exampleKind='proposed-change' if changed else 'representative-role',
                                                 source=sources[row['id']]['text'], reference=sources[row['id']]['reference'],
                                                 noGlossary=neutral[row['id']], candidate=candidate[row['id']],
                                                 firstAssessment=row, notHumanVerified=True))
    research = [r for r in records if r['role'] == 'research']
    separation = []
    research_requests = []
    for record in research:
        request = read(Path(record['dir']) / 'request.json')
        term_directory = Path(record['dir']).parent.parent.parent
        payload = read(term_directory / 'source-only/payload.json')
        separation.append(json.loads(request['content']) == payload)
        research_requests.append((record, request))
    original = next(q for r, q in research_requests if r['term'] == 'Íntimo' and r['method'] == 'bilingual-source-research')
    repaired = next((q for r, q in research_requests if r['method'] == 'bilingual-source-research-name-distinction'), None)
    first_research = min(r['startedAt'] for r in research)
    report = dict(rows=rows, baselineFreezeValid=freeze_valid,
                  baselineFrozenBeforeResearch=freeze['at'] <= first_research,
                  actualResearchContentEqualsSourceOnlyPayload=all(separation),
                  nameRepairOneFactorVerified=bool(repaired and repaired['content'] == original['content'] and repaired['schema'] == original['schema'] and repaired['effort'] == original['effort'] and repaired['instructions'].startswith(original['instructions'])),
                  researchByMethod={m: totals([r for r in research if r['method'] == m]) for m in sorted({r['method'] for r in research})},
                  researchExperiments=[dict(term=r['term'], method=r['method'], **totals([r])) for r in research],
                  research=totals(research), translation=totals([r for r in records if r['role'] == 'evaluation']),
                  deterministicNameProof=read(run / 'terms/02/deterministic-name/proof.json'),
                  assessment=totals([r for r in records if r['role'] == 'acceptance-audit']),
                  failedCalls=[{k: r.get(k) for k in ['term', 'method', 'stage', 'status', 'seconds', 'usage', 'message']} for r in records if r['status'] != 'ok'],
                  notHumanVerified=True, broaderStudyComplete=False,
                  limitations=['Fresh sessions use the same model; agreement is provisional, not independent human validation.',
                               'Hooltampanas has only two corpus passages; both are also research evidence.',
                               'The forty Íntimo passages do not establish ordinary intimate/friendship adjective translation performance.',
                               'Íntimo reuses the earlier exact-text holdout; it has weaker separation than a fresh location-excluded sample.',
                               'Initial incomplete Vietnamese Íntimo entry is rejected without expensive translation evaluation.',
                               'Naturalness changes require confirmation before credit; unconfirmed changes remain unresolved.',
                               'Local printed pairs establish the source equivalent, not first coinage or every historical borrowing route.',
                               'Research token totals include actual input and output; source retrieval and inherited baseline costs are separate.'])
    (run / 'analysis-bilingual-origins.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    (run / 'human-review-bilingual.json').write_text(json.dumps(examples, ensure_ascii=False, indent=2) + '\n')
    lines = ['# Íntimo and Hooltampanas bilingual tests', '',
             'Research sees source evidence only. Expected terminology is assessment-only. Translation is directly from Spanish in each target language. Semantic accuracy and canonical term adherence are separate.', '',
             '| Term | Target | Method | Passages | Entry complete | Meaning W/L/T/U | Canonical term W/L/T/U |',
             '|---|---|---|---:|---|---|---|']
    for row in rows:
        def cell(axis):
            score = row['axes'][axis]
            return 'skipped / pending' if score['pending'] else '/'.join(str(score[k]) for k in ['wins', 'losses', 'ties', 'unresolved'])
        audit = row['entryAssessment'] or {}
        lines.append(f"| {row['term']} | ES–{row['language'].upper()} | {row['method']} | {row['evaluationPassages']} | {audit.get('requiredMeanings', 'pending')} | {cell('accuracy')} | {cell('requiredTerm')} |")
    lines += ['', 'A win requires two blind assessments finding a clear improvement over the exact no-glossary version. A canonical spelling correction is not automatically a semantic accuracy win. Both-good and both-bad pairs receive no gain credit.', '',
              'Research costs by experiment (shared work generates both target entries):', '']
    for cost in report['researchExperiments']:
        lines.append(f"- {cost['term']} / {cost['method']}: {cost['calls']} calls; {cost['seconds']} summed model seconds; {cost['input']} input + {cost['output']} output tokens ({cost['cached']} cached input; {cost['unknownUsage']} unknown usages).")
    lines += ['', 'Baseline generation, candidate translation and assessment are evaluation costs, not research-cost savings. Newly executed translation cost: ' + json.dumps(report['translation']) + '; assessment cost: ' + json.dumps(report['assessment']) + '. Existing Vietnamese neutral drafts were inherited from the prior study. Failed attempts remain charged in the ledgers; unavailable usage is unknown, not zero.']
    if report['deterministicNameProof']:
        proof = report['deterministicNameProof']
        lines += ['', 'Deterministic named-unit route: ' + str(proof['researchModelCalls']) + ' model research calls / ' + str(proof['researchModelTokens']) + ' research tokens; local decision and entry construction ' + str(proof.get('localDecisionSeconds', 'unmeasured')) + ' seconds using the same cached source-only lookup evidence. It removes the previous 47.507-second, 13,598-token proposal. Unique one-edit counterpart, shared large number/unit equivalence and original-edition name are mandatory. Negative guard tests reject ambiguity, wrong numbers, wrong units and unrelated editions. This is a narrow source-verification route, not a general replacement for semantic research.', '',
                  'Both deterministic target-language translations match every previously judged translation text exactly. Prior judgments are reused only after verifying text identity, unchanged neutral-draft hashes and unchanged actual judge criteria; new entry audits and controlled translations were executed and charged. No new vote is implied by inherited judgments.']
    lines += ['', 'Verification: frozen baselines intact = ' + str(freeze_valid) + '; frozen before research = ' + str(report['baselineFrozenBeforeResearch']) + '; saved research content matches raw source-only payload = ' + str(report['actualResearchContentEqualsSourceOnlyPayload']) + '.', '',
              'Íntimo: the source evidence includes the printed Íntimo–Innermost pair and original English passages from The Dayspring of Youth, with Dioses Atómicos identified as its Spanish edition. The generic name/definition distinction repair preserves the noun designation instead of replacing it with another doctrinal concept. Ordinary dictionary meanings remain in a separate adjective branch.', '',
              'Hooltampanas: exact source matching failed. A one-edit source-book lookup discovered Hooltanpanas in Gurdjieff, and the Spanish and English definitions match the corpus’s 5,764,801 tonalities. Preserve the observed spelling for searching while using the verified name in translations.', '',
              'Useful procedure changes: try a cheap source-book spelling lookup when exact matching fails; retain ordinary dictionary senses in a separate branch; preserve a technical name rather than substituting a related concept used to define it; reject missing required meanings before running forty translations. Shared source research produces two language entries here, but a two-separate-call control has not been run, so no measured bilingual saving is claimed.', '',
              'Limitations:', ''] + ['- ' + text for text in report['limitations']]
    (run / 'BILINGUAL_ORIGINS_RESULTS.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({k: report[k] for k in ['baselineFreezeValid', 'baselineFrozenBeforeResearch', 'actualResearchContentEqualsSourceOnlyPayload', 'research']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
