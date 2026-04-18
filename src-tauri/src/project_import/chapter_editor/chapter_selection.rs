use super::*;

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
