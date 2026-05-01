use std::collections::BTreeSet;

use super::StoredGlossaryTermFile;

pub(super) fn sanitize_term_values(values: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut sanitized = Vec::new();
    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            sanitized.push(trimmed.to_string());
        }
    }
    sanitized
}

pub(super) fn trim_non_empty_term_values(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

pub(super) fn has_duplicate_term_values(values: &[String]) -> bool {
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value.clone()) {
            return true;
        }
    }
    false
}

pub(super) fn has_conflicting_source_terms(
    existing_terms: &[StoredGlossaryTermFile],
    source_terms: &[String],
    current_term_id: Option<&str>,
) -> bool {
    let mut existing_source_terms = BTreeSet::new();
    for term in existing_terms {
        if term.lifecycle.state != "active" || current_term_id == Some(term.term_id.as_str()) {
            continue;
        }

        for source_term in &term.source_terms {
            let normalized = source_term.trim();
            if !normalized.is_empty() {
                existing_source_terms.insert(normalized.to_string());
            }
        }
    }

    source_terms
        .iter()
        .any(|source_term| existing_source_terms.contains(source_term))
}

pub(super) fn sanitize_target_term_values(values: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut sanitized = Vec::new();
    let mut included_empty_variant = false;

    for value in values {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            if !included_empty_variant {
                sanitized.push(String::new());
                included_empty_variant = true;
            }
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            sanitized.push(trimmed.to_string());
        }
    }

    sanitized
}
