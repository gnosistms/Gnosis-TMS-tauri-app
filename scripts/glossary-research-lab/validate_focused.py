"""Audit actual frozen experiment inputs, rather than reconstructed prompts."""
import json
from pathlib import Path

base = Path(__file__).resolve().parent / 'runs'
checks = []

def request(directory, stage='compact-proposal'):
    requests = [json.loads(p.read_text()) for p in (directory / 'calls').rglob('request.json')]
    return next(r for r in requests if r['stage'] == stage)

def same_settings(a, b):
    for key in ('instructions', 'schema', 'effort'):
        assert a[key] == b[key], key

for root, index in [('2026-10-12-focused', 1), ('2026-10-12-focused', 2),
                    ('2026-10-12-recent-app', 1), ('2026-10-12-recent-app', 2)]:
    directory = base / root / 'terms' / f'{index:02}'
    original = request(directory / 'compact12-precise-nodict')
    diverse = request(directory / 'compact12-diverse-precise-nodict')
    same_settings(original, diverse)
    a, b = (json.loads(r['content']) for r in (original, diverse))
    assert a.keys() == b.keys() and a['term'] == b['term'] and a['corpusForms'] == b['corpusForms']
    assert not b['dictionary'] and len(b['passages']) <= 12
    evidence = json.loads((directory / 'evidence.json').read_text())
    reserved = [' '.join(p['text'].split()).casefold() for p in evidence['evaluation']]
    for method in ['compact12-diverse-precise-nodict', 'compact12-provenance-precise-nodict',
                   'compact12-spanishdict-precise', 'compact12-coverage-spanishdict-precise',
                   'compact12-scope-precise-nodict', 'compact12-scope-spanishdict-precise',
                   'compact30-diverse-spanishdict-precise']:
        target = directory / method
        if not (target / 'entry.json').exists():
            continue
        proposal = request(target)
        content = json.loads(proposal['content'])
        assert set(content) <= set(a) | {'sourceProvenance'}
        for passage in content['passages']:
            text = ' '.join(passage['text'].split()).casefold()
            assert not any(text in held or held in text for held in reserved)
            assert 'existingTranslation' not in passage
        if method not in ('compact12-provenance-precise-nodict', 'compact12-scope-precise-nodict', 'compact12-scope-spanishdict-precise'):
            same_settings(original, proposal)
        if method == 'compact12-provenance-precise-nodict':
            without_provenance = {k: v for k, v in content.items() if k != 'sourceProvenance'}
            assert without_provenance == b
            assert proposal['instructions'].startswith(diverse['instructions'])
            assert proposal['schema'] == diverse['schema'] and proposal['effort'] == diverse['effort']
        if 'spanishdict' in method:
            assert '====Traducciones====' not in content['dictionary']
        if method == 'compact12-coverage-spanishdict-precise':
            scout = json.loads(request(target, 'coverage-scout')['content'])
            assert set(scout) == {'term', 'forms', 'sourceDictionary', 'frames'}
            ids = {frame['id'] for frame in scout['frames']}
            selected = json.loads((target / 'selected-evidence.json').read_text())
            selected_ids = {p['itemId'] for p in selected}
            assert len(selected) <= 12 and len(selected_ids) == len(selected) and selected_ids <= ids
            assert content['passages'] == [{'text': p['text'], 'reference': p['reference']['title']} for p in selected]
            for frame in scout['frames']:
                for window in frame['windows']:
                    text = ' '.join(window.split()).casefold()
                    assert not any(held in text for held in reserved)
                    assert not any(answer in window for answer in ('hành tinh', 'phù phiếm'))
            checks.append(f'{root}/{index}: bounded source-only scout and exact selected proposal evidence')
    checks.append(f'{root}/{index}: unchanged diverse settings and repair passage exclusions')

directory = base / '2026-10-12-focused/terms/01'
a = request(directory / 'compact12-diverse-precise-nodict')
b = request(directory / 'compact12-scope-precise-nodict')
c = request(directory / 'compact12-scope-spanishdict-precise')
assert a['content'] == b['content'] and b['instructions'].startswith(a['instructions'])
same_settings(b, c)
bc, cc = (json.loads(r['content']) for r in (b, c))
bc['dictionary'] = cc['dictionary']
assert bc == cc
checks.append('mundos: scope instruction only; subsequent dictionary field only')

directory = base / '2026-10-12-focused/terms/02'
a = request(directory / 'compact12-spanishdict-precise')
b = request(directory / 'compact30-diverse-spanishdict-precise')
same_settings(a, b)
ac, bc = (json.loads(r['content']) for r in (a, b))
assert bc['passages'][:12] == ac['passages'] and len(bc['passages']) == 30
bc['passages'] = ac['passages']
assert ac == bc
checks.append('fatal: passage count only, exact first twelve preserved')

result = {'passed': True, 'checks': checks}
(base / '2026-10-12-focused/intervention-validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': True, 'checks': len(checks)}))
