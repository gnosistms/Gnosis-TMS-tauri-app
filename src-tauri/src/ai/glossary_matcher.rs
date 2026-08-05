//! Generic compiled token-trie matcher with globally longest greedy selection.
//!
//! Tokenizer- and metadata-agnostic: callers supply candidates as
//! already-normalized token sequences (one per merged normalized sequence, in
//! first-seen order) and text as a normalized token slice. Domain concerns —
//! tokenization, metadata merging, prompt construction — stay in `ai/mod.rs`.
//!
//! Selection semantics (see docs/glossary-matching.md and
//! tests/fixtures/glossary-matching/golden.json): discover every trie terminal
//! occurrence including nested and crossing overlaps, then greedily accept in
//! priority order — token count descending, candidate scalar length
//! descending, start ascending, end ascending, normalized key ascending,
//! first-seen ordinal ascending — skipping occurrences that touch an occupied
//! token. This is the historical longest-first rule applied globally, NOT
//! maximum-coverage interval scheduling.

use std::collections::HashMap;

/// Bumped whenever compiled-matcher or selection semantics change; asserted
/// against the shared golden fixture so JS and Rust stay in lockstep. Only
/// tests read it today; production consumers arrive with cache versioning.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const GLOSSARY_MATCHER_POLICY_VERSION: u64 = 1;

/// The single active selection policy. The legacy left-to-right scan was
/// removed after the v0.8.86 bake, so rollback is now a git revert rather
/// than a constant flip. The shared fixture's `defaultPolicy` field must
/// equal this constant in both runtimes.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) const GLOSSARY_MATCHER_POLICY_NAME: &str = "globalTrie";

/// One merged normalized token sequence. `priority_length` is the greatest
/// Unicode scalar count among the merged variants' base texts (NOT UTF-8
/// bytes — those disagree with the frontend for non-ASCII text).
pub(crate) struct GlossaryMatcherCandidate {
    pub tokens: Vec<String>,
    pub priority_length: usize,
}

struct CompiledCandidate {
    token_count: usize,
    priority_length: usize,
    key: String,
    ordinal: usize,
}

