use std::{collections::BTreeMap, fs, path::Path};

use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::git_commit::{git_commit_as_signed_in_user_with_metadata, GitCommitMetadata};
use crate::project_repo_paths::resolve_project_git_repo_path;

use super::super::project_git::{
    ensure_clean_git_repo, ensure_gitattributes, ensure_repo_exists, ensure_valid_git_repo,
    git_output, read_json_file, write_json_pretty,
};
use super::{
    active_lifecycle_state, ChapterFile, ChapterLanguage, ChapterSettings, FieldEditorFlags,
    FieldValue, FormatState, Guidance, ImportXlsxResponse, ImportedRow, ParsedWorkbook,
    ProjectFile, RowFile, RowOrigin, RowStatus, RowStructure, SourceFile, SourceFileMetadata,
};

const GTMS_FORMAT: &str = "gtms";
const GTMS_FORMAT_VERSION: u32 = 1;
const ORDER_KEY_SPACING: u128 = 1u128 << 104;

pub(super) fn import_parsed_workbook_to_gtms_sync(
    app: &AppHandle,
    parsed: ParsedWorkbook,
) -> Result<ImportXlsxResponse, String> {
    let chapter_id = Uuid::now_v7();
    let repo_path = resolve_project_git_repo_path(
        app,
        parsed.installation_id,
        parsed.project_id.as_deref(),
        Some(&parsed.repo_name),
    )?;
    ensure_repo_exists(
    &repo_path,
    "The local project repo is not available yet. Refresh the Projects page first so the repo can be cloned.",
  )?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    ensure_clean_git_repo(
        &repo_path,
        "The local project repo has uncommitted changes. Sync it before adding files.",
    )?;

    let project_title = read_project_title(&repo_path.join("project.json"))?;
    let chapter_slug =
        unique_chapter_slug(&repo_path.join("chapters"), &slugify(&parsed.file_title));
    let chapter_path = repo_path.join("chapters").join(&chapter_slug);
    let rows_path = chapter_path.join("rows");
    let assets_path = chapter_path.join("assets");

    fs::create_dir_all(&rows_path)
        .map_err(|error| format!("Could not create the imported rows folder: {error}"))?;
    fs::create_dir_all(&assets_path)
        .map_err(|error| format!("Could not create the imported assets folder: {error}"))?;

    ensure_gitattributes(&repo_path.join(".gitattributes"))?;

    let chapter_file = build_chapter_file(&parsed, &chapter_id, &chapter_slug);
    write_json_pretty(&chapter_path.join("chapter.json"), &chapter_file)?;

    let unit_count = write_row_files(&parsed, &rows_path)?;

    git_output(&repo_path, &["add", ".gitattributes", "chapters"])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!("Import {}", parsed.source_file_name),
        &[],
        GitCommitMetadata {
            operation: Some("import"),
            status_note: None,
            ai_model: None,
        },
    )?;

    let source_word_counts = build_source_word_counts_from_import(&parsed);
    let selected_source_language_code = parsed
        .languages
        .first()
        .map(|language| language.code.clone());
    let selected_target_language_code = chapter_file.settings.default_target_language.clone();

    Ok(ImportXlsxResponse {
        chapter_id: chapter_id.to_string(),
        repo_path: repo_path.display().to_string(),
        chapter_path: chapter_path.display().to_string(),
        project_title,
        file_title: parsed.file_title,
        worksheet_name: parsed.worksheet_name,
        unit_count,
        languages: chapter_file.languages.clone(),
        source_word_counts,
        selected_source_language_code,
        selected_target_language_code,
        language_codes: parsed
            .languages
            .iter()
            .map(|language| language.code.clone())
            .collect(),
        source_file_name: parsed.source_file_name,
        import_summary: parsed.import_summary,
    })
}

