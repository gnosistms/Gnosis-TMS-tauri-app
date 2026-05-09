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

pub(super) fn sanitize_target_term_pairs(
    values: &[String],
    notes: &[String],
) -> (Vec<String>, Vec<String>) {
    let mut seen = BTreeSet::new();
    let mut sanitized_terms = Vec::new();
    let mut sanitized_notes = Vec::new();

    for (index, value) in values.iter().enumerate() {
        let trimmed = value.trim().to_string();
        let note = notes
            .get(index)
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        let key = trimmed.clone();
        if seen.insert(key.clone()) {
            sanitized_terms.push(trimmed);
            sanitized_notes.push(note);
            continue;
        }

        if note.is_empty() {
            continue;
        }
        if let Some(existing_index) = sanitized_terms.iter().position(|term| term == &key) {
            merge_note_text(&mut sanitized_notes[existing_index], &note);
        }
    }

    (sanitized_terms, sanitized_notes)
}

fn merge_note_text(existing: &mut String, incoming: &str) {
    let incoming = incoming.trim();
    if incoming.is_empty() {
        return;
    }

    if existing.split("\n\n").any(|value| value.trim() == incoming) {
        return;
    }

    if !existing.trim().is_empty() {
        existing.push_str("\n\n");
    }
    existing.push_str(incoming);
}