pub(crate) struct CompiledGlossaryMatcher {
    token_ids: HashMap<String, usize>,
    transitions: Vec<HashMap<usize, usize>>,
    terminals: Vec<Vec<usize>>,
    candidates: Vec<CompiledCandidate>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GlossaryOccurrence {
    pub candidate: usize,
    pub start_word: usize,
    pub end_word: usize,
}

pub(crate) fn compile_glossary_token_matcher(
    candidates: &[GlossaryMatcherCandidate],
) -> CompiledGlossaryMatcher {
    let mut token_ids = HashMap::<String, usize>::new();
    let mut transitions: Vec<HashMap<usize, usize>> = vec![HashMap::new()];
    let mut terminals: Vec<Vec<usize>> = vec![Vec::new()];
    let mut compiled_candidates = Vec::with_capacity(candidates.len());

    for (ordinal, candidate) in candidates.iter().enumerate() {
        compiled_candidates.push(CompiledCandidate {
            token_count: candidate.tokens.len(),
            priority_length: candidate.priority_length,
            key: candidate.tokens.join(" "),
            ordinal,
        });
        if candidate.tokens.is_empty() {
            continue;
        }

        let mut node = 0usize;
        for token in &candidate.tokens {
            let next_token_id = token_ids.len();
            let token_id = *token_ids.entry(token.clone()).or_insert(next_token_id);
            let next_node = transitions.len();
            let target = *transitions[node].entry(token_id).or_insert(next_node);
            if target == next_node {
                transitions.push(HashMap::new());
                terminals.push(Vec::new());
            }
            node = target;
        }
        terminals[node].push(ordinal);
    }

    CompiledGlossaryMatcher {
        token_ids,
        transitions,
        terminals,
        candidates: compiled_candidates,
    }
}

/// Emits every terminal passed from every start position — nested and
/// crossing occurrences included, not only the deepest terminal per start.
pub(crate) fn discover_glossary_token_occurrences(
    compiled: &CompiledGlossaryMatcher,
    normalized_words: &[&str],
) -> Vec<GlossaryOccurrence> {
    let mut occurrences = Vec::new();

    for start in 0..normalized_words.len() {
        let mut node = 0usize;
        for (offset, word) in normalized_words[start..].iter().enumerate() {
            let Some(token_id) = compiled.token_ids.get(*word) else {
                break;
            };
            let Some(&next) = compiled.transitions[node].get(token_id) else {
                break;
            };
            node = next;
            for &candidate in &compiled.terminals[node] {
                occurrences.push(GlossaryOccurrence {
                    candidate,
                    start_word: start,
                    end_word: start + offset + 1,
                });
            }
        }
    }

    occurrences
}

// Rust `str` ordering compares UTF-8 bytes, which equals Unicode scalar order,
// so the key tie-break matches the frontend's code-point comparison. Two
// occurrences over the same word span always share a normalized key, so keys
// and ordinals are defensive tie-breaks that keep the comparator total
// without depending on HashMap iteration or sort stability.
fn compare_occurrence_priority(
    compiled: &CompiledGlossaryMatcher,
    left: &GlossaryOccurrence,
    right: &GlossaryOccurrence,
) -> std::cmp::Ordering {
    let left_candidate = &compiled.candidates[left.candidate];
    let right_candidate = &compiled.candidates[right.candidate];
    right_candidate
        .token_count
        .cmp(&left_candidate.token_count)
        .then_with(|| {
            right_candidate
                .priority_length
                .cmp(&left_candidate.priority_length)
        })
        .then_with(|| left.start_word.cmp(&right.start_word))
        .then_with(|| left.end_word.cmp(&right.end_word))
        .then_with(|| left_candidate.key.cmp(&right_candidate.key))
        .then_with(|| left_candidate.ordinal.cmp(&right_candidate.ordinal))
}

fn span_occupied(occupied: &[u64], start_word: usize, end_word: usize) -> bool {
    (start_word..end_word).any(|word| occupied[word >> 6] & (1u64 << (word & 63)) != 0)
}

fn occupy_span(occupied: &mut [u64], start_word: usize, end_word: usize) {
    for word in start_word..end_word {
        occupied[word >> 6] |= 1u64 << (word & 63);
    }
}

/// Greedy occupancy selection over the full occurrence set; returns accepted
/// occurrences in source order (start ascending, then end).
pub(crate) fn select_globally_longest_occurrences(
    compiled: &CompiledGlossaryMatcher,
    occurrences: &[GlossaryOccurrence],
    word_count: usize,
) -> Vec<GlossaryOccurrence> {
    let mut order: Vec<usize> = (0..occurrences.len()).collect();
    order.sort_by(|&left, &right| {
        compare_occurrence_priority(compiled, &occurrences[left], &occurrences[right])
    });

    let mut occupied = vec![0u64; (word_count >> 6) + 1];
    let mut accepted = Vec::new();
    for index in order {
        let occurrence = occurrences[index];
        if span_occupied(&occupied, occurrence.start_word, occurrence.end_word) {
            continue;
        }
        occupy_span(&mut occupied, occurrence.start_word, occurrence.end_word);
        accepted.push(occurrence);
    }

    accepted.sort_by(|left, right| {
        left.start_word
            .cmp(&right.start_word)
            .then_with(|| left.end_word.cmp(&right.end_word))
    });
    accepted
}

#[cfg(test)]
mod tests {
    use super::super::{
        find_matched_glossary_terms_in_texts, tokenize_glossary_term, tokenize_text_words,
    };
    use super::*;
    use crate::ai::types::AiTranslatedGlossaryTermInput;

    const GOLDEN_JSON: &str = include_str!("../../../tests/fixtures/glossary-matching/golden.json");

    #[derive(serde::Deserialize)]
    struct GoldenFixture {
        #[serde(rename = "policyVersion")]
        policy_version: u64,
        #[serde(rename = "defaultPolicy")]
        default_policy: String,
        cases: Vec<GoldenCase>,
    }

    #[derive(serde::Deserialize)]
    struct GoldenCase {
        id: String,
        profile: String,
        runtimes: String,
        candidates: Vec<GoldenCandidate>,
        text: String,
        discovered: Vec<GoldenOccurrence>,
        accepted: Vec<GoldenOccurrence>,
    }

