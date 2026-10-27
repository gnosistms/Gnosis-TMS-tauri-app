"""Subscription-only bilingual loanword tests; expected answers are assessment-only."""
import argparse
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def prepare(run):
    if (run / 'manifest.json').exists():
        return
    previous = HERE / 'runs/2026-10-13-human-challenge-v2/terms/02'
    loan = HERE / 'runs/2026-10-13-loanwords'
    write(run / 'manifest.json', {'seed': 26101306, 'terms': [
        {'source_terms': ['Íntimo']}, {'source_terms': ['Hooltampanas']}],
        'target_languages': ['vi', 'en'], 'sampling': 'Reuse the forty frozen Íntimo passages and all two Hooltampanas passages. Sparse-term research/evaluation overlap is declared.'})
    write(run / 'provenance.json', {'modelId': 'gpt-6.1-sol', 'subscriptionOnly': True})
    request = next((previous / 'dictionary-completion/calls').glob('*/request.json'))
    payload = json.loads(read(request)['content'])
    evidence = read(previous / 'evidence.json')
    write(run / 'terms/01/evidence.json', evidence)
    write(run / 'terms/01/source-only/payload.json', payload)
    write(run / 'terms/01/vi/no-glossary/translations.json', read(previous / 'no-glossary/controlled/translations.json'))
    sparse = read(loan / 'terms/01/evidence.json')
    write(run / 'terms/02/evidence.json', sparse)
    write(run / 'terms/02/source-only/payload.json', {
        'term': sparse['term'], 'corpusForms': sparse['forms'],
        'passages': [{'text': r['text'], 'reference': r['reference']} for r in sparse['research']],
        'nearSourceSpellings': read(loan / 'near-source-spellings.json'),
        'nearSourcePassages': read(loan / 'near-source-passages.json'),
        'originalPassages': read(loan / 'near-original-passages.json')['result'],
    })
    write(run / 'assessment-only/criteria.json', {
        'Íntimo': {
            'vi': 'The specialized noun must identify the Innermost and use Đấng Nội tại; distinguish ordinary adjective inner, internal, intimate. Research must identify the English original Innermost through Dioses Atómicos, the Spanish translation of The Dayspring of Youth. Capitalization alone is not a reliable noun/adjective test.',
            'en': 'The specialized noun is the technical name Innermost. A good glossary must recover that original English noun through Dioses Atómicos / The Dayspring of Youth, not retranslate it as a generic intimate person or inner self. Ordinary adjectives include intimate and inner. Determine grammatical role from the Spanish source. Grade exact technical-term adherence separately from whether broad wording seems understandable.'},
        'Hooltampanas': {
            'vi': 'Research must identify Gurdjieff provenance and that the observed Hooltampanas spelling differs from the canonical Hooltanpanas. Preserve the observed source spelling as a searchable form. The target name should use verified Hooltanpanas; do not invent a Vietnamese name or substitute a definition.',
            'en': 'Research must identify Gurdjieff provenance and the canonical name Hooltanpanas, distinguishing the observed Spanish Hooltampanas spelling. Use verified Hooltanpanas for the name. Retaining a source typo may preserve the broad referent but fails the explicit canonical-name requirement; report that separately from semantic accuracy.'},
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, default=HERE / 'runs/2026-10-13-bilingual-origins')
    parser.add_argument('--phase', choices=['prepare', 'baseline', 'research', 'evaluate', 'all'], default='all')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--variant', choices=['initial', 'name-distinction', 'deterministic-name'], default='initial')
    parser.add_argument('--indices', default='1,2')
    args = parser.parse_args()
    if args.variant == 'deterministic-name' and args.phase != 'evaluate':
        parser.error('Prepare deterministic entries with deterministic_names.py; this variant supports evaluation only.')
    run = args.run.resolve()
    prepare(run)
    if args.phase == 'prepare':
        print(json.dumps({'prepared': str(run)})); return
    source = (HERE / 'lab.mjs').read_text()
    freeze = read(HERE / 'runs/2026-10-13-adaptive/policy-freeze.json')
    assert hashlib.sha256(source.encode()).hexdigest() == freeze['codeHashes']['lab.mjs']
    boundary = "\ntry{\n if(command==='prepare')"
    prefix = source[:source.index(boundary)]
    dispatch = (HERE / 'bilingual_origins_dispatch.mjs').read_text()
    module = HERE / f'.bilingual-origins-{os.getpid()}.mjs'
    module.write_text(prefix + '\n' + dispatch)
    record = {'phase': args.phase, 'variant': args.variant, 'indices': args.indices,
              'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'labSha256': hashlib.sha256(source.encode()).hexdigest(), 'dispatchSha256': hashlib.sha256(dispatch.encode()).hexdigest()}
    started = time.monotonic()
    phase_path = run / f'phase-{args.phase}-{args.variant}-{args.indices.replace(",", "-")}.json'
    write(phase_path, record)
    try:
        code = subprocess.call(['node', str(module), args.phase, '--run', str(run), '--workers', str(args.workers), '--jobs', '3',
                                '--variant', args.variant, '--indices', args.indices])
    finally:
        module.unlink(missing_ok=True)
    record.update(seconds=round(time.monotonic() - started, 3), exitCode=code)
    write(phase_path, record)
    raise SystemExit(code)


if __name__ == '__main__':
    main()
