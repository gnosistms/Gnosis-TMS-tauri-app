"""Conservative source-only shortcut for rare named units with numeric fingerprints."""
import hashlib
import re
import time
import unicodedata

from bilingual_origins import HERE, read, write


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if not unicodedata.combining(c))


def one_edit(left, right):
    left, right = fold(left), fold(right)
    if left == right or abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        differences = [i for i, (a, b) in enumerate(zip(left, right)) if a != b]
        return len(differences) == 1 or (len(differences) == 2 and differences[1] == differences[0] + 1
                                        and left[differences[0]:differences[1]+1] == right[differences[0]:differences[1]+1][::-1])
    shorter, longer = (left, right) if len(left) < len(right) else (right, left)
    return any(longer[:i] + longer[i+1:] == shorter for i in range(len(longer)))


def fingerprints(text, term):
    positions = list(re.finditer(r'(?<!\w)' + re.escape(term) + r'(?!\w)', text, re.I))
    result = set()
    for number in re.finditer(r'(?<!\w)(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s+([^\W\d_]+)', text):
        value = int(re.sub(r'[.,]', '', number.group(1)))
        if value < 10000 or not any(abs(number.start() - position.start()) <= 250 for position in positions):
            continue
        window = text[max(0, number.start()-250):number.end()+40]
        if re.search(r'\b(?:equivale|equivalente|representa|igual)\b', window, re.I):
            result.add((value, fold(number.group(2))))
    return result


def discover(payload):
    observed = payload['term']
    candidates = payload['nearSourceSpellings']['near']
    if len(candidates) != 1:
        raise ValueError('Require one unique near spelling, not an ambiguous choice')
    canonical = candidates[0]['form']
    if not one_edit(observed, canonical):
        raise ValueError('Require a distinct one-edit counterpart')
    edition = payload['originalPassages']
    if not edition.get('author') or not edition.get('book_id') or not any(
        re.search(r'(?<!\w)' + re.escape(canonical) + r'(?!\w)', p['text'], re.I) for p in edition['items']):
        raise ValueError('Matched original edition must attest the canonical name and author')
    original_doc = 'source-' + edition['book_id']
    sources = [p for p in payload['nearSourcePassages']['items'] if
               p['representative']['doc_id'] == original_doc and
               re.search(r'(?<!\w)' + re.escape(canonical) + r'(?!\w)', p['text'], re.I)]
    corpus_fingerprints = set().union(*(fingerprints(p['text'], observed) for p in payload['passages']))
    matches = [(p, fingerprints(p['text'], canonical) & corpus_fingerprints) for p in sources]
    matches = [(p, values) for p, values in matches if len(values) == 1]
    if len(matches) != 1:
        raise ValueError('Require one source definition matching the same large number and unit')
    source, values = matches[0]
    return dict(observed=observed, canonical=canonical, author=edition['author'],
                book=edition['title_es'], originalEditionLanguage=edition['language'],
                value=next(iter(values))[0], unit=next(iter(values))[1],
                reference=source['representative'], sourceDefinition=source['text'])


def main():
    started = time.perf_counter()
    run = HERE / 'runs/2026-10-13-bilingual-origins'
    directory = run / 'terms/02'
    payload_path = directory / 'source-only/payload.json'
    payload = read(payload_path)
    result = discover(payload)
    evidence = read(directory / 'evidence.json')
    provenance = dict(sourceForm=result['observed'], originalTerm=result['canonical'],
                      originalLanguage=result['originalEditionLanguage'], book=result['book'], author=result['author'],
                      relationship='Verified source-book counterpart; observed corpus spelling differs by one edit.',
                      evidence=result['sourceDefinition'],
                      uncertainty='The available original-language edition attests the name; first composition language, first coinage and who introduced the corpus spelling variation are not established.')
    entry = dict(entries=[dict(id='verified-source-name', kind='word',
                              sourceTerms=list(dict.fromkeys(evidence['forms'] + [result['canonical']])),
                              generalNote=f"Forma observada: {result['observed']}; forma verificada en {result['book']} — {result['author']}: {result['canonical']}. Coinciden la cifra {result['value']} y la unidad {result['unit']}. Mantener la forma observada para búsquedas; usar la forma verificada al traducir.",
                              variants=[dict(id='verified-source-name-1', target=result['canonical'], note='Nombre propio de la unidad; no reemplazarlo por una definición.')])],
                 provenance=[provenance], risks=[provenance['uncertainty']])
    for language in ['vi', 'en']:
        write(directory / language / 'researched-deterministic-name/entry.json', entry)
    write(directory / 'deterministic-name/proof.json', dict(result=result, researchModelCalls=0,
          researchModelTokens=0, payloadSha256=hashlib.sha256(payload_path.read_bytes()).hexdigest(),
          localDecisionSeconds=round(time.perf_counter() - started, 6),
          narrowRule='Unique one-edit source counterpart + shared large numeric/unit definition + attested original edition name.'))
    print({'canonical': result['canonical'], 'author': result['author'], 'researchModelCalls': 0})


if __name__ == '__main__':
    main()
