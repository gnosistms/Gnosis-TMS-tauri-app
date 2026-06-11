use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::constants::ensure_within_import_size_limit;
use crate::git_commit::{
    ensure_local_commit_preconditions, git_commit_as_signed_in_user_with_metadata,
    GitCommitMetadata,
};
use crate::project_repo_paths::resolve_project_git_repo_path;
use crate::short_path_names::{allocate_short_folder_name, allocate_short_image_filename};

use super::super::project_git::{
    ensure_clean_git_repo, ensure_gitattributes, ensure_repo_exists, ensure_valid_git_repo,
    git_output, read_json_file, repo_relative_path, write_json_pretty,
};
use super::{
    active_lifecycle_state, ChapterFile, ChapterGlossaryLink, ChapterLanguage,
    ChapterLinkedGlossaries, ChapterSettings, FieldEditorFlags, FieldValue, FormatState, Guidance,
    ImportProjectDefaultGlossaryInput, ImportXlsxResponse, ImportedRow, ParsedWorkbook,
    ProjectFile, RowFile, RowOrigin, RowStatus, RowStructure, SourceFile, SourceFileMetadata,
};

const GTMS_FORMAT: &str = "gtms";
const GTMS_FORMAT_VERSION: u32 = 1;
const ORDER_KEY_SPACING: u128 = 1u128 << 104;

pub(super) struct ProjectImportRepoContext {
    pub(super) repo_path: PathBuf,
    pub(super) project_title: String,
    pub(super) gitattributes_existed: bool,
}

pub(super) struct WrittenImport {
    pub(super) response: ImportXlsxResponse,
    pub(super) relative_chapter_path: String,
    pub(super) absolute_chapter_path: PathBuf,
}

pub(super) fn import_parsed_workbook_to_gtms_sync(
    app: &AppHandle,
    parsed: ParsedWorkbook,
) -> Result<ImportXlsxResponse, String> {
    let context = prepare_project_import_repo(
        app,
        parsed.installation_id,
        parsed.project_id.as_deref(),
        &parsed.repo_name,
    )?;
    let written = write_parsed_workbook_chapter(&context, parsed, None)?;
    if let Err(error) = commit_written_imports(
        app,
        &context,
        std::slice::from_ref(&written.relative_chapter_path),
        &format!("Import {}", written.response.source_file_name),
    ) {
        // Unstage and remove the written chapter so a failed commit cannot strand a
        // dirty tree — prepare_project_import_repo's clean-tree precondition would
        // otherwise reject every future import.
        let cleanup = cleanup_written_imports(&context, std::slice::from_ref(&written), true);
        return Err(with_cleanup_failure(error, cleanup));
    }

    Ok(written.response)
}

/// Combine an import failure with the result of cleaning up after it, so a cleanup
/// error can never shadow the root-cause import error.
pub(super) fn with_cleanup_failure(
    import_error: String,
    cleanup_result: Result<(), String>,
) -> String {
    match cleanup_result {
        Ok(()) => import_error,
        Err(cleanup_error) => {
            format!("{import_error} Cleaning up the partial import also failed: {cleanup_error}")
        }
    }
}

/// Best-effort removal of written-but-uncommitted import chapters: unstage them, remove
/// the folders, and drop a `.gitattributes` this import created. Collected errors are
/// returned for the caller to append to the root-cause failure (see
/// `with_cleanup_failure`).
pub(super) fn cleanup_written_imports(
    context: &ProjectImportRepoContext,
    written: &[WrittenImport],
    unstage: bool,
) -> Result<(), String> {
    let mut cleanup_errors = Vec::new();
    if unstage {
        let mut paths = vec![".gitattributes".to_string()];
        paths.extend(
            written
                .iter()
                .map(|entry| entry.relative_chapter_path.clone()),
        );
        for path in &paths {
            let _ = git_output(&context.repo_path, &["reset", "--", path]);
        }
    }

    for entry in written.iter().rev() {
        if let Err(error) = fs::remove_dir_all(&entry.absolute_chapter_path) {
            if entry.absolute_chapter_path.exists() {
                cleanup_errors.push(format!(
                    "Could not remove '{}': {error}",
                    entry.absolute_chapter_path.display()
                ));
            }
        }
    }

    let gitattributes_path = context.repo_path.join(".gitattributes");
    if !context.gitattributes_existed && gitattributes_path.exists() {
        if let Err(error) = fs::remove_file(&gitattributes_path) {
            cleanup_errors.push(format!(
                "Could not remove '{}': {error}",
                gitattributes_path.display()
            ));
        }
    }

    if cleanup_errors.is_empty() {
        Ok(())
    } else {
        Err(cleanup_errors.join(" "))
    }
}