    #[derive(serde::Deserialize)]
    struct GoldenCandidate {
        id: String,
        term: String,
    }

    #[derive(serde::Deserialize, Debug, PartialEq, Eq, PartialOrd, Ord)]
    struct GoldenOccurrence {
        start: usize,
        end: usize,
        id: String,
    }

    fn golden() -> GoldenFixture {
        serde_json::from_str(GOLDEN_JSON).expect("golden fixture parses")
    }

    // Merges fixture candidates the way the domain layer does: duplicates by
    // normalized token sequence keep the first-seen id and the greatest
    // scalar length.
    fn merged_candidates(case: &GoldenCase) -> (Vec<GlossaryMatcherCandidate>, Vec<String>) {
        let mut candidates = Vec::new();
        let mut ids = Vec::new();
        let mut index_by_key = std::collections::HashMap::<String, usize>::new();
        for candidate in &case.candidates {
            let tokens = tokenize_glossary_term(&candidate.term);
            if tokens.is_empty() {
                continue;
            }
            let key = tokens.join(" ");
            let scalar_length = candidate.term.chars().count();
            if let Some(&index) = index_by_key.get(&key) {
                let existing: &mut GlossaryMatcherCandidate = &mut candidates[index];
                existing.priority_length = existing.priority_length.max(scalar_length);
                continue;
            }
            index_by_key.insert(key, candidates.len());
            candidates.push(GlossaryMatcherCandidate {
                tokens,
                priority_length: scalar_length,
            });
            ids.push(candidate.id.clone());
        }
        (candidates, ids)
    }

    fn sorted(mut records: Vec<GoldenOccurrence>) -> Vec<GoldenOccurrence> {
        records.sort();
        records
    }

    #[test]
    fn golden_fixture_policy_metadata_matches_this_runtime() {
        let fixture = golden();
        assert_eq!(fixture.policy_version, GLOSSARY_MATCHER_POLICY_VERSION);
        // The fixture's defaultPolicy and this constant move together; the
        // guard keeps backend and frontend on the same algorithm.
        assert_eq!(fixture.default_policy, GLOSSARY_MATCHER_POLICY_NAME);
    }

    #[test]
    fn golden_discovery_and_selection_cases() {
        for case in golden().cases {
            if case.runtimes == "js" || case.profile != "word" {
                continue;
            }

            let (candidates, ids) = merged_candidates(&case);
            let compiled = compile_glossary_token_matcher(&candidates);
            let words = tokenize_text_words(&case.text);
            let normalized: Vec<&str> = words.iter().map(|word| word.normalized.as_str()).collect();

            let occurrences = discover_glossary_token_occurrences(&compiled, &normalized);
            let discovered: Vec<GoldenOccurrence> = occurrences
                .iter()
                .map(|occurrence| GoldenOccurrence {
                    start: occurrence.start_word,
                    end: occurrence.end_word,
                    id: ids[occurrence.candidate].clone(),
                })
                .collect();
            assert_eq!(
                sorted(discovered),
                sorted(case.discovered),
                "discovered mismatch in case {}",
                case.id
            );

            let accepted: Vec<GoldenOccurrence> =
                select_globally_longest_occurrences(&compiled, &occurrences, normalized.len())
                    .iter()
                    .map(|occurrence| GoldenOccurrence {
                        start: occurrence.start_word,
                        end: occurrence.end_word,
                        id: ids[occurrence.candidate].clone(),
                    })
                    .collect();
            assert_eq!(
                accepted, case.accepted,
                "accepted mismatch in case {}",
                case.id
            );
        }
    }

    fn glossary_term_inputs(case: &GoldenCase) -> Vec<AiTranslatedGlossaryTermInput> {
        case.candidates
            .iter()
            .map(|candidate| AiTranslatedGlossaryTermInput {
                glossary_source_terms: vec![candidate.term.clone()],
                target_variants: vec![],
                no_translation: None,
                notes: vec![],
                global_notes: vec![],
                footnotes: vec![],
            })
            .collect()
    }

