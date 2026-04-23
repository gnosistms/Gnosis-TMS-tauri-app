use super::*;
use crate::project_repo_sync::{sync_gtms_project_editor_repo_sync, ProjectEditorRepoSyncInput};

pub(crate) fn update_gtms_chapter_language_selection_sync(
    app: &AppHandle,
    input: UpdateChapterLanguageSelectionInput,
) -> Result<UpdateChapterLanguageSelectionResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_json_path = chapter_path.join("chapter.json");
    let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
    let chapter_title = chapter_value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("file")
        .to_string();
    let known_language_codes = chapter_value
        .get("languages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|language| language.get("code").and_then(Value::as_str))
        .collect::<Vec<_>>();

    if !known_language_codes.contains(&input.source_language_code.as_str()) {
        return Err(format!(
            "The source language '{}' is not available in this file.",
            input.source_language_code
        ));
    }

    if !known_language_codes.contains(&input.target_language_code.as_str()) {
        return Err(format!(
            "The target language '{}' is not available in this file.",
            input.target_language_code
        ));
    }

    let chapter_object = chapter_value
        .as_object_mut()
        .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
    let settings_value = chapter_object
        .entry("settings".to_string())
        .or_insert_with(|| json!({}));
    let settings_object = settings_value
        .as_object_mut()
        .ok_or_else(|| "The chapter settings are not a JSON object.".to_string())?;

    let source_changed = settings_object
        .get("default_source_language")
        .and_then(Value::as_str)
        != Some(input.source_language_code.as_str());
    let target_changed = settings_object
        .get("default_target_language")
        .and_then(Value::as_str)
        != Some(input.target_language_code.as_str());

    if source_changed || target_changed {
        settings_object.insert(
            "default_source_language".to_string(),
            Value::String(input.source_language_code.clone()),
        );
        settings_object.insert(
            "default_target_language".to_string(),
            Value::String(input.target_language_code.clone()),
        );
        settings_object.remove("default_preview_language");
        write_json_pretty(&chapter_json_path, &chapter_value)?;

        let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
        git_output(&repo_path, &["add", &relative_chapter_json])?;
        git_commit_as_signed_in_user(
            app,
            &repo_path,
            &format!("Update language selection for {}", chapter_title),
            &[&relative_chapter_json],
        )?;
    }

    Ok(UpdateChapterLanguageSelectionResponse {
        chapter_id: input.chapter_id,
        source_language_code: input.source_language_code,
        target_language_code: input.target_language_code,
    })
}

fn normalize_chapter_language_input(language: &ChapterLanguage) -> Option<ChapterLanguage> {
    let code = language.code.trim().to_lowercase();
    if code.is_empty() {
        return None;
    }

    let name = language.name.trim();
    let role = language.role.trim().to_lowercase();
    Some(ChapterLanguage {
        code,
        name: if name.is_empty() {
            language.code.trim().to_string()
        } else {
            name.to_string()
        },
        role: if role == "source" || role == "target" {
            role
        } else {
            "target".to_string()
        },
    })
}

