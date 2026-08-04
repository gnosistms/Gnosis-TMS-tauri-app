import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  GLOSSARY_MATCHER_POLICIES,
  GLOSSARY_MATCHER_POLICY_VERSION,
  activeGlossaryMatcherPolicy,
  compileGlossaryTokenMatcher,
  discoverGlossaryTokenOccurrences,
  resetGlossaryMatcherPolicy,
  selectGloballyLongestOccurrences,
} from "./glossary-token-matcher.js";
import {
  buildEditorGlossaryModel,
  findGlossaryMatchesForPolicy,
  tokenizeGlossaryTerm,
} from "./editor-glossary-highlighting.js";

const golden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../tests/fixtures/glossary-matching/golden.json", import.meta.url)),
    "utf8",
  ),
);

function goldenCaseMatcher(goldenCase) {
  const model = buildEditorGlossaryModel({
    glossaryId: "golden",
    repoName: "golden",
    title: "Golden",
    sourceLanguage: { code: goldenCase.languageCode, name: goldenCase.languageCode },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    terms: goldenCase.candidates.map((candidate) => ({
      termId: candidate.id,
      sourceTerms: [candidate.term],
      targetTerms: ["target"],
    })),
  });
  return model?.sourceMatcher ?? null;
}

function occurrenceRecord(matcher, occurrence) {
  return {
    id: matcher.compiled.candidates[occurrence.candidateIndex].payload.termIdsOrdered[0],
    start: occurrence.startWord,
    end: occurrence.endWord,
  };
}