    fn expected_surfaces(case: &GoldenCase, expected: &[GoldenOccurrence]) -> Vec<String> {
        let words = tokenize_text_words(&case.text);
        let mut surfaces = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for occurrence in expected {
            let start = words[occurrence.start].start;
            let end = words[occurrence.end - 1].end;
            let surface = case.text[start..end].trim().to_string();
            if seen.insert(super::super::normalize_glossary_token(&surface)) {
                surfaces.push(surface);
            }
        }
        surfaces
    }

    #[test]
    fn golden_cases_flow_through_prepared_match_pipeline() {
        for case in golden().cases {
            if case.runtimes == "js" || case.profile != "word" {
                continue;
            }
            let terms = glossary_term_inputs(&case);

            // legacyAccepted fixture entries document the removed
            // left-to-right scan and are no longer executed.
            let global_matches =
                find_matched_glossary_terms_in_texts(&[case.text.as_str()], &terms);
            assert_eq!(
                global_matches
                    .iter()
                    .map(|matched| matched.glossary_source_term.clone())
                    .collect::<Vec<_>>(),
                expected_surfaces(&case, &case.accepted),
                "globalTrie pipeline mismatch in case {}",
                case.id
            );
        }
    }

    #[test]
    fn occupancy_bitset_is_correct_across_64_bit_word_boundaries() {
        let words: Vec<String> = (0..140).map(|index| format!("w{index}")).collect();
        let candidates = vec![
            GlossaryMatcherCandidate {
                tokens: words[62..66].to_vec(),
                priority_length: 40,
            },
            GlossaryMatcherCandidate {
                tokens: words[63..64].to_vec(),
                priority_length: 20,
            },
            GlossaryMatcherCandidate {
                tokens: words[126..130].to_vec(),
                priority_length: 40,
            },
            GlossaryMatcherCandidate {
                tokens: words[127..128].to_vec(),
                priority_length: 20,
            },
        ];
        let compiled = compile_glossary_token_matcher(&candidates);
        let word_refs: Vec<&str> = words.iter().map(String::as_str).collect();
        let occurrences = discover_glossary_token_occurrences(&compiled, &word_refs);
        assert_eq!(occurrences.len(), 4);

        let accepted =
            select_globally_longest_occurrences(&compiled, &occurrences, word_refs.len());
        // The 4-token spans crossing bits 63/64 and 127/128 win; the nested
        // spans must be rejected by occupancy checks straddling the u64
        // boundary.
        assert_eq!(
            accepted
                .iter()
                .map(|occurrence| (occurrence.start_word, occurrence.end_word))
                .collect::<Vec<_>>(),
            vec![(62, 66), (126, 130)]
        );
    }

    // Mirror of the JS test's mulberry32 so both runtimes run the same seed
    // corpus (seeds 1..=200 with an identical draw sequence).
    struct Mulberry32 {
        state: u32,
    }

    impl Mulberry32 {
        fn next(&mut self) -> f64 {
            self.state = self.state.wrapping_add(0x6d2b79f5);
            let mut mixed = self.state;
            mixed = (mixed ^ (mixed >> 15)).wrapping_mul(mixed | 1);
            mixed ^= mixed.wrapping_add((mixed ^ (mixed >> 7)).wrapping_mul(mixed | 61));
            f64::from(mixed ^ (mixed >> 14)) / 4294967296.0
        }

        fn below(&mut self, bound: usize) -> usize {
            (self.next() * bound as f64).floor() as usize
        }
    }

