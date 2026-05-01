use std::collections::HashSet;

use super::{CandidateDocument, SearchProjectsResponse, MIN_SEARCH_QUERY_LENGTH};

#[derive(Clone, Copy)]
pub(super) struct SearchScore {
    pub(super) exact_phrase: bool,
    pub(super) token_coverage: f64,
    pub(super) ngram_dice: f64,
    ordered_tokens: bool,
    prefix_bonus: bool,
    length_penalty: f64,
}

pub(super) fn normalize_search_text(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut previous_was_space = true;

    for character in value.chars() {
        if character.is_whitespace() {
            if !previous_was_space {
                normalized.push(' ');
                previous_was_space = true;
            }
            continue;
        }

        if character.is_alphanumeric() {
            for lower in character.to_lowercase() {
                normalized.push(lower);
            }
            previous_was_space = false;
            continue;
        }

        if !previous_was_space {
            normalized.push(' ');
            previous_was_space = true;
        }
    }

    normalized.trim().to_string()
}

pub(super) fn collect_unique_tokens(value: &str) -> Vec<String> {
    let normalized = normalize_search_text(value);
    let mut seen = HashSet::new();
    let mut tokens = Vec::new();
    for token in normalized.split_whitespace() {
        if !token.is_empty() && seen.insert(token.to_string()) {
            tokens.push(token.to_string());
        }
    }
    tokens
}

pub(super) fn collect_unique_bigrams(value: &str) -> Vec<String> {
    collect_unique_ngrams(value, 2)
}

pub(super) fn collect_unique_trigrams(value: &str) -> Vec<String> {
    collect_unique_ngrams(value, 3)
}

fn collect_unique_ngrams(value: &str, size: usize) -> Vec<String> {
    let normalized = normalize_search_text(value);
    let characters = normalized.chars().collect::<Vec<_>>();
    if size < 2 || characters.len() < size {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    let mut ngrams = Vec::new();
    for index in 0..=characters.len() - size {
        let ngram = characters[index..index + size].iter().collect::<String>();
        if seen.insert(ngram.clone()) {
            ngrams.push(ngram);
        }
    }
    ngrams
}

pub(super) fn compute_search_score(
    candidate: &CandidateDocument,
    normalized_query: &str,
    query_token_count: usize,
    query_ngram_count: usize,
) -> SearchScore {
    let exact_phrase = candidate.document.search_text.contains(normalized_query);
    let token_coverage = if query_token_count == 0 {
        0.0
    } else {
        candidate.token_hits as f64 / query_token_count as f64
    };
    let ngram_dice = if query_ngram_count == 0 || candidate.document_ngram_count == 0 {
        0.0
    } else {
        (2.0 * candidate.ngram_hits as f64)
            / (query_ngram_count + candidate.document_ngram_count) as f64
    };
    let ordered_tokens = query_token_count > 0
        && tokens_appear_in_order(
            &candidate.document.search_text,
            &collect_unique_tokens(normalized_query),
        );
    let prefix_bonus = query_token_count > 0
        && query_has_prefix_match(
            &candidate.document.search_text,
            &collect_unique_tokens(normalized_query),
        );
    let length_penalty = {
        let document_length = candidate.document.search_text.chars().count() as f64;
        let query_length = normalized_query.chars().count().max(1) as f64;
        (document_length - query_length).abs() / query_length
    };

    SearchScore {
        exact_phrase,
        token_coverage,
        ngram_dice,
        ordered_tokens,
        prefix_bonus,
        length_penalty,
    }
}

pub(super) fn score_to_number(score: SearchScore) -> f64 {
    (if score.exact_phrase { 1000.0 } else { 0.0 })
        + (250.0 * score.token_coverage)
        + (180.0 * score.ngram_dice)
        + (if score.ordered_tokens { 60.0 } else { 0.0 })
        + (if score.prefix_bonus { 25.0 } else { 0.0 })
        - (15.0 * score.length_penalty)
}

fn tokens_appear_in_order(document: &str, query_tokens: &[String]) -> bool {
    let mut from_index = 0usize;
    for token in query_tokens {
        let Some(position) = document[from_index..].find(token) else {
            return false;
        };
        from_index += position + token.len();
    }
    true
}

fn query_has_prefix_match(document: &str, query_tokens: &[String]) -> bool {
    let document_tokens = document.split_whitespace().collect::<Vec<_>>();
    query_tokens.iter().any(|query_token| {
        document_tokens
            .iter()
            .any(|document_token| document_token.starts_with(query_token))
    })
}

pub(super) fn resolve_match_count(candidate: &CandidateDocument, normalized_query: &str) -> usize {
    let exact_matches = count_exact_substrings(&candidate.document.search_text, normalized_query);
    if exact_matches > 0 {
        return exact_matches;
    }
    candidate.token_hits.max(candidate.ngram_hits).max(1)
}

pub(super) fn empty_search_response(
    query_too_short: bool,
    total_capped: bool,
) -> SearchProjectsResponse {
    SearchProjectsResponse {
        results: Vec::new(),
        total: 0,
        has_more: false,
        index_status: "ready".to_string(),
        total_capped,
        query_too_short,
        minimum_query_length: MIN_SEARCH_QUERY_LENGTH,
    }
}

fn count_exact_substrings(document: &str, needle: &str) -> usize {
    if needle.is_empty() || document.is_empty() {
        return 0;
    }

    let mut count = 0usize;
    let mut from_index = 0usize;
    while let Some(position) = document[from_index..].find(needle) {
        count += 1;
        from_index += position + needle.len();
    }
    count
}

pub(super) fn build_plain_text_snippet(plain_text: &str) -> String {
    let trimmed = plain_text.trim();
    if trimmed.chars().count() <= 140 {
        return trimmed.to_string();
    }

    let snippet = trimmed
        .chars()
        .take(140)
        .collect::<String>()
        .trim()
        .to_string();
    format!("{snippet}...")
}
