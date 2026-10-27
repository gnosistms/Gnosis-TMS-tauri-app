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
        if !seen.insert(source_term_key(value)) {
            return true;
        }
    }
    false
}

pub(super) fn source_term_key(value: &str) -> String {
    value.trim().to_lowercase()
}

pub(super) fn conflicting_source_terms(
    existing_terms: &[StoredGlossaryTermFile],
    source_terms: &[String],
    current_term_id: Option<&str>,
) -> Vec<String> {
    let mut existing_source_terms = BTreeSet::new();
    for term in existing_terms {
        if term.lifecycle.state != "active" || current_term_id == Some(term.term_id.as_str()) {
            continue;
        }

        for source_term in &term.source_terms {
            let normalized = source_term_key(source_term);
            if !normalized.is_empty() {
                existing_source_terms.insert(normalized);
            }
        }
    }

    source_terms
        .iter()
        .filter(|source_term| existing_source_terms.contains(&source_term_key(source_term)))
        .cloned()
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflicts_ignore_capitalization_and_preserve_candidate_spelling() {
        let existing = vec![
            serde_json::from_value::<StoredGlossaryTermFile>(serde_json::json!({
                "term_id": "existing",
                "source_terms": ["Tal como es arriba es abajo", "Íntimo"],
                "target_terms": [],
                "lifecycle": { "state": "active" }
            }))
            .unwrap(),
        ];
        let candidates = [
            "tal como es arriba, es abajo",
            "tal como es arriba es abajo",
            "ÍNTIMO",
            "intimo",
        ]
        .map(String::from);
        assert_eq!(
            conflicting_source_terms(&existing, &candidates, None),
            vec!["tal como es arriba es abajo", "ÍNTIMO"]
        );
        assert!(conflicting_source_terms(&existing, &candidates, Some("existing")).is_empty());
    }

    #[test]
    fn duplicate_variants_ignore_capitalization_but_keep_punctuation_and_accents() {
        assert!(has_duplicate_term_values(&[
            "Íntimo".into(),
            " ÍNTIMO ".into()
        ]));
        assert!(!has_duplicate_term_values(&[
            "íntimo".into(),
            "intimo".into()
        ]));
        assert!(!has_duplicate_term_values(&[
            "Dag Dugpa".into(),
            "Dag-Dugpa".into()
        ]));
    }

    #[test]
    fn conflicts_identify_exact_variants_and_ignore_current_and_deleted_terms() {
        let term = |id: &str, source: &str, state: &str| {
            serde_json::from_value::<StoredGlossaryTermFile>(serde_json::json!({
                "term_id": id,
                "source_terms": [source],
                "target_terms": [],
                "lifecycle": { "state": state }
            }))
            .expect("valid term fixture")
        };
        let existing = vec![
            term("current", "Dag Dugpa", "active"),
            term("other", " Dag-Dugpa ", "active"),
            term("quoted", "Dugpa \"quoted\"", "active"),
            term("deleted", "Dad-Dugpa", "deleted"),
        ];
        let candidates = [
            "Dag Dugpa",
            "Dag-Dugpa",
            "Dad-Dugpa",
            "Dugpa \"quoted\"",
            "New",
        ]
        .map(String::from);
        assert_eq!(
            conflicting_source_terms(&existing, &candidates, Some("current")),
            vec!["Dag-Dugpa", "Dugpa \"quoted\""]
        );
    }
}
