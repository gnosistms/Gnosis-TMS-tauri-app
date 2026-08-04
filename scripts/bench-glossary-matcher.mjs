// Offline glossary-matcher benchmark: legacy scan vs globalTrie selection.
//
// Usage: node scripts/bench-glossary-matcher.mjs
//
// Deterministic (seeded) corpora modeled on the real glossary's shape:
// mostly 1-2 token terms, common-prefix families, some duplicates. Reports
// medians over 30 iterations after warm-up. Never run from npm test — there
// are no timing assertions here; numbers are recorded in
// plans/glossary-global-longest-matching-plan.md.

import {
  findGlossaryMatchesForPolicy,
  buildEditorGlossaryModel,
} from "../src-ui/app/editor-glossary-highlighting.js";

function mulberry32(seed) {
  let internal = seed >>> 0;
  return () => {
    internal = (internal + 0x6d2b79f5) >>> 0;
    let mixed = internal;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(2026);
const pick = (values) => values[Math.floor(random() * values.length)];

// Vocabulary of plausible word shapes; prefix families come from reusing the
// same head noun across many terms (astral body / astral plane / ...).
const heads = Array.from({ length: 120 }, (_, i) => `head${i}`);
const tails = Array.from({ length: 400 }, (_, i) => `tail${i}`);
const fillers = Array.from({ length: 800 }, (_, i) => `word${i}`);

function buildTerms(count) {
  const terms = [];
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    let sourceTerm;
    if (roll < 0.35) {
      sourceTerm = pick(tails);
    } else if (roll < 0.85) {
      sourceTerm = `${pick(heads)} ${pick(tails)}`;
    } else if (roll < 0.97) {
      sourceTerm = `${pick(heads)} ${pick(tails)} ${pick(tails)}`;
    } else {
      // Deliberate duplicates to exercise merging.
      sourceTerm = `${heads[0]} ${tails[0]}`;
    }
    terms.push({
      termId: `t${index}`,
      sourceTerms: [sourceTerm],
      targetTerms: [`target ${index}`],
    });
  }
  return terms;
}

function buildText(wordCount, matchEvery) {
  const words = [];
  for (let index = 0; index < wordCount; index += 1) {
    if (matchEvery > 0 && index % matchEvery === 0) {
      words.push(`${pick(heads)} ${pick(tails)}`);
    } else {
      words.push(pick(fillers));
    }
  }
  return words.join(" ");
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(label, iterations, run) {
  for (let index = 0; index < 5; index += 1) {
    run();
  }
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  const value = median(samples);
  console.log(`${label}: median ${value.toFixed(3)} ms over ${iterations} iterations`);
  return value;
}

for (const termCount of [737, 16000]) {
  console.log(`\n=== ${termCount}-term glossary ===`);
  const terms = buildTerms(termCount);

  let model = null;
  measure(`compile (${termCount} terms)`, 30, () => {
    model = buildEditorGlossaryModel({
      glossaryId: "bench",
      repoName: "bench",
      title: "Bench",
      sourceLanguage: { code: "en", name: "English" },
      targetLanguage: { code: "vi", name: "Vietnamese" },
      terms,
    });
  });

  const rows = {
    "typical 100-token row": buildText(100, 10),
    "long 2000-token row": buildText(2000, 10),
    "no-match 250-token row": buildText(250, 0),
    "overlap-heavy row": Array.from({ length: 60 }, () => `${heads[0]} ${tails[0]} ${tails[1]}`).join(" "),
  };

  for (const [label, text] of Object.entries(rows)) {
    for (const policy of ["legacy", "globalTrie"]) {
      measure(`${label} [${policy}]`, 30, () => {
        findGlossaryMatchesForPolicy(text, model.sourceMatcher, policy);
      });
    }
  }
}
