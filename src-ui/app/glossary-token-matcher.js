// Generic compiled token-trie matcher with globally longest greedy selection.
//
// This module is tokenizer-agnostic and metadata-agnostic: callers supply
// candidates as already-normalized token sequences (one candidate per merged
// normalized sequence, in first-seen order) and text as a normalized token
// array. Domain concerns — tokenization modes, ruby handling, metadata
// merging, rendering — stay in editor-glossary-highlighting.js.
//
// Selection semantics (see docs/glossary-matching.md and
// tests/fixtures/glossary-matching/golden.json): discover every trie terminal
// occurrence including nested and crossing overlaps, then greedily accept
// occurrences in priority order — token count descending, candidate scalar
// length descending, start ascending, end ascending, normalized key ascending,
// first-seen ordinal ascending — skipping any occurrence that touches an
// already-occupied token. This is the historical longest-first rule applied
// globally, NOT maximum-coverage interval scheduling.

// Bumped whenever compiled-matcher or selection semantics change; asserted
// against the shared golden fixture so JS and Rust stay in lockstep.
export const GLOSSARY_MATCHER_POLICY_VERSION = 1;

// The single active selection policy. The legacy left-to-right scan was
// removed after the v0.8.86 bake, so rollback is now a git revert rather than
// a constant flip. The shared fixture's defaultPolicy field must equal this
// constant in both runtimes, and the value stays in the derived-glossary
// revision key so cached derived entries remain valid across the cleanup.
export const GLOSSARY_MATCHER_POLICY = "globalTrie";

// candidates: [{ tokens: [normalized...], priorityLength, payload }] in
// first-seen order, one entry per merged normalized token sequence.
// priorityLength is the greatest Unicode-scalar length among the merged
// variants' base texts (NOT UTF-16 units — those disagree for non-ASCII).
export function compileGlossaryTokenMatcher(candidates) {
  const tokenIds = new Map();
  const transitions = [new Map()];
  const terminals = [[]];
  let maxDepth = 0;

  const compiledCandidates = (Array.isArray(candidates) ? candidates : []).map(
    (candidate, ordinal) => ({
      tokenCount: candidate.tokens.length,
      priorityLength: candidate.priorityLength ?? 0,
      key: candidate.tokens.join(" "),
      keyCodePoints: null,
      ordinal,
      payload: candidate.payload ?? candidate,
    }),
  );

  for (let index = 0; index < compiledCandidates.length; index += 1) {
    const compiled = compiledCandidates[index];
    if (compiled.tokenCount === 0) {
      continue;
    }

    let node = 0;
    for (const token of candidates[index].tokens) {
      let tokenId = tokenIds.get(token);
      if (tokenId === undefined) {
        tokenId = tokenIds.size;
        tokenIds.set(token, tokenId);
      }
      let next = transitions[node].get(tokenId);
      if (next === undefined) {
        next = transitions.length;
        transitions[node].set(tokenId, next);
        transitions.push(new Map());
        terminals.push([]);
      }
      node = next;
    }
    terminals[node].push(index);
    maxDepth = Math.max(maxDepth, compiled.tokenCount);
  }

  return { tokenIds, transitions, terminals, candidates: compiledCandidates, maxDepth };
}

// Emits every terminal passed from every start position — nested and crossing
// occurrences included, not only the deepest terminal per start.
export function discoverGlossaryTokenOccurrences(compiled, normalizedWords) {
  const occurrences = [];
  const { tokenIds, transitions, terminals } = compiled;

  for (let start = 0; start < normalizedWords.length; start += 1) {
    let node = 0;
    for (let offset = 0; start + offset < normalizedWords.length; offset += 1) {
      const tokenId = tokenIds.get(normalizedWords[start + offset]);
      if (tokenId === undefined) {
        break;
      }
      const next = transitions[node].get(tokenId);
      if (next === undefined) {
        break;
      }
      node = next;
      for (const candidateIndex of terminals[node]) {
        occurrences.push({
          candidateIndex,
          startWord: start,
          endWord: start + offset + 1,
        });
      }
    }
  }

  return occurrences;
}

// Compares by Unicode scalar values, not UTF-16 code units. Two occurrences
// over the same word span always share a normalized key, so keys and ordinals
// are defensive tie-breaks that keep the comparator total without depending
// on Map iteration or sort stability.
function compareKeyCodePoints(left, right) {
  if (left.keyCodePoints === null) {
    left.keyCodePoints = Array.from(left.key, (unit) => unit.codePointAt(0));
  }
  if (right.keyCodePoints === null) {
    right.keyCodePoints = Array.from(right.key, (unit) => unit.codePointAt(0));
  }
  const shared = Math.min(left.keyCodePoints.length, right.keyCodePoints.length);
  for (let index = 0; index < shared; index += 1) {
    if (left.keyCodePoints[index] !== right.keyCodePoints[index]) {
      return left.keyCodePoints[index] - right.keyCodePoints[index];
    }
  }
  return left.keyCodePoints.length - right.keyCodePoints.length;
}

function compareOccurrencePriority(compiled, left, right) {
  const leftCandidate = compiled.candidates[left.candidateIndex];
  const rightCandidate = compiled.candidates[right.candidateIndex];
  if (leftCandidate.tokenCount !== rightCandidate.tokenCount) {
    return rightCandidate.tokenCount - leftCandidate.tokenCount;
  }
  if (leftCandidate.priorityLength !== rightCandidate.priorityLength) {
    return rightCandidate.priorityLength - leftCandidate.priorityLength;
  }
  if (left.startWord !== right.startWord) {
    return left.startWord - right.startWord;
  }
  if (left.endWord !== right.endWord) {
    return left.endWord - right.endWord;
  }
  if (leftCandidate.key !== rightCandidate.key) {
    return compareKeyCodePoints(leftCandidate, rightCandidate);
  }
  return leftCandidate.ordinal - rightCandidate.ordinal;
}

function spanOccupied(occupied, startWord, endWord) {
  for (let word = startWord; word < endWord; word += 1) {
    if ((occupied[word >> 5] & (1 << (word & 31))) !== 0) {
      return true;
    }
  }
  return false;
}

function occupySpan(occupied, startWord, endWord) {
  for (let word = startWord; word < endWord; word += 1) {
    occupied[word >> 5] |= 1 << (word & 31);
  }
}

// Greedy occupancy selection over the full occurrence set; returns accepted
// occurrences in source order (start ascending, then end).
export function selectGloballyLongestOccurrences(compiled, occurrences, wordCount) {
  const order = occurrences.map((_, index) => index);
  order.sort((left, right) =>
    compareOccurrencePriority(compiled, occurrences[left], occurrences[right]),
  );

  const occupied = new Uint32Array((wordCount >> 5) + 1);
  const accepted = [];
  for (const index of order) {
    const occurrence = occurrences[index];
    if (spanOccupied(occupied, occurrence.startWord, occurrence.endWord)) {
      continue;
    }
    occupySpan(occupied, occurrence.startWord, occurrence.endWord);
    accepted.push(occurrence);
  }

  accepted.sort(
    (left, right) => left.startWord - right.startWord || left.endWord - right.endWord,
  );
  return accepted;
}