pub(super) fn build_chapter_file(
    parsed: &ParsedWorkbook,
    chapter_id: &Uuid,
    chapter_slug: &str,
) -> ChapterFile {
    let source_locale = parsed
        .languages
        .first()
        .map(|language| language.base_code.clone().unwrap_or_else(|| language.code.clone()));
    let target_locales = parsed
        .languages
        .iter()
        .skip(1)
        .map(|language| language.base_code.clone().unwrap_or_else(|| language.code.clone()))
        .collect::<Vec<_>>();
    let mut serialization_hints = BTreeMap::new();
    if parsed.source_format == "xlsx" {
        serialization_hints.insert(
            "worksheet".to_string(),
            Value::String(parsed.worksheet_name.clone()),
        );
    }
    if parsed.source_format == "docx" {
        if let Some(summary) = parsed.import_summary.as_ref() {
            serialization_hints.insert(
                "docx".to_string(),
                serde_json::to_value(summary).unwrap_or_else(|_| json!({})),
            );
        }
    }

    ChapterFile {
        format: GTMS_FORMAT,
        format_version: GTMS_FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        chapter_id: chapter_id.to_string(),
        title: parsed.file_title.clone(),
        slug: chapter_slug.to_string(),
        lifecycle: active_lifecycle_state(),
        source_files: vec![SourceFile {
            file_id: "source-001".to_string(),
            format: parsed.source_format,
            path_hint: parsed.source_file_name.clone(),
            filename_template: parsed.source_file_name.clone(),
            file_metadata: SourceFileMetadata {
                source_locale,
                target_locales,
                header_blob: parsed.header_blob.clone(),
                root_language: None,
                wrapper_name: None,
                serialization_hints,
            },
        }],
        package_assets: Vec::new(),
        languages: parsed
            .languages
            .iter()
            .map(|language| ChapterLanguage {
                code: language.code.clone(),
                name: language.name.clone(),
                role: language.role.to_string(),
                base_code: language.base_code.clone(),
            })
            .collect(),
        settings: ChapterSettings {
            linked_glossaries: None,
            default_source_language: parsed
                .languages
                .first()
                .map(|language| language.code.clone()),
            default_target_language: if parsed.languages.len() > 1 {
                parsed
                    .languages
                    .last()
                    .map(|language| language.code.clone())
            } else {
                None
            },
        },
    }
}

fn write_row_files(parsed: &ParsedWorkbook, rows_path: &Path) -> Result<usize, String> {
    let total_rows = parsed.rows.len();

    for (index, imported_row) in parsed.rows.iter().enumerate() {
        let row_id = Uuid::now_v7().to_string();
        let row_file = build_row_file(parsed, imported_row, index, total_rows, &row_id)?;
        write_json_pretty(&rows_path.join(format!("{row_id}.json")), &row_file)?;
    }

    Ok(total_rows)
}