pub(crate) fn update_gtms_chapter_languages_sync(
    app: &AppHandle,
    input: UpdateChapterLanguagesInput,
    session_token: &str,
) -> Result<UpdateChapterLanguagesResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    if !git_output(&repo_path, &["status", "--porcelain"])?
        .trim()
        .is_empty()
    {
        return Err(
            "Resolve other local repo changes before changing chapter languages.".to_string(),
        );
    }
    if repo_has_imported_editor_conflicts(&repo_path)? {
        return Err(
            "Resolve imported editor conflicts before changing chapter languages.".to_string(),
        );
    }

    let previous_head_sha = git_output(&repo_path, &["rev-parse", "HEAD"])?;
    let project_id = input
        .project_id
        .clone()
        .ok_or_else(|| "Could not determine which project repo to sync.".to_string())?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_json_path = chapter_path.join("chapter.json");
    let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
    let chapter_file: StoredChapterFile = serde_json::from_value(chapter_value.clone())
        .map_err(|error| format!("The chapter.json file could not be parsed: {error}"))?;
    let chapter_title = chapter_value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("file")
        .to_string();
    let previous_languages = sanitize_chapter_languages(&chapter_file.languages);

    let requested_languages = input
        .languages
        .iter()
        .filter_map(normalize_chapter_language_input)
        .collect::<Vec<_>>();
    let languages = sanitize_chapter_languages(&requested_languages);
    if languages.is_empty() {
        return Err("A file must contain at least one language.".to_string());
    }

    {
        let chapter_object = chapter_value
            .as_object_mut()
            .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
        chapter_object.insert(
            "languages".to_string(),
            serde_json::to_value(&languages)
                .map_err(|error| format!("The languages could not be serialized: {error}"))?,
        );
    }

    let updated_chapter_file: StoredChapterFile = serde_json::from_value(chapter_value.clone())
        .map_err(|error| format!("The updated chapter.json file could not be parsed: {error}"))?;
    let selected_source_language_code =
        preferred_source_language_code(&updated_chapter_file, &languages);
    let selected_target_language_code = preferred_target_language_code(
        &updated_chapter_file,
        &languages,
        selected_source_language_code.as_deref(),
    );

    let (previous_source_language_code, previous_target_language_code) = {
        let chapter_object = chapter_value
            .as_object_mut()
            .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
        let settings_value = chapter_object
            .entry("settings".to_string())
            .or_insert_with(|| json!({}));
        let settings_object = settings_value
            .as_object_mut()
            .ok_or_else(|| "The chapter settings are not a JSON object.".to_string())?;
        let previous_source_language_code = settings_object
            .get("default_source_language")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        let previous_target_language_code = settings_object
            .get("default_target_language")
            .and_then(Value::as_str)
            .map(ToString::to_string);

        if let Some(source_language_code) = selected_source_language_code.as_ref() {
            settings_object.insert(
                "default_source_language".to_string(),
                Value::String(source_language_code.clone()),
            );
        } else {
            settings_object.remove("default_source_language");
        }

        if let Some(target_language_code) = selected_target_language_code.as_ref() {
            settings_object.insert(
                "default_target_language".to_string(),
                Value::String(target_language_code.clone()),
            );
        } else {
            settings_object.remove("default_target_language");
        }
        settings_object.remove("default_preview_language");

        (previous_source_language_code, previous_target_language_code)
    };

    if previous_languages != languages
        || previous_source_language_code != selected_source_language_code
        || previous_target_language_code != selected_target_language_code
    {
        write_json_pretty(&chapter_json_path, &chapter_value)?;

        let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
        let update_result = (|| -> Result<(), String> {
            git_output(&repo_path, &["add", &relative_chapter_json])?;
            git_commit_as_signed_in_user(
                app,
                &repo_path,
                &format!("Update languages for {}", chapter_title),
                &[&relative_chapter_json],
            )?;
            sync_gtms_project_editor_repo_sync(
                app,
                ProjectEditorRepoSyncInput {
                    installation_id: input.installation_id,
                    project_id,
                    repo_name: input.repo_name.clone(),
                    full_name: input.full_name.clone(),
                    repo_id: input.repo_id,
                    default_branch_name: input.default_branch_name.clone(),
                    default_branch_head_oid: input.default_branch_head_oid.clone(),
                    chapter_id: input.chapter_id.clone(),
                },
                session_token,
            )?;
            Ok(())
        })();

        if let Err(error) = update_result {
            return Err(rollback_failed_chapter_language_update(
                &repo_path,
                &previous_head_sha,
                error,
            ));
        }
    }

    Ok(UpdateChapterLanguagesResponse {
        chapter_id: input.chapter_id,
        languages,
        selected_source_language_code,
        selected_target_language_code,
    })
}

fn rollback_failed_chapter_language_update(
    repo_path: &std::path::Path,
    previous_head_sha: &str,
    update_error: String,
) -> String {
    match git_output(repo_path, &["reset", "--hard", previous_head_sha]) {
        Ok(_) => format!("{update_error} The local chapter language change was rolled back."),
        Err(rollback_error) => format!(
            "{update_error} Rolling back the local chapter language change also failed: {rollback_error}"
        ),
    }
}

