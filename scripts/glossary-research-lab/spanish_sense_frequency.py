"""Source-only sense counts; subscription transport, no glossary or translation input."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
RUN = HERE / 'runs/2026-10-15-spanish-sense-frequency'
SOURCE = HERE / 'runs/2026-10-14-candidate-delivery/sample.json'
RUN.mkdir(parents=True, exist_ok=True)
auth = subprocess.run(['codex', 'login', 'status'], capture_output=True, text=True, check=True)
assert 'Logged in using ChatGPT' in auth.stdout + auth.stderr, 'ChatGPT subscription required'
sample = json.loads(SOURCE.read_text())
categories = ['cuerpo_planetario', 'geografia_humana', 'humanidad_sociedad',
              'ambito_cultural_psicologico_tematico', 'region_doctrinal',
              'realidad_cosmica_total', 'existencia_terrenal', 'expresion_personas',
              'expresion_nacimiento', 'expresion_fin', 'indeterminado']
controls = [
    ('Desde la nave vieron aquel mundo rocoso orbitando su estrella.', 'cuerpo_planetario'),
    ('Su mundo se limitaba a los negocios y la política.', 'ambito_cultural_psicologico_tematico'),
    ('Los viajeros recorrieron todo el mundo y visitaron ciudades de cinco continentes.', 'geografia_humana'),
    ('Todo el mundo aplaudió al terminar la función.', 'expresion_personas'),
    ('El astrónomo distinguió tres mundos que orbitaban la misma estrella.', 'cuerpo_planetario'),
    ('Accedió mediante la meditación a los mundos internos, planos espirituales de existencia.', 'region_doctrinal'),
]
import re
control_packets = []
for n, (text, expected) in enumerate(controls):
    identity = hashlib.sha256(f'calibracion-{n}'.encode()).hexdigest()[:16]
    control_packets.append({'itemId': identity, 'text': text, 'contextBefore': [], 'contextAfter': [],
                            'occurrences': [{'start': m.start(), 'end': m.end(), 'surface': m.group()}
                                            for m in re.finditer(r'\bmundos?\b', text, re.I)]})
instructions = '''Clasifica el significado contextual de cada ocurrencia marcada de mundo/mundos, exclusivamente desde el español y sus vecinos. No traduzcas ni propongas palabras de otra lengua. Primero expresa brevemente en español qué significa aquí la ocurrencia; después asigna la categoría más ajustada. No conoces ningún glosario, traducción, clasificación previa ni criterio humano de aceptación.
Categorías: cuerpo_planetario = cuerpo celeste individual o conjunto de cuerpos presentados específicamente como unidades planetarias, incluida la Tierra considerada como cuerpo; geografia_humana = extensión terrestre, lugares, territorios o distribución geográfica; humanidad_sociedad = colectividad humana o sociedad; ambito_cultural_psicologico_tematico = ámbito cultural, mental, profesional o temático; region_doctrinal = plano, dimensión o región espiritual/doctrinal; realidad_cosmica_total = totalidad creada o realidad cósmica como conjunto; existencia_terrenal = vida terrena y sus circunstancias; expresion_personas = locución que significa todas las personas; expresion_nacimiento = locución de nacer, manifestarse o volver a la vida terrena; expresion_fin = locución de catástrofe terminal o fin de un orden; indeterminado = contexto insuficiente o lecturas competidoras.
Que el referente último sea la Tierra no convierte automáticamente una referencia a sociedad, territorio o existencia en una referencia al cuerpo planetario. A la inversa, un cuerpo planetario puede ser la Tierra sin nombrar expresamente planeta. No confundas un plano físico/doctrinal con un cuerpo celeste ni des por planetaria toda unidad cósmica no especificada. Conserva las categorías del autor sin juzgar la verdad de sus afirmaciones. Si varias lecturas son plausibles, marca uncertain y enumera alternativas; no fuerces una decisión. Cita evidencia literal del párrafo o vecinos. Devuelve cada id y cada occurrenceIndex, desde cero, exactamente una vez. Las ocurrencias de los vecinos sirven solo de contexto y no se cuentan.'''
def save(name, data):
    (RUN / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
save('sample.json', sample)
save('controls.json', [{'id': p['itemId'], 'expected': c[1]} for p, c in zip(control_packets, controls)])
save('protocol.json', {'sampleSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                      'instructions': instructions, 'categories': categories,
                      'meaningBeforeCategory': True, 'englishCandidates': False,
                      'glossaryAccess': False, 'acceptanceCriteriaAccess': False,
                      'sampleParagraphs': len(sample),
                      'sampleOccurrences': sum(len(p['occurrences']) for p in sample)})
lab = (HERE / 'lab.mjs').read_text()
transport = lab[lab.index('const ledgerFile='):lab.index('\nconst object=')]
locks = lab[lab.index('async function exclusive('):lab.index('\nlet jobFailures=')]
prefix = f'''import fs from 'node:fs';import path from 'node:path';import {{spawn,spawnSync}} from 'node:child_process';import {{createInterface}} from 'node:readline';import {{hash,checkIds}} from {json.dumps((HERE/'protocol.mjs').as_uri())};
const run={json.dumps(str(RUN))},workers=2,modelId='gpt-6.1-sol',provenance=null;
const write=(f,v)=>{{fs.mkdirSync(path.dirname(f),{{recursive:true}});fs.writeFileSync(f,JSON.stringify(v,null,2));}};
const read=f=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;
'''
runtime = '''
const object=p=>({type:'object',properties:p,required:Object.keys(p),additionalProperties:false});
const string={type:'string'},array=items=>({type:'array',items});
const protocol=read(`${run}/protocol.json`),sample=read(`${run}/sample.json`);
const category={type:'string',enum:protocol.categories};
const schema=object({items:array(object({id:string,occurrences:array(object({occurrenceIndex:{type:'integer'},meaningSpanish:string,category,certainty:{type:'string',enum:['clear','uncertain']},alternatives:array(category),evidenceQuote:string,reasonSpanish:string}))}))});
const packets=JSON.parse(process.env.GNOSIS_SENSE_CONTROL_PACKETS);
const all=[...sample,...packets];
const results=await Promise.allSettled([1,2].map(async j=>{
 const passages=[...all].sort((a,b)=>hash(`${j}:${a.itemId}`).localeCompare(hash(`${j}:${b.itemId}`))).map(p=>({id:String(p.itemId),text:p.text,before:p.contextBefore,after:p.contextAfter,occurrences:p.occurrences}));
 const answer=await call({term:'mundo',method:'spanish-source-sense-count',stage:`source-reading-${j}`,purpose:'source meaning frequency without translation candidates',effort:'high',schema,instructions:protocol.instructions,content:JSON.stringify({passages})},`${run}/calls/source-reading-${j}`,'source-classification');
 const result=JSON.parse(answer.text);checkIds(result.items,passages.map(p=>p.id));
 for(const row of result.items){
  const p=passages.find(p=>p.id===row.id),count=p.occurrences.length;
  if(row.occurrences.length!==count||new Set(row.occurrences.map(o=>o.occurrenceIndex)).size!==count||row.occurrences.some(o=>o.occurrenceIndex<0||o.occurrenceIndex>=count))throw Error('Lost occurrence');
  for(const o of row.occurrences)if(!o.evidenceQuote.trim()||![p.text,...p.before,...p.after].some(t=>t.includes(o.evidenceQuote)))throw Error('Unverified source quotation');
 }
 write(`${run}/source-reading-${j}.json`,result);return j;
}));
for(const r of results)if(r.status==='rejected')throw r.reason;
'''
assembled = prefix + locks + '\n' + transport + '\n' + runtime
save('code-manifest.json', {'assembledSha256': hashlib.sha256(assembled.encode()).hexdigest(),
                           'transportSha256': hashlib.sha256(transport.encode()).hexdigest()})
script = RUN / 'runner.mjs'
script.write_text(assembled)
env = {**os.environ, 'GNOSIS_SENSE_CONTROL_PACKETS': json.dumps(control_packets, ensure_ascii=False)}
subprocess.run(['node', '--check', str(script)], check=True)
subprocess.run(['node', str(script)], env=env, check=True)
readings = [json.loads((RUN / f'source-reading-{j}.json').read_text())['items'] for j in (1, 2)]
by_id = [{p['id']: p for p in rows} for rows in readings]
rows = []
for p in sample:
    for k, occurrence in enumerate(p['occurrences']):
        decisions = [next(o for o in index[str(p['itemId'])]['occurrences'] if o['occurrenceIndex'] == k) for index in by_id]
        agreed = all(d['certainty'] == 'clear' for d in decisions) and decisions[0]['category'] == decisions[1]['category']
        rows.append({'id': str(p['itemId']), 'occurrenceIndex': k, 'surface': occurrence['surface'],
                     'category': decisions[0]['category'] if agreed else 'unresolved', 'readings': decisions})
counts = {}
for row in rows:
    counts[row['category']] = counts.get(row['category'], 0) + 1
calibration = []
for p, (_, expected) in zip(control_packets, controls):
    for j, index in enumerate(by_id, 1):
        actual = index[p['itemId']]['occurrences'][0]
        calibration.append({'id': p['itemId'], 'reading': j, 'expected': expected,
                            'actual': actual['category'], 'passed': actual['certainty'] == 'clear' and actual['category'] == expected})
result = {'paragraphs': len(sample), 'occurrences': len(rows), 'agreedCounts': counts,
          'rows': rows, 'controlsPassed': all(c['passed'] for c in calibration), 'controls': calibration,
          'limits': 'Same-model source judgments on a paragraph sample, not gold labels or full-corpus prevalence; expressions remain separate.'}
save('results.json', result)
print(json.dumps({k: result[k] for k in ['paragraphs', 'occurrences', 'agreedCounts', 'controlsPassed']}, ensure_ascii=False), flush=True)