pub(super) fn prepare_project_import_repo(
    app: &AppHandle,
    installation_id: i64,
    project_id: Option<&str>,
    repo_name: &str,
) -> Result<ProjectImportRepoContext, String> {
    let repo_path =
        resolve_project_git_repo_path(app, installation_id, project_id, Some(repo_name))?;
    ensure_repo_exists(
    &repo_path,
    "The local project repo is not available yet. Refresh the Projects page first so the repo can be cloned.",
  )?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    ensure_clean_git_repo(
        &repo_path,
        "The local project repo has uncommitted changes. Sync it before adding files.",
    )?;
    // The commit gates (write access, signed-in session) normally run only inside the
    // commit helper, after the chapter is already written and staged. Check them here
    // so an *expected* gate failure rejects before anything is parsed or written.
    ensure_local_commit_preconditions(app, &repo_path)?;

    let project_title = read_project_title(&repo_path.join("project.json"))?;
    let gitattributes_existed = repo_path.join(".gitattributes").exists();

    Ok(ProjectImportRepoContext {
        repo_path,
        project_title,
        gitattributes_existed,
    })
}

pub(super) fn write_parsed_workbook_chapter(
    context: &ProjectImportRepoContext,
    parsed: ParsedWorkbook,
    default_glossary: Option<&ImportProjectDefaultGlossaryInput>,
) -> Result<WrittenImport, String> {
    let chapter_id = Uuid::now_v7();
    let repo_path = &context.repo_path;
    let chapter_slug = unique_chapter_slug(&repo_path.join("chapters"), &parsed.file_title)?;
    let chapter_path = repo_path.join("chapters").join(&chapter_slug);
    let rows_path = chapter_path.join("rows");
    let assets_path = chapter_path.join("assets");

    let result = (|| -> Result<WrittenImport, String> {
        fs::create_dir_all(&rows_path)
            .map_err(|error| format!("Could not create the imported rows folder: {error}"))?;
        fs::create_dir_all(&assets_path)
            .map_err(|error| format!("Could not create the imported assets folder: {error}"))?;

        ensure_gitattributes(&repo_path.join(".gitattributes"))?;

        let mut chapter_file =
            build_chapter_file(&parsed, &chapter_id, &chapter_slug, default_glossary);
        let word_counts = build_word_counts_from_import(&parsed);
        let selected_source_language_code = parsed
            .languages
            .first()
            .map(|language| language.code.clone());
        // Seed the projects-page word-count cache at creation. Only the source language has a
        // "source word count"; the summary reads this instead of re-reading every row.
        chapter_file.source_word_count = Some(
            selected_source_language_code
                .as_deref()
                .and_then(|code| word_counts.get(code))
                .copied()
                .unwrap_or(0),
        );
        write_json_pretty(&chapter_path.join("chapter.json"), &chapter_file)?;

        let unit_count = write_row_files(&parsed, repo_path, &rows_path, &chapter_slug)?;

        let relative_chapter_path = repo_relative_path(repo_path, &chapter_path)?;
        let selected_target_language_code = chapter_file.settings.default_target_language.clone();

        Ok(WrittenImport {
            response: ImportXlsxResponse {
                chapter_id: chapter_id.to_string(),
                repo_path: repo_path.display().to_string(),
                chapter_path: chapter_path.display().to_string(),
                project_title: context.project_title.clone(),
                file_title: parsed.file_title,
                worksheet_name: parsed.worksheet_name,
                unit_count,
                languages: chapter_file.languages.clone(),
                word_counts,
                selected_source_language_code,
                selected_target_language_code,
                language_codes: parsed
                    .languages
                    .iter()
                    .map(|language| language.code.clone())
                    .collect(),
                source_file_name: parsed.source_file_name,
                import_summary: parsed.import_summary,
            },
            relative_chapter_path,
            absolute_chapter_path: chapter_path.clone(),
        })
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&chapter_path);
        let gitattributes_path = repo_path.join(".gitattributes");
        if !context.gitattributes_existed && gitattributes_path.exists() {
            let _ = fs::remove_file(gitattributes_path);
        }
    }

    result
}

