"""Frozen union benchmark for a single meaning contract, using subscription inference."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor

HERE = Path(__file__).resolve().parent
RUN = HERE / 'runs/2026-10-13-efficient-design'
PARENTS = ['2026-10-12-focused', '2026-10-12-recent-app', '2026-10-12', '2026-10-13-adaptive', '2026-10-13-bilingual-origins']
HISTORICAL = ['vanidad', 'Íntimo', 'fatal', 'mundos', 'sensible', 'suprasensible', 'ultrasensible', 'hipersensible',
              'mundo', 'Ultramundos', 'doble astral', 'alquimistas', 'devoto', 'fatalmente', 'fatalidad', 'triángulo fatal', 'Hooltampanas', 'mundo sensible', 'Regenerar']
EN = {s.casefold() for s in ['Íntimo', 'sensible', 'suprasensible', 'ultrasensible', 'hipersensible', 'mundo', 'mundos', 'Ultramundos', 'Hooltampanas', 'fatal', 'fatalmente', 'fatalidad', 'triángulo fatal', 'mundo sensible']}

def read(p):
    return json.loads(p.read_text()) if p.exists() else None

def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + f'.tmp-{os.getpid()}')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(p)

def norm(s):
    return unicodedata.normalize('NFC', s).casefold()

def raw_item(p):
    return {k: p[k] for k in ['itemId', 'text', 'occurrences', 'reference', 'copies', 'copyCount', 'contextBefore', 'contextAfter'] if k in p}

def neutral_from(directory, evidence):
    saved = read(directory / 'no-glossary/controlled/translations.json')
    if saved is None:
        saved = read(directory / 'vi/no-glossary/translations.json')
    if saved is not None:
        assert {p['id'] for p in saved} == {str(p['itemId']) for p in evidence['evaluation']}
        return saved
    values = {}
    expected = {str(p['itemId']): p['text'] for p in evidence['evaluation']}
    for f in (directory / 'carrier-calls').glob('*.result.json'):
        request = read(f.parent / f.name.replace('.result.json', '') / 'request.json')
        if not request or request['stage'] != 'carrier-translate':
            continue
        content = json.loads(request['content'])
        assert all(expected.get(p['id']) == p['text'] for p in content['passages'])
        for row in json.loads(read(f)['text'])['items']:
            assert row['id'] not in values or values[row['id']] == row
            values[row['id']] = row
    if set(values) == set(expected):
        return [values[str(p['itemId'])] for p in evidence['evaluation']]
    return None

def prepare_manifest(run):
    if (run / 'manifest.json').exists():
        return
    candidates = {}
    for parent in PARENTS:
        root = HERE / 'runs' / parent
        for i, entry in enumerate(read(root / 'manifest.json')['terms'], 1):
            term = entry['source_terms'][0]
            candidates.setdefault(norm(term), (term, root / 'terms' / f'{i:02}'))
    terms = []
    for term in HISTORICAL + [v[0] for v in candidates.values()]:
        if norm(term) not in {norm(t['source_terms'][0]) for t in terms}:
            terms.append({'entry_id': f'efficient-{len(terms)+1}', 'source_terms': [term],
                          'languages': ['vi', 'en'] if norm(term) in EN else ['vi'], 'historical': norm(term) in {norm(t) for t in HISTORICAL}})
    write(run / 'manifest.json', {'seed': 26101309, 'terms': terms, 'source_language': 'es', 'target_language': 'vi',
                                 'sampling': 'All original frozen evaluation passages for previous terms; new historical terms use location/containment holdout. Reused development samples are not fresh confirmation.'})
    inherited = []
    for i, entry in enumerate(terms, 1):
        previous = candidates.get(norm(entry['source_terms'][0]))
        if not previous:
            continue
        term, directory = previous
        evidence = read(directory / 'evidence.json')
        dest = run / 'terms' / f'{i:02}'
        if not evidence:
            continue
        # Replay acquisition-only sparse recall, not a prior researcher answer.
        for f in directory.glob('compact12-clitics*/evidence.json'):
            repaired = read(f)
            if repaired and repaired.get('research'):
                evidence = {**evidence, 'forms': repaired['forms'], 'research': repaired['research']}
        safe = {k: evidence[k] for k in ['term', 'forms', 'hint', 'population', 'meta', 'overlap', 'holdoutPolicy', 'recall'] if k in evidence}
        safe.update(index=i, evaluation=[raw_item(p) for p in evidence['evaluation']], research=[raw_item(p) for p in evidence['research']])
        write(dest / 'evidence.json', safe)
        neutral = neutral_from(directory, evidence)
        if neutral is not None:
            write(dest / 'vi/no-glossary.json', neutral)
        english = read(directory / 'en/no-glossary/translations.json')
        if english is not None:
            assert {p['id'] for p in english} == {str(p['itemId']) for p in evidence['evaluation']}
            write(dest / 'en/no-glossary.json', english)
        inherited.append({'index': i, 'term': term, 'previous': str(directory), 'exactNeutralReused': neutral is not None,
                          'evidenceSha256': hashlib.sha256((directory / 'evidence.json').read_bytes()).hexdigest(),
                          'neutralSha256': hashlib.sha256(json.dumps(neutral, ensure_ascii=False).encode()).hexdigest() if neutral is not None else None})
    write(run / 'inherited.json', inherited)
    explicit = read(HERE / 'runs/2026-10-13-human-challenge-v2/assessment-only/criteria.json')
    criteria = {term: {'vi': {'origin': 'explicit human criteria', 'rules': rules}} for term, rules in explicit.items()}
    origins = read(HERE / 'runs/2026-10-13-bilingual-origins/assessment-only/criteria.json')
    for term, values in origins.items():
        for language, rules in values.items():
            criteria.setdefault(term, {})[language] = {'origin': 'explicit human provenance criteria', 'rules': rules}
    inferred = {
        'sensible': 'Ordinary Spanish perceptibility must not become English sensible in its reasonable/prudent sense. Preserve genuinely sensitive/emotional uses separately. A dictionary-listed archaic sense does not establish ordinary reader comprehension.',
        'suprasensible': 'Preserve beyond-the-senses meanings with understandable English wording. Do not rely on sensible meaning perceptible inside an opaque compound. Preserve any distinct source-supported meanings.',
        'ultrasensible': 'Distinguish beyond-the-senses spiritual uses from literal extreme instrument sensitivity. An English compound must communicate its intended component meanings to ordinary readers.',
        'hipersensible': 'Distinguish extreme sensitivity from beyond-the-senses uses using the source. Do not collapse distinctions the author makes with ultrasensible/suprasensible.',
        'mundo sensible': 'Render the source perceptible/sensory-world meaning in understandable English. Do not mechanically use sensible world in its ordinary English reasonable meaning.',
        'Ultramundos': 'Recover the Nietzsche relationship where supported. Preserve the behind/beyond-world concept as a name or suitable translation. Unfamiliar opaque specialist wording must receive a reader-explanation recommendation; do not invent coinage/history.',
        'mundo': 'Preserve planetary, spiritual realm and ordinary society/world uses. World and planet are not universally interchangeable; planets must not be silently removed from usable meanings. Explicit lists containing Sun/stars need a broad enough category.',
        'alquimistas': 'Preserve adjective uses as well as nouns naming alchemists. Do not translate an adjective as people if it modifies a thing.',
        'devoto': 'Preserve ordinary devout-believer usages as well as any source-supported specialized use. Do not infer a specialist sense merely from ranked dominant books.',
        'fatalmente': 'Preserve inevitable/unavoidable uses distinctly from harmful/ominous and lethal uses. Do not mechanically translate every occurrence fatally.',
        'fatalidad': 'Distinguish misfortune/adversity, fate and genuine death contexts. Do not default to a death count or fatality just because the word resembles it.',
        'triángulo fatal': 'Identify the adulterous love triangle where that is the source referent, rather than an unexplained geometric or mystical triangle. Preserve destructive force; distinguish actual death when present.',
        'doble astral': 'Preserve the astral-body/double concept. The human reviewer rejected thể vía as a widespread Vietnamese mistranslation. Do not replace a named concept with a different body because the terms are often confused online.',
        'Regenerar': 'Preserve evidenced meanings and recover reflexive attached-pronoun occurrences. Do not treat a one-passage sample as complete evidence when regenerarse/regenerarnos occur in the corpus.'}
    for term, rules in inferred.items():
        for language in (['vi', 'en'] if norm(term) in EN else ['vi']):
            criteria.setdefault(term, {})[language] = {'origin': 'inferred from historical failure/design record', 'rules': rules}
    criteria['fatal']['en'] = {'origin': 'inferred from historical fatal study', 'rules': 'Distinguish evil/baleful, harmful, dangerous, inevitable and genuinely lethal meanings. Serious harm is not necessarily death; natural contextual English wording matters.'}
    criteria['mundos']['en'] = {'origin': 'inferred from world/planet failure', 'rules': inferred['mundo']}
    write(run / 'assessment-only/criteria.json', criteria)

class Corpus:
    def __init__(self, run):
        self.run = run
        self.process = subprocess.Popen(['python3', str(HERE / 'data_worker.py'), '/Users/hans/Desktop/AI-Projects/GlossaryGen',
            '/Users/hans/Desktop/AI-Projects/GlossaryGen/tmp/release_20261011/out/search.db',
            '/Users/hans/Library/Application Support/com.gnosis.tms/research-data/v1', str(run / 'acquisition-cache')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.seq = 0
    def get(self, endpoint, params):
        self.seq += 1
        self.process.stdin.write(json.dumps({'id': self.seq, 'op': 'search', 'url': 'https://corpus.local' + endpoint + '?' + urlencode(params)}) + '\n')
        self.process.stdin.flush()
        row = json.loads(self.process.stdout.readline())
        with (self.run / 'local-operations.jsonl').open('a') as f:
            f.write(json.dumps({'endpoint': endpoint, **row}) + '\n')
        if 'error' in row:
            raise ValueError(row['error'])
        return row['result']
    def close(self):
        self.process.stdin.close()
        self.process.wait()

def dictionary(term, cache):
    file = cache / (hashlib.sha256(term.lower().encode()).hexdigest() + '.json')
    if file.exists():
        return read(file)
    if len(term.split()) > 3 or not re.fullmatch(r'[\w áéíóúüñ-]+', term):
        result = {'text': '', 'status': 'no bounded dictionary lookup'}
    else:
        url = 'https://es.wiktionary.org/w/api.php?' + urlencode({'action': 'parse', 'page': term.lower(), 'prop': 'wikitext', 'format': 'json'})
        try:
            raw = json.loads(urlopen(Request(url, headers={'User-Agent': 'GnosisResearchStudy/1.0'}), timeout=12).read())
            text = raw.get('parse', {}).get('wikitext', {}).get('*', '')
            at = re.search(r'^==\s*\{\{lengua\|es\}\}\s*==', text, re.M)
            if not at:
                raise ValueError('No published Spanish section')
            section = re.split(r'\n==\s*\{\{lengua\|', text[at.start():])[0]
            section = re.split(r'\n={2,5}\s*Traducciones\s*={2,5}', section)[0]
            result = {'text': f'Published monolingual Spanish Wiktionary, CC BY-SA, {url}\n' + section[:6500], 'status': 'found', 'url': url}
        except Exception as error:
            result = {'text': '', 'status': 'unavailable', 'error': str(error), 'url': url}
    write(file, result)
    return result

def sources(run):
    manifest = read(run / 'manifest.json')
    inherited = {r['index']: Path(r['previous']) for r in read(run / 'inherited.json')}
    cache = run / 'dictionary-cache'
    cache.mkdir(exist_ok=True)
    # Dictionary retrieval is mechanical, has no inference call and no target answers.
    with ThreadPoolExecutor(max_workers=5) as pool:
        dictionaries = list(pool.map(lambda t: dictionary(t['source_terms'][0], cache), manifest['terms']))
    corpus = Corpus(run)
    try:
        for i, term in enumerate(manifest['terms'], 1):
            dest = run / 'terms' / f'{i:02}'
            if (dest / 'source-only/raw.json').exists():
                continue
            e = read(dest / 'evidence.json')
            value = {'dictionary': dictionaries[i-1]['text'], 'sourceProvenance': [], 'failures': [], 'spellingEvidence': None}
            if dictionaries[i-1]['status'] == 'unavailable':
                value['failures'].append(dictionaries[i-1])
            # Prior source-only payloads are acquisition evidence, never prior proposals.
            previous = inherited.get(i)
            raw_paths = []
            if previous:
                raw_paths += [previous / 'source-only/payload.json']
                raw_paths += list(previous.glob('compact12-provenance*/evidence.json'))
                raw_paths += list(previous.glob('adaptive-v1/source-provenance.json'))
            for p in raw_paths:
                raw = read(p)
                if raw:
                    value['sourceProvenance'].extend(raw.get('sourceProvenance', raw.get('sources', [])))
                    if raw.get('dictionary'):
                        value['dictionary'] = raw['dictionary']
                    if raw.get('nearSourceSpellings'):
                        value['spellingEvidence'] = {k: raw[k] for k in ['nearSourceSpellings', 'nearSourcePassages', 'originalPassages'] if k in raw}
            # Acquire original-word pairs once, bounded by books and original passages.
            if not value['sourceProvenance'] and e['forms']:
                try:
                    response = corpus.get('/api/sample/original-terms', {'forms': ','.join(e['forms'])})
                    pairs = sorted(response.get('pairs', []), key=lambda p: (p.get('basis') != 'printed_glossaries', -(p.get('original_count') or 0)))
                    seen = set()
                    for pair in pairs:
                        book = pair.get('book_id')
                        if not book or book in seen:
                            continue
                        seen.add(book)
                        original = corpus.get('/api/original/sample', {'book_id': book, 'forms': ','.join([pair['original_term'], *pair.get('original_forms', [])]), 'n': 2, 'seed': str(manifest['seed'])})
                        if original.get('items'):
                            value['sourceProvenance'].append({'pair': pair, 'original_passages': [{'text': p['text'], 'reference': p.get('reference')} for p in original['items']]})
                        if len(seen) == 3:
                            break
                except Exception as error:
                    value['failures'].append({'originals': str(error)})
            write(dest / 'source-only/raw.json', value)
            print(json.dumps({'index': i, 'term': e['term'], 'dictionary': bool(value['dictionary']), 'sourceBooks': len(value['sourceProvenance'])}), flush=True)
    finally:
        corpus.close()
    # Pure JS selection/validation is tested independently of the model runner.
    code = "import fs from 'node:fs';import {payload} from './scripts/glossary-research-lab/efficient_design.mjs';const r=process.argv[1];const m=JSON.parse(fs.readFileSync(r+'/manifest.json'));for(let i=0;i<m.terms.length;i++){const d=r+'/terms/'+String(i+1).padStart(2,'0');const e=JSON.parse(fs.readFileSync(d+'/evidence.json'));const s=JSON.parse(fs.readFileSync(d+'/source-only/raw.json'));fs.writeFileSync(d+'/source-only/input.json',JSON.stringify(payload(e,s,m.terms[i].languages)));}"
    subprocess.check_call(['node', '--input-type=module', '-e', code, str(run)], cwd=HERE.parent.parent)
    frozen_files = [*run.glob('terms/*/source-only/input.json'), *run.glob('terms/*/evidence.json'), *run.glob('terms/*/*/no-glossary.json')]
    hashes = {str(p.relative_to(run)): hashlib.sha256(p.read_bytes()).hexdigest() for p in frozen_files}
    hashes['assessment-only/criteria.json'] = hashlib.sha256((run / 'assessment-only/criteria.json').read_bytes()).hexdigest()
    write(run / 'freeze.json', {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'inputs': hashes,
        'code': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [HERE / 'efficient_design.mjs', HERE / 'efficient_design_dispatch.mjs', HERE / 'lab.mjs', HERE / 'protocol.mjs', HERE / 'adaptive.mjs']}, 'subscriptionOnly': True})

def report(run):
    manifest = read(run / 'manifest.json')
    records = [json.loads(s) for s in (run / 'requests.jsonl').read_text().splitlines()] if (run / 'requests.jsonl').exists() else []
    rows = []
    for i, item in enumerate(manifest['terms'], 1):
        d = run / 'terms' / f'{i:02}'
        e = read(d / 'evidence.json')
        for language in item['languages']:
            for method in ['lexical', 'cards']:
                grades = read(d / language / method / 'confirmed.json')
                if grades is None:
                    continue
                effects = {dim: {'gains': sum(r['effects'][dim] == 1 for r in grades), 'harms': sum(r['effects'][dim] == -1 for r in grades),
                                 'ties': sum(r['effects'][dim] == 0 for r in grades)} for dim in ['accuracy', 'policy', 'naturalness']}
                audit = read(d / language / 'entry-audit.json')
                rows.append({'index': i, 'term': e['term'], 'language': language, 'method': method, 'passages': len(grades),
                             'overlap': e.get('overlap', 0), 'effects': effects, 'audit': audit,
                             'bothMeaningErrors': sum(r['first']['accuracyA'] == r['first']['accuracyB'] == 'material_error' for r in grades),
                             'uncertain': sum('uncertain' in [r['first']['accuracyA'], r['first']['accuracyB']] for r in grades)})
    cost = {}
    for role in sorted({r['role'] for r in records}):
        rs = [r for r in records if r['role'] == role]
        cost[role] = {'calls': len(rs), 'failed': sum(r['status'] != 'ok' for r in rs), 'seconds': sum(r['seconds'] for r in rs),
                      'input': sum((r.get('usage') or {}).get('input_tokens', 0) for r in rs), 'cached': sum((r.get('usage') or {}).get('cached_input_tokens', 0) for r in rs),
                      'output': sum((r.get('usage') or {}).get('output_tokens', 0) for r in rs), 'unknownUsage': sum(not r.get('usage') for r in rs)}
    summary = {'terms': len(manifest['terms']), 'results': rows, 'cost': cost,
               'limitations': ['Exploratory previously inspected samples; not fresh confirmation.', 'Independent sessions of one model, not human validation.', 'Sparse overlap and zero-hit terms retained.', 'Policy/name gains separated from semantic correctness.']}
    write(run / 'analysis.json', summary)
    lines = ['# Efficient glossary research experiment', '', 'One integrated research artifact; no routine discovery/choice/frequency/consistency/summary model stages. Initial failures and all inference attempts remain preserved.', '',
             f"Frozen terms: {len(manifest['terms'])}. Completed term/language/method results: {len(rows)}.", '',
             '| Term | Language | Representation | Passages | Meaning gains/harms | Policy gains/harms | Naturalness gains/harms | Entry criteria |',
             '|---|---|---|---:|---:|---:|---:|---|']
    for row in rows:
        f = lambda dim: f"{row['effects'][dim]['gains']}/{row['effects'][dim]['harms']}"
        audit = ', '.join(sorted({c['status'] for c in row['audit']['checks']})) if row['audit'] else 'not assessed'
        lines.append(f"| {row['term']} | {row['language']} | {row['method']} | {row['passages']} | {f('accuracy')} | {f('policy')} | {f('naturalness')} | {audit} |")
    lines += ['', 'Ties earn no improvement credit. Both versions can share errors. Missing results are pending, not passes. Ordinary-sense performance cannot be established by an entry audit alone.', '', '## Actual model work', '', '| Role | Calls | Failed | Input tokens | Cached input | Output tokens | Summed seconds |', '|---|---:|---:|---:|---:|---:|---:|']
    for role, c in cost.items():
        lines.append(f"| {role} | {c['calls']} | {c['failed']} | {c['input']} | {c['cached']} | {c['output']} | {c['seconds']:.1f} |")
    lines += ['', 'Costs include fixed inference-runner prompt overhead and all failed attempts with available usage. Summed model work is not wall latency; unknown usage is disclosed in analysis.json. Inherited exact neutral drafts are reused without charging new baseline calls.', '', '## Limits', '', *['- ' + x for x in summary['limitations']]]
    (run / 'RESULTS.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({'results': len(rows), 'terms': len(manifest['terms']), 'cost': cost}), flush=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('phase', choices=['prepare', 'research', 'neutral', 'audit', 'translate', 'evaluate', 'confirm', 'report'])
    parser.add_argument('--run', type=Path, default=RUN)
    parser.add_argument('--indices', default='')
    parser.add_argument('--languages', default='')
    parser.add_argument('--method', choices=['lexical', 'cards'], default='lexical')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    run = args.run.resolve()
    if args.phase == 'prepare':
        prepare_manifest(run)
        subprocess.check_call(['node', str(HERE / 'lab.mjs'), 'prepare', '--run', str(run), '--holdout-policy', 'locations'], cwd=HERE.parent.parent)
        sources(run)
        return
    if args.phase == 'report':
        report(run)
        return
    freeze = read(run / 'freeze.json')
    for p, h in freeze['inputs'].items():
        assert hashlib.sha256((run / p).read_bytes()).hexdigest() == h, 'Frozen evidence changed'
    for p, h in freeze['code'].items():
        assert hashlib.sha256((HERE / p).read_bytes()).hexdigest() == h, 'Frozen code changed; register a fresh experiment'
    source = (HERE / 'lab.mjs').read_text()
    boundary = '\ntry{\n if(command===\'prepare\')'
    assert source.count(boundary) == 1
    module = HERE / f'.efficient-design-{os.getpid()}.mjs'
    module.write_text(source[:source.index(boundary)] + '\n' + (HERE / 'efficient_design_dispatch.mjs').read_text())
    start = time.monotonic()
    try:
        code = subprocess.call(['node', str(module), args.phase, '--run', str(run), '--indices', args.indices,
            '--languages', args.languages, '--method', args.method, '--workers', str(args.workers), '--jobs', str(args.workers)])
    finally:
        module.unlink(missing_ok=True)
    write(run / f'phase-{args.phase}-{args.method}-{args.indices.replace(",", "-")}-{args.languages}.json', {'seconds': time.monotonic()-start, 'exitCode': code})
    report(run)
    raise SystemExit(code)

if __name__ == '__main__':
    main()
