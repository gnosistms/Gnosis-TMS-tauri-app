"""Four-term evaluation using human criteria isolated from de novo research.

Copies frozen source samples and exact neutral drafts. Existing results remain
unchanged. The CLI uses the original subscription-only runner's hash-verified
functions, with a separate dispatcher for this exploratory experiment.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCES = [
    ('vanidad', '2026-10-12-recent-app', 2, 'compact12-coverage-spanishdict-precise'),
    ('Íntimo', '2026-10-12-recent-app', 1, 'compact12-provenance-precise-nodict'),
    ('fatal', '2026-10-12-focused', 2, 'compact12-coverage-spanishdict-precise'),
    ('mundos', '2026-10-12-focused', 1, 'compact12-scope-spanishdict-precise'),
]
CRITERIA = {
    'vanidad': [
        {'id': 'appearance-perception', 'meaning': 'In the personal-vanity sense, excessive concern about outward appearance or how others perceive you. The human domain reviewer specifically says this rarely or perhaps never means phù phiếm, and contrasts that wording with the appearance/perception trait. For this test, bare phù phiếm or lòng phù phiếm does not adequately convey that trait; reserve it for genuine futility/frivolity contexts, unless explicit Vietnamese qualification itself communicates the required concern. Do not override this supplied target-language distinction by asserting that readers can infer the missing meaning from surrounding source context. Other Vietnamese wording is acceptable only if it actually communicates the trait, not merely self-satisfaction, pride or desire for public fame.'},
        {'id': 'exception', 'meaning': 'Preserve genuinely source-supported futility, transience or empty-praise uses; the dominant psychological sense is not a categorical ban on other meanings.'},
    ],
    'Íntimo': [
        {'id': 'noun', 'meaning': 'The specialized noun is the Innermost, Đấng Nội tại, with the Dayspring of Youth source relationship. It is distinct from the ordinary adjective and must remain distinct from nearby named concepts such as Atman or Soul when contrasted in the source.'},
        {'id': 'adjective', 'meaning': 'The adjective means inner, internal or intimate as context requires. The entry must provide this grammatical branch separately; do not translate an ordinary adjective as a divine person.'},
        {'id': 'provenance', 'meaning': 'The entry must identify Innermost and The Dayspring of Youth for the specialized noun. Assess the supported relationship separately from unproven assertions of first coinage or a direct historical borrowing route.'},
    ],
    'fatal': [
        {'id': 'baleful', 'meaning': 'baleful / ominously malign or bringing misfortune'},
        {'id': 'evil', 'meaning': 'evil / malign'},
        {'id': 'harmful', 'meaning': 'harmful / detrimental'},
        {'id': 'dangerous', 'meaning': 'dangerous'},
        {'id': 'inevitable', 'meaning': 'inevitable / unavoidable'},
        {'id': 'deadly', 'meaning': 'deadly / lethal when the source warrants death'},
        {'id': 'selection', 'meaning': 'All six meanings must be available in the entry. Deadly is less common than baleful, evil and harmful in the intended corpus usage. Do not default to chết người, chết chóc or other lethal language for nonlethal senses. Do not infer lethality just because harm is serious.'},
    ],
    'mundos': [
        {'id': 'planet', 'meaning': 'Planet, hành tinh, is the primary intended translation whenever the source can coherently be understood as planets. Do not require the sentence to explicitly contain planeta. Merely possible modern taxonomic objections do not override the author’s usage.'},
        {'id': 'realm-world', 'meaning': 'Other translations include cõi and thế giới. Use them when planet would not make sense, e.g. clearly spiritual realms, human society or expressions. A list that explicitly includes the Sun or stars as worlds may require a broader word; do not call every celestial object a planet.'},
    ],
}


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + f'.tmp-{os.getpid()}')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def prepare(run):
    if (run / 'manifest.json').exists():
        assert read(run / 'assessment-only/criteria.json') == CRITERIA
        return
    write(run / 'assessment-only/criteria.json', CRITERIA)
    write(run / 'manifest.json', {
        'seed': 26101304, 'population': None,
        'terms': [{'entry_id': f'challenge-{i}', 'source_terms': [s[0]]} for i, s in enumerate(SOURCES, 1)],
        'source_language': 'es', 'target_language': 'vi',
        'sampling': 'Previously frozen forty-passage samples, analyzed under newly supplied human criteria. Exploratory, not fresh confirmation or a frequency estimate.',
    })
    inherited = []
    for index, (term, parent, oldindex, method) in enumerate(SOURCES, 1):
        src = HERE / 'runs' / parent / 'terms' / f'{oldindex:02}'
        dest = run / 'terms' / f'{index:02}'
        evidence = read(src / 'evidence.json')
        assert evidence['term'] == term and len(evidence['evaluation']) == 40
        write(dest / 'evidence.json', evidence)
        requests = [read(p) for p in (src / method / 'calls').glob('*/request.json')]
        proposals = [r for r in requests if r['stage'] == 'compact-proposal']
        assert len(proposals) == 1
        request = proposals[0]
        content = json.loads(request['content'])
        reserved = {p['text'] for p in evidence['evaluation']}
        assert not reserved.intersection(p['text'] for p in content['passages'])
        write(dest / 'source-only/request.json', request)
        write(dest / 'selected/entry.json', read(src / method / 'entry.json'))
        write(dest / 'selected/controlled/translations.json', read(src / method / 'controlled/translations.json'))
        write(dest / 'no-glossary/entry.json', {'entries': [], 'status': 'done', 'exactNeutralDraft': True})
        write(dest / 'no-glossary/controlled/translations.json', read(src / 'no-glossary/controlled/translations.json'))
        shutil.copytree(src / 'carrier-calls', dest / 'carrier-calls', dirs_exist_ok=True)
        records = [json.loads(line) for line in (HERE / 'runs' / parent / 'requests.jsonl').read_text().splitlines()]
        recs = [r for r in records if r.get('term') == term and r.get('method') == method and r.get('role') == 'research']
        inherited.append({'term': term, 'parentRun': parent, 'method': method,
                          'researchRecords': recs,
                          'limitations': 'Original reserved-text holdout, not the later adaptive source-location holdout. Prior optimization already inspected this sample.'})
    write(run / 'inherited-costs.json', inherited)
    source = (HERE / 'lab.mjs').read_bytes()
    write(run / 'provenance.json', {'modelId': 'gpt-6.1-sol', 'frozenLabSha256': hashlib.sha256(source).hexdigest(), 'subscriptionOnly': True})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, default=HERE / 'runs/2026-10-13-human-challenge-v2')
    parser.add_argument('--phase', choices=['prepare', 'baseline', 'research', 'evaluate', 'variant', 'variant-research', 'all'], default='all')
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--variant', choices=['meaning-first', 'all-source-onecall', 'operational-definition', 'meaning-cards', 'specificity-boundary', 'priority-policy', 'modifier-scope', 'dictionary-completion', 'form-balanced'], default='meaning-first')
    parser.add_argument('--indices', default='1,2,3,4')
    args = parser.parse_args()
    run = args.run.resolve()
    prepare(run)
    # The first assessment omitted the user's earlier explicit Vietnamese
    # distinction. Preserve that attempt; reuse only unchanged other-term calls.
    previous = HERE / 'runs/2026-10-13-human-challenge'
    if previous.exists() and previous != run:
        for index in [2, 3, 4]:
            src = previous / 'terms' / f'{index:02}' / 'assessment-only'
            dest = run / 'terms' / f'{index:02}' / 'assessment-only'
            if src.exists():
                shutil.copytree(src, dest, dirs_exist_ok=True)
        if not (run / 'prior-assessment-attempt.json').exists():
            ledger = previous / 'requests.jsonl'
            write(run / 'prior-assessment-attempt.json', {
                'run': str(previous), 'reason': 'Assessment failed to enforce the already supplied Vietnamese distinction for personal vanidad; no new research had run.',
                'records': [json.loads(s) for s in ledger.read_text().splitlines()] if ledger.exists() else [],
                'rawInterruptedCallsPreserved': True,
                'reusedUnchangedTerms': ['Íntimo', 'fatal', 'mundos'],
            })
    if args.phase == 'prepare':
        print(json.dumps({'prepared': str(run), 'terms': [s[0] for s in SOURCES]}))
        return
    source = (HERE / 'lab.mjs').read_text()
    freeze = read(HERE / 'runs/2026-10-13-adaptive/policy-freeze.json')
    assert hashlib.sha256(source.encode()).hexdigest() == freeze['codeHashes']['lab.mjs']
    boundary = "\ntry{\n if(command==='prepare')"
    assert source.count(boundary) == 1
    prefix = source[:source.index(boundary)]
    dispatch = (HERE / 'human_challenge_dispatch.mjs').read_text()
    module = HERE / f'.human-challenge-{os.getpid()}.mjs'
    module.write_text(prefix + '\n' + dispatch)
    record = {'phase': args.phase, 'variant': args.variant, 'indices': args.indices,
              'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'labSha256': hashlib.sha256(source.encode()).hexdigest(),
              'dispatchSha256': hashlib.sha256(dispatch.encode()).hexdigest()}
    phasefile = run / f'phase-{args.phase}-{args.variant}-{args.indices.replace(",", "-")}.json'
    write(phasefile, record)
    started = time.monotonic()
    try:
        code = subprocess.call(['node', str(module), args.phase, '--run', str(run),
                                '--evaluation-mode', 'controlled', '--workers', str(args.workers), '--jobs', '2',
                                '--variant', args.variant, '--indices', args.indices])
    finally:
        module.unlink(missing_ok=True)
    record.update(seconds=round(time.monotonic() - started, 3), exitCode=code)
    write(phasefile, record)
    raise SystemExit(code)


if __name__ == '__main__':
    main()