pub(super) fn commit_written_imports(
    app: &AppHandle,
    context: &ProjectImportRepoContext,
    relative_chapter_paths: &[String],
    message: &str,
) -> Result<(), String> {
    if relative_chapter_paths.is_empty() {
        return Ok(());
    }

    let mut staged_paths = vec![".gitattributes".to_string()];
    staged_paths.extend(relative_chapter_paths.iter().cloned());
    git_add_paths(&context.repo_path, &staged_paths)?;
    let commit_paths = staged_paths.iter().map(String::as_str).collect::<Vec<_>>();
    git_commit_as_signed_in_user_with_metadata(
        app,
        &context.repo_path,
        message,
        &commit_paths,
        import_commit_metadata(),
    )?;

    Ok(())
}

fn git_add_paths(repo_path: &Path, paths: &[String]) -> Result<(), String> {
    let mut args = vec!["add"];
    for path in paths {
        args.push(path.as_str());
    }
    git_output(repo_path, &args).map(|_| ())
}

fn import_commit_metadata() -> GitCommitMetadata<'static> {
    GitCommitMetadata {
        operation: Some("import"),
        migration: None,
        status_note: None,
        ai_model: None,
    }
}

pub(super) fn build_chapter_file(
    parsed: &ParsedWorkbook,
    chapter_id: &Uuid,
    chapter_slug: &str,
    default_glossary: Option<&ImportProjectDefaultGlossaryInput>,
) -> ChapterFile {
    let source_locale = parsed.languages.first().map(|language| {
        language
            .base_code
            .clone()
            .unwrap_or_else(|| language.code.clone())
    });
    let target_locales = parsed
        .languages
        .iter()
        .skip(1)
        .map(|language| {
            language
                .base_code
                .clone()
                .unwrap_or_else(|| language.code.clone())
        })
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
            linked_glossaries: default_glossary.map(|glossary| ChapterLinkedGlossaries {
                glossary: Some(ChapterGlossaryLink {
                    glossary_id: glossary.glossary_id.clone(),
                    repo_name: glossary.repo_name.clone(),
                }),
            }),
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
        // Populated by the caller after word counts are computed (see import_xlsx_into_repo).
        source_word_count: None,
    }
}

fn write_row_files(
    parsed: &ParsedWorkbook,
    repo_path: &Path,
    rows_path: &Path,
    chapter_slug: &str,
) -> Result<usize, String> {
    let total_rows = parsed.rows.len();

    for (index, imported_row) in parsed.rows.iter().enumerate() {
        let row_id = Uuid::now_v7().to_string();
        let mut row_file = build_row_file(parsed, imported_row, index, total_rows, &row_id)?;
        finalize_pending_uploaded_images(&mut row_file, repo_path, chapter_slug, &row_id)?;
        write_json_pretty(&rows_path.join(format!("{row_id}.json")), &row_file)?;
    }

    Ok(total_rows)
}

fn finalize_pending_uploaded_images(
    row_file: &mut RowFile,
    repo_path: &Path,
    chapter_slug: &str,
    _row_id: &str,
) -> Result<(), String> {
    for field in row_file.fields.values_mut() {
        let Some(image) = field.image.as_mut() else {
            continue;
        };
        let Some(upload) = image.pending_upload.take() else {
            continue;
        };
        ensure_within_import_size_limit(upload.bytes.len() as u64, &upload.filename)?;

        let Some(extension) = detected_imported_image_extension(&upload.bytes) else {
            field.image = None;
            continue;
        };

        let relative_image_path =
            relative_imported_image_path(repo_path, chapter_slug, &upload.filename, extension)?;
        let absolute_image_path = repo_path.join(&relative_image_path);
        if let Some(parent) = absolute_image_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Could not create imported image folder '{}': {error}",
                    parent.display()
                )
            })?;
        }
        fs::write(&absolute_image_path, &upload.bytes).map_err(|error| {
            format!(
                "Could not write imported image '{}': {error}",
                absolute_image_path.display()
            )
        })?;

        image.kind = "upload".to_string();
        image.url = None;
        image.path = Some(relative_image_path);
    }

    Ok(())
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
                image_caption: plain_text.image_caption,
                image: plain_text.image,
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
    } else if parsed.source_format == "html" {
        if let Some(metadata) = imported_row.html_metadata.as_ref() {
            let mut html_metadata = json!({
              "source_url": metadata.source_url,
              "block_kind": metadata.block_kind,
              "block_index": metadata.block_index,
              "original_tag": metadata.original_tag,
            });
            if let Some(image_url) = metadata.image_url.as_ref() {
                if let Some(object) = html_metadata.as_object_mut() {
                    object.insert("image_url".to_string(), Value::String(image_url.clone()));
                }
            }
            format_metadata.insert("html".to_string(), html_metadata);
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

fn detected_imported_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("ico");
    }
    if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && bytes
            .windows(4)
            .any(|window| window == b"avif" || window == b"avis")
    {
        return Some("avif");
    }
    // SVG is deliberately absent: imported images become stored uploads that travel
    // via git, and unsanitized SVG is latent stored XSS. Mirrors the editor upload
    // path (10d m1) — see detected_uploaded_image_extension in chapter_editor/images.rs.
    None
}

