"""Full-engine preservation experiment; calibrated human-criterion tests precede scoring."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE / 'runs/2026-10-13-full-preservation'
PREPARED = HERE / 'runs/2026-10-13-efficient-design'

def read(p):
    return json.loads(p.read_text()) if p.exists() else None

def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + f'.tmp-{os.getpid()}')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(p)

def controls(language, criteria):
    """Explicit mutations of genuine source excerpts, not easy invented source sentences."""
    manifest = read(PREPARED / 'manifest.json')
    by = {t['source_terms'][0]: read(PREPARED / 'terms' / f'{i:02}' / 'evidence.json') for i, t in enumerate(manifest['terms'], 1)}
    def source(term, match):
        return next(p for p in by[term]['evaluation'] + by[term]['research'] if match(p['text']))
    cases = []
    def add(name, term, item, source_text, good, bad, checks, origin='expected judgments derived from recorded human criteria'):
        assert source_text in item['text'], 'Calibration excerpt must be genuine source text'
        cases.append({'case': name, 'term': term, 'source': source_text, 'reference': item['reference'], 'sourceId': item['itemId'],
                      'good': good, 'bad': bad, 'checks': checks, 'expectedOrigin': origin})
    if language == 'vi':
        p = source('vanidad', lambda t: 'espejo' in t and 'vanidad' in t)
        s = 'Si le dijéramos que es espantosamente fea, se sentiría herida en su vanidad y mortalmente.'
        add('vanidad-appearance-motive', 'vanidad', p, s,
            'Nếu chúng ta nói rằng cô ấy xấu xí đến kinh khủng, lòng tự phụ về vẻ ngoài và hình ảnh của mình trong mắt người khác của cô ấy sẽ bị tổn thương sâu sắc.',
            'Nếu chúng ta nói rằng cô ấy xấu xí đến kinh khủng, lòng phù phiếm của cô ấy sẽ bị tổn thương sâu sắc.', {'accuracyGood': 'faithful', 'accuracyBad': 'material_error'})
        p = source('fatal', lambda t: 'influencia mecánica fatal' in t)
        s = p['text']
        neutral = next(p['translation'] for p in read(PREPARED / 'terms/03/vi/no-glossary.json') if p['id'] == str(next(x['itemId'] for x in by['fatal']['evaluation'] if x['text'] == s)))
        assert 'tai hại' in neutral
        add('fatal-harm-is-not-death', 'fatal', p, s, neutral, neutral.replace('tai hại', 'gây chết người'), {'accuracyGood': 'faithful', 'accuracyBad': 'material_error'})
        add('fatal-acceptable-synonym', 'fatal', p, s, neutral, neutral.replace('tai hại', 'có hại'), {'accuracyGood': 'faithful', 'accuracyBad': 'faithful'}, 'acceptable target alternatives under the human harmful-sense criterion')
        add('identical-bad-is-not-success', 'fatal', p, s, neutral.replace('tai hại', 'gây chết người'), neutral.replace('tai hại', 'gây chết người'), {'accuracyGood': 'material_error', 'accuracyBad': 'material_error'})
        p = source('mundos', lambda t: 'cuarto, Sol' in t)
        s = 'Recuerden ustedes que nuestro Sistema Solar tiene 13 mundos; y eso se les hará raro a ustedes, pero los voy a mencionar: primero, Tierra; segundo, Mercurio; tercero, Venus; cuarto, Sol; quinto, Marte; sexto, Júpiter; séptimo, Saturno; octavo, Neptuno; noveno, Urano; décimo, Plutón; onceavo, Vulcano; doceavo, Perséfone; y treceavo, Clarión.'
        good = 'Hãy nhớ rằng Hệ Mặt Trời của chúng ta có 13 thế giới; điều đó có thể khiến các bạn ngạc nhiên, nhưng tôi sẽ kể ra: thứ nhất, Trái Đất; thứ hai, Sao Thủy; thứ ba, Sao Kim; thứ tư, Mặt Trời; thứ năm, Sao Hỏa; thứ sáu, Sao Mộc; thứ bảy, Sao Thổ; thứ tám, Sao Hải Vương; thứ chín, Sao Thiên Vương; thứ mười, Sao Diêm Vương; thứ mười một, Vulcano; thứ mười hai, Perséfone; và thứ mười ba, Clarión.'
        add('mundos-category-membership', 'mundos', p, s, good, good.replace('13 thế giới', '13 hành tinh'), {'accuracyGood': 'faithful', 'policyGood': 'pass', 'policyBad': 'fail'})
    else:
        p = source('Íntimo', lambda t: 'amigo íntimo' in t)
        s = 'Decir que conocemos a un amigo, que conocemos su vida íntima, que es un amigo íntimo, resulta exagerar la nota'
        good = 'To say that we know a friend, know his private life, and that he is a close friend is to exaggerate.'
        add('intimo-ordinary-adjective', 'Íntimo', p, s, good, good.replace('a close friend', 'an Innermost friend'), {'accuracyGood': 'faithful', 'accuracyBad': 'material_error'})
        p = source('suprasensible', lambda t: 'aquello que no pertenece al mundo físico' in t)
        s = 'tienen las humanas criaturas el poder de ver lo suprasensible, aquello que no pertenece al mundo físico, eso que es invisible para los adultos.'
        good = 'Human children have the power to see what lies beyond the senses, what does not belong to the physical world and is invisible to adults.'
        add('suprasensible-ordinary-reader', 'suprasensible', p, s, good, good.replace('what lies beyond the senses', 'the supersensible'), {'accuracyGood': 'faithful', 'policyGood': 'pass', 'policyBad': 'fail'})
        p = source('Hooltampanas', lambda t: 'Hooltampanas' in t)
        s = '(Un Hooltampanas equivale a 5.764.801 tonalidades del color cósmico universal.)'
        good = '(One Hooltanpanas equals 5,764,801 shades of universal cosmic colour.)'
        add('hooltampanas-canonical-name', 'Hooltampanas', p, s, good, good.replace('Hooltanpanas', 'Hooltampanas'), {'accuracyGood': 'faithful', 'accuracyBad': 'faithful', 'policyGood': 'pass', 'policyBad': 'fail'})
    # Mirror every pair, using opaque ids. Gold expectations never enter packets.
    presentations = []
    for i, c in enumerate(cases, 1):
        for mirror in [False, True]:
            good_side, bad_side = ('B', 'A') if mirror else ('A', 'B')
            expected = {k.replace('Good', good_side).replace('Bad', bad_side): v for k, v in c['checks'].items()}
            presentations.append({'case': c['case'], 'reference': c['reference'], 'sourceId': c['sourceId'], 'expectedOrigin': c['expectedOrigin'],
                'packet': {'id': f'c{i:02}-{int(mirror)}', 'term': c['term'], 'language': language, 'source': c['source'],
                           'A': c['bad'] if mirror else c['good'], 'B': c['good'] if mirror else c['bad'],
                           'criteria': criteria.get(c['term'], {}).get(language, {'rules': 'Preserve actual source meaning.'})},
                'expected': expected})
    return presentations

def prepare(language):
    run = ROOT / language
    if (run / 'freeze.json').exists():
        return run
    manifest = read(PREPARED / 'manifest.json')
    chosen = [(i, t) for i, t in enumerate(manifest['terms'], 1) if language in t['languages']]
    write(run / 'manifest.json', {**manifest, 'terms': [t for _, t in chosen], 'researchProcedure': 'full', 'target_language': language,
        'primaryCohort': 'historical failures and explicit human criteria', 'secondaryCohort': 'random regression terms',
        'sampling': 'Original frozen passages; domain calibration excerpts are separate and never establish glossary gains.'})
    criteria = read(PREPARED / 'assessment-only/criteria.json')
    write(run / 'assessment-only/criteria.json', criteria)
    for new_i, (old_i, term) in enumerate(chosen, 1):
        src, dest = PREPARED / 'terms' / f'{old_i:02}', run / 'terms' / f'{new_i:02}'
        e = read(src / 'evidence.json');e['index'] = new_i
        write(dest / 'evidence.json', e)
        neutral = read(src / language / 'no-glossary.json')
        if neutral is not None:
            write(dest / 'no-glossary.json', neutral)
        write(dest / 'source-only/acquisition.json', read(src / 'source-only/raw.json'))
    write(run / 'assessment-only/domain-controls.json', controls(language, criteria))
    subprocess.check_call(['node', str(HERE / 'lab.mjs'), 'prepare', '--run', str(run), '--holdout-policy', 'locations'], cwd=HERE.parent.parent)
    files = [run / 'manifest.json', *run.glob('terms/*/evidence.json'), *run.glob('terms/*/no-glossary.json'), *run.glob('assessment-only/*.json'), *run.glob('baseline-snapshot/*.js')]
    write(run / 'freeze.json', {'inputs': {str(p.relative_to(run)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
        'code': {p: hashlib.sha256((HERE / p).read_bytes()).hexdigest() for p in ['lab.mjs', 'full_research_dispatch.mjs', 'full_carrythrough.mjs', 'efficient_design.mjs']},
        'language': language, 'researchProcedure': 'full', 'calibrationMustPassBeforeScoring': True, 'primaryBaseline': 'exact no-glossary draft',
        'stageRemovalAuthorized': False, 'subscriptionOnly': True})
    return run

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'calibrate', 'research', 'compile', 'neutral', 'translate', 'evaluate', 'confirm'])
    parser.add_argument('--language', choices=['vi', 'en'], default='vi')
    parser.add_argument('--indices', default='')
    parser.add_argument('--method', choices=['full-original', 'full-preserved'], default='full-preserved')
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    run = prepare(args.language)
    if args.phase == 'prepare':
        print(json.dumps({'prepared': str(run), 'terms': len(read(run / 'manifest.json')['terms']), 'domainControlPresentations': len(read(run / 'assessment-only/domain-controls.json'))}));return
    freeze = read(run / 'freeze.json')
    for p, h in freeze['inputs'].items():
        assert hashlib.sha256((run / p).read_bytes()).hexdigest() == h, 'Frozen evidence/control/snapshot changed'
    for p, h in freeze['code'].items():
        assert hashlib.sha256((HERE / p).read_bytes()).hexdigest() == h, 'Register a new experiment for code changes'
    source = (HERE / 'lab.mjs').read_text();boundary = "\ntry{\n if(command==='prepare')"
    assert source.count(boundary) == 1
    module = HERE / f'.full-research-{os.getpid()}.mjs'
    module.write_text(source[:source.index(boundary)] + '\n' + (HERE / 'full_research_dispatch.mjs').read_text())
    subprocess.check_call(['node', '--check', str(module)])
    start = time.monotonic()
    try:
        code = subprocess.call(['node', str(module), args.phase, '--run', str(run), '--language', args.language, '--indices', args.indices,
            '--method', args.method, '--workers', str(args.workers), '--jobs', str(args.workers)])
    finally:
        module.unlink(missing_ok=True)
    write(run / f'phase-{args.phase}-{args.method}-{args.indices.replace(",", "-")}.json', {'seconds': time.monotonic()-start, 'exitCode': code})
    raise SystemExit(code)

if __name__ == '__main__':
    main()
