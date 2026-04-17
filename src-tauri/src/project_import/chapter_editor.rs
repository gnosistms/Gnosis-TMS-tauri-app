use std::{
    cmp::Ordering,
    collections::BTreeMap,
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
    str,
};

use base64::Engine as _;
use quick_xml::{events::Event as XmlEvent, Reader as XmlReader};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::git_commit::{
    git_commit_as_signed_in_user, git_commit_as_signed_in_user_with_metadata,
    GitCommitMetadata as CommitMetadata,
};
use crate::project_repo_paths::{find_project_repo_path, resolve_project_git_repo_path};

use super::{
    chapter_editor_comments::StoredEditorComment,
    project_git::{
        ensure_gitattributes, ensure_repo_exists, ensure_valid_git_repo, find_chapter_path_by_id,
        git_output, git_output_with_stdin, local_repo_root, read_json_file, repo_relative_path,
        write_json_pretty, write_text_file,
    },
};

const ORDER_KEY_SPACING: u128 = 1u128 << 104;
const DEFAULT_EDITOR_TEXT_STYLE: &str = "paragraph";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeProjectRepoInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLocalProjectFilesInput {
    installation_id: i64,
    projects: Vec<LocalProjectFilesDescriptor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalProjectFilesDescriptor {
    project_id: String,
    repo_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProjectFilesResponse {
    project_id: String,
    repo_name: String,
    chapters: Vec<ProjectChapterSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeProjectRepoResponse {
    project_id: String,
    repo_name: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PurgeLocalProjectRepoInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLanguageSelectionInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    source_language_code: String,
    target_language_code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLanguageSelectionResponse {
    chapter_id: String,
    source_language_code: String,
    target_language_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterGlossaryLinksInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    glossary: Option<GlossaryLinkSelectionInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryLinkSelectionInput {
    glossary_id: String,
    repo_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterGlossaryLinksResponse {
    chapter_id: String,
    glossary: Option<ProjectChapterGlossaryLink>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldsInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    fields: BTreeMap<String, String>,
    #[serde(default)]
    footnotes: BTreeMap<String, String>,
    #[serde(default)]
    base_fields: BTreeMap<String, String>,
    #[serde(default)]
    base_footnotes: BTreeMap<String, String>,
    #[serde(default)]
    operation: String,
    #[serde(default)]
    ai_model: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldsBatchRowInput {
    row_id: String,
    fields: BTreeMap<String, String>,
    #[serde(default)]
    footnotes: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldsBatchInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    rows: Vec<UpdateEditorRowFieldsBatchRowInput>,
    commit_message: String,
    operation: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldFlagInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    language_code: String,
    flag: String,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowTextStyleInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    text_style: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorFieldImageInput {
    kind: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveEditorLanguageImageUrlInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    language_code: String,
    url: String,
    #[serde(default)]
    base_image: Option<EditorFieldImageInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadEditorLanguageImageInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    language_code: String,
    filename: String,
    data_base64: String,
    #[serde(default)]
    base_image: Option<EditorFieldImageInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoveEditorLanguageImageInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    language_code: String,
    #[serde(default)]
    base_image: Option<EditorFieldImageInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClearEditorReviewedMarkersInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    language_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InsertEditorRowInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowLifecycleInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldsBatchResponse {
    row_ids: Vec<String>,
    source_word_counts: BTreeMap<String, usize>,
    commit_sha: Option<String>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowFieldFlagResponse {
    row_id: String,
    language_code: String,
    reviewed: bool,
    please_check: bool,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowTextStyleResponse {
    row_id: String,
    text_style: String,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveEditorLanguageImageResponse {
    row_id: String,
    language_code: String,
    status: String,
    row: Option<EditorRow>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClearEditorReviewedMarkersResponse {
    row_ids: Vec<String>,
    language_code: String,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InsertEditorRowResponse {
    row: EditorRow,
    source_word_counts: BTreeMap<String, usize>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowLifecycleResponse {
    row_id: String,
    lifecycle_state: String,
    source_word_counts: BTreeMap<String, usize>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadChapterEditorInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorFieldHistoryInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    language_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorRowInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorFieldHistoryResponse {
    row_id: String,
    language_code: String,
    entries: Vec<EditorFieldHistoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorFieldHistoryEntry {
    commit_sha: String,
    author_name: String,
    committed_at: String,
    message: String,
    operation_type: Option<String>,
    status_note: Option<String>,
    ai_model: Option<String>,
    plain_text: String,
    footnote: String,
    image: Option<EditorFieldImage>,
    text_style: String,
    reviewed: bool,
    please_check: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreEditorFieldHistoryInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    language_code: String,
    commit_sha: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreEditorFieldHistoryResponse {
    row_id: String,
    language_code: String,
    plain_text: String,
    footnote: String,
    image: Option<EditorFieldImage>,
    text_style: String,
    reviewed: bool,
    please_check: bool,
    source_word_counts: BTreeMap<String, usize>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorRowResponse {
    row_id: String,
    row: Option<EditorRow>,
    chapter_base_commit_sha: Option<String>,
    row_version: Option<EditorRowVersionMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReverseEditorBatchReplaceCommitInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    commit_sha: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReverseEditorBatchReplaceCommitResponse {
    updated_rows: Vec<UpdateEditorRowFieldsBatchRowInput>,
    skipped_row_ids: Vec<String>,
    source_word_counts: BTreeMap<String, usize>,
    commit_sha: Option<String>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadChapterEditorResponse {
    chapter_id: String,
    file_title: String,
    languages: Vec<ChapterLanguage>,
    source_word_counts: BTreeMap<String, usize>,
    selected_source_language_code: Option<String>,
    selected_target_language_code: Option<String>,
    chapter_base_commit_sha: Option<String>,
    rows: Vec<EditorRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorRow {
    row_id: String,
    revision_token: String,
    external_id: Option<String>,
    description: Option<String>,
    context: Option<String>,
    comment_count: usize,
    comments_revision: u64,
    source_row_number: usize,
    review_state: String,
    lifecycle_state: String,
    order_key: String,
    text_style: String,
    fields: BTreeMap<String, String>,
    footnotes: BTreeMap<String, String>,
    images: BTreeMap<String, EditorFieldImage>,
    field_states: BTreeMap<String, EditorFieldState>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorFieldState {
    reviewed: bool,
    please_check: bool,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StoredFieldImage {
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct EditorFieldImage {
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectChapterSummary {
    id: String,
    name: String,
    status: String,
    languages: Vec<ChapterLanguage>,
    source_word_counts: BTreeMap<String, usize>,
    selected_source_language_code: Option<String>,
    selected_target_language_code: Option<String>,
    linked_glossary: Option<ProjectChapterGlossaryLink>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectChapterGlossaryLink {
    glossary_id: String,
    repo_name: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChapterLanguage {
    code: String,
    name: String,
    role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveEditorRowWithConcurrencyResponse {
    row_id: String,
    status: String,
    row: Option<EditorRow>,
    source_word_counts: BTreeMap<String, usize>,
    base_fields: BTreeMap<String, String>,
    base_footnotes: BTreeMap<String, String>,
    conflict_remote_version: Option<EditorRowVersionMetadata>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorRowVersionMetadata {
    commit_sha: String,
    author_name: String,
    committed_at: String,
}

#[derive(Deserialize)]
struct StoredChapterFile {
    chapter_id: String,
    title: String,
    #[serde(default = "active_lifecycle_state")]
    lifecycle: StoredLifecycleState,
    #[serde(default)]
    source_files: Vec<StoredSourceFile>,
    #[serde(default)]
    languages: Vec<ChapterLanguage>,
    #[serde(default)]
    settings: Option<StoredChapterSettings>,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredLifecycleState {
    state: String,
}

fn active_lifecycle_state() -> StoredLifecycleState {
    StoredLifecycleState {
        state: "active".to_string(),
    }
}

fn active_row_lifecycle_state() -> StoredLifecycleState {
    StoredLifecycleState {
        state: "active".to_string(),
    }
}

#[derive(Deserialize)]
struct StoredSourceFile {
    #[serde(default)]
    path_hint: String,
    file_metadata: StoredSourceFileMetadata,
}

#[derive(Deserialize, Default)]
struct StoredSourceFileMetadata {
    source_locale: Option<String>,
}

#[derive(Deserialize, Default)]
struct StoredChapterSettings {
    linked_glossaries: Option<StoredChapterLinkedGlossaries>,
    default_source_language: Option<String>,
    default_target_language: Option<String>,
}

#[derive(Clone, Deserialize, Default)]
struct StoredChapterLinkedGlossaries {
    #[serde(default)]
    glossary: Option<StoredChapterGlossaryLink>,
}

#[derive(Clone, Deserialize)]
struct StoredChapterGlossaryLink {
    glossary_id: String,
    repo_name: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredRowFile {
    row_id: String,
    #[serde(default)]
    external_id: Option<String>,
    #[serde(default)]
    guidance: Option<StoredGuidance>,
    #[serde(default = "active_row_lifecycle_state")]
    lifecycle: StoredLifecycleState,
    structure: StoredRowStructure,
    status: StoredRowStatus,
    origin: StoredRowOrigin,
    #[serde(default)]
    editor_comments_revision: u64,
    #[serde(default)]
    editor_comments: Vec<StoredEditorComment>,
    #[serde(default)]
    text_style: Option<String>,
    fields: BTreeMap<String, StoredFieldValue>,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredRowStructure {
    order_key: String,
}

#[derive(Clone, Deserialize, Default, Serialize)]
struct StoredGuidance {
    description: Option<String>,
    context: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredRowStatus {
    review_state: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredRowOrigin {
    source_row_number: usize,
}

#[derive(Clone, Deserialize, Serialize)]
struct StoredFieldValue {
    #[serde(default)]
    plain_text: String,
    #[serde(default)]
    footnote: String,
    #[serde(default)]
    image: Option<StoredFieldImage>,
    #[serde(default)]
    editor_flags: StoredFieldEditorFlags,
}

#[derive(Clone, Deserialize, Default, Serialize)]
struct StoredFieldEditorFlags {
    #[serde(default)]
    reviewed: bool,
    #[serde(default)]
    please_check: bool,
}

struct GitCommitMetadata {
    commit_sha: String,
    author_name: String,
    committed_at: String,
    message: String,
    operation_type: Option<String>,
    status_note: Option<String>,
    ai_model: Option<String>,
}

pub(super) fn load_gtms_chapter_editor_data_sync(
    app: &AppHandle,
    input: LoadChapterEditorInput,
) -> Result<LoadChapterEditorResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);
    let selected_source_language_code = preferred_source_language_code(&chapter_file, &languages);
    let selected_target_language_code = preferred_target_language_code(
        &chapter_file,
        &languages,
        selected_source_language_code.as_deref(),
    );

    Ok(LoadChapterEditorResponse {
        chapter_id: chapter_file.chapter_id,
        file_title: chapter_file.title,
        languages,
        source_word_counts,
        selected_source_language_code,
        selected_target_language_code,
        chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"]).ok(),
        rows: rows
            .into_iter()
            .map(|row| editor_row_from_stored_row_file(&repo_path, row))
            .collect::<Result<Vec<_>, _>>()?,
    })
}

pub(super) fn load_gtms_editor_row_sync(
    app: &AppHandle,
    input: LoadEditorRowInput,
) -> Result<LoadEditorRowResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    let relative_row_json = if row_json_path.exists() {
        Some(repo_relative_path(&repo_path, &row_json_path)?)
    } else {
        None
    };
    let row = if row_json_path.exists() {
        Some(editor_row_from_stored_row_file(
            &repo_path,
            read_json_file(&row_json_path, "row file")?,
        )?)
    } else {
        None
    };
    let row_version = if let Some(relative_row_json) = relative_row_json.as_deref() {
        load_latest_row_version_metadata(&repo_path, relative_row_json)?
    } else {
        None
    };

    Ok(LoadEditorRowResponse {
        row_id: input.row_id,
        row,
        chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"]).ok(),
        row_version,
    })
}

pub(super) fn insert_gtms_editor_row_sync(
    app: &AppHandle,
    input: InsertEditorRowInput,
    insert_before: bool,
) -> Result<InsertEditorRowResponse, String> {
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
    let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    let anchor_index = rows
        .iter()
        .position(|row| row.row_id == input.row_id)
        .ok_or_else(|| format!("Could not find row '{}' in this file.", input.row_id))?;
    let (previous, next) = if insert_before {
        (
            anchor_index
                .checked_sub(1)
                .and_then(|index| rows.get(index)),
            rows.get(anchor_index),
        )
    } else {
        (rows.get(anchor_index), rows.get(anchor_index + 1))
    };
    let order_key = allocate_order_key_between(
        previous.map(|row| row.structure.order_key.as_str()),
        next.map(|row| row.structure.order_key.as_str()),
    )?;
    let row_id = uuid::Uuid::now_v7().to_string();
    let row_file = create_inserted_row_file(&row_id, &order_key, &chapter_file, &languages);
    let row_json_path = chapter_path.join("rows").join(format!("{row_id}.json"));
    write_json_pretty(&row_json_path, &row_file)?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let commit_message = if insert_before {
        format!("Insert row {} before {}", row_id, input.row_id)
    } else {
        format!("Insert row {} after {}", row_id, input.row_id)
    };
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &commit_message,
        &[&relative_row_json],
        CommitMetadata {
            operation: Some("insert"),
            status_note: None,
            ai_model: None,
        },
    )?;

    let inserted_row_file: StoredRowFile = serde_json::from_value(row_file)
        .map_err(|error| format!("Could not decode inserted row '{}': {error}", row_id))?;

    Ok(InsertEditorRowResponse {
        row: editor_row_from_stored_row_file(&repo_path, inserted_row_file)?,
        source_word_counts: build_source_word_counts_from_stored_rows(&rows, &languages),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn list_local_gtms_project_files_sync(
    app: &AppHandle,
    input: ListLocalProjectFilesInput,
) -> Result<Vec<LocalProjectFilesResponse>, String> {
    let repo_root = local_repo_root(app, input.installation_id)?;
    let mut results = Vec::with_capacity(input.projects.len());

    for project in input.projects {
        let repo_path = find_project_repo_path(
            app,
            input.installation_id,
            Some(&project.project_id),
            Some(&project.repo_name),
        )?
        .unwrap_or_else(|| repo_root.join(&project.repo_name));
        let chapters =
            if repo_path.exists() && git_output(&repo_path, &["rev-parse", "--git-dir"]).is_ok() {
                load_project_chapter_summaries(&repo_path)?
            } else {
                Vec::new()
            };

        results.push(LocalProjectFilesResponse {
            project_id: project.project_id,
            repo_name: project.repo_name,
            chapters,
        });
    }

    Ok(results)
}

pub(super) fn initialize_gtms_project_repo_sync(
    app: &AppHandle,
    input: InitializeProjectRepoInput,
) -> Result<InitializeProjectRepoResponse, String> {
    let repo_name = input.repo_name.trim();
    if repo_name.is_empty() {
        return Err("Could not determine which project repo to initialize.".to_string());
    }

    let title = input.title.trim();
    if title.is_empty() {
        return Err("Enter a project name.".to_string());
    }

    let project_id = input
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Could not determine which project to initialize.".to_string())?;
    let repo_root = local_repo_root(app, input.installation_id)?;
    let repo_path = find_project_repo_path(
        app,
        input.installation_id,
        Some(&project_id),
        Some(repo_name),
    )?
    .unwrap_or_else(|| repo_root.join(repo_name));

    fs::create_dir_all(&repo_path).map_err(|error| {
        format!(
            "Could not create the local project repo '{}': {error}",
            repo_path.display()
        )
    })?;

    if git_output(&repo_path, &["rev-parse", "--git-dir"]).is_err() {
        git_output(&repo_path, &["init", "--initial-branch", "main"])?;
    }

    if repo_path.join("project.json").exists() {
        return Err("This project repo is already initialized.".to_string());
    }

    ensure_gitattributes(&repo_path.join(".gitattributes"))?;
    write_json_pretty(
        &repo_path.join("project.json"),
        &json!({
          "title": title,
        }),
    )?;
    git_output(&repo_path, &["add", ".gitattributes", "project.json"])?;
    git_commit_as_signed_in_user(
        app,
        &repo_path,
        "Initialize project",
        &[".gitattributes", "project.json"],
    )?;

    let _ = crate::local_repo_sync_state::upsert_local_repo_sync_state(
        &repo_path,
        crate::local_repo_sync_state::LocalRepoSyncStateUpdate {
            resource_id: Some(project_id.clone()),
            current_repo_name: Some(repo_name.to_string()),
            kind: Some("project".to_string()),
            has_ever_synced: Some(false),
            ..Default::default()
        },
    );

    Ok(InitializeProjectRepoResponse {
        project_id,
        repo_name: repo_name.to_string(),
        title: title.to_string(),
    })
}

pub(super) fn purge_local_gtms_project_repo_sync(
    app: &AppHandle,
    input: PurgeLocalProjectRepoInput,
) -> Result<(), String> {
    let repo_name = input.repo_name.trim().to_string();
    if repo_name.is_empty() {
        return Err("Could not determine which project repo to remove.".to_string());
    }

    let Some(repo_path) = find_project_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&repo_name),
    )?
    else {
        return Ok(());
    };
    if !repo_path.exists() {
        return Ok(());
    }

    fs::remove_dir_all(&repo_path).map_err(|error| {
        format!(
            "Could not remove the local project repo '{}': {error}",
            repo_path.display()
        )
    })
}

pub(super) fn update_gtms_chapter_language_selection_sync(
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

pub(super) fn update_gtms_chapter_glossary_links_sync(
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

pub(super) fn update_gtms_editor_row_lifecycle_sync(
    app: &AppHandle,
    input: UpdateEditorRowLifecycleInput,
    next_state: &str,
) -> Result<UpdateEditorRowLifecycleResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let row_object = row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
    let lifecycle_value = row_object
        .entry("lifecycle".to_string())
        .or_insert_with(|| json!({ "state": "active" }));
    let lifecycle_object = lifecycle_value
        .as_object_mut()
        .ok_or_else(|| "The row lifecycle is not a JSON object.".to_string())?;
    let current_state = lifecycle_object
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("active");

    if current_state == next_state {
        return Ok(UpdateEditorRowLifecycleResponse {
            row_id: input.row_id,
            lifecycle_state: next_state.to_string(),
            source_word_counts: load_source_word_counts(&chapter_path.join("rows"), &languages)?,
            chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"])
                .ok(),
        });
    }

    lifecycle_object.insert("state".to_string(), Value::String(next_state.to_string()));
    let updated_row_file: StoredRowFile =
        serde_json::from_value(row_value.clone()).map_err(|error| {
            format!(
                "Could not decode updated row '{}': {error}",
                row_json_path.display()
            )
        })?;
    let existing_source_word_counts =
        load_source_word_counts(&chapter_path.join("rows"), &languages)?;
    let source_word_counts = apply_source_word_count_delta(
        &existing_source_word_counts,
        &original_row_file,
        &updated_row_file,
        &languages,
    );
    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    write_text_file(&row_json_path, &updated_row_text)?;

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let commit_message = if next_state == "deleted" {
        format!("Delete row {}", input.row_id)
    } else {
        format!("Restore row {}", input.row_id)
    };
    git_output(&repo_path, &["add", &relative_row_json])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &commit_message,
        &[&relative_row_json],
        CommitMetadata {
            operation: Some(if next_state == "deleted" {
                "delete"
            } else {
                "restore"
            }),
            status_note: None,
            ai_model: None,
        },
    )?;

    Ok(UpdateEditorRowLifecycleResponse {
        row_id: input.row_id,
        lifecycle_state: next_state.to_string(),
        source_word_counts,
        chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"]).ok(),
    })
}

pub(super) fn permanently_delete_gtms_editor_row_sync(
    app: &AppHandle,
    input: UpdateEditorRowLifecycleInput,
) -> Result<UpdateEditorRowLifecycleResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    let row_file: StoredRowFile = read_json_file(&row_json_path, "row file")?;
    if row_file.lifecycle.state != "deleted" {
        return Err("Only soft-deleted rows can be permanently deleted.".to_string());
    }

    let existing_source_word_counts =
        load_source_word_counts(&chapter_path.join("rows"), &languages)?;
    let source_word_counts = apply_source_word_count_delta(
        &existing_source_word_counts,
        &row_file,
        &empty_deleted_row_stub(&row_file),
        &languages,
    );
    let uploaded_image_paths = row_uploaded_image_relative_paths(&row_file);
    fs::remove_file(&row_json_path).map_err(|error| {
        format!(
            "Could not remove the deleted row from disk at '{}': {error}",
            row_json_path.display()
        )
    })?;
    for relative_path in &uploaded_image_paths {
        let absolute_path = repo_path.join(relative_path);
        let _ = fs::remove_file(&absolute_path);
        git_output(
            &repo_path,
            &["rm", "--cached", "--ignore-unmatch", relative_path],
        )?;
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    git_output(
        &repo_path,
        &["rm", "--cached", "--ignore-unmatch", &relative_row_json],
    )?;
    let mut commit_paths = vec![relative_row_json.clone()];
    commit_paths.extend(uploaded_image_paths);
    let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!("Delete row {} permanently", input.row_id),
        &commit_path_refs,
        CommitMetadata {
            operation: Some("permanent-delete"),
            status_note: None,
            ai_model: None,
        },
    )?;

    Ok(UpdateEditorRowLifecycleResponse {
        row_id: input.row_id,
        lifecycle_state: "deleted".to_string(),
        source_word_counts,
        chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"]).ok(),
    })
}

pub(super) fn update_gtms_editor_row_fields_sync(
    app: &AppHandle,
    input: UpdateEditorRowFieldsInput,
) -> Result<SaveEditorRowWithConcurrencyResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let source_word_counts = load_source_word_counts(&chapter_path.join("rows"), &languages)?;
    if !row_json_path.exists() {
        return Ok(SaveEditorRowWithConcurrencyResponse {
            row_id: input.row_id,
            status: "deleted".to_string(),
            row: None,
            source_word_counts,
            base_fields: input.base_fields,
            base_footnotes: input.base_footnotes,
            conflict_remote_version: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorRowWithConcurrencyResponse {
            row_id: input.row_id,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            source_word_counts,
            base_fields: input.base_fields,
            base_footnotes: input.base_footnotes,
            conflict_remote_version: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    if row_plain_text_map(&original_row_file) != input.base_fields
        || row_footnote_map(&original_row_file) != input.base_footnotes
    {
        return Ok(SaveEditorRowWithConcurrencyResponse {
            row_id: input.row_id,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            source_word_counts,
            base_fields: input.base_fields,
            base_footnotes: input.base_footnotes,
            conflict_remote_version: load_latest_row_version_metadata(
                &repo_path,
                &relative_row_json,
            )?,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_plain_text_updates(&mut row_value, &input.fields)?;
    apply_editor_footnote_updates(&mut row_value, &input.footnotes)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let mut next_source_word_counts = source_word_counts.clone();
    let mut next_row = original_row_file.clone();
    if updated_row_text != original_row_text {
        let updated_row_file: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;
        next_source_word_counts = apply_source_word_count_delta(
            &source_word_counts,
            &original_row_file,
            &updated_row_file,
            &languages,
        );
        write_text_file(&row_json_path, &updated_row_text)?;
        git_output(&repo_path, &["add", &relative_row_json])?;
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {}", input.row_id),
            &[&relative_row_json],
            CommitMetadata {
                operation: Some(if input.operation.trim().is_empty() {
                    "editor-update"
                } else {
                    input.operation.trim()
                }),
                status_note: None,
                ai_model: Some(input.ai_model.trim()).filter(|value| !value.is_empty()),
            },
        )?;
        next_row = updated_row_file;
    }

    Ok(SaveEditorRowWithConcurrencyResponse {
        row_id: input.row_id,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file(&repo_path, next_row)?),
        source_word_counts: next_source_word_counts,
        base_fields: input.base_fields,
        base_footnotes: input.base_footnotes,
        conflict_remote_version: None,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn update_gtms_editor_row_fields_batch_sync(
    app: &AppHandle,
    input: UpdateEditorRowFieldsBatchInput,
) -> Result<UpdateEditorRowFieldsBatchResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let mut source_word_counts = load_source_word_counts(&chapter_path.join("rows"), &languages)?;
    let mut rows_by_id = BTreeMap::new();
    for row in input.rows {
        let row_id = row.row_id.trim().to_string();
        if row_id.is_empty() {
            continue;
        }

        rows_by_id.insert(
            row_id,
            UpdateEditorRowFieldsBatchRowInput {
                row_id: row.row_id,
                fields: row.fields,
                footnotes: row.footnotes,
            },
        );
    }

    let mut changed_row_ids = Vec::new();
    let mut relative_row_paths = Vec::new();

    for (row_id, batch_row) in rows_by_id {
        let fields = batch_row.fields;
        let footnotes = batch_row.footnotes;
        let row_json_path = chapter_path.join("rows").join(format!("{row_id}.json"));
        let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
            format!(
                "Could not read row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let original_row_file: StoredRowFile =
            serde_json::from_str(&original_row_text).map_err(|error| {
                format!(
                    "Could not parse row file '{}': {error}",
                    row_json_path.display()
                )
            })?;
        let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        apply_editor_plain_text_updates(&mut row_value, &fields)?;
        apply_editor_footnote_updates(&mut row_value, &footnotes)?;

        let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
            format!(
                "Could not serialize row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let updated_row_text = format!("{updated_row_json}\n");
        if updated_row_text == original_row_text {
            continue;
        }

        let updated_row_file: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;
        source_word_counts = apply_source_word_count_delta(
            &source_word_counts,
            &original_row_file,
            &updated_row_file,
            &languages,
        );
        write_text_file(&row_json_path, &updated_row_text)?;
        relative_row_paths.push(repo_relative_path(&repo_path, &row_json_path)?);
        changed_row_ids.push(row_id);
    }

    if !changed_row_ids.is_empty() {
        let mut add_args = vec!["add"];
        for path in &relative_row_paths {
            add_args.push(path.as_str());
        }
        git_output(&repo_path, &add_args)?;

        let commit_paths: Vec<&str> = relative_row_paths.iter().map(String::as_str).collect();
        let commit_message = input.commit_message.trim();
        let operation = input.operation.trim();
        let commit_output = git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            if commit_message.is_empty() {
                "Update editor rows"
            } else {
                commit_message
            },
            &commit_paths,
            CommitMetadata {
                operation: if operation.is_empty() {
                    None
                } else {
                    Some(operation)
                },
                status_note: None,
                ai_model: None,
            },
        )?;
        let commit_sha = if commit_output.is_empty() {
            None
        } else {
            Some(git_output(&repo_path, &["rev-parse", "--short", "HEAD"])?)
        };

        return Ok(UpdateEditorRowFieldsBatchResponse {
            row_ids: changed_row_ids,
            source_word_counts,
            commit_sha,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    Ok(UpdateEditorRowFieldsBatchResponse {
        row_ids: changed_row_ids,
        source_word_counts,
        commit_sha: None,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn load_gtms_editor_field_history_sync(
    app: &AppHandle,
    input: LoadEditorFieldHistoryInput,
) -> Result<LoadEditorFieldHistoryResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Err(format!(
            "Could not find row '{}' in the local project repo.",
            input.row_id
        ));
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let commits = load_git_history_for_path(&repo_path, &relative_row_json)?;
    let historical_field_values = load_historical_row_field_values_batch(
        &repo_path,
        &relative_row_json,
        &commits,
        &input.language_code,
    )?;
    let entries = build_editor_field_history_entries(&repo_path, commits, historical_field_values);

    Ok(LoadEditorFieldHistoryResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        entries,
    })
}

pub(super) fn restore_gtms_editor_field_from_history_sync(
    app: &AppHandle,
    input: RestoreEditorFieldHistoryInput,
) -> Result<RestoreEditorFieldHistoryResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Err(format!(
            "Could not find row '{}' in the local project repo.",
            input.row_id
        ));
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let historical_field_value = load_historical_row_field_value(
        &repo_path,
        &relative_row_json,
        &input.commit_sha,
        &input.language_code,
    )?
    .ok_or_else(|| {
        format!(
            "The selected history entry does not contain the '{}' field.",
            input.language_code
        )
    })?;
    let historical_plain_text = historical_field_value.field_value.plain_text.clone();
    let historical_footnote =
        normalize_editor_footnote_value(&historical_field_value.field_value.footnote);
    let historical_image =
        normalize_editor_field_image_value(&historical_field_value.field_value.image);
    let historical_text_style = historical_field_value.text_style.clone();

    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let _ = apply_editor_text_style_update(&mut row_value, &historical_text_style)?;
    let row_object = row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())?;
    let fields_value = row_object
        .entry("fields".to_string())
        .or_insert_with(|| json!({}));
    let fields_object = fields_value
        .as_object_mut()
        .ok_or_else(|| "The row fields are not a JSON object.".to_string())?;
    let field_value = fields_object
        .entry(input.language_code.clone())
        .or_insert_with(|| json!({}));
    let field_object = field_value
        .as_object_mut()
        .ok_or_else(|| "The row field is not a JSON object.".to_string())?;

    ensure_editor_field_object_defaults(field_object)?;
    field_object.insert("value_kind".to_string(), Value::String("text".to_string()));
    field_object.insert(
        "plain_text".to_string(),
        Value::String(historical_plain_text.clone()),
    );
    field_object.insert(
        "footnote".to_string(),
        Value::String(historical_footnote.clone()),
    );
    field_object.insert(
        "image".to_string(),
        serde_json::to_value(historical_image.clone())
            .map_err(|error| format!("Could not serialize the restored image metadata: {error}"))?,
    );
    let field_changed = original_row_file
        .fields
        .get(&input.language_code)
        .map(|field| {
            field.plain_text != historical_plain_text
                || field.editor_flags.reviewed
                    != historical_field_value.field_value.editor_flags.reviewed
                || field.editor_flags.please_check
                    != historical_field_value.field_value.editor_flags.please_check
        })
        .unwrap_or(true);
    if field_changed {
        field_object.remove("html_preview");
    }
    set_editor_field_flags(
        field_object,
        &historical_field_value.field_value.editor_flags,
    );

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let mut source_word_counts = load_source_word_counts(&chapter_path.join("rows"), &languages)?;
    let historical_uploaded_path = historical_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    let current_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    let mut added_asset_paths = Vec::new();
    let mut removed_asset_paths = Vec::new();
    let mut rollback_snapshots = Vec::new();
    let mut historical_asset_update: Option<(String, Vec<u8>)> = None;

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;

    if let Some(relative_path) = historical_uploaded_path.as_deref() {
        let historical_bytes =
            load_historical_blob_bytes(&repo_path, &input.commit_sha, relative_path)?;
        let absolute_path = repo_path.join(relative_path);
        if !file_bytes_equal(&absolute_path, &historical_bytes) {
            push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
            historical_asset_update = Some((relative_path.to_string(), historical_bytes));
            added_asset_paths.push(relative_path.to_string());
        }
    }

    let removed_uploaded_path = current_uploaded_path
        .as_deref()
        .filter(|path| Some(*path) != historical_uploaded_path.as_deref())
        .map(str::to_string);
    if let Some(relative_path) = removed_uploaded_path.as_deref() {
        push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
        removed_asset_paths.push(relative_path.to_string());
    }

    if updated_row_text != original_row_text
        || !added_asset_paths.is_empty()
        || !removed_asset_paths.is_empty()
    {
        let updated_row_file: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode restored row '{}': {error}",
                    row_json_path.display()
                )
            })?;
        source_word_counts = apply_source_word_count_delta(
            &source_word_counts,
            &original_row_file,
            &updated_row_file,
            &languages,
        );
        let short_commit = short_commit_sha(&input.commit_sha);
        with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
            if let Some((relative_path, historical_bytes)) = historical_asset_update.as_ref() {
                let absolute_path = repo_path.join(relative_path);
                write_binary_file(&absolute_path, historical_bytes)?;
            }

            if let Some(relative_path) = removed_uploaded_path.as_deref() {
                let absolute_path = repo_path.join(relative_path);
                let _ = fs::remove_file(&absolute_path);
                git_output(
                    &repo_path,
                    &["rm", "--cached", "--ignore-unmatch", relative_path],
                )?;
            }

            if updated_row_text != original_row_text {
                write_text_file(&row_json_path, &updated_row_text)?;
            }

            let mut add_args = vec!["add"];
            if updated_row_text != original_row_text {
                add_args.push(relative_row_json.as_str());
            }
            for path in &added_asset_paths {
                add_args.push(path.as_str());
            }
            if add_args.len() > 1 {
                git_output(&repo_path, &add_args)?;
            }
            let mut commit_paths = Vec::new();
            if updated_row_text != original_row_text {
                commit_paths.push(relative_row_json.clone());
            }
            commit_paths.extend(added_asset_paths.clone());
            commit_paths.extend(removed_asset_paths.clone());
            let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
            git_commit_as_signed_in_user_with_metadata(
                app,
                &repo_path,
                &format!(
                    "Restore row {} {} from {}",
                    input.row_id, input.language_code, short_commit
                ),
                &commit_path_refs,
                CommitMetadata {
                    operation: Some("restore"),
                    status_note: None,
                    ai_model: None,
                },
            )?;
            Ok(())
        })?;
    }

    Ok(RestoreEditorFieldHistoryResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        plain_text: historical_plain_text,
        footnote: historical_footnote,
        image: editor_field_image_from_stored(
            &repo_path,
            &historical_field_value.field_value.image,
        ),
        text_style: historical_text_style,
        reviewed: historical_field_value.field_value.editor_flags.reviewed,
        please_check: historical_field_value.field_value.editor_flags.please_check,
        source_word_counts,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn reverse_gtms_editor_batch_replace_commit_sync(
    app: &AppHandle,
    input: ReverseEditorBatchReplaceCommitInput,
) -> Result<ReverseEditorBatchReplaceCommitResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    let selected_operation = load_git_commit_operation_type(&repo_path, &input.commit_sha)?;
    if selected_operation.as_deref() != Some("editor-replace") {
        return Err("Only batch replace commits can be undone from history.".to_string());
    }

    let parent_commit_sha = git_output(
        &repo_path,
        &["rev-parse", &format!("{}^", input.commit_sha)],
    )
    .map_err(|_| {
        "The selected batch replace commit does not have a previous version to restore.".to_string()
    })?;
    let relative_chapter_path = repo_relative_path(&repo_path, &chapter_path)?;
    let relative_row_paths =
        load_commit_row_paths_for_chapter(&repo_path, &input.commit_sha, &relative_chapter_path)?;
    if relative_row_paths.is_empty() {
        return Err(
            "The selected batch replace commit does not contain any rows in this file.".to_string(),
        );
    }

    let mut updated_rows = Vec::new();
    let mut skipped_row_ids = Vec::new();
    let mut relative_paths_to_add = Vec::new();

    for relative_row_path in relative_row_paths {
        let row_id = row_id_from_relative_row_path(&relative_row_path).ok_or_else(|| {
            format!(
                "Could not determine the row id for '{}'.",
                relative_row_path
            )
        })?;
        if commit_has_later_changes_for_path(&repo_path, &input.commit_sha, &relative_row_path)? {
            skipped_row_ids.push(row_id);
            continue;
        }

        let row_json_path = repo_path.join(&relative_row_path);
        if !row_json_path.exists() {
            skipped_row_ids.push(row_id);
            continue;
        }

        let restored_row_text = git_output(
            &repo_path,
            &["show", &format!("{parent_commit_sha}:{relative_row_path}")],
        )
        .map_err(|_| format!("Could not load the previous version of row '{}'.", row_id))?;
        let normalized_restored_row_text = ensure_text_has_trailing_newline(&restored_row_text);
        let current_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
            format!(
                "Could not read row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        if normalized_restored_row_text == current_row_text {
            continue;
        }

        let restored_row_file: StoredRowFile = serde_json::from_str(&normalized_restored_row_text)
            .map_err(|error| {
                format!(
                    "Could not parse the previous version of row '{}': {error}",
                    row_id
                )
            })?;
        write_text_file(&row_json_path, &normalized_restored_row_text)?;
        relative_paths_to_add.push(relative_row_path);
        updated_rows.push(UpdateEditorRowFieldsBatchRowInput {
            row_id,
            fields: row_plain_text_fields(&restored_row_file),
            footnotes: row_footnote_map(&restored_row_file),
        });
    }

    if updated_rows.is_empty() {
        let source_word_counts = load_source_word_counts(&chapter_path.join("rows"), &languages)?;
        return Ok(ReverseEditorBatchReplaceCommitResponse {
            updated_rows,
            skipped_row_ids,
            source_word_counts,
            commit_sha: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);

    let mut add_args = vec!["add"];
    for path in &relative_paths_to_add {
        add_args.push(path.as_str());
    }
    git_output(&repo_path, &add_args)?;

    let commit_paths: Vec<&str> = relative_paths_to_add.iter().map(String::as_str).collect();
    let commit_output = git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!(
            "Undo batch replace in {} {}",
            updated_rows.len(),
            if updated_rows.len() == 1 {
                "row"
            } else {
                "rows"
            }
        ),
        &commit_paths,
        CommitMetadata {
            operation: Some("editor-replace"),
            status_note: None,
            ai_model: None,
        },
    )?;
    let commit_sha = if commit_output.is_empty() {
        None
    } else {
        Some(git_output(&repo_path, &["rev-parse", "--short", "HEAD"])?)
    };

    Ok(ReverseEditorBatchReplaceCommitResponse {
        updated_rows,
        skipped_row_ids,
        source_word_counts,
        commit_sha,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

fn compare_stored_rows(left: &StoredRowFile, right: &StoredRowFile) -> Ordering {
    left.structure
        .order_key
        .cmp(&right.structure.order_key)
        .then_with(|| left.row_id.cmp(&right.row_id))
}

fn current_repo_head_sha(repo_path: &Path) -> Option<String> {
    git_output(repo_path, &["rev-parse", "--verify", "HEAD"]).ok()
}

fn load_editor_rows(rows_path: &Path) -> Result<Vec<StoredRowFile>, String> {
    if !rows_path.exists() {
        return Ok(Vec::new());
    }

    let mut rows = Vec::new();
    for entry in fs::read_dir(rows_path).map_err(|error| {
        format!(
            "Could not read rows folder '{}': {error}",
            rows_path.display()
        )
    })? {
        let entry = entry.map_err(|error| format!("Could not read a row file entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        rows.push(read_json_file(&path, "row file")?);
    }

    rows.sort_by(compare_stored_rows);
    Ok(rows)
}

fn load_project_chapter_summaries(repo_path: &Path) -> Result<Vec<ProjectChapterSummary>, String> {
    let chapters_root = repo_path.join("chapters");
    if !chapters_root.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&chapters_root).map_err(|error| {
        format!(
            "Could not read chapters folder '{}': {error}",
            chapters_root.display()
        )
    })?;

    let mut chapters = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not read a chapter folder entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let chapter_json_path = path.join("chapter.json");
        if !chapter_json_path.exists() {
            continue;
        }

        let chapter_file: StoredChapterFile = read_json_file(&chapter_json_path, "chapter.json")?;
        let languages = sanitize_chapter_languages(&chapter_file.languages);
        let rows = load_editor_rows(&path.join("rows"))?;
        let source_word_counts = build_source_word_counts_from_stored_rows(&rows, &languages);
        let selected_source_language_code =
            preferred_source_language_code(&chapter_file, &languages);
        let selected_target_language_code = preferred_target_language_code(
            &chapter_file,
            &languages,
            selected_source_language_code.as_deref(),
        );
        let linked_glossary = linked_chapter_glossary(&chapter_file);

        chapters.push(ProjectChapterSummary {
            id: chapter_file.chapter_id,
            name: chapter_file.title,
            status: if chapter_file.lifecycle.state == "deleted" {
                "deleted".to_string()
            } else {
                "active".to_string()
            },
            languages,
            source_word_counts,
            selected_source_language_code,
            selected_target_language_code,
            linked_glossary,
        });
    }

    Ok(chapters)
}

pub(super) fn update_gtms_editor_row_field_flag_sync(
    app: &AppHandle,
    input: UpdateEditorRowFieldFlagInput,
) -> Result<UpdateEditorRowFieldFlagResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let (reviewed, please_check, changed) = apply_editor_field_flag_update(
        &mut row_value,
        &input.language_code,
        &input.flag,
        input.enabled,
    )?;

    if changed {
        let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
            format!(
                "Could not serialize row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let updated_row_text = format!("{updated_row_json}\n");
        write_text_file(&row_json_path, &updated_row_text)?;

        let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
        let status_note = status_note_for_field_flag(
            normalize_editor_field_flag_key(&input.flag)?,
            input.enabled,
        );
        git_output(&repo_path, &["add", &relative_row_json])?;
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!(
                "Update row {} {} markers",
                input.row_id, input.language_code
            ),
            &[&relative_row_json],
            CommitMetadata {
                operation: Some("field-status"),
                status_note: Some(status_note),
                ai_model: None,
            },
        )?;
    }

    Ok(UpdateEditorRowFieldFlagResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        reviewed,
        please_check,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn update_gtms_editor_row_text_style_sync(
    app: &AppHandle,
    input: UpdateEditorRowTextStyleInput,
) -> Result<UpdateEditorRowTextStyleResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let (text_style, changed) = apply_editor_text_style_update(&mut row_value, &input.text_style)?;

    if changed {
        let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
            format!(
                "Could not serialize row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let updated_row_text = format!("{updated_row_json}\n");
        write_text_file(&row_json_path, &updated_row_text)?;

        let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
        git_output(&repo_path, &["add", &relative_row_json])?;
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {} text style", input.row_id),
            &[&relative_row_json],
            CommitMetadata {
                operation: Some("text-style"),
                status_note: None,
                ai_model: None,
            },
        )?;
    }

    Ok(UpdateEditorRowTextStyleResponse {
        row_id: input.row_id,
        text_style,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn save_gtms_editor_language_image_url_sync(
    app: &AppHandle,
    input: SaveEditorLanguageImageUrlInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let next_image = Some(StoredFieldImage {
        kind: "url".to_string(),
        url: Some(validate_editor_image_url(&input.url)?),
        path: None,
    });
    let replaced_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, next_image)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let row_changed = updated_row_text != original_row_text;
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    if let Some(relative_path) = replaced_uploaded_path.as_deref() {
        push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        let mut next_row = original_row_file.clone();
        let mut paths_to_commit = vec![relative_row_json.clone()];

        if row_changed {
            write_text_file(&row_json_path, &updated_row_text)?;
            next_row = serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;
        }

        if let Some(relative_path) = replaced_uploaded_path.as_deref() {
            let absolute_path = repo_path.join(relative_path);
            let _ = fs::remove_file(&absolute_path);
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
            paths_to_commit.push(relative_path.to_string());
        }

        if row_changed {
            git_output(&repo_path, &["add", &relative_row_json])?;
        }

        if row_changed || paths_to_commit.len() > 1 {
            let commit_paths: Vec<&str> = paths_to_commit.iter().map(String::as_str).collect();
            git_commit_as_signed_in_user_with_metadata(
                app,
                &repo_path,
                &format!("Update row {} {} image", input.row_id, input.language_code),
                &commit_paths,
                CommitMetadata {
                    operation: Some("editor-update"),
                    status_note: None,
                    ai_model: None,
                },
            )?;
        }

        Ok(next_row)
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file(&repo_path, next_row)?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn upload_gtms_editor_language_image_sync(
    app: &AppHandle,
    input: UploadEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let bytes = decode_uploaded_image_bytes(&input.data_base64)?;
    let extension = validated_uploaded_image_extension(&input.filename, &bytes)?;
    let relative_image_path = relative_uploaded_image_path(
        &input.chapter_id,
        &input.row_id,
        &input.language_code,
        extension,
    );
    let absolute_image_path = repo_path.join(&relative_image_path);
    let next_image = Some(StoredFieldImage {
        kind: "upload".to_string(),
        url: None,
        path: Some(relative_image_path.clone()),
    });
    let replaced_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone())
        .filter(|path| path != &relative_image_path);
    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, next_image)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_image_path)?;
    if let Some(relative_path) = replaced_uploaded_path.as_deref() {
        push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        write_binary_file(&absolute_image_path, &bytes)?;
        write_text_file(&row_json_path, &updated_row_text)?;
        let next_row: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;

        if let Some(relative_path) = replaced_uploaded_path.as_deref() {
            let absolute_path = repo_path.join(relative_path);
            let _ = fs::remove_file(&absolute_path);
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
        }

        git_output(
            &repo_path,
            &["add", &relative_row_json, &relative_image_path],
        )?;
        let mut commit_paths = vec![relative_row_json.clone(), relative_image_path.clone()];
        if let Some(relative_path) = replaced_uploaded_path.as_deref() {
            commit_paths.push(relative_path.to_string());
        }
        let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {} {} image", input.row_id, input.language_code),
            &commit_path_refs,
            CommitMetadata {
                operation: Some("editor-update"),
                status_note: None,
                ai_model: None,
            },
        )?;

        Ok(next_row)
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file(&repo_path, next_row)?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn remove_gtms_editor_language_image_sync(
    app: &AppHandle,
    input: RemoveEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let row_json_path = chapter_path
        .join("rows")
        .join(format!("{}.json", input.row_id));
    if !row_json_path.exists() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: None,
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let relative_row_json = repo_relative_path(&repo_path, &row_json_path)?;
    let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
        format!(
            "Could not read row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let original_row_file: StoredRowFile =
        serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
    if original_row_file.lifecycle.state == "deleted" {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "deleted".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let current_image = row_language_stored_image(&original_row_file, &input.language_code);
    let base_image = normalize_editor_field_image_input(input.base_image.as_ref());
    if current_image != base_image {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "conflict".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let removed_uploaded_path = current_image
        .as_ref()
        .filter(|image| image.kind == "upload")
        .and_then(|image| image.path.clone());
    if current_image.is_none() {
        return Ok(SaveEditorLanguageImageResponse {
            row_id: input.row_id,
            language_code: input.language_code,
            status: "saved".to_string(),
            row: Some(editor_row_from_stored_row_file(
                &repo_path,
                original_row_file,
            )?),
            chapter_base_commit_sha: current_repo_head_sha(&repo_path),
        });
    }

    let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
        format!(
            "Could not parse row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    apply_editor_field_image_update(&mut row_value, &input.language_code, None)?;

    let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
        format!(
            "Could not serialize row file '{}': {error}",
            row_json_path.display()
        )
    })?;
    let updated_row_text = format!("{updated_row_json}\n");
    let mut rollback_snapshots = Vec::new();

    push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, &relative_row_json)?;
    if let Some(relative_path) = removed_uploaded_path.as_deref() {
        push_repo_file_snapshot(&mut rollback_snapshots, &repo_path, relative_path)?;
    }

    let next_row = with_repo_file_rollback(&repo_path, &rollback_snapshots, || {
        write_text_file(&row_json_path, &updated_row_text)?;
        let next_row: StoredRowFile =
            serde_json::from_value(row_value.clone()).map_err(|error| {
                format!(
                    "Could not decode updated row '{}': {error}",
                    row_json_path.display()
                )
            })?;

        if let Some(relative_path) = removed_uploaded_path.as_deref() {
            let absolute_path = repo_path.join(relative_path);
            let _ = fs::remove_file(&absolute_path);
            git_output(
                &repo_path,
                &["rm", "--cached", "--ignore-unmatch", relative_path],
            )?;
        }

        git_output(&repo_path, &["add", &relative_row_json])?;
        let mut commit_paths = vec![relative_row_json.clone()];
        if let Some(relative_path) = removed_uploaded_path.as_deref() {
            commit_paths.push(relative_path.to_string());
        }
        let commit_path_refs: Vec<&str> = commit_paths.iter().map(String::as_str).collect();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Update row {} {} image", input.row_id, input.language_code),
            &commit_path_refs,
            CommitMetadata {
                operation: Some("editor-update"),
                status_note: None,
                ai_model: None,
            },
        )?;

        Ok(next_row)
    })?;

    Ok(SaveEditorLanguageImageResponse {
        row_id: input.row_id,
        language_code: input.language_code,
        status: "saved".to_string(),
        row: Some(editor_row_from_stored_row_file(&repo_path, next_row)?),
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

pub(super) fn clear_gtms_editor_reviewed_markers_sync(
    app: &AppHandle,
    input: ClearEditorReviewedMarkersInput,
) -> Result<ClearEditorReviewedMarkersResponse, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;

    let chapter_path = find_chapter_path_by_id(&repo_path.join("chapters"), &input.chapter_id)?;
    let rows_path = chapter_path.join("rows");
    let mut changed_row_ids = Vec::new();
    let mut relative_row_paths = Vec::new();

    for stored_row in load_editor_rows(&rows_path)? {
        let row_id = stored_row.row_id.trim().to_string();
        if row_id.is_empty() {
            continue;
        }

        let row_json_path = rows_path.join(format!("{row_id}.json"));
        let original_row_text = fs::read_to_string(&row_json_path).map_err(|error| {
            format!(
                "Could not read row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let mut row_value: Value = serde_json::from_str(&original_row_text).map_err(|error| {
            format!(
                "Could not parse row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let (_, _, changed) = apply_editor_field_flag_update(
            &mut row_value,
            &input.language_code,
            "reviewed",
            false,
        )?;
        if !changed {
            continue;
        }

        let updated_row_json = serde_json::to_string_pretty(&row_value).map_err(|error| {
            format!(
                "Could not serialize row file '{}': {error}",
                row_json_path.display()
            )
        })?;
        let updated_row_text = format!("{updated_row_json}\n");
        write_text_file(&row_json_path, &updated_row_text)?;
        relative_row_paths.push(repo_relative_path(&repo_path, &row_json_path)?);
        changed_row_ids.push(row_id);
    }

    if !changed_row_ids.is_empty() {
        let mut add_args = vec!["add"];
        for path in &relative_row_paths {
            add_args.push(path.as_str());
        }
        git_output(&repo_path, &add_args)?;

        let commit_paths: Vec<&str> = relative_row_paths.iter().map(String::as_str).collect();
        git_commit_as_signed_in_user_with_metadata(
            app,
            &repo_path,
            &format!("Mark all {} translations unreviewed", input.language_code),
            &commit_paths,
            CommitMetadata {
                operation: Some("field-status"),
                status_note: Some("Marked all unreviewed"),
                ai_model: None,
            },
        )?;
    }

    Ok(ClearEditorReviewedMarkersResponse {
        row_ids: changed_row_ids,
        language_code: input.language_code,
        chapter_base_commit_sha: current_repo_head_sha(&repo_path),
    })
}

fn load_git_history_for_path(
    repo_path: &Path,
    relative_path: &str,
) -> Result<Vec<GitCommitMetadata>, String> {
    let output = git_output(
        repo_path,
        &[
            "log",
            "--format=%H%x1f%an%x1f%aI%x1f%B%x1e",
            "--",
            relative_path,
        ],
    )?;
    if output.is_empty() {
        return Ok(Vec::new());
    }

    output
        .split('\u{1e}')
        .filter(|record| !record.trim().is_empty())
        .map(|record| {
            let mut parts = record.split('\u{1f}');
            let commit_sha = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("Could not parse git history for '{}'.", relative_path))?;
            let author_name = parts.next().unwrap_or_default().trim();
            let committed_at = parts.next().unwrap_or_default().trim();
            let full_message = parts.next().unwrap_or_default();
            let (message, operation_type, status_note, ai_model) =
                parse_git_commit_message(full_message);

            Ok(GitCommitMetadata {
                commit_sha: commit_sha.to_string(),
                author_name: author_name.to_string(),
                committed_at: committed_at.to_string(),
                message,
                operation_type,
                status_note,
                ai_model,
            })
        })
        .collect()
}

fn parse_git_commit_message(
    message: &str,
) -> (String, Option<String>, Option<String>, Option<String>) {
    let trimmed_message = message.trim();
    if trimmed_message.is_empty() {
        return (String::new(), None, None, None);
    }

    let subject = trimmed_message
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_string();
    let operation_type = trimmed_message
        .lines()
        .find_map(parse_gtms_operation_trailer)
        .or_else(|| infer_commit_operation_from_subject(&subject));
    let status_note = trimmed_message
        .lines()
        .find_map(parse_gtms_status_note_trailer);
    let ai_model = trimmed_message
        .lines()
        .find_map(parse_gtms_ai_model_trailer);
    (subject, operation_type, status_note, ai_model)
}

fn parse_gtms_operation_trailer(line: &str) -> Option<String> {
    let (name, value) = line.split_once(':')?;
    if !name.trim().eq_ignore_ascii_case("GTMS-Operation") {
        return None;
    }

    let operation = value.trim();
    if operation.is_empty() {
        None
    } else {
        Some(operation.to_string())
    }
}

fn parse_gtms_status_note_trailer(line: &str) -> Option<String> {
    let (name, value) = line.split_once(':')?;
    if !name.trim().eq_ignore_ascii_case("GTMS-Status-Note") {
        return None;
    }

    let note = value.trim();
    if note.is_empty() {
        None
    } else {
        Some(note.to_string())
    }
}

fn parse_gtms_ai_model_trailer(line: &str) -> Option<String> {
    let (name, value) = line.split_once(':')?;
    if !name.trim().eq_ignore_ascii_case("GTMS-AI-Model") {
        return None;
    }

    let ai_model = value.trim();
    if ai_model.is_empty() {
        None
    } else {
        Some(ai_model.to_string())
    }
}

fn infer_commit_operation_from_subject(subject: &str) -> Option<String> {
    let trimmed_subject = subject.trim();
    if trimmed_subject.starts_with("Import ") {
        Some("import".to_string())
    } else {
        None
    }
}

fn status_note_for_field_flag(flag: &str, enabled: bool) -> &'static str {
    match (flag, enabled) {
        ("reviewed", true) => "Marked reviewed",
        ("reviewed", false) => "Marked unreviewed",
        ("please_check", true) => "Marked \"Please check\"",
        ("please_check", false) => "Removed \"Please check\"",
        _ => "Updated markers",
    }
}

fn row_plain_text_fields(row: &StoredRowFile) -> BTreeMap<String, String> {
    row.fields
        .iter()
        .map(|(code, field)| (code.clone(), field.plain_text.clone()))
        .collect()
}

fn row_language_stored_image(row: &StoredRowFile, language_code: &str) -> Option<StoredFieldImage> {
    row.fields
        .get(language_code)
        .and_then(|field| normalize_editor_field_image_value(&field.image))
}

fn row_uploaded_image_relative_paths(row: &StoredRowFile) -> Vec<String> {
    row.fields
        .values()
        .filter_map(|field| normalize_editor_field_image_value(&field.image))
        .filter_map(|image| {
            if image.kind == "upload" {
                image.path
            } else {
                None
            }
        })
        .collect()
}

fn normalize_uploaded_image_extension(extension: &str) -> Option<&'static str> {
    match extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some("jpg"),
        "png" | "apng" => Some("png"),
        "gif" => Some("gif"),
        "svg" => Some("svg"),
        "webp" => Some("webp"),
        "avif" => Some("avif"),
        "bmp" => Some("bmp"),
        "ico" => Some("ico"),
        _ => None,
    }
}

fn svg_document_root_is_svg(bytes: &[u8]) -> bool {
    let mut reader = XmlReader::from_reader(bytes);
    reader.trim_text(true);
    let mut buffer = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(XmlEvent::Start(event)) | Ok(XmlEvent::Empty(event)) => {
                return event.name().as_ref() == b"svg";
            }
            Ok(XmlEvent::Decl(_))
            | Ok(XmlEvent::DocType(_))
            | Ok(XmlEvent::Comment(_))
            | Ok(XmlEvent::PI(_))
            | Ok(XmlEvent::Text(_))
            | Ok(XmlEvent::CData(_)) => {
                buffer.clear();
                continue;
            }
            Ok(XmlEvent::Eof) | Err(_) => return false,
            _ => {
                buffer.clear();
            }
        }
    }
}

fn detected_uploaded_image_extension(bytes: &[u8]) -> Option<&'static str> {
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
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        if bytes
            .windows(4)
            .any(|window| window == b"avif" || window == b"avis")
        {
            return Some("avif");
        }
    }
    if svg_document_root_is_svg(bytes) {
        return Some("svg");
    }

    None
}

fn validated_uploaded_image_extension(
    filename: &str,
    bytes: &[u8],
) -> Result<&'static str, String> {
    let detected_extension = detected_uploaded_image_extension(bytes)
        .ok_or_else(|| "The uploaded file is not a valid supported image.".to_string())?;
    let filename_extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .and_then(normalize_uploaded_image_extension);

    if let Some(filename_extension) = filename_extension {
        if filename_extension != detected_extension {
            return Err(
                "The uploaded file extension does not match its image contents.".to_string(),
            );
        }
    }

    Ok(detected_extension)
}

fn decode_uploaded_image_bytes(data_base64: &str) -> Result<Vec<u8>, String> {
    let normalized_data = data_base64.trim();
    if normalized_data.is_empty() {
        return Err("The uploaded image data is empty.".to_string());
    }

    base64::engine::general_purpose::STANDARD
        .decode(normalized_data)
        .map_err(|error| format!("Could not decode the uploaded image data: {error}"))
}

fn validate_editor_image_url(value: &str) -> Result<String, String> {
    let normalized_url = value.trim();
    if normalized_url.is_empty() {
        return Err("Enter an image URL.".to_string());
    }

    let parsed_url = url::Url::parse(normalized_url)
        .map_err(|error| format!("The image URL is invalid: {error}"))?;
    match parsed_url.scheme() {
        "http" | "https" => Ok(normalized_url.to_string()),
        _ => Err("Only http:// and https:// image URLs are supported.".to_string()),
    }
}

fn write_binary_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create '{}': {error}", parent.display()))?;
    }

    fs::write(path, bytes).map_err(|error| format!("Could not write '{}': {error}", path.display()))
}

#[derive(Clone)]
struct RepoFileSnapshot {
    relative_path: String,
    absolute_path: PathBuf,
    original_bytes: Option<Vec<u8>>,
}

fn capture_repo_file_snapshot(
    repo_path: &Path,
    relative_path: &str,
) -> Result<RepoFileSnapshot, String> {
    let absolute_path = repo_path.join(relative_path);
    let original_bytes = match fs::read(&absolute_path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Could not read '{}': {error}",
                absolute_path.display()
            ));
        }
    };

    Ok(RepoFileSnapshot {
        relative_path: relative_path.to_string(),
        absolute_path,
        original_bytes,
    })
}

fn push_repo_file_snapshot(
    snapshots: &mut Vec<RepoFileSnapshot>,
    repo_path: &Path,
    relative_path: &str,
) -> Result<(), String> {
    if snapshots
        .iter()
        .any(|snapshot| snapshot.relative_path == relative_path)
    {
        return Ok(());
    }

    snapshots.push(capture_repo_file_snapshot(repo_path, relative_path)?);
    Ok(())
}

fn restore_repo_file_snapshot_on_disk(snapshot: &RepoFileSnapshot) -> Result<(), String> {
    if let Some(original_bytes) = snapshot.original_bytes.as_deref() {
        write_binary_file(&snapshot.absolute_path, original_bytes)?;
        return Ok(());
    }

    match fs::remove_file(&snapshot.absolute_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove '{}': {error}",
            snapshot.absolute_path.display()
        )),
    }
}

fn sync_repo_file_snapshot_to_index(
    repo_path: &Path,
    snapshot: &RepoFileSnapshot,
) -> Result<(), String> {
    if snapshot.original_bytes.is_some() {
        git_output(repo_path, &["add", &snapshot.relative_path])?;
    } else {
        git_output(
            repo_path,
            &[
                "rm",
                "--cached",
                "--ignore-unmatch",
                &snapshot.relative_path,
            ],
        )?;
    }
    Ok(())
}

fn rollback_repo_file_snapshots(
    repo_path: &Path,
    snapshots: &[RepoFileSnapshot],
) -> Result<(), String> {
    let mut errors = Vec::new();

    for snapshot in snapshots.iter().rev() {
        if let Err(error) = restore_repo_file_snapshot_on_disk(snapshot) {
            errors.push(error);
            continue;
        }
        if let Err(error) = sync_repo_file_snapshot_to_index(repo_path, snapshot) {
            errors.push(error);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" "))
    }
}

fn with_repo_file_rollback<T, F>(
    repo_path: &Path,
    snapshots: &[RepoFileSnapshot],
    operation: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    match operation() {
        Ok(value) => Ok(value),
        Err(error) => match rollback_repo_file_snapshots(repo_path, snapshots) {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!("{error} Rollback failed: {rollback_error}")),
        },
    }
}

fn relative_uploaded_image_path(
    chapter_id: &str,
    row_id: &str,
    language_code: &str,
    extension: &str,
) -> String {
    format!(
        "chapters/{chapter_id}/images/row-{row_id}-{language_code}-{}.{}",
        uuid::Uuid::now_v7(),
        extension
    )
}

fn file_bytes_equal(path: &Path, bytes: &[u8]) -> bool {
    fs::read(path)
        .map(|existing| existing == bytes)
        .unwrap_or(false)
}

fn load_historical_blob_bytes(
    repo_path: &Path,
    commit_sha: &str,
    relative_path: &str,
) -> Result<Vec<u8>, String> {
    let request = format!("{commit_sha}:{relative_path}\n");
    let output = git_output_with_stdin(repo_path, &["cat-file", "--batch"], &request)?;
    let Some(header_end) = output.iter().position(|byte| *byte == b'\n') else {
        return Err(format!(
            "Could not parse the historical blob header for '{}'.",
            relative_path
        ));
    };
    let header = str::from_utf8(&output[..header_end]).map_err(|error| {
        format!(
            "Could not decode the historical blob header for '{}': {error}",
            relative_path
        )
    })?;
    if header.ends_with(" missing") {
        return Err(format!(
            "Could not find the historical file '{}' at commit '{}'.",
            relative_path, commit_sha
        ));
    }

    let mut header_parts = header.split_whitespace();
    let _object_name = header_parts.next().unwrap_or_default();
    let object_type = header_parts.next().unwrap_or_default();
    let object_size = header_parts
        .next()
        .ok_or_else(|| {
            format!(
                "Could not parse the historical blob size for '{}'.",
                relative_path
            )
        })?
        .parse::<usize>()
        .map_err(|error| {
            format!(
                "Could not decode the historical blob size for '{}': {error}",
                relative_path
            )
        })?;
    if object_type != "blob" {
        return Err(format!(
            "Expected a blob for historical file '{}', found '{}'.",
            relative_path, object_type
        ));
    }

    let body_start = header_end + 1;
    let body_end = body_start
        .checked_add(object_size)
        .ok_or_else(|| format!("Historical blob size overflow for '{}'.", relative_path))?;
    if body_end > output.len() {
        return Err(format!(
            "The historical blob output was truncated for '{}'.",
            relative_path
        ));
    }

    Ok(output[body_start..body_end].to_vec())
}

fn ensure_text_has_trailing_newline(text: &str) -> String {
    if text.ends_with('\n') {
        text.to_string()
    } else {
        format!("{text}\n")
    }
}

fn load_git_commit_operation_type(
    repo_path: &Path,
    commit_sha: &str,
) -> Result<Option<String>, String> {
    let full_message = git_output(repo_path, &["show", "-s", "--format=%B", commit_sha])?;
    let (_, operation_type, _, _) = parse_git_commit_message(&full_message);
    Ok(operation_type)
}

fn load_commit_row_paths_for_chapter(
    repo_path: &Path,
    commit_sha: &str,
    relative_chapter_path: &str,
) -> Result<Vec<String>, String> {
    let changed_paths = git_output(repo_path, &["show", "--format=", "--name-only", commit_sha])?;
    Ok(filter_commit_row_paths_for_chapter(
        changed_paths.lines(),
        relative_chapter_path,
    ))
}

fn filter_commit_row_paths_for_chapter<'a>(
    changed_paths: impl IntoIterator<Item = &'a str>,
    relative_chapter_path: &str,
) -> Vec<String> {
    let row_prefix = format!("{}/rows/", relative_chapter_path.trim_end_matches('/'));
    let mut row_paths = changed_paths
        .into_iter()
        .map(str::trim)
        .filter(|path| path.starts_with(&row_prefix) && path.ends_with(".json"))
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    row_paths.sort();
    row_paths.dedup();
    row_paths
}

fn row_id_from_relative_row_path(relative_row_path: &str) -> Option<String> {
    Path::new(relative_row_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
}

fn commit_has_later_changes_for_path(
    repo_path: &Path,
    commit_sha: &str,
    relative_path: &str,
) -> Result<bool, String> {
    let output = git_output(
        repo_path,
        &[
            "log",
            "--format=%H",
            &format!("{commit_sha}..HEAD"),
            "--",
            relative_path,
        ],
    )?;
    Ok(!output.trim().is_empty())
}

fn ensure_editor_field_object_defaults(
    field_object: &mut serde_json::Map<String, Value>,
) -> Result<(), String> {
    let plain_text = field_object
        .get("plain_text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let footnote = field_object
        .get("footnote")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    field_object
        .entry("value_kind".to_string())
        .or_insert_with(|| Value::String("text".to_string()));
    field_object
        .entry("plain_text".to_string())
        .or_insert_with(|| Value::String(plain_text.clone()));
    field_object
        .entry("footnote".to_string())
        .or_insert_with(|| Value::String(footnote));

    let editor_flags_value = field_object
        .entry("editor_flags".to_string())
        .or_insert_with(|| json!({}));
    let editor_flags_object = editor_flags_value
        .as_object_mut()
        .ok_or_else(|| "The row field editor flags are not a JSON object.".to_string())?;
    editor_flags_object
        .entry("reviewed".to_string())
        .or_insert(Value::Bool(false));
    editor_flags_object
        .entry("please_check".to_string())
        .or_insert(Value::Bool(false));

    Ok(())
}

fn normalize_editor_text_style_value(value: Option<&str>) -> String {
    match value.unwrap_or_default().trim() {
        "h1" | "heading1" => "heading1".to_string(),
        "h2" | "heading2" => "heading2".to_string(),
        "q" | "quote" => "quote".to_string(),
        "i" | "indented" => "indented".to_string(),
        _ => DEFAULT_EDITOR_TEXT_STYLE.to_string(),
    }
}

fn normalize_editor_footnote_value(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        value.to_string()
    }
}

fn normalize_editor_field_image_kind(value: &str) -> Option<&'static str> {
    match value.trim() {
        "url" => Some("url"),
        "upload" => Some("upload"),
        _ => None,
    }
}

fn normalize_editor_field_image_parts(
    kind: &str,
    url: Option<&str>,
    path: Option<&str>,
) -> Option<StoredFieldImage> {
    match normalize_editor_field_image_kind(kind)? {
        "url" => {
            let normalized_url = url.unwrap_or_default().trim();
            if normalized_url.is_empty() {
                return None;
            }

            Some(StoredFieldImage {
                kind: "url".to_string(),
                url: Some(normalized_url.to_string()),
                path: None,
            })
        }
        "upload" => {
            let normalized_path = path.unwrap_or_default().trim();
            if normalized_path.is_empty() {
                return None;
            }

            Some(StoredFieldImage {
                kind: "upload".to_string(),
                url: None,
                path: Some(normalized_path.to_string()),
            })
        }
        _ => None,
    }
}

fn normalize_editor_field_image_value(
    value: &Option<StoredFieldImage>,
) -> Option<StoredFieldImage> {
    value.as_ref().and_then(|image| {
        normalize_editor_field_image_parts(&image.kind, image.url.as_deref(), image.path.as_deref())
    })
}

fn normalize_editor_field_image_input(
    value: Option<&EditorFieldImageInput>,
) -> Option<StoredFieldImage> {
    value.and_then(|image| {
        normalize_editor_field_image_parts(&image.kind, Some(&image.url), Some(&image.path))
    })
}

fn editor_field_image_from_stored(
    repo_path: &Path,
    value: &Option<StoredFieldImage>,
) -> Option<EditorFieldImage> {
    let image = normalize_editor_field_image_value(value)?;
    let file_name = image
        .path
        .as_deref()
        .and_then(editor_uploaded_image_file_name_from_relative_path);
    let file_path = image
        .path
        .as_deref()
        .map(|relative_path| repo_path.join(relative_path).to_string_lossy().to_string());

    Some(EditorFieldImage {
        kind: image.kind,
        url: image.url,
        path: image.path,
        file_path,
        file_name,
    })
}

fn editor_uploaded_image_file_name_from_relative_path(relative_path: &str) -> Option<String> {
    Path::new(relative_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
}

fn row_object_mut(row_value: &mut Value) -> Result<&mut serde_json::Map<String, Value>, String> {
    row_value
        .as_object_mut()
        .ok_or_else(|| "The row file is not a JSON object.".to_string())
}

fn row_fields_object_mut(
    row_value: &mut Value,
) -> Result<&mut serde_json::Map<String, Value>, String> {
    let row_object = row_object_mut(row_value)?;
    let fields_value = row_object
        .entry("fields".to_string())
        .or_insert_with(|| json!({}));
    fields_value
        .as_object_mut()
        .ok_or_else(|| "The row fields are not a JSON object.".to_string())
}

fn clear_editor_html_preview_cache(
    fields_object: &mut serde_json::Map<String, Value>,
) -> Result<(), String> {
    for field_value in fields_object.values_mut() {
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        field_object.remove("html_preview");
    }

    Ok(())
}

fn apply_editor_plain_text_updates(
    row_value: &mut Value,
    fields: &BTreeMap<String, String>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;

    for (code, plain_text) in fields {
        let field_value = fields_object
            .entry(code.clone())
            .or_insert_with(|| json!({}));
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        let previous_plain_text = field_object
            .get("plain_text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert("value_kind".to_string(), Value::String("text".to_string()));
        field_object.insert("plain_text".to_string(), Value::String(plain_text.clone()));
        if previous_plain_text != *plain_text {
            field_object.remove("html_preview");
        }
    }

    Ok(())
}

fn apply_editor_footnote_updates(
    row_value: &mut Value,
    footnotes: &BTreeMap<String, String>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;

    for (code, footnote) in footnotes {
        let field_value = fields_object
            .entry(code.clone())
            .or_insert_with(|| json!({}));
        let field_object = field_value
            .as_object_mut()
            .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
        ensure_editor_field_object_defaults(field_object)?;
        field_object.insert(
            "footnote".to_string(),
            Value::String(normalize_editor_footnote_value(footnote)),
        );
    }

    Ok(())
}

fn apply_editor_field_image_update(
    row_value: &mut Value,
    language_code: &str,
    image: Option<StoredFieldImage>,
) -> Result<(), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    let field_value = fields_object
        .entry(language_code.to_string())
        .or_insert_with(|| json!({}));
    let field_object = field_value
        .as_object_mut()
        .ok_or_else(|| "A row field is not a JSON object.".to_string())?;
    ensure_editor_field_object_defaults(field_object)?;
    field_object.insert(
        "image".to_string(),
        serde_json::to_value(image)
            .map_err(|error| format!("Could not serialize the row image metadata: {error}"))?,
    );

    Ok(())
}

fn apply_editor_text_style_update(
    row_value: &mut Value,
    text_style: &str,
) -> Result<(String, bool), String> {
    let normalized_text_style = normalize_editor_text_style_value(Some(text_style));
    let row_object = row_object_mut(row_value)?;
    let previous_text_style =
        normalize_editor_text_style_value(row_object.get("text_style").and_then(Value::as_str));
    let changed = previous_text_style != normalized_text_style;
    if changed {
        row_object.insert(
            "text_style".to_string(),
            Value::String(normalized_text_style.clone()),
        );
        let fields_object = row_object
            .get_mut("fields")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| "The row fields are not a JSON object.".to_string())?;
        clear_editor_html_preview_cache(fields_object)?;
    }

    Ok((normalized_text_style, changed))
}

fn apply_editor_field_flag_update(
    row_value: &mut Value,
    language_code: &str,
    flag: &str,
    enabled: bool,
) -> Result<(bool, bool, bool), String> {
    let fields_object = row_fields_object_mut(row_value)?;
    let field_value = fields_object
        .entry(language_code.to_string())
        .or_insert_with(|| json!({}));
    let field_object = field_value
        .as_object_mut()
        .ok_or_else(|| "The row field is not a JSON object.".to_string())?;
    ensure_editor_field_object_defaults(field_object)?;
    let flag_key = normalize_editor_field_flag_key(flag)?;

    let editor_flags_object = field_object
        .get_mut("editor_flags")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "The row field editor flags are not a JSON object.".to_string())?;
    let previous_value = editor_flags_object
        .get(flag_key)
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let changed = previous_value != enabled;
    if changed {
        editor_flags_object.insert(flag_key.to_string(), Value::Bool(enabled));
    }
    let reviewed = editor_flags_object
        .get("reviewed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let please_check = editor_flags_object
        .get("please_check")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if changed {
        field_object.remove("html_preview");
    }

    Ok((reviewed, please_check, changed))
}

fn normalize_editor_field_flag_key(flag: &str) -> Result<&'static str, String> {
    match flag.trim() {
        "reviewed" => Ok("reviewed"),
        "please-check" => Ok("please_check"),
        _ => Err("Unknown row field flag.".to_string()),
    }
}

fn set_editor_field_flags(
    field_object: &mut serde_json::Map<String, Value>,
    flags: &StoredFieldEditorFlags,
) {
    if let Some(editor_flags_object) = field_object
        .get_mut("editor_flags")
        .and_then(Value::as_object_mut)
    {
        editor_flags_object.insert("reviewed".to_string(), Value::Bool(flags.reviewed));
        editor_flags_object.insert("please_check".to_string(), Value::Bool(flags.please_check));
    }
}

#[derive(Clone, PartialEq, Eq)]
struct HistoricalFieldSignature {
    plain_text: String,
    footnote: String,
    image: Option<StoredFieldImage>,
    text_style: String,
    reviewed: bool,
    please_check: bool,
}

#[derive(Clone)]
struct HistoricalFieldVersion {
    field_value: StoredFieldValue,
    text_style: String,
}

impl HistoricalFieldSignature {
    fn from_version(version: &HistoricalFieldVersion) -> Self {
        Self {
            plain_text: version.field_value.plain_text.clone(),
            footnote: normalize_editor_footnote_value(&version.field_value.footnote),
            image: normalize_editor_field_image_value(&version.field_value.image),
            text_style: version.text_style.clone(),
            reviewed: version.field_value.editor_flags.reviewed,
            please_check: version.field_value.editor_flags.please_check,
        }
    }
}

fn build_editor_field_history_entries(
    repo_path: &Path,
    commits: Vec<GitCommitMetadata>,
    historical_field_versions: Vec<Option<HistoricalFieldVersion>>,
) -> Vec<EditorFieldHistoryEntry> {
    let baseline_index = historical_field_versions.iter().rposition(Option::is_some);
    let mut entries = Vec::new();
    let mut last_recorded_field_signature: Option<HistoricalFieldSignature> = None;

    for (index, (commit, historical_field_version)) in commits
        .into_iter()
        .zip(historical_field_versions.into_iter())
        .enumerate()
    {
        let Some(field_version) = historical_field_version else {
            continue;
        };
        let plain_text = field_version.field_value.plain_text.clone();
        let footnote = normalize_editor_footnote_value(&field_version.field_value.footnote);
        let image = editor_field_image_from_stored(repo_path, &field_version.field_value.image);
        let text_style = field_version.text_style.clone();
        let field_signature = HistoricalFieldSignature::from_version(&field_version);
        let is_baseline_entry = baseline_index == Some(index);

        if !is_baseline_entry && last_recorded_field_signature.as_ref() == Some(&field_signature) {
            continue;
        }

        last_recorded_field_signature = Some(field_signature);
        entries.push(EditorFieldHistoryEntry {
            commit_sha: commit.commit_sha,
            author_name: commit.author_name,
            committed_at: commit.committed_at,
            message: commit.message,
            operation_type: commit.operation_type,
            status_note: commit.status_note,
            ai_model: commit.ai_model,
            plain_text,
            footnote,
            image,
            text_style,
            reviewed: field_version.field_value.editor_flags.reviewed,
            please_check: field_version.field_value.editor_flags.please_check,
        });
    }

    entries
}

fn load_historical_row_field_value(
    repo_path: &Path,
    relative_row_json: &str,
    commit_sha: &str,
    language_code: &str,
) -> Result<Option<HistoricalFieldVersion>, String> {
    let row_text = git_output(
        repo_path,
        &["show", &format!("{commit_sha}:{relative_row_json}")],
    )?;
    let row_file: StoredRowFile = serde_json::from_str(&row_text).map_err(|error| {
        format!(
            "Could not parse historical row file '{}' at commit '{}': {error}",
            relative_row_json, commit_sha
        )
    })?;

    Ok(row_file
        .fields
        .get(language_code)
        .cloned()
        .map(|field_value| HistoricalFieldVersion {
            field_value,
            text_style: row_text_style(&row_file),
        }))
}

fn load_historical_row_field_values_batch(
    repo_path: &Path,
    relative_row_json: &str,
    commits: &[GitCommitMetadata],
    language_code: &str,
) -> Result<Vec<Option<HistoricalFieldVersion>>, String> {
    if commits.is_empty() {
        return Ok(Vec::new());
    }

    let request = commits
        .iter()
        .map(|commit| format!("{}:{}\n", commit.commit_sha, relative_row_json))
        .collect::<String>();
    let output = git_output_with_stdin(repo_path, &["cat-file", "--batch"], &request)?;
    let mut cursor = 0usize;
    let mut values = Vec::with_capacity(commits.len());

    for commit in commits {
        let header_start = cursor;
        let header_end = output[header_start..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|offset| header_start + offset)
            .ok_or_else(|| {
                format!(
                    "Could not parse historical row header for '{}' at commit '{}'.",
                    relative_row_json, commit.commit_sha
                )
            })?;
        let header = str::from_utf8(&output[header_start..header_end]).map_err(|error| {
            format!(
                "Could not decode historical row header for '{}' at commit '{}': {error}",
                relative_row_json, commit.commit_sha
            )
        })?;
        cursor = header_end + 1;

        if header.ends_with(" missing") {
            values.push(None);
            continue;
        }

        let mut header_parts = header.split_whitespace();
        let _object_name = header_parts.next().unwrap_or_default();
        let object_type = header_parts.next().unwrap_or_default();
        let object_size = header_parts
            .next()
            .ok_or_else(|| {
                format!(
                    "Could not parse historical row size for '{}' at commit '{}'.",
                    relative_row_json, commit.commit_sha
                )
            })?
            .parse::<usize>()
            .map_err(|error| {
                format!(
                    "Could not decode historical row size for '{}' at commit '{}': {error}",
                    relative_row_json, commit.commit_sha
                )
            })?;

        if object_type != "blob" {
            return Err(format!(
                "Expected a blob for historical row '{}' at commit '{}', found '{}'.",
                relative_row_json, commit.commit_sha, object_type
            ));
        }

        let body_end = cursor.checked_add(object_size).ok_or_else(|| {
            format!(
                "Historical row size overflow for '{}' at commit '{}'.",
                relative_row_json, commit.commit_sha
            )
        })?;
        if body_end > output.len() {
            return Err(format!(
                "Historical row output was truncated for '{}' at commit '{}'.",
                relative_row_json, commit.commit_sha
            ));
        }

        let row_text = str::from_utf8(&output[cursor..body_end]).map_err(|error| {
            format!(
                "Could not decode historical row file '{}' at commit '{}': {error}",
                relative_row_json, commit.commit_sha
            )
        })?;
        cursor = body_end;
        if output.get(cursor) == Some(&b'\n') {
            cursor += 1;
        }

        let row_file: StoredRowFile = serde_json::from_str(row_text).map_err(|error| {
            format!(
                "Could not parse historical row file '{}' at commit '{}': {error}",
                relative_row_json, commit.commit_sha
            )
        })?;
        values.push(
            row_file
                .fields
                .get(language_code)
                .cloned()
                .map(|field_value| HistoricalFieldVersion {
                    field_value,
                    text_style: row_text_style(&row_file),
                }),
        );
    }

    Ok(values)
}

fn load_latest_row_version_metadata(
    repo_path: &Path,
    relative_row_json: &str,
) -> Result<Option<EditorRowVersionMetadata>, String> {
    Ok(load_git_history_for_path(repo_path, relative_row_json)?
        .into_iter()
        .next()
        .map(|commit| EditorRowVersionMetadata {
            commit_sha: commit.commit_sha,
            author_name: commit.author_name,
            committed_at: commit.committed_at,
        }))
}

fn short_commit_sha(commit_sha: &str) -> String {
    commit_sha.chars().take(8).collect()
}

fn glossary_link_value_from_input(input: Option<&GlossaryLinkSelectionInput>) -> Value {
    match input {
        Some(selection) => json!({
          "glossary_id": selection.glossary_id,
          "repo_name": selection.repo_name,
        }),
        None => Value::Null,
    }
}

fn project_chapter_glossary_link_from_input(
    input: GlossaryLinkSelectionInput,
) -> ProjectChapterGlossaryLink {
    ProjectChapterGlossaryLink {
        glossary_id: input.glossary_id,
        repo_name: input.repo_name,
    }
}

fn sanitize_chapter_languages(languages: &[ChapterLanguage]) -> Vec<ChapterLanguage> {
    let mut seen = BTreeMap::<String, ()>::new();
    let mut sanitized = Vec::new();

    for language in languages {
        if is_reserved_non_language_header(&language.code)
            || is_reserved_non_language_header(&language.name)
        {
            continue;
        }

        if seen.contains_key(&language.code) {
            continue;
        }

        seen.insert(language.code.clone(), ());
        sanitized.push(language.clone());
    }

    sanitized
}

fn editor_row_from_stored_row_file(
    repo_path: &Path,
    row: StoredRowFile,
) -> Result<EditorRow, String> {
    let revision_token = row_revision_token(&row)?;
    let fields = row_plain_text_map(&row);
    let footnotes = row_footnote_map(&row);
    let images = row_image_map(repo_path, &row);
    let text_style = row_text_style(&row);

    Ok(EditorRow {
        row_id: row.row_id,
        revision_token,
        external_id: row.external_id,
        description: row
            .guidance
            .as_ref()
            .and_then(|guidance| guidance.description.clone()),
        context: row
            .guidance
            .as_ref()
            .and_then(|guidance| guidance.context.clone()),
        comment_count: row.editor_comments.len(),
        comments_revision: row.editor_comments_revision,
        source_row_number: row.origin.source_row_number,
        review_state: row.status.review_state,
        lifecycle_state: row.lifecycle.state,
        order_key: row.structure.order_key,
        text_style,
        fields,
        footnotes,
        images,
        field_states: row
            .fields
            .into_iter()
            .map(|(code, value)| {
                (
                    code,
                    EditorFieldState {
                        reviewed: value.editor_flags.reviewed,
                        please_check: value.editor_flags.please_check,
                    },
                )
            })
            .collect(),
    })
}

fn row_plain_text_map(row: &StoredRowFile) -> BTreeMap<String, String> {
    row.fields
        .iter()
        .map(|(code, value)| (code.clone(), value.plain_text.clone()))
        .collect()
}

fn row_footnote_map(row: &StoredRowFile) -> BTreeMap<String, String> {
    row.fields
        .iter()
        .map(|(code, value)| {
            (
                code.clone(),
                normalize_editor_footnote_value(&value.footnote),
            )
        })
        .collect()
}

fn row_image_map(repo_path: &Path, row: &StoredRowFile) -> BTreeMap<String, EditorFieldImage> {
    row.fields
        .iter()
        .filter_map(|(code, value)| {
            editor_field_image_from_stored(repo_path, &value.image)
                .map(|image| (code.clone(), image))
        })
        .collect()
}

fn row_text_style(row: &StoredRowFile) -> String {
    normalize_editor_text_style_value(row.text_style.as_deref())
}

fn row_revision_token(row: &StoredRowFile) -> Result<String, String> {
    let row_json = serde_json::to_string_pretty(row)
        .map_err(|error| format!("Could not serialize the row revision token: {error}"))?;
    let mut digest = Sha256::new();
    digest.update(row_json.as_bytes());
    digest.update(b"\n");
    let hash = digest.finalize();
    let mut token = String::with_capacity(hash.len() * 2);
    for byte in hash {
        let _ = write!(&mut token, "{byte:02x}");
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use serde_json::json;

    use super::{
        active_lifecycle_state, apply_editor_field_flag_update, apply_editor_footnote_updates,
        apply_editor_plain_text_updates, apply_editor_text_style_update,
        build_editor_field_history_entries, capture_repo_file_snapshot, create_inserted_editor_row,
        create_inserted_row_file, editor_row_from_stored_row_file,
        filter_commit_row_paths_for_chapter, parse_git_commit_message,
        preferred_target_language_code, restore_repo_file_snapshot_on_disk, row_text_style,
        write_binary_file, ChapterLanguage, GitCommitMetadata, HistoricalFieldVersion,
        StoredChapterFile, StoredChapterSettings, StoredFieldEditorFlags, StoredFieldValue,
        StoredRowFile, DEFAULT_EDITOR_TEXT_STYLE,
    };

    fn history_commit(commit_sha: &str, operation_type: Option<&str>) -> GitCommitMetadata {
        GitCommitMetadata {
            commit_sha: commit_sha.to_string(),
            author_name: "Test User".to_string(),
            committed_at: "2026-04-14T00:00:00Z".to_string(),
            message: format!("Commit {commit_sha}"),
            operation_type: operation_type.map(str::to_string),
            status_note: None,
            ai_model: None,
        }
    }

    fn history_field(plain_text: &str, reviewed: bool, please_check: bool) -> StoredFieldValue {
        StoredFieldValue {
            plain_text: plain_text.to_string(),
            footnote: String::new(),
            image: None,
            editor_flags: StoredFieldEditorFlags {
                reviewed,
                please_check,
            },
        }
    }

    fn history_version(
        plain_text: &str,
        text_style: &str,
        reviewed: bool,
        please_check: bool,
    ) -> HistoricalFieldVersion {
        HistoricalFieldVersion {
            field_value: history_field(plain_text, reviewed, please_check),
            text_style: text_style.to_string(),
        }
    }

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("gnosis-tms-{name}-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&path).expect("temp dir should be created");
        path
    }

    #[test]
    fn parse_git_commit_message_reads_editor_replace_operation_trailer() {
        let (subject, operation_type, status_note, ai_model) = parse_git_commit_message(
            "Undo batch replace in 3 rows\n\nGTMS-Operation: editor-replace\n",
        );

        assert_eq!(subject, "Undo batch replace in 3 rows");
        assert_eq!(operation_type.as_deref(), Some("editor-replace"));
        assert_eq!(status_note, None);
        assert_eq!(ai_model, None);
    }

    #[test]
    fn parse_git_commit_message_reads_ai_model_trailer() {
        let (subject, operation_type, status_note, ai_model) = parse_git_commit_message(
            "Update row row-1\n\nGTMS-Operation: ai-translation\nGTMS-AI-Model: gpt-5.4\n",
        );

        assert_eq!(subject, "Update row row-1");
        assert_eq!(operation_type.as_deref(), Some("ai-translation"));
        assert_eq!(status_note, None);
        assert_eq!(ai_model.as_deref(), Some("gpt-5.4"));
    }

    #[test]
    fn filter_commit_row_paths_for_chapter_keeps_only_row_files_in_that_chapter() {
        let row_paths = filter_commit_row_paths_for_chapter(
            [
                "chapters/chapter-a/chapter.json",
                "chapters/chapter-a/rows/a.json",
                "chapters/chapter-a/rows/b.json",
                "chapters/chapter-b/rows/c.json",
                "chapters/chapter-a/rows/a.json",
            ],
            "chapters/chapter-a",
        );

        assert_eq!(
            row_paths,
            vec![
                "chapters/chapter-a/rows/a.json".to_string(),
                "chapters/chapter-a/rows/b.json".to_string(),
            ]
        );
    }

    #[test]
    fn apply_editor_plain_text_updates_changes_requested_field_and_clears_preview_cache() {
        let mut row_value = json!({
          "fields": {
            "es": {
              "value_kind": "text",
              "plain_text": "uno",
              "footnote": "",
              "html_preview": "<p>uno</p>",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            },
            "en": {
              "value_kind": "text",
              "plain_text": "one",
              "html_preview": "<p>one</p>",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            }
          }
        });

        apply_editor_plain_text_updates(
            &mut row_value,
            &[(String::from("es"), String::from("dos"))]
                .into_iter()
                .collect(),
        )
        .expect("plain text update should succeed");

        assert_eq!(row_value["fields"]["es"]["plain_text"], json!("dos"));
        assert!(row_value["fields"]["es"].get("html_preview").is_none());
        assert_eq!(row_value["fields"]["en"]["plain_text"], json!("one"));
    }

    #[test]
    fn apply_editor_plain_text_updates_is_a_no_op_for_identical_text() {
        let mut row_value = json!({
          "fields": {
            "es": {
              "value_kind": "text",
              "plain_text": "uno",
              "footnote": "",
              "html_preview": "<p>uno</p>",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            }
          }
        });
        let original_serialized = serde_json::to_string_pretty(&row_value).unwrap();

        apply_editor_plain_text_updates(
            &mut row_value,
            &[(String::from("es"), String::from("uno"))]
                .into_iter()
                .collect(),
        )
        .expect("plain text update should succeed");

        assert_eq!(
            serde_json::to_string_pretty(&row_value).unwrap(),
            original_serialized
        );
    }

    #[test]
    fn apply_editor_footnote_updates_normalizes_whitespace_only_values() {
        let mut row_value = json!({
          "fields": {
            "es": {
              "value_kind": "text",
              "plain_text": "uno",
              "footnote": "existing",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            }
          }
        });

        apply_editor_footnote_updates(
            &mut row_value,
            &[(String::from("es"), String::from("   \n\t  "))]
                .into_iter()
                .collect(),
        )
        .expect("footnote update should succeed");

        assert_eq!(row_value["fields"]["es"]["footnote"], json!(""));
    }

    #[test]
    fn apply_editor_text_style_update_updates_style_and_clears_cached_previews() {
        let mut row_value = json!({
          "text_style": "paragraph",
          "fields": {
            "es": {
              "value_kind": "text",
              "plain_text": "uno",
              "html_preview": "<p>uno</p>",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            },
            "en": {
              "value_kind": "text",
              "plain_text": "one",
              "html_preview": "<p>one</p>",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            }
          }
        });

        let (text_style, changed) = apply_editor_text_style_update(&mut row_value, "heading1")
            .expect("text style update should succeed");

        assert!(changed);
        assert_eq!(text_style, "heading1");
        assert_eq!(row_value["text_style"], json!("heading1"));
        assert!(row_value["fields"]["es"].get("html_preview").is_none());
        assert!(row_value["fields"]["en"].get("html_preview").is_none());
    }

    #[test]
    fn apply_editor_field_flag_update_reports_changes_and_preserves_other_flags() {
        let mut row_value = json!({
          "fields": {
            "es": {
              "value_kind": "text",
              "plain_text": "uno",
              "html_preview": "<p>uno</p>",
              "editor_flags": {
                "reviewed": false,
                "please_check": true
              }
            }
          }
        });

        let (reviewed, please_check, changed) =
            apply_editor_field_flag_update(&mut row_value, "es", "reviewed", true)
                .expect("flag update should succeed");

        assert!(changed);
        assert!(reviewed);
        assert!(please_check);
        assert_eq!(
            row_value["fields"]["es"]["editor_flags"]["reviewed"],
            json!(true)
        );
        assert_eq!(
            row_value["fields"]["es"]["editor_flags"]["please_check"],
            json!(true)
        );
        assert!(row_value["fields"]["es"].get("html_preview").is_none());
    }

    #[test]
    fn apply_editor_field_flag_update_is_a_no_op_when_flag_already_matches() {
        let mut row_value = json!({
          "fields": {
            "es": {
              "value_kind": "text",
              "plain_text": "uno",
              "html_preview": "<p>uno</p>",
              "editor_flags": {
                "reviewed": true,
                "please_check": false
              }
            }
          }
        });

        let (_, _, changed) =
            apply_editor_field_flag_update(&mut row_value, "es", "reviewed", true)
                .expect("flag update should succeed");

        assert!(!changed);
    }

    #[test]
    fn stored_row_file_defaults_missing_editor_comments_fields() {
        let row: StoredRowFile = serde_json::from_value(json!({
          "row_id": "row-1",
          "structure": { "order_key": "0001" },
          "status": { "review_state": "unreviewed" },
          "origin": { "source_row_number": 1 },
          "fields": {
            "es": {
              "plain_text": "uno",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            }
          }
        }))
        .expect("row should deserialize");

        assert_eq!(row.editor_comments_revision, 0);
        assert!(row.editor_comments.is_empty());
        assert_eq!(row_text_style(&row), DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn editor_row_from_stored_row_file_exposes_comment_summary_data() {
        let row: StoredRowFile = serde_json::from_value(json!({
          "row_id": "row-1",
          "structure": { "order_key": "0001" },
          "status": { "review_state": "unreviewed" },
          "origin": { "source_row_number": 1 },
          "editor_comments_revision": 7,
          "editor_comments": [
            {
              "comment_id": "comment-1",
              "author_login": "octocat",
              "author_name": "The Octocat",
              "body": "Check this",
              "created_at": "2026-04-13T09:12:33Z"
            }
          ],
          "fields": {
            "es": {
              "plain_text": "uno",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            }
          }
        }))
        .expect("row should deserialize");

        let editor_row =
            editor_row_from_stored_row_file(Path::new("."), row).expect("editor row should build");
        assert_eq!(editor_row.comment_count, 1);
        assert_eq!(editor_row.comments_revision, 7);
        assert_eq!(editor_row.text_style, DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn editor_row_from_stored_row_file_normalizes_whitespace_only_footnotes() {
        let row: StoredRowFile = serde_json::from_value(json!({
          "row_id": "row-1",
          "structure": { "order_key": "0001" },
          "status": { "review_state": "unreviewed" },
          "origin": { "source_row_number": 1 },
          "fields": {
            "es": {
              "plain_text": "uno",
              "footnote": "   ",
              "editor_flags": {
                "reviewed": false,
                "please_check": false
              }
            }
          }
        }))
        .expect("row should deserialize");

        let editor_row =
            editor_row_from_stored_row_file(Path::new("."), row).expect("editor row should build");
        assert_eq!(editor_row.footnotes.get("es").map(String::as_str), Some(""));
    }

    #[test]
    fn create_inserted_row_file_initializes_editor_comments_defaults() {
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".to_string(),
            title: "Chapter".to_string(),
            lifecycle: super::active_lifecycle_state(),
            source_files: Vec::new(),
            languages: Vec::new(),
            settings: None,
        };
        let row_value = create_inserted_row_file("row-1", "0001", &chapter, &[]);

        assert_eq!(row_value["editor_comments_revision"], json!(0));
        assert_eq!(row_value["editor_comments"], json!([]));
        assert_eq!(row_value["text_style"], json!(DEFAULT_EDITOR_TEXT_STYLE));
    }

    #[test]
    fn create_inserted_editor_row_initializes_comment_summary_defaults() {
        let row = create_inserted_editor_row("row-1", "0001", &[]).expect("row should build");

        assert_eq!(row.comment_count, 0);
        assert_eq!(row.comments_revision, 0);
        assert_eq!(row.text_style, DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn build_editor_field_history_entries_keeps_oldest_import_baseline_when_field_is_unchanged() {
        let entries = build_editor_field_history_entries(
            Path::new("."),
            vec![
                history_commit("c3", Some("editor-update")),
                history_commit("c2", Some("editor-update")),
                history_commit("c1", Some("import")),
            ],
            vec![
                Some(history_version(
                    "Hello",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
                Some(history_version(
                    "Hello",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
                Some(history_version(
                    "Hello",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
            ],
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].commit_sha, "c3");
        assert_eq!(entries[0].operation_type.as_deref(), Some("editor-update"));
        assert_eq!(entries[0].text_style, DEFAULT_EDITOR_TEXT_STYLE);
        assert_eq!(entries[1].commit_sha, "c1");
        assert_eq!(entries[1].operation_type.as_deref(), Some("import"));
        assert_eq!(entries[1].plain_text, "Hello");
        assert_eq!(entries[1].text_style, DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn build_editor_field_history_entries_uses_oldest_present_field_as_the_baseline() {
        let entries = build_editor_field_history_entries(
            Path::new("."),
            vec![
                history_commit("c3", Some("editor-update")),
                history_commit("c2", Some("insert")),
                history_commit("c1", Some("import")),
            ],
            vec![
                Some(history_version(
                    "Translated",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
                Some(history_version("", DEFAULT_EDITOR_TEXT_STYLE, false, false)),
                None,
            ],
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].commit_sha, "c3");
        assert_eq!(entries[0].plain_text, "Translated");
        assert_eq!(entries[0].text_style, DEFAULT_EDITOR_TEXT_STYLE);
        assert_eq!(entries[1].commit_sha, "c2");
        assert_eq!(entries[1].operation_type.as_deref(), Some("insert"));
        assert_eq!(entries[1].plain_text, "");
        assert_eq!(entries[1].text_style, DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn build_editor_field_history_entries_keeps_style_only_changes() {
        let entries = build_editor_field_history_entries(
            Path::new("."),
            vec![
                history_commit("c2", Some("text-style")),
                history_commit("c1", Some("import")),
            ],
            vec![
                Some(history_version("Hello", "heading1", false, false)),
                Some(history_version(
                    "Hello",
                    DEFAULT_EDITOR_TEXT_STYLE,
                    false,
                    false,
                )),
            ],
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].commit_sha, "c2");
        assert_eq!(entries[0].text_style, "heading1");
        assert_eq!(entries[1].commit_sha, "c1");
        assert_eq!(entries[1].text_style, DEFAULT_EDITOR_TEXT_STYLE);
    }

    #[test]
    fn build_editor_field_history_entries_keeps_footnote_only_changes() {
        let entries = build_editor_field_history_entries(
            Path::new("."),
            vec![
                history_commit("c2", Some("editor-update")),
                history_commit("c1", Some("import")),
            ],
            vec![
                Some(HistoricalFieldVersion {
                    field_value: StoredFieldValue {
                        plain_text: "Hello".to_string(),
                        footnote: "Note".to_string(),
                        image: None,
                        editor_flags: StoredFieldEditorFlags::default(),
                    },
                    text_style: DEFAULT_EDITOR_TEXT_STYLE.to_string(),
                }),
                Some(HistoricalFieldVersion {
                    field_value: StoredFieldValue {
                        plain_text: "Hello".to_string(),
                        footnote: String::new(),
                        image: None,
                        editor_flags: StoredFieldEditorFlags::default(),
                    },
                    text_style: DEFAULT_EDITOR_TEXT_STYLE.to_string(),
                }),
            ],
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].commit_sha, "c2");
        assert_eq!(entries[0].footnote, "Note");
        assert_eq!(entries[1].commit_sha, "c1");
        assert_eq!(entries[1].footnote, "");
    }

    #[test]
    fn restore_repo_file_snapshot_on_disk_restores_original_bytes() {
        let repo_path = temp_test_dir("snapshot-restores-bytes");
        let relative_path = "chapters/chapter-1/images/row-1-vi.png";
        let absolute_path = repo_path.join(relative_path);

        write_binary_file(&absolute_path, b"original").expect("original file should be written");
        let snapshot = capture_repo_file_snapshot(&repo_path, relative_path)
            .expect("snapshot should be captured");

        write_binary_file(&absolute_path, b"changed").expect("changed file should be written");
        restore_repo_file_snapshot_on_disk(&snapshot).expect("snapshot should restore bytes");

        assert_eq!(
            fs::read(&absolute_path).expect("file should exist"),
            b"original"
        );

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn restore_repo_file_snapshot_on_disk_removes_new_files_when_they_were_originally_missing() {
        let repo_path = temp_test_dir("snapshot-removes-new-file");
        let relative_path = "chapters/chapter-1/images/row-1-vi.png";
        let absolute_path = repo_path.join(relative_path);

        let snapshot = capture_repo_file_snapshot(&repo_path, relative_path)
            .expect("snapshot should be captured");

        write_binary_file(&absolute_path, b"created").expect("new file should be written");
        restore_repo_file_snapshot_on_disk(&snapshot).expect("snapshot should remove new file");

        assert!(!absolute_path.exists(), "new file should be removed");

        let _ = fs::remove_dir_all(&repo_path);
    }

    #[test]
    fn preferred_target_language_code_uses_default_target_language() {
        let languages = vec![
            ChapterLanguage {
                code: "es".to_string(),
                name: "Spanish".to_string(),
                role: "source".to_string(),
            },
            ChapterLanguage {
                code: "en".to_string(),
                name: "English".to_string(),
                role: "reference".to_string(),
            },
            ChapterLanguage {
                code: "vi".to_string(),
                name: "Vietnamese".to_string(),
                role: "target".to_string(),
            },
        ];
        let chapter = StoredChapterFile {
            chapter_id: "chapter-1".to_string(),
            title: "Chapter".to_string(),
            lifecycle: active_lifecycle_state(),
            source_files: Vec::new(),
            languages: languages.clone(),
            settings: Some(StoredChapterSettings {
                linked_glossaries: None,
                default_source_language: Some("es".to_string()),
                default_target_language: Some("en".to_string()),
            }),
        };

        let selected_target = preferred_target_language_code(&chapter, &languages, Some("es"));

        assert_eq!(selected_target.as_deref(), Some("en"));
    }
}

fn is_reserved_non_language_header(value: &str) -> bool {
    matches!(
        normalize_header(value).as_str(),
        "" | "row"
            | "row number"
            | "row id"
            | "source label"
            | "source title"
            | "description"
            | "desc"
            | "context"
            | "comment"
            | "comments"
            | "note"
            | "notes"
            | "developer comment"
            | "developer note"
            | "translator comment"
            | "translator note"
            | "key"
            | "id"
            | "identifier"
            | "string key"
            | "string id"
            | "resource key"
    )
}

fn normalize_header(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_source_word_counts_from_stored_rows(
    rows: &[StoredRowFile],
    languages: &[ChapterLanguage],
) -> BTreeMap<String, usize> {
    let mut counts = languages
        .iter()
        .map(|language| (language.code.clone(), 0usize))
        .collect::<BTreeMap<_, _>>();

    for row in rows {
        if row.lifecycle.state == "deleted" {
            continue;
        }
        for language in languages {
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

fn load_source_word_counts(
    rows_path: &Path,
    languages: &[ChapterLanguage],
) -> Result<BTreeMap<String, usize>, String> {
    let rows = load_editor_rows(rows_path)?;
    Ok(build_source_word_counts_from_stored_rows(&rows, languages))
}

fn apply_source_word_count_delta(
    existing_counts: &BTreeMap<String, usize>,
    original_row: &StoredRowFile,
    updated_row: &StoredRowFile,
    languages: &[ChapterLanguage],
) -> BTreeMap<String, usize> {
    let mut next_counts = existing_counts.clone();

    for language in languages {
        let original_words = if original_row.lifecycle.state == "deleted" {
            0
        } else {
            original_row
                .fields
                .get(&language.code)
                .map(|field| count_words(&field.plain_text))
                .unwrap_or(0)
        };
        let updated_words = if updated_row.lifecycle.state == "deleted" {
            0
        } else {
            updated_row
                .fields
                .get(&language.code)
                .map(|field| count_words(&field.plain_text))
                .unwrap_or(0)
        };
        let previous_total = next_counts.get(&language.code).copied().unwrap_or(0);
        let adjusted_total = previous_total.saturating_sub(original_words) + updated_words;
        next_counts.insert(language.code.clone(), adjusted_total);
    }

    next_counts
}

fn allocate_order_key_between(
    previous: Option<&str>,
    next: Option<&str>,
) -> Result<String, String> {
    let previous_value = previous.map(parse_order_key_hex).transpose()?;
    let next_value = next.map(parse_order_key_hex).transpose()?;
    let allocated = match (previous_value, next_value) {
        (Some(previous_key), Some(next_key)) => {
            if previous_key >= next_key {
                return Err("The surrounding rows are out of order.".to_string());
            }
            let gap = next_key - previous_key;
            if gap <= 1 {
                return Err(
                    "There is no space left to insert here. Insert nearby instead.".to_string(),
                );
            }
            previous_key + (gap / 2)
        }
        (Some(previous_key), None) => {
            previous_key.checked_add(ORDER_KEY_SPACING).ok_or_else(|| {
                "There is no space left to insert here. Insert nearby instead.".to_string()
            })?
        }
        (None, Some(next_key)) => next_key.checked_sub(ORDER_KEY_SPACING).ok_or_else(|| {
            "There is no space left to insert here. Insert nearby instead.".to_string()
        })?,
        (None, None) => ORDER_KEY_SPACING,
    };

    Ok(format!("{allocated:032x}"))
}

fn parse_order_key_hex(value: &str) -> Result<u128, String> {
    let normalized = value.trim();
    if normalized.len() != 32 {
        return Err("The row order key is invalid.".to_string());
    }

    u128::from_str_radix(normalized, 16).map_err(|_| "The row order key is invalid.".to_string())
}

fn create_inserted_row_file(
    row_id: &str,
    order_key: &str,
    chapter_file: &StoredChapterFile,
    languages: &[ChapterLanguage],
) -> Value {
    let fields = languages
        .iter()
        .map(|language| {
            (
                language.code.clone(),
                json!({
                  "value_kind": "text",
                  "plain_text": "",
                  "footnote": "",
                  "rich_text": Value::Null,
                  "notes_html": "",
                  "attachments": [],
                  "passthrough_value": Value::Null,
                  "editor_flags": {
                    "reviewed": false,
                    "please_check": false,
                  }
                }),
            )
        })
        .collect::<serde_json::Map<String, Value>>();
    let source_path_hint = chapter_file
        .source_files
        .first()
        .map(|source_file| source_file.path_hint.clone())
        .unwrap_or_default();

    json!({
      "row_id": row_id,
      "unit_type": "string",
      "guidance": {
        "description": Value::Null,
        "context": Value::Null,
        "comments": [],
        "source_references": [],
      },
      "lifecycle": {
        "state": "active",
      },
      "status": {
        "review_state": "unreviewed",
        "reviewed_at": Value::Null,
        "reviewed_by": Value::Null,
        "flags": [],
      },
      "structure": {
        "source_file": source_path_hint,
        "container_path": {},
        "order_key": order_key,
        "group_context": Value::Null,
      },
      "origin": {
        "source_format": "manual",
        "source_sheet": "",
        "source_row_number": 0,
      },
      "format_state": {
        "translatable": true,
        "character_limit": Value::Null,
        "tags": [],
        "source_state": Value::Null,
        "custom_attributes": {},
      },
      "placeholders": [],
      "variants": [],
      "editor_comments_revision": 0,
      "editor_comments": [],
      "text_style": DEFAULT_EDITOR_TEXT_STYLE,
      "fields": fields,
      "format_metadata": {},
    })
}

#[cfg(test)]
fn create_inserted_editor_row(
    row_id: &str,
    order_key: &str,
    languages: &[ChapterLanguage],
) -> Result<EditorRow, String> {
    let fields = languages
        .iter()
        .map(|language| (language.code.clone(), String::new()))
        .collect();
    let footnotes = languages
        .iter()
        .map(|language| (language.code.clone(), String::new()))
        .collect();
    let field_states = languages
        .iter()
        .map(|language| {
            (
                language.code.clone(),
                EditorFieldState {
                    reviewed: false,
                    please_check: false,
                },
            )
        })
        .collect();

    Ok(EditorRow {
        row_id: row_id.to_string(),
        revision_token: row_revision_token(
            &serde_json::from_value(create_inserted_row_file(
                row_id,
                order_key,
                &StoredChapterFile {
                    chapter_id: String::new(),
                    title: String::new(),
                    lifecycle: active_lifecycle_state(),
                    source_files: Vec::new(),
                    languages: languages.to_vec(),
                    settings: None,
                },
                languages,
            ))
            .map_err(|error| format!("Could not build the inserted row token: {error}"))?,
        )?,
        external_id: None,
        description: None,
        context: None,
        comment_count: 0,
        comments_revision: 0,
        source_row_number: 0,
        review_state: "unreviewed".to_string(),
        lifecycle_state: "active".to_string(),
        order_key: order_key.to_string(),
        text_style: DEFAULT_EDITOR_TEXT_STYLE.to_string(),
        fields,
        footnotes,
        images: BTreeMap::new(),
        field_states,
    })
}

fn empty_deleted_row_stub(row: &StoredRowFile) -> StoredRowFile {
    let mut stub = row.clone();
    stub.fields.clear();
    stub
}

fn preferred_source_language_code(
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

fn linked_chapter_glossary(chapter_file: &StoredChapterFile) -> Option<ProjectChapterGlossaryLink> {
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

fn preferred_target_language_code(
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

fn count_words(value: &str) -> usize {
    value
        .split_whitespace()
        .filter(|segment| !segment.is_empty())
        .count()
}