fn relative_imported_image_path(
    repo_path: &Path,
    chapter_slug: &str,
    filename: &str,
    extension: &str,
) -> Result<String, String> {
    let images_path = repo_path.join("chapters").join(chapter_slug).join("images");
    let file_name =
        allocate_short_image_filename(filename, extension, local_file_names(&images_path)?);
    Ok(format!("chapters/{chapter_slug}/images/{file_name}"))
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

fn unique_chapter_slug(chapters_root: &Path, title: &str) -> Result<String, String> {
    Ok(allocate_short_folder_name(
        title,
        local_file_names(chapters_root)?,
    ))
}

fn local_file_names(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Could not read '{}': {error}", path.display()))?
        .filter_map(|entry| {
            entry.ok().and_then(|entry| {
                entry
                    .path()
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
            })
        })
        .collect())
}

pub(super) fn build_word_counts_from_import(parsed: &ParsedWorkbook) -> BTreeMap<String, usize> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_png_bytes() -> Vec<u8> {
        vec![
            0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, b'I', b'H',
            b'D', b'R',
        ]
    }

    fn row_with_pending_upload(bytes: Vec<u8>) -> RowFile {
        let mut fields = BTreeMap::new();
        fields.insert(
            "en".to_string(),
            FieldValue {
                value_kind: "text",
                plain_text: String::new(),
                footnote: String::new(),
                image_caption: "Inline image".to_string(),
                image: Some(super::super::ImportedFieldImage {
                    kind: "upload".to_string(),
                    url: None,
                    path: None,
                    pending_upload: Some(super::super::ImportedImageUpload {
                        filename: "inline image.png".to_string(),
                        bytes,
                    }),
                }),
                rich_text: None,
                notes_html: String::new(),
                attachments: Vec::new(),
                passthrough_value: None,
                editor_flags: FieldEditorFlags::default(),
            },
        );

        RowFile {
            row_id: "row-1".to_string(),
            unit_type: "string",
            text_style: None,
            external_id: None,
            guidance: None,
            lifecycle: active_lifecycle_state(),
            status: RowStatus {
                review_state: "unreviewed",
                reviewed_at: None,
                reviewed_by: None,
                flags: Vec::new(),
            },
            structure: RowStructure {
                source_file: "article.html".to_string(),
                container_path: BTreeMap::new(),
                order_key: "1".to_string(),
                group_context: None,
            },
            origin: RowOrigin {
                source_format: "html",
                source_sheet: "HTML".to_string(),
                source_row_number: 1,
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
            format_metadata: BTreeMap::new(),
        }
    }

    fn create_test_repo() -> Result<PathBuf, String> {
        let repo_path =
            std::env::temp_dir().join(format!("gnosis-import-cleanup-test-{}", Uuid::now_v7()));
        fs::create_dir_all(&repo_path)
            .map_err(|error| format!("Could not create test repo: {error}"))?;
        git_output(&repo_path, &["init"])?;
        git_output(&repo_path, &["config", "user.email", "test@example.com"])?;
        git_output(&repo_path, &["config", "user.name", "Test User"])?;
        fs::write(repo_path.join("project.json"), "{\"title\":\"Project\"}\n")
            .map_err(|error| format!("Could not write project.json: {error}"))?;
        git_output(&repo_path, &["add", "."])?;
        git_output(&repo_path, &["commit", "-m", "Initial project"])?;
        Ok(repo_path)
    }

    fn test_written_import(
        relative_chapter_path: &str,
        absolute_chapter_path: PathBuf,
    ) -> WrittenImport {
        WrittenImport {
            response: ImportXlsxResponse {
                chapter_id: "chapter-1".to_string(),
                repo_path: String::new(),
                chapter_path: String::new(),
                project_title: "Project".to_string(),
                file_title: "Article".to_string(),
                worksheet_name: "HTML".to_string(),
                unit_count: 0,
                languages: Vec::new(),
                word_counts: BTreeMap::new(),
                selected_source_language_code: None,
                selected_target_language_code: None,
                language_codes: Vec::new(),
                source_file_name: "article.html".to_string(),
                import_summary: None,
            },
            relative_chapter_path: relative_chapter_path.to_string(),
            absolute_chapter_path,
        }
    }

    #[test]
    fn cleanup_written_imports_unstages_and_removes_written_chapters() -> Result<(), String> {
        let repo_path = create_test_repo()?;

        // Simulate the state a failed commit leaves behind: a written chapter and a
        // .gitattributes created by this import, both staged.
        let chapter_path = repo_path.join("chapters").join("article");
        fs::create_dir_all(chapter_path.join("rows"))
            .map_err(|error| format!("Could not create test chapter: {error}"))?;
        fs::write(chapter_path.join("chapter.json"), "{}\n")
            .map_err(|error| format!("Could not write chapter.json: {error}"))?;
        fs::write(repo_path.join(".gitattributes"), "*.json text eol=lf\n")
            .map_err(|error| format!("Could not write .gitattributes: {error}"))?;
        git_output(&repo_path, &["add", ".gitattributes", "chapters/article"])?;

        let context = ProjectImportRepoContext {
            repo_path: repo_path.clone(),
            project_title: "Project".to_string(),
            gitattributes_existed: false,
        };
        let written = vec![test_written_import(
            "chapters/article",
            chapter_path.clone(),
        )];

        cleanup_written_imports(&context, &written, true)?;

        assert!(!chapter_path.exists());
        assert!(!repo_path.join(".gitattributes").exists());
        assert_eq!(git_output(&repo_path, &["status", "--porcelain"])?, "");
        let _ = fs::remove_dir_all(&repo_path);
        Ok(())
    }

    #[test]
    fn with_cleanup_failure_preserves_the_root_cause_error() {
        assert_eq!(
            with_cleanup_failure("The commit failed.".to_string(), Ok(())),
            "The commit failed."
        );
        assert_eq!(
            with_cleanup_failure(
                "The commit failed.".to_string(),
                Err("Could not remove folder.".to_string())
            ),
            "The commit failed. Cleaning up the partial import also failed: Could not remove folder."
        );
    }

    #[test]
    fn finalize_pending_uploaded_images_writes_image_and_sets_upload_path() {
        let repo_path =
            std::env::temp_dir().join(format!("gnosis-import-image-test-{}", Uuid::now_v7()));
        fs::create_dir_all(&repo_path).expect("repo temp path should be created");
        let mut row = row_with_pending_upload(tiny_png_bytes());

        finalize_pending_uploaded_images(&mut row, &repo_path, "article", "row-1")
            .expect("pending upload should finalize");

        let image = row
            .fields
            .get("en")
            .and_then(|field| field.image.as_ref())
            .expect("image should remain");
        let relative_path = image.path.as_deref().expect("path should be set");
        assert_eq!(image.kind, "upload");
        assert!(image.url.is_none());
        assert!(image.pending_upload.is_none());
        assert_eq!(relative_path, "chapters/article/images/inline-image.png");
        assert!(repo_path.join(relative_path).exists());

        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn finalize_pending_uploaded_images_omits_invalid_image_bytes() {
        let repo_path = std::env::temp_dir().join(format!(
            "gnosis-import-invalid-image-test-{}",
            Uuid::now_v7()
        ));
        fs::create_dir_all(&repo_path).expect("repo temp path should be created");
        let mut row = row_with_pending_upload(b"not an image".to_vec());

        finalize_pending_uploaded_images(&mut row, &repo_path, "article", "row-1")
            .expect("invalid upload should be omitted without failing import");

        assert!(row
            .fields
            .get("en")
            .and_then(|field| field.image.as_ref())
            .is_none());

        let _ = fs::remove_dir_all(repo_path);
    }

    #[test]
    fn imported_image_detection_rejects_svg() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>"#;
        assert_eq!(detected_imported_image_extension(svg), None);

        let repo_path =
            std::env::temp_dir().join(format!("gnosis-import-svg-image-test-{}", Uuid::now_v7()));
        fs::create_dir_all(&repo_path).expect("repo temp path should be created");
        let mut row = row_with_pending_upload(svg.to_vec());

        finalize_pending_uploaded_images(&mut row, &repo_path, "article", "row-1")
            .expect("svg upload should be omitted without failing import");

        assert!(row
            .fields
            .get("en")
            .and_then(|field| field.image.as_ref())
            .is_none());

        let _ = fs::remove_dir_all(repo_path);
    }
}