pub(super) fn build_row_file(
    parsed: &ParsedWorkbook,
    imported_row: &ImportedRow,
    index: usize,
    total_rows: usize,
    row_id: &str,
) -> Result<RowFile, String> {
    let guidance = if imported_row.description.is_some()
        || imported_row.context.is_some()
        || !imported_row.comments.is_empty()
    {
        Some(Guidance {
            description: imported_row.description.clone(),
            context: imported_row.context.clone(),
            comments: imported_row.comments.clone(),
            source_references: Vec::new(),
        })
    } else {
        None
    };

    let mut container_path = BTreeMap::new();
    container_path.insert(
        "sheet".to_string(),
        Value::String(parsed.worksheet_name.clone()),
    );
    container_path.insert(
        "row".to_string(),
        Value::Number((imported_row.source_row_number as u64).into()),
    );

    let mut fields = BTreeMap::new();
    for language in &parsed.languages {
        let plain_text = imported_row
            .fields
            .get(&language.code)
            .cloned()
            .unwrap_or_default();
        fields.insert(
            language.code.clone(),
            FieldValue {
                value_kind: "text",
                plain_text: plain_text.plain_text,
                footnote: plain_text.footnote,
                rich_text: None,
                notes_html: String::new(),
                attachments: Vec::new(),
                passthrough_value: None,
                editor_flags: FieldEditorFlags::default(),
            },
        );
    }

    let mut format_metadata = BTreeMap::new();
    if parsed.source_format == "xlsx" {
        format_metadata.insert(
            "xlsx".to_string(),
            json!({
              "source_sheet": parsed.worksheet_name.clone(),
              "source_row_number": imported_row.source_row_number,
            }),
        );
    } else if parsed.source_format == "txt" {
        format_metadata.insert(
            "txt".to_string(),
            json!({
              "source_line_number": imported_row.source_row_number,
            }),
        );
    } else if parsed.source_format == "docx" {
        if let Some(metadata) = imported_row.docx_metadata.as_ref() {
            format_metadata.insert(
                "docx".to_string(),
                json!({
                  "block_kind": metadata.block_kind,
                  "paragraph_number": metadata.paragraph_number,
                  "table_row_number": metadata.table_row_number,
                  "list_item": metadata.list_item,
                  "original_style": metadata.original_style,
                  "warning_counts": metadata.warning_counts,
                }),
            );
        }
    }

    Ok(RowFile {
        row_id: row_id.to_string(),
        unit_type: "string",
        text_style: imported_row.text_style.clone(),
        external_id: imported_row.external_id.clone(),
        guidance,
        lifecycle: active_lifecycle_state(),
        status: RowStatus {
            review_state: "unreviewed",
            reviewed_at: None,
            reviewed_by: None,
            flags: Vec::new(),
        },
        structure: RowStructure {
            source_file: parsed.source_file_name.clone(),
            container_path,
            order_key: order_key_for_position(index, total_rows)?,
            group_context: imported_row.context.clone(),
        },
        origin: RowOrigin {
            source_format: parsed.source_format,
            source_sheet: parsed.worksheet_name.clone(),
            source_row_number: imported_row.source_row_number,
        },
        format_state: FormatState {
            translatable: true,
            character_limit: None,
            tags: Vec::new(),
            source_state: None,
            custom_attributes: BTreeMap::new(),
        },
        placeholders: Vec::new(),
        variants: Vec::new(),
        fields,
        format_metadata,
    })
}

fn order_key_for_position(index: usize, total_rows: usize) -> Result<String, String> {
    if index >= total_rows {
        return Err("Could not assign an order key outside the row set.".to_string());
    }

    let position = u128::try_from(index)
        .map_err(|error| format!("Could not convert the row position to an order key: {error}"))?
        + 1;
    let value = position
        .checked_mul(ORDER_KEY_SPACING)
        .ok_or_else(|| "Could not allocate a sparse order key for this row.".to_string())?;

    Ok(format!("{value:032x}"))
}

fn unique_chapter_slug(chapters_root: &Path, base_slug: &str) -> String {
    let slug = if base_slug.trim().is_empty() {
        "untitled".to_string()
    } else {
        base_slug.trim().to_string()
    };

    if !chapters_root.join(&slug).exists() {
        return slug;
    }

    let mut index = 2usize;
    loop {
        let candidate = format!("{slug}-{index}");
        if !chapters_root.join(&candidate).exists() {
            return candidate;
        }
        index += 1;
    }
}

fn slugify(value: &str) -> String {
    let slug = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

pub(super) fn build_source_word_counts_from_import(
    parsed: &ParsedWorkbook,
) -> BTreeMap<String, usize> {
    let mut counts = parsed
        .languages
        .iter()
        .map(|language| (language.code.clone(), 0usize))
        .collect::<BTreeMap<_, _>>();

    for row in &parsed.rows {
        for language in &parsed.languages {
            let value = row
                .fields
                .get(&language.code)
                .map(|field| field.plain_text.as_str())
                .unwrap_or("");
            *counts.entry(language.code.clone()).or_default() += count_words(value);
        }
    }

    counts
}

fn count_words(value: &str) -> usize {
    value
        .split_whitespace()
        .filter(|segment| !segment.is_empty())
        .count()
}

fn read_project_title(project_json_path: &Path) -> Result<String, String> {
    let project_file: ProjectFile = read_json_file(project_json_path, "project.json")?;
    Ok(project_file.title)
}
