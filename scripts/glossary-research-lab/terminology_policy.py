"""Apply the existing blind evaluator to worlds' meaning and term policy separately."""
import argparse
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

from bilingual_origins import HERE, write
from human_challenge_report import read


def prepare(run):
    source = HERE / 'runs/2026-10-13-human-challenge-v2/terms/04'
    if not (run / 'manifest.json').exists():
        write(run / 'manifest.json', {'seed': 26101307, 'terms': [{'source_terms': ['mundos']}],
                                     'target_languages': ['vi'], 'sampling': 'Same frozen forty Spanish corpus passages; exploratory reused holdout.'})
        write(run / 'provenance.json', {'modelId': 'gpt-6.1-sol', 'subscriptionOnly': True})
        write(run / 'terms/01/evidence.json', read(source / 'evidence.json'))
        write(run / 'terms/01/vi/no-glossary/translations.json', read(source / 'no-glossary/controlled/translations.json'))
        write(run / 'assessment-only/criteria.json', {'mundos': {'vi':
            'Project term policy: prefer hành tinh whenever the exact mundo/mundos occurrence can coherently mean a planet or planets in the source. The explicit synonym planeta is not necessary. Use cõi or thế giới for clearly nonplanetary spiritual realms, human society, figurative worlds or expressions. A list explicitly including the Sun or stars may require a broader word. Grade meaning accuracy separately from this selection requirement: broad thế giới may remain understandable while failing the project term choice. Mixed passages need occurrence-by-occurrence assessment; one correct planetary label does not excuse another incorrect occurrence. Identify actual term renderings and explain source applicability, do not match unrelated target words. Check naturalness, including literal calques in phrases describing planetary interiors. Do not judge the truth of the author’s beliefs.'}})
    for method in ['selected', 'priority-policy', 'modifier-scope', 'modifier-scope-guard']:
        source_method = 'modifier-scope' if method == 'modifier-scope-guard' else method
        entry = read(source / source_method / 'entry.json')
        if entry:
            write(run / 'terms/01/vi' / method / 'entry.json', entry)
        translations = read(source / method / 'controlled/translations.json') if method != 'modifier-scope-guard' else None
        if translations:
            write(run / 'terms/01/vi' / method / 'translations.json', translations)
        audit = read(source / 'assessment-only' / f'{source_method}-entry.json')
        if audit and method != 'selected':
            states = {c['status'] for c in audit['checks']}
            status = 'incomplete' if states & {'fail', 'partial'} else 'uncertain' if 'uncertain' in states else 'complete'
            review = read(source / 'assessment-only' / f'{source_method}-gate-review.json')
            if status == 'incomplete' and review and review.get('allowTranslationTest'):
                status = 'uncertain'
            write(run / 'terms/01/vi' / f'{method}-entry-assessment.json', {
                'requiredMeanings': status, 'provenance': 'pass',
                'reason': 'Reuse the independent assessment against the same project criteria; no historical provenance requirement for this term.',
                'missing': [c['reason'] for c in audit['checks'] if c['status'] != 'pass'],
                'inheritedAudit': audit,
                'assessmentOnlyGateReview': review,
                'auditSha256': hashlib.sha256((source / 'assessment-only' / f'{source_method}-entry.json').read_bytes()).hexdigest()})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['baseline', 'evaluate'], required=True)
    parser.add_argument('--method', choices=['selected', 'priority-policy', 'modifier-scope', 'modifier-scope-guard'], default='priority-policy')
    args = parser.parse_args()
    run = HERE / 'runs/2026-10-13-worlds-priority'
    prepare(run)
    source = (HERE / 'lab.mjs').read_text()
    frozen = read(HERE / 'runs/2026-10-13-adaptive/policy-freeze.json')
    assert hashlib.sha256(source.encode()).hexdigest() == frozen['codeHashes']['lab.mjs']
    prefix = source[:source.index("\ntry{\n if(command==='prepare')")]
    dispatch = (HERE / 'bilingual_origins_dispatch.mjs').read_text()
    original_targets = "const targets={vi:'Vietnamese',en:'English'}"
    assert dispatch.count(original_targets) == 1
    dispatch = dispatch.replace(original_targets, "const targets={vi:'Vietnamese'}")
    original_method = "const originVariant=arg('variant','initial'),candidateMethod=originVariant==='initial'?'researched':`researched-${originVariant}`;"
    assert dispatch.count(original_method) == 1
    dispatch = dispatch.replace(original_method, "const originVariant='initial',candidateMethod=arg('method','priority-policy');")
    gate = "if(read(`${d}/${language}/${candidateMethod}-entry-assessment.json`).requiredMeanings==='incomplete')"
    assert dispatch.count(gate) == 1
    dispatch = dispatch.replace(gate, "if(candidateMethod!=='selected'&&read(`${d}/${language}/${candidateMethod}-entry-assessment.json`).requiredMeanings==='incomplete')")
    original_instructions = "schema:translationSchema,instructions,\n   content:"
    assert dispatch.count(original_instructions) == 1
    guard = ' Apply glossary targets conditionally, verifying the exact source meaning and grammatical role. A preferred narrower sense is appropriate only while every relevant named or enumerated member fits its category; never use a narrower target that changes the category or contradicts the source membership. When that condition fails, retain a source-supported broader glossary alternative. Preserve an idiomatic whole-expression rendering if the researched word is already conveyed implicitly and the glossary supplies no distinct meaning that requires changing that expression; do not force a separate literal word into it. Continue applying a more precise preferred term where the source supports it, even if the broad existing draft is understandable. These safeguards apply to the source term, not unrelated edits.'
    dispatch = dispatch.replace(original_instructions, "schema:translationSchema,instructions:instructions+(method==='modifier-scope-guard'?" + json.dumps(guard) + ":''),\n   content:")
    module = HERE / f'.terminology-policy-{os.getpid()}.mjs'
    module.write_text(prefix + '\n' + dispatch)
    started = time.monotonic()
    record = {'phase': args.phase, 'method': args.method, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'labSha256': hashlib.sha256(source.encode()).hexdigest(), 'dispatchSha256': hashlib.sha256(dispatch.encode()).hexdigest()}
    phase_path = run / f'phase-{args.phase}-{args.method}.json'
    write(phase_path, record)
    try:
        code = subprocess.call(['node', str(module), args.phase, '--run', str(run), '--indices', '1',
                                '--method', args.method, '--workers', '2', '--jobs', '1'])
    finally:
        module.unlink(missing_ok=True)
    record.update(seconds=round(time.monotonic() - started, 3), exitCode=code)
    write(phase_path, record)
    if args.phase == 'baseline' and code == 0:
        files = ['assessment-only/criteria.json', 'terms/01/evidence.json',
                 'terms/01/vi/baseline-assessment.json', 'terms/01/vi/no-glossary/translations.json']
        hashes = {p: hashlib.sha256((run / p).read_bytes()).hexdigest() for p in files}
        freeze = read(run / 'baseline-freeze.json')
        if freeze:
            assert freeze['hashes'] == hashes
        else:
            write(run / 'baseline-freeze.json', {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'hashes': hashes})
    raise SystemExit(code)


if __name__ == '__main__':
    main()