function sortRecords(records) {
  return [...records].sort(
    (left, right) =>
      left.start - right.start
      || left.end - right.end
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

test("golden fixture policy metadata matches this runtime", () => {
  assert.equal(golden.policyVersion, GLOSSARY_MATCHER_POLICY_VERSION);
  resetGlossaryMatcherPolicy();
  // The shipped default and the fixture's defaultPolicy flip together; this is
  // the guard that keeps frontend and backend on the same algorithm.
  assert.equal(activeGlossaryMatcherPolicy(), golden.defaultPolicy);
});

for (const goldenCase of golden.cases) {
  if (goldenCase.runtimes === "rust") {
    continue;
  }

  test(`golden discovery and selection: ${goldenCase.id}`, () => {
    const matcher = goldenCaseMatcher(goldenCase);
    if (goldenCase.discovered.length === 0 && !matcher) {
      // All candidates were empty/punctuation-only; nothing to compile.
      return;
    }
    assert.ok(matcher, "matcher should compile");

    const normalizedWords = tokenizeGlossaryTerm(goldenCase.text, goldenCase.languageCode);
    const occurrences = discoverGlossaryTokenOccurrences(matcher.compiled, normalizedWords);
    assert.deepEqual(
      sortRecords(occurrences.map((occurrence) => occurrenceRecord(matcher, occurrence))),
      sortRecords(goldenCase.discovered),
    );

    const accepted = selectGloballyLongestOccurrences(
      matcher.compiled,
      occurrences,
      normalizedWords.length,
    );
    assert.deepEqual(
      accepted.map((occurrence) => occurrenceRecord(matcher, occurrence)),
      goldenCase.accepted,
    );

    // The consumer wrapper must surface the same accepted candidates in the
    // same order under the globalTrie policy.
    const wrapped = findGlossaryMatchesForPolicy(
      goldenCase.text,
      matcher,
      GLOSSARY_MATCHER_POLICIES.globalTrie,
    );
    assert.deepEqual(
      wrapped.matches.map((match) => match.candidate.termIdsOrdered[0]),
      goldenCase.accepted.map((entry) => entry.id),
    );

    if (goldenCase.legacyAccepted) {
      const legacy = findGlossaryMatchesForPolicy(
        goldenCase.text,
        matcher,
        GLOSSARY_MATCHER_POLICIES.legacy,
      );
      assert.deepEqual(
        legacy.matches.map((match) => match.candidate.termIdsOrdered[0]),
        goldenCase.legacyAccepted.map((entry) => entry.id),
      );
    }
  });
}

test("occupancy bitset is correct across 32-bit word boundaries", () => {
  const words = Array.from({ length: 70 }, (_, index) => `w${index}`);
  const spans = [
    { tokens: words.slice(30, 34), priorityLength: 40 },
    { tokens: words.slice(31, 33), priorityLength: 20 },
    { tokens: words.slice(62, 66), priorityLength: 40 },
    { tokens: words.slice(63, 64), priorityLength: 20 },
  ];
  const compiled = compileGlossaryTokenMatcher(spans);
  const occurrences = discoverGlossaryTokenOccurrences(compiled, words);
  assert.equal(occurrences.length, 4);

  const accepted = selectGloballyLongestOccurrences(compiled, occurrences, words.length);
  // The 4-token spans crossing bits 31/32 and 63/64 win; the nested spans
  // must be rejected by occupancy checks that straddle the word boundary.
  assert.deepEqual(
    accepted.map((occurrence) => [occurrence.startWord, occurrence.endWord]),
    [
      [30, 34],
      [62, 66],
    ],
  );
});

test("accepted occurrences never overlap and rejections overlap an accepted winner", () => {
  const candidates = [
    { tokens: ["a", "b", "c"], priorityLength: 5 },
    { tokens: ["b", "c"], priorityLength: 3 },
    { tokens: ["c", "a"], priorityLength: 3 },
    { tokens: ["a"], priorityLength: 1 },
  ];
  const words = ["a", "b", "c", "a", "b", "c", "a"];
  const compiled = compileGlossaryTokenMatcher(candidates);
  const occurrences = discoverGlossaryTokenOccurrences(compiled, words);
  const accepted = selectGloballyLongestOccurrences(compiled, occurrences, words.length);

  const occupiedWords = new Set();
  for (const occurrence of accepted) {
    for (let word = occurrence.startWord; word < occurrence.endWord; word += 1) {
      assert.ok(!occupiedWords.has(word), "accepted occurrences must not overlap");
      occupiedWords.add(word);
    }
  }

  const acceptedKeys = new Set(
    accepted.map((occurrence) => `${occurrence.candidateIndex}:${occurrence.startWord}`),
  );
  for (const occurrence of occurrences) {
    if (acceptedKeys.has(`${occurrence.candidateIndex}:${occurrence.startWord}`)) {
      continue;
    }
    let overlapsAccepted = false;
    for (let word = occurrence.startWord; word < occurrence.endWord; word += 1) {
      if (occupiedWords.has(word)) {
        overlapsAccepted = true;
      }
    }
    assert.ok(overlapsAccepted, "every rejected occurrence overlaps an accepted one");
  }
});

// Deliberately slow exhaustive reference implementation: nested-loop discovery
// plus greedy selection over a naively computed priority order. The compiled
// trie must agree with it on every seeded random input.
function referenceGloballyLongest(candidates, words) {
  const merged = [];
  const byKey = new Map();
  candidates.forEach((candidate) => {
    if (candidate.tokens.length === 0) {
      return;
    }
    const key = candidate.tokens.join(" ");
    const existing = byKey.get(key);
    if (existing) {
      existing.priorityLength = Math.max(existing.priorityLength, candidate.priorityLength);
      return;
    }
    const record = {
      tokens: candidate.tokens,
      priorityLength: candidate.priorityLength,
      key,
      ordinal: merged.length,
    };
    byKey.set(key, record);
    merged.push(record);
  });

  const occurrences = [];
  for (const candidate of merged) {
    for (let start = 0; start + candidate.tokens.length <= words.length; start += 1) {
      const matchesHere = candidate.tokens.every(
        (token, offset) => words[start + offset] === token,
      );
      if (matchesHere) {
        occurrences.push({ candidate, start, end: start + candidate.tokens.length });
      }
    }
  }

  occurrences.sort((left, right) =>
    right.candidate.tokens.length - left.candidate.tokens.length
    || right.candidate.priorityLength - left.candidate.priorityLength
    || left.start - right.start
    || left.end - right.end
    || (left.candidate.key < right.candidate.key
      ? -1
      : left.candidate.key > right.candidate.key
        ? 1
        : 0)
    || left.candidate.ordinal - right.candidate.ordinal);

  const occupied = new Array(words.length).fill(false);
  const accepted = [];
  for (const occurrence of occurrences) {
    let blocked = false;
    for (let word = occurrence.start; word < occurrence.end; word += 1) {
      if (occupied[word]) {
        blocked = true;
      }
    }
    if (blocked) {
      continue;
    }
    for (let word = occurrence.start; word < occurrence.end; word += 1) {
      occupied[word] = true;
    }
    accepted.push(occurrence);
  }
  accepted.sort((left, right) => left.start - right.start || left.end - right.end);
  return accepted.map((occurrence) => ({
    key: occurrence.candidate.key,
    start: occurrence.start,
    end: occurrence.end,
  }));
}

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

test("property: compiled trie agrees with the exhaustive reference on seeded random inputs", () => {
  const alphabet = ["a", "b", "c"];
  // Same deterministic seed corpus as the Rust property test.
  for (let seed = 1; seed <= 200; seed += 1) {
    const random = mulberry32(seed);
    const pick = (values) => values[Math.floor(random() * values.length)];
    const candidateCount = 1 + Math.floor(random() * 6);
    const candidates = Array.from({ length: candidateCount }, () => {
      const tokenCount = 1 + Math.floor(random() * 3);
      return {
        tokens: Array.from({ length: tokenCount }, () => pick(alphabet)),
        priorityLength: 1 + Math.floor(random() * 10),
      };
    });
    const wordCount = Math.floor(random() * 13);
    const words = Array.from({ length: wordCount }, () => pick(alphabet));

    const expected = referenceGloballyLongest(candidates, words);

    // Merge duplicates the same way the domain layer does before compiling.
    const mergedByKey = new Map();
    for (const candidate of candidates) {
      const key = candidate.tokens.join(" ");
      const existing = mergedByKey.get(key);
      if (existing) {
        existing.priorityLength = Math.max(existing.priorityLength, candidate.priorityLength);
      } else {
        mergedByKey.set(key, { ...candidate });
      }
    }
    const compiled = compileGlossaryTokenMatcher(Array.from(mergedByKey.values()));
    const occurrences = discoverGlossaryTokenOccurrences(compiled, words);
    const accepted = selectGloballyLongestOccurrences(compiled, occurrences, words.length);
    const actual = accepted.map((occurrence) => ({
      key: compiled.candidates[occurrence.candidateIndex].key,
      start: occurrence.startWord,
      end: occurrence.endWord,
    }));

    assert.deepEqual(actual, expected, `seed ${seed}`);
  }
});

test("reordering distinct candidates does not change accepted spans", () => {
  const forward = [
    { tokens: ["a", "b", "c"], priorityLength: 5 },
    { tokens: ["b", "c"], priorityLength: 4 },
    { tokens: ["a"], priorityLength: 1 },
  ];
  const words = ["a", "b", "c", "b", "c", "a"];
  const spansFor = (candidates) => {
    const compiled = compileGlossaryTokenMatcher(candidates);
    return selectGloballyLongestOccurrences(
      compiled,
      discoverGlossaryTokenOccurrences(compiled, words),
      words.length,
    ).map((occurrence) => [
      compiled.candidates[occurrence.candidateIndex].key,
      occurrence.startWord,
      occurrence.endWord,
    ]);
  };

  assert.deepEqual(spansFor(forward), spansFor([...forward].reverse()));
});
