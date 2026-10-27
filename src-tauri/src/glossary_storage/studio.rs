//! Multi-entry research saves use one commit and the normal glossary sync/rollback.
use super::*;
use crate::git_commit::ensure_local_commit_preconditions;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResearchChange {
    term_id: String,
    expected: Value,
    source_terms: Vec<String>,
}

fn same_entry(current: &StoredGlossaryTermFile, expected: &Value) -> bool {
    let Ok(mapped) = serde_json::to_value(map_term_record(current.clone())) else {
        return false;
    };
    [
        "termId",
        "sourceTerms",
        "targetTerms",
        "targetVariantNotes",
        "notesToTranslators",
        "footnote",
        "untranslated",
    ]
    .iter()
    .all(|key| mapped[*key] == expected[*key])
}

fn restore_files(repo: &Path, backups: &[(String, Option<String>)]) -> Result<(), String> {
    for (relative, text) in backups {
        let path = repo.join(relative);
        match text {
            Some(text) => fs::write(&path, text).map_err(|e| e.to_string())?,
            None => {
                if path.exists() {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    let mut args = vec!["reset", "-q", "HEAD", "--"];
    args.extend(backups.iter().map(|(path, _)| path.as_str()));
    git_output(repo, &args)?;
    Ok(())
}

pub(super) fn recover(repo: &Path) -> Result<(), String> {
    let journal = repo.join(".git/glossary-studio-recovery.json");
    if !journal.exists() {
        return Ok(());
    }
    let recovery: Value = read_json_file(&journal, "research save recovery")?;
    let current = git_output(repo, &["rev-parse", "HEAD"])?;
    let message = git_output(repo, &["log", "-1", "--format=%s"])?;
    if message.trim() == recovery["message"].as_str().unwrap_or("") {
        fs::remove_file(journal).map_err(|e| e.to_string())?;
        return Ok(());
    }
    if current.trim() != recovery["head"].as_str().unwrap_or("").trim() {
        return Err("An interrupted research save needs recovery before another glossary change can be saved.".into());
    }
    let backups: Vec<(String, Option<String>)> =
        serde_json::from_value(recovery["backups"].clone()).map_err(|e| e.to_string())?;
    restore_files(repo, &backups)?;
    fs::remove_file(journal).map_err(|e| e.to_string())?;
    Ok(())
}

// Existing glossaries can contain legacy duplicates unrelated to this study.
// Validate the incoming sources against the retained old sources, as normal term
// saves do, rather than requiring cleanup of the entire glossary transaction.
fn ensure_no_new_source_conflicts(
    existing: &[StoredGlossaryTermFile],
    changes: &[ResearchChange],
    term_id: &str,
    source: &[String],
) -> Result<(), String> {
    let mut retained = std::collections::BTreeSet::new();
    for old in existing {
        if old.term_id == term_id {
            continue;
        }
        let sources = changes
            .iter()
            .find(|change| change.term_id == old.term_id)
            .map(|change| &change.source_terms)
            .unwrap_or(&old.source_terms);
        retained.extend(sources.iter().map(|source| terms::source_term_key(source)));
    }
    for form in source {
        if !retained.insert(terms::source_term_key(form)) {
            return Err(format!(
                "Remove or change these duplicate source variants before saving: {}",
                json!([form])
            ));
        }
    }
    Ok(())
}

fn with_remaining_sources(mut value: Value, source_terms: &[String]) -> Value {
    value["source_terms"] = json!(source_terms);
    value
}

pub(super) fn upsert(
    app: &AppHandle,
    input: UpsertGlossaryTermInput,
) -> Result<UpsertGlossaryTermResponse, String> {
    let repo = glossary_repo_path(
        app,
        input.installation_id,
        input.glossary_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let lock = repo_sync_lock(&repo);
    let _guard = acquire_repo_sync_lock(&lock);
    ensure_local_commit_preconditions(app, &repo)?;
    recover(&repo)?;
    let glossary = read_glossary_file(&repo)?;
    let existing = load_glossary_terms(&repo.join("terms"))?;
    let mut changes = input.research_changes.clone();
    let mut seen = std::collections::BTreeSet::new();
    for change in &mut changes {
        super::super::glossary_research_studio::validate_term_id(&change.term_id)?;
        if !seen.insert(change.term_id.clone()) {
            return Err("A research save repeats an old glossary entry.".into());
        }
        let old = existing
            .iter()
            .find(|e| e.term_id == change.term_id)
            .ok_or("An existing glossary entry was removed. Review collisions again.")?;
        if !same_entry(old, &change.expected) {
            return Err(
                "An existing glossary entry changed. Review collisions again before saving.".into(),
            );
        }
        change.source_terms = terms::sanitize_term_values(&change.source_terms);
    }
    let source = trim_non_empty_term_values(&input.source_terms);
    if source.is_empty() {
        return Err("Enter at least one source term.".into());
    }
    if has_duplicate_term_values(&source) {
        return Err(SOURCE_TERM_DUPLICATE_WARNING.into());
    }
    let term_id = input
        .term_id
        .clone()
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    super::super::glossary_research_studio::validate_term_id(&term_id)?;
    if changes.iter().any(|change| change.term_id == term_id) {
        return Err("A research entry cannot overwrite itself through an old-entry change.".into());
    }
    ensure_no_new_source_conflicts(&existing, &changes, &term_id, &source)?;
    let (targets, notes) =
        sanitize_target_term_pairs(&input.target_terms, &input.target_variant_notes);
    // Research edits preserve links managed by the glossary sibling workflow.
    let sibling_term_ids = existing
        .iter()
        .find(|entry| entry.term_id == term_id)
        .map(|entry| entry.sibling_term_ids.clone())
        .unwrap_or_default();
    let term = GlossaryTermEditorRecord {
        sibling_term_ids: sibling_term_ids.clone(),
        term_id: term_id.clone(),
        source_terms: source.clone(),
        target_terms: targets.clone(),
        target_variant_notes: notes.clone(),
        notes_to_translators: input.notes_to_translators.clone(),
        footnote: input.footnote.clone(),
        untranslated: input.untranslated,
        lifecycle_state: "active".into(),
    };
    let stored = StoredGlossaryTermFile {
        sibling_term_ids,
        term_id: term_id.clone(),
        source_terms: source,
        target_terms: targets,
        target_variant_notes: notes,
        notes_to_translators: input.notes_to_translators,
        footnote: input.footnote,
        untranslated: input.untranslated,
        lifecycle: StoredLifecycle {
            state: "active".into(),
        },
    };
    let mut writes: Vec<(String, Option<Value>)> = Vec::new();
    for change in changes {
        let path = format!("terms/{}.json", change.term_id);
        if change.source_terms.is_empty() {
            writes.push((path, None));
        } else {
            let value: Value = read_json_file(&repo.join(&path), "glossary term")?;
            writes.push((
                path,
                Some(with_remaining_sources(value, &change.source_terms)),
            ));
        }
    }
    writes.push((
        format!("terms/{term_id}.json"),
        Some(serde_json::to_value(stored).map_err(|e| e.to_string())?),
    ));
    let backups = writes
        .iter()
        .map(|(path, _)| {
            let full = repo.join(path);
            if full.exists() {
                fs::read_to_string(full)
                    .map(|text| (path.clone(), Some(text)))
                    .map_err(|e| e.to_string())
            } else {
                Ok((path.clone(), None))
            }
        })
        .collect::<Result<Vec<_>, String>>()?;
    let head = git_output(&repo, &["rev-parse", "HEAD"])?;
    let message = format!("Save glossary research {}", Uuid::now_v7());
    let journal = repo.join(".git/glossary-studio-recovery.json");
    write_json_pretty(
        &journal,
        &json!({"head":head.trim(),"message":message,"backups":backups}),
    )?;
    let result = (|| {
        for (path, value) in &writes {
            match value {
                Some(value) => write_json_pretty(&repo.join(path), value)?,
                None => fs::remove_file(repo.join(path)).map_err(|e| e.to_string())?,
            }
        }
        let paths: Vec<&str> = writes.iter().map(|(path, _)| path.as_str()).collect();
        let mut args = vec!["add", "--"];
        args.extend(paths.iter().copied());
        git_output(&repo, &args)?;
        git_commit_as_signed_in_user(app, &repo, &message, &paths)?;
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        restore_files(&repo, &backups)?;
        fs::remove_file(journal).map_err(|e| e.to_string())?;
        return Err(error);
    }
    fs::remove_file(journal).map_err(|e| e.to_string())?;
    Ok(UpsertGlossaryTermResponse {
        glossary_id: glossary.glossary_id,
        term_count: count_glossary_term_files(&repo.join("terms"))?,
        previous_head_sha: Some(head),
        term,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recovery_repo() -> std::path::PathBuf {
        let repo = std::env::temp_dir().join(format!("studio-recovery-{}", Uuid::now_v7()));
        fs::create_dir_all(repo.join("terms")).unwrap();
        let output = std::process::Command::new("git")
            .args(["init", "--initial-branch", "main"])
            .current_dir(&repo)
            .output()
            .unwrap();
        assert!(output.status.success());
        fs::write(repo.join("terms/old.json"), "original").unwrap();
        git_output(&repo, &["add", "."]).unwrap();
        git_output(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        repo
    }

    fn old_term(id: &str, forms: &[&str]) -> StoredGlossaryTermFile {
        StoredGlossaryTermFile {
            sibling_term_ids: vec!["sibling-entry".into()],
            term_id: id.into(),
            source_terms: forms.iter().map(|s| (*s).to_string()).collect(),
            target_terms: vec!["old translation".into()],
            target_variant_notes: vec![String::new()],
            notes_to_translators: String::new(),
            footnote: String::new(),
            untranslated: false,
            lifecycle: StoredLifecycle {
                state: "active".into(),
            },
        }
    }

    #[test]
    fn partial_overwrite_updates_the_stored_source_field_and_preserves_other_data() {
        let original = old_term("old", &["walk", "walked"]);
        let mut value = serde_json::to_value(&original).unwrap();
        value["futureMetadata"] = json!({"keep":true});
        let updated = with_remaining_sources(value, &["walked".into()]);
        let stored: StoredGlossaryTermFile = serde_json::from_value(updated.clone()).unwrap();
        assert_eq!(stored.source_terms, ["walked"]);
        assert_eq!(stored.target_terms, original.target_terms);
        assert_eq!(stored.sibling_term_ids, original.sibling_term_ids);
        assert_eq!(updated["futureMetadata"]["keep"], true);
        assert!(updated.get("sourceTerms").is_none());
    }

    #[test]
    fn research_save_allows_unrelated_existing_duplicates_but_rejects_new_conflicts() {
        let existing = vec![
            old_term("replace", &["hooltampanas"]),
            old_term("a", &["unrelated"]),
            old_term("b", &["unrelated"]),
        ];
        let changes = vec![ResearchChange {
            term_id: "replace".into(),
            expected: json!({}),
            source_terms: vec![],
        }];
        let source = vec!["hooltanpanas".into(), "hooltampanas".into()];
        assert!(ensure_no_new_source_conflicts(&existing, &changes, "new", &source).is_ok());
        assert!(ensure_no_new_source_conflicts(&existing, &[], "new", &source).is_err());
        let error =
            ensure_no_new_source_conflicts(&existing, &changes, "new", &["unrelated".into()])
                .unwrap_err();
        assert!(error.contains("unrelated"));
        assert!(
            ensure_no_new_source_conflicts(&existing, &changes, "new", &["UNRELATED".into()])
                .is_err()
        );
        assert!(ensure_no_new_source_conflicts(
            &existing,
            &changes,
            "new",
            &["new".into(), "new".into()]
        )
        .is_err());
        assert_eq!(existing[0].source_terms, ["hooltampanas"]);
    }

    #[test]
    fn interrupted_collision_save_restores_old_and_removes_new_entry() {
        let repo = recovery_repo();
        let head = git_output(&repo, &["rev-parse", "HEAD"]).unwrap();
        fs::remove_file(repo.join("terms/old.json")).unwrap();
        fs::write(repo.join("terms/new.json"), "new entry").unwrap();
        git_output(&repo, &["add", "."]).unwrap();
        write_json_pretty(
            &repo.join(".git/glossary-studio-recovery.json"),
            &json!({
                "head":head.trim(),"message":"unfinished research save",
                "backups":[["terms/old.json","original"],["terms/new.json",null]]
            }),
        )
        .unwrap();
        recover(&repo).unwrap();
        assert_eq!(
            fs::read_to_string(repo.join("terms/old.json")).unwrap(),
            "original"
        );
        assert!(!repo.join("terms/new.json").exists());
        assert!(git_output(&repo, &["status", "--porcelain"])
            .unwrap()
            .is_empty());
        recover(&repo).unwrap();
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn completed_collision_commit_is_not_rolled_back_after_restart() {
        let repo = recovery_repo();
        let head = git_output(&repo, &["rev-parse", "HEAD"]).unwrap();
        fs::write(repo.join("terms/old.json"), "remaining variants").unwrap();
        git_output(&repo, &["add", "."]).unwrap();
        git_output(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-m",
                "research transaction",
            ],
        )
        .unwrap();
        write_json_pretty(
            &repo.join(".git/glossary-studio-recovery.json"),
            &json!({
                "head":head.trim(),"message":"research transaction",
                "backups":[["terms/old.json","original"]]
            }),
        )
        .unwrap();
        recover(&repo).unwrap();
        assert_eq!(
            fs::read_to_string(repo.join("terms/old.json")).unwrap(),
            "remaining variants"
        );
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn stale_entry_check_uses_content_not_ui_fields() {
        let term = StoredGlossaryTermFile {
            sibling_term_ids: Vec::new(),
            term_id: "old".into(),
            source_terms: vec!["ser".into()],
            target_terms: vec!["be".into()],
            target_variant_notes: vec!["verb".into()],
            notes_to_translators: String::new(),
            footnote: String::new(),
            untranslated: false,
            lifecycle: StoredLifecycle {
                state: "active".into(),
            },
        };
        let mut expected = serde_json::to_value(map_term_record(term.clone())).unwrap();
        expected["freshness"] = json!("ready");
        assert!(same_entry(&term, &expected));
        expected["sourceTerms"] = json!(["el ser"]);
        assert!(!same_entry(&term, &expected));
    }
}