pub(crate) fn update_gtms_chapter_glossary_links_sync(
    app: &AppHandle,
    input: UpdateChapterGlossaryLinksInput,
) -> Result<UpdateChapterGlossaryLinksResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_json_path = chapter_path.join("chapter.json");
    let mut chapter_value: Value = read_json_file(&chapter_json_path, "chapter.json")?;
    let chapter_title = chapter_value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("file")
        .to_string();

    let chapter_object = chapter_value
        .as_object_mut()
        .ok_or_else(|| "The chapter.json file is not a JSON object.".to_string())?;
    let settings_value = chapter_object
        .entry("settings".to_string())
        .or_insert_with(|| json!({}));
    let settings_object = settings_value
        .as_object_mut()
        .ok_or_else(|| "The chapter settings are not a JSON object.".to_string())?;
    let linked_glossaries_value = settings_object
        .entry("linked_glossaries".to_string())
        .or_insert_with(|| json!({}));
    let linked_glossaries_object = linked_glossaries_value
        .as_object_mut()
        .ok_or_else(|| "The chapter linked glossaries are not a JSON object.".to_string())?;

    let glossary_value = glossary_link_value_from_input(input.glossary.as_ref());
    let glossary_changed = linked_glossaries_object.get("glossary") != Some(&glossary_value);

    if glossary_changed {
        linked_glossaries_object.insert("glossary".to_string(), glossary_value);
        linked_glossaries_object.remove("glossary_1");
        linked_glossaries_object.remove("glossary_2");
        write_json_pretty(&chapter_json_path, &chapter_value)?;

        let relative_chapter_json = repo_relative_path(&repo_path, &chapter_json_path)?;
        git_output(&repo_path, &["add", &relative_chapter_json])?;
        git_commit_as_signed_in_user(
            app,
            &repo_path,
            &format!("Update glossary links for {}", chapter_title),
            &[&relative_chapter_json],
        )?;
    }

    Ok(UpdateChapterGlossaryLinksResponse {
        chapter_id: input.chapter_id,
        glossary: input.glossary.map(project_chapter_glossary_link_from_input),
    })
}

pub(super) fn glossary_link_value_from_input(input: Option<&GlossaryLinkSelectionInput>) -> Value {
    match input {
        Some(selection) => json!({
          "glossary_id": selection.glossary_id,
          "repo_name": selection.repo_name,
        }),
        None => Value::Null,
    }
}

pub(super) fn project_chapter_glossary_link_from_input(
    input: GlossaryLinkSelectionInput,
) -> ProjectChapterGlossaryLink {
    ProjectChapterGlossaryLink {
        glossary_id: input.glossary_id,
        repo_name: input.repo_name,
    }
}

pub(super) fn preferred_source_language_code(
    chapter_file: &StoredChapterFile,
    languages: &[ChapterLanguage],
) -> Option<String> {
    chapter_file
        .settings
        .as_ref()
        .and_then(|settings| settings.default_source_language.clone())
        .filter(|code| languages.iter().any(|language| language.code == *code))
        .or_else(|| languages.first().map(|language| language.code.clone()))
        .or_else(|| {
            chapter_file
                .source_files
                .iter()
                .find_map(|source_file| source_file.file_metadata.source_locale.clone())
        })
}

pub(super) fn linked_chapter_glossary(
    chapter_file: &StoredChapterFile,
) -> Option<ProjectChapterGlossaryLink> {
    let link = chapter_file
        .settings
        .as_ref()
        .and_then(|settings| settings.linked_glossaries.as_ref())
        .and_then(|linked| linked.glossary.as_ref())?;

    Some(ProjectChapterGlossaryLink {
        glossary_id: link.glossary_id.clone(),
        repo_name: link.repo_name.clone(),
    })
}

pub(super) fn preferred_target_language_code(
    chapter_file: &StoredChapterFile,
    languages: &[ChapterLanguage],
    selected_source_language_code: Option<&str>,
) -> Option<String> {
    chapter_file
        .settings
        .as_ref()
        .and_then(|settings| settings.default_target_language.clone())
        .filter(|code| languages.iter().any(|language| language.code == *code))
        .or_else(|| {
            languages
                .iter()
                .find(|language| language.role == "target")
                .map(|language| language.code.clone())
        })
        .or_else(|| {
            languages
                .iter()
                .find(|language| Some(language.code.as_str()) != selected_source_language_code)
                .map(|language| language.code.clone())
        })
        .or_else(|| languages.first().map(|language| language.code.clone()))
}
