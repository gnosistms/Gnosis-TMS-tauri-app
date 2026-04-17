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

mod history;
mod images;

pub(super) use self::history::{
    load_gtms_editor_field_history_sync, restore_gtms_editor_field_from_history_sync,
    reverse_gtms_editor_batch_replace_commit_sync,
};
use self::history::{load_latest_row_version_metadata, status_note_for_field_flag};
use self::images::{editor_field_image_from_stored, row_uploaded_image_relative_paths};
pub(super) use self::images::{
    remove_gtms_editor_language_image_sync, save_gtms_editor_language_image_url_sync,
    upload_gtms_editor_language_image_sync,
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
    use std::path::Path;

    use serde_json::json;

    use super::{
        active_lifecycle_state, apply_editor_field_flag_update, apply_editor_footnote_updates,
        apply_editor_plain_text_updates, apply_editor_text_style_update,
        create_inserted_editor_row, create_inserted_row_file, editor_row_from_stored_row_file,
        preferred_target_language_code, row_text_style, ChapterLanguage, StoredChapterFile,
        StoredChapterSettings, StoredRowFile, DEFAULT_EDITOR_TEXT_STYLE,
    };

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