    fn reference_globally_longest(
        candidates: &[GlossaryMatcherCandidate],
        words: &[&str],
    ) -> Vec<(String, usize, usize)> {
        struct Merged {
            tokens: Vec<String>,
            priority_length: usize,
            key: String,
            ordinal: usize,
        }
        let mut merged: Vec<Merged> = Vec::new();
        let mut by_key = std::collections::HashMap::<String, usize>::new();
        for candidate in candidates {
            if candidate.tokens.is_empty() {
                continue;
            }
            let key = candidate.tokens.join(" ");
            if let Some(&index) = by_key.get(&key) {
                merged[index].priority_length =
                    merged[index].priority_length.max(candidate.priority_length);
                continue;
            }
            by_key.insert(key.clone(), merged.len());
            let ordinal = merged.len();
            merged.push(Merged {
                tokens: candidate.tokens.clone(),
                priority_length: candidate.priority_length,
                key,
                ordinal,
            });
        }

        let mut occurrences = Vec::new();
        for candidate in &merged {
            if candidate.tokens.len() > words.len() {
                continue;
            }
            for start in 0..=(words.len() - candidate.tokens.len()) {
                let matches_here = candidate
                    .tokens
                    .iter()
                    .enumerate()
                    .all(|(offset, token)| words[start + offset] == token);
                if matches_here {
                    occurrences.push((candidate, start, start + candidate.tokens.len()));
                }
            }
        }

        occurrences.sort_by(|left, right| {
            right
                .0
                .tokens
                .len()
                .cmp(&left.0.tokens.len())
                .then_with(|| right.0.priority_length.cmp(&left.0.priority_length))
                .then_with(|| left.1.cmp(&right.1))
                .then_with(|| left.2.cmp(&right.2))
                .then_with(|| left.0.key.cmp(&right.0.key))
                .then_with(|| left.0.ordinal.cmp(&right.0.ordinal))
        });

        let mut occupied = vec![false; words.len()];
        let mut accepted = Vec::new();
        for (candidate, start, end) in occurrences {
            if (start..end).any(|word| occupied[word]) {
                continue;
            }
            occupied[start..end].fill(true);
            accepted.push((candidate.key.clone(), start, end));
        }
        accepted.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.2.cmp(&right.2)));
        accepted
    }

    #[test]
    fn property_compiled_trie_agrees_with_exhaustive_reference() {
        let alphabet = ["a", "b", "c"];
        for seed in 1u32..=200 {
            let mut random = Mulberry32 { state: seed };
            let candidate_count = 1 + random.below(6);
            let raw_candidates: Vec<GlossaryMatcherCandidate> = (0..candidate_count)
                .map(|_| {
                    let token_count = 1 + random.below(3);
                    let tokens = (0..token_count)
                        .map(|_| alphabet[random.below(3)].to_string())
                        .collect();
                    GlossaryMatcherCandidate {
                        tokens,
                        priority_length: 1 + random.below(10),
                    }
                })
                .collect();
            let word_count = random.below(13);
            let words: Vec<&str> = (0..word_count).map(|_| alphabet[random.below(3)]).collect();

            let expected = reference_globally_longest(&raw_candidates, &words);

            let mut merged: Vec<GlossaryMatcherCandidate> = Vec::new();
            let mut by_key = std::collections::HashMap::<String, usize>::new();
            for candidate in &raw_candidates {
                let key = candidate.tokens.join(" ");
                if let Some(&index) = by_key.get(&key) {
                    merged[index].priority_length =
                        merged[index].priority_length.max(candidate.priority_length);
                    continue;
                }
                by_key.insert(key, merged.len());
                merged.push(GlossaryMatcherCandidate {
                    tokens: candidate.tokens.clone(),
                    priority_length: candidate.priority_length,
                });
            }
            let compiled = compile_glossary_token_matcher(&merged);
            let occurrences = discover_glossary_token_occurrences(&compiled, &words);
            let actual: Vec<(String, usize, usize)> =
                select_globally_longest_occurrences(&compiled, &occurrences, words.len())
                    .iter()
                    .map(|occurrence| {
                        (
                            compiled.candidates[occurrence.candidate].key.clone(),
                            occurrence.start_word,
                            occurrence.end_word,
                        )
                    })
                    .collect();

            assert_eq!(actual, expected, "seed {seed}");
        }
    }

    #[test]
    fn reordering_distinct_candidates_does_not_change_accepted_spans() {
        let forward = vec![
            GlossaryMatcherCandidate {
                tokens: vec!["a".into(), "b".into(), "c".into()],
                priority_length: 5,
            },
            GlossaryMatcherCandidate {
                tokens: vec!["b".into(), "c".into()],
                priority_length: 4,
            },
            GlossaryMatcherCandidate {
                tokens: vec!["a".into()],
                priority_length: 1,
            },
        ];
        let mut reversed: Vec<GlossaryMatcherCandidate> = forward
            .iter()
            .map(|candidate| GlossaryMatcherCandidate {
                tokens: candidate.tokens.clone(),
                priority_length: candidate.priority_length,
            })
            .collect();
        reversed.reverse();
        let words = ["a", "b", "c", "b", "c", "a"];

        let spans_for = |candidates: &[GlossaryMatcherCandidate]| {
            let compiled = compile_glossary_token_matcher(candidates);
            let occurrences = discover_glossary_token_occurrences(&compiled, &words);
            select_globally_longest_occurrences(&compiled, &occurrences, words.len())
                .iter()
                .map(|occurrence| {
                    (
                        compiled.candidates[occurrence.candidate].key.clone(),
                        occurrence.start_word,
                        occurrence.end_word,
                    )
                })
                .collect::<Vec<_>>()
        };

        assert_eq!(spans_for(&forward), spans_for(&reversed));
    }

    // Offline benchmark, excluded from normal runs. Execute with:
    //   cargo test --release --lib ai::glossary_matcher -- --ignored --nocapture
    // Numbers are recorded in plans/glossary-global-longest-matching-plan.md.
    #[test]
    #[ignore]
    fn bench_glossary_matcher_policies() {
        use std::time::Instant;

        let mut random = Mulberry32 { state: 2026 };
        let heads: Vec<String> = (0..120).map(|i| format!("head{i}")).collect();
        let tails: Vec<String> = (0..400).map(|i| format!("tail{i}")).collect();
        let fillers: Vec<String> = (0..800).map(|i| format!("word{i}")).collect();

        for term_count in [737usize, 16000] {
            let mut terms = Vec::new();
            for index in 0..term_count {
                let roll = random.next();
                let source_term = if roll < 0.35 {
                    tails[random.below(tails.len())].clone()
                } else if roll < 0.85 {
                    format!(
                        "{} {}",
                        heads[random.below(heads.len())],
                        tails[random.below(tails.len())]
                    )
                } else if roll < 0.97 {
                    format!(
                        "{} {} {}",
                        heads[random.below(heads.len())],
                        tails[random.below(tails.len())],
                        tails[random.below(tails.len())]
                    )
                } else {
                    format!("{} {}", heads[0], tails[0])
                };
                terms.push(AiTranslatedGlossaryTermInput {
                    glossary_source_terms: vec![source_term],
                    target_variants: vec![],
                    no_translation: None,
                    notes: vec![format!("note {index}")],
                    global_notes: vec![],
                    footnotes: vec![],
                });
            }

            let compile_start = Instant::now();
            let mut compile_iterations = 0u32;
            while compile_iterations < 10 {
                let candidates = super::super::build_glossary_match_candidates(&terms);
                assert!(!candidates.is_empty());
                compile_iterations += 1;
            }
            println!(
                "compile ({term_count} terms): {:.3} ms/iteration",
                compile_start.elapsed().as_secs_f64() * 1000.0 / f64::from(compile_iterations)
            );

            let mut text_words = Vec::new();
            for index in 0..2000usize {
                if index % 10 == 0 {
                    text_words.push(format!(
                        "{} {}",
                        heads[random.below(heads.len())],
                        tails[random.below(tails.len())]
                    ));
                } else {
                    text_words.push(fillers[random.below(fillers.len())].clone());
                }
            }
            let long_row = text_words.join(" ");
            let typical_row = text_words[..100].join(" ");

            for (label, text) in [
                ("typical 100-token row", &typical_row),
                ("long 2000-token row", &long_row),
            ] {
                let start = Instant::now();
                let mut iterations = 0u32;
                while iterations < 100 {
                    let matches = find_matched_glossary_terms_in_texts(&[text.as_str()], &terms);
                    assert!(!matches.is_empty());
                    iterations += 1;
                }
                println!(
                    "{label} ({term_count} terms): {:.3} ms/iteration (includes compile)",
                    start.elapsed().as_secs_f64() * 1000.0 / f64::from(iterations)
                );
            }
        }
    }
}
