use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
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

mod chapter_export;
mod chapter_selection;
mod aligned_translation;
mod git_conflicts;
mod history;
mod images;
mod row_fields;
mod row_structure;
mod shared;

pub(crate) use self::chapter_export::{export_gtms_chapter_file_sync, ExportChapterFileInput};
pub(crate) use self::aligned_translation::{
    apply_aligned_translation_to_gtms_chapter_sync,
    preflight_aligned_translation_to_gtms_chapter_sync, AlignedTranslationApplyInput,
    AlignedTranslationApplyResponse, AlignedTranslationPreflightInput,
    AlignedTranslationPreflightResponse,
};
use self::chapter_selection::{
    linked_chapter_glossary, preferred_source_language_code, preferred_target_language_code,
};
pub(crate) use self::chapter_selection::{
    update_gtms_chapter_glossary_links_sync, update_gtms_chapter_language_selection_sync,
    update_gtms_chapter_languages_sync,
};
pub(crate) use self::git_conflicts::{
    clear_imported_editor_conflict_entry, list_imported_editor_conflict_refs,
    persist_imported_editor_conflict_entries, repo_has_imported_editor_conflicts,
    resolve_chapter_json_git_conflict_from_stage_texts, resolve_row_git_conflict_from_stage_texts,
    ImportedEditorConflictRef, PendingImportedEditorConflictEntry, ResolvedEditorConflictAction,
};
pub(super) use self::history::{
    load_gtms_editor_field_history_sync, restore_gtms_editor_field_from_history_sync,
    reverse_gtms_editor_batch_replace_commit_sync,
};
use self::history::{
    load_latest_row_version_metadata, load_latest_row_version_metadata_by_path,
    status_note_for_field_flag,
};
use self::images::{editor_field_image_from_stored, row_uploaded_image_relative_paths};
pub(super) use self::images::{
    remove_gtms_editor_language_image_sync, save_gtms_editor_language_image_url_sync,
    upload_gtms_editor_language_image_sync,
};
use self::row_fields::apply_editor_text_style_update;
#[cfg(test)]
use self::row_fields::{
    apply_editor_field_flag_update, apply_editor_footnote_updates, apply_editor_plain_text_updates,
};
pub(crate) use self::row_fields::{
    apply_gtms_editor_ai_review_result_sync, clear_gtms_editor_reviewed_markers_sync,
    update_gtms_editor_row_field_flag_sync, update_gtms_editor_row_fields_batch_sync,
    update_gtms_editor_row_fields_sync, update_gtms_editor_row_text_style_sync,
};
#[cfg(test)]
use self::row_structure::create_inserted_editor_row;
#[cfg(test)]
use self::row_structure::create_inserted_row_file;
pub(crate) use self::row_structure::{
    insert_gtms_editor_row_sync, permanently_delete_gtms_editor_row_sync,
    update_gtms_editor_row_lifecycle_sync,
};
use self::shared::{
    apply_source_word_count_delta, build_source_word_counts_from_stored_rows,
    clear_editor_html_preview_cache, current_repo_head_sha, editor_row_from_stored_row_file,
    editor_row_from_stored_row_file_with_update, ensure_editor_field_object_defaults,
    load_editor_rows, load_project_chapter_summaries, load_source_word_counts,
    normalize_editor_footnote_value, normalize_editor_image_caption_value,
    normalize_editor_text_style_value, row_fields_object_mut, row_footnote_map,
    row_image_caption_map, row_object_mut, row_plain_text_map, row_text_style,
    sanitize_chapter_languages, set_editor_field_flags,
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
pub(crate) struct UpdateChapterLanguagesInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    full_name: String,
    #[serde(default)]
    repo_id: Option<i64>,
    #[serde(default)]
    default_branch_name: Option<String>,
    #[serde(default)]
    default_branch_head_oid: Option<String>,
    chapter_id: String,
    languages: Vec<ChapterLanguage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateChapterLanguagesResponse {
    chapter_id: String,
    languages: Vec<ChapterLanguage>,
    selected_source_language_code: Option<String>,
    selected_target_language_code: Option<String>,
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
    image_captions: BTreeMap<String, String>,
    #[serde(default)]
    base_fields: BTreeMap<String, String>,
    #[serde(default)]
    base_footnotes: BTreeMap<String, String>,
    #[serde(default)]
    base_image_captions: BTreeMap<String, String>,
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
    #[serde(default)]
    image_captions: BTreeMap<String, String>,
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
pub(crate) struct ApplyEditorAiReviewResultInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
    language_code: String,
    #[serde(default)]
    suggested_text: String,
    reviewed: bool,
    please_check: bool,
    #[serde(default)]
    ai_model: String,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClearImportedEditorConflictInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
    row_id: String,
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
    last_update: Option<EditorRowVersionMetadata>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyEditorAiReviewResultResponse {
    row_id: String,
    language_code: String,
    text: String,
    reviewed: bool,
    please_check: bool,
    last_update: Option<EditorRowVersionMetadata>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateEditorRowTextStyleResponse {
    row_id: String,
    text_style: String,
    last_update: Option<EditorRowVersionMetadata>,
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
    author_email: String,
    author_login: String,
    committed_at: String,
    message: String,
    operation_type: Option<String>,
    status_note: Option<String>,
    ai_model: Option<String>,
    plain_text: String,
    footnote: String,
    image_caption: String,
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
    image_caption: String,
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

#[derive(Clone, Serialize)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_update: Option<EditorRowVersionMetadata>,
    fields: BTreeMap<String, String>,
    footnotes: BTreeMap<String, String>,
    image_captions: BTreeMap<String, String>,
    images: BTreeMap<String, EditorFieldImage>,
    field_states: BTreeMap<String, EditorFieldState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    imported_conflict: Option<EditorRowImportedConflict>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorFieldState {
    reviewed: bool,
    please_check: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorRowImportedConflict {
    conflict_kind: String,
    remote_row: Box<EditorRow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_row: Option<Box<EditorRow>>,
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

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ChapterLanguage {
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
    base_image_captions: BTreeMap<String, String>,
    conflict_remote_version: Option<EditorRowVersionMetadata>,
    chapter_base_commit_sha: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorRowVersionMetadata {
    commit_sha: String,
    author_name: String,
    committed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ai_model: Option<String>,
}

#[derive(Deserialize, Serialize)]
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

#[derive(Deserialize, Serialize)]
struct StoredSourceFile {
    #[serde(default)]
    path_hint: String,
    file_metadata: StoredSourceFileMetadata,
}

#[derive(Deserialize, Default, Serialize)]
struct StoredSourceFileMetadata {
    source_locale: Option<String>,
}

#[derive(Deserialize, Default, Serialize)]
struct StoredChapterSettings {
    linked_glossaries: Option<StoredChapterLinkedGlossaries>,
    default_source_language: Option<String>,
    default_target_language: Option<String>,
}

#[derive(Clone, Deserialize, Default, Serialize)]
struct StoredChapterLinkedGlossaries {
    #[serde(default)]
    glossary: Option<StoredChapterGlossaryLink>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
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
    image_caption: String,
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
    author_email: String,
    author_login: String,
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
    let row_update_paths_by_id = rows
        .iter()
        .map(|row| {
            let row_json_path = chapter_path
                .join("rows")
                .join(format!("{}.json", row.row_id));
            repo_relative_path(&repo_path, &row_json_path)
                .map(|relative_path| (row.row_id.clone(), relative_path))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let latest_update_by_path = load_latest_row_version_metadata_by_path(
        &repo_path,
        &row_update_paths_by_id.values().cloned().collect::<Vec<_>>(),
    )?;
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
        rows: git_conflicts::overlay_imported_editor_conflict_rows(
            &repo_path,
            &input.chapter_id,
            rows.into_iter()
                .map(|row| {
                    let mut editor_row = editor_row_from_stored_row_file(&repo_path, row)?;
                    editor_row.last_update = row_update_paths_by_id
                        .get(&editor_row.row_id)
                        .and_then(|path| latest_update_by_path.get(path))
                        .cloned();
                    Ok::<EditorRow, String>(editor_row)
                })
                .collect::<Result<Vec<_>, _>>()?,
        )?,
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
        let mut editor_row = editor_row_from_stored_row_file(
            &repo_path,
            read_json_file(&row_json_path, "row file")?,
        )?;
        if let Some(relative_row_json) = relative_row_json.as_deref() {
            editor_row.last_update =
                load_latest_row_version_metadata(&repo_path, relative_row_json)?;
        }
        Some(editor_row)
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
        row: git_conflicts::overlay_imported_editor_conflict_row(
            &repo_path,
            &input.chapter_id,
            row,
        )?,
        chapter_base_commit_sha: git_output(&repo_path, &["rev-parse", "--verify", "HEAD"]).ok(),
        row_version,
    })
}

pub(crate) fn clear_gtms_editor_imported_conflict_sync(
    app: &AppHandle,
    input: ClearImportedEditorConflictInput,
) -> Result<(), String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    clear_imported_editor_conflict_entry(&repo_path, &input.chapter_id, &input.row_id)?;
    Ok(())
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
        apply_editor_plain_text_updates(
            &mut row_value,
            &[(String::from("es"), String::from("uno"))]
                .into_iter()
                .collect(),
        )
        .expect("plain text update should succeed");

        assert_eq!(row_value["fields"]["es"]["plain_text"], json!("uno"));
        assert_eq!(
            row_value["fields"]["es"]["html_preview"],
            json!("<p>uno</p>")
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
    fn apply_editor_text_style_update_accepts_centered_style() {
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
            }
          }
        });

        let (text_style, changed) = apply_editor_text_style_update(&mut row_value, "centered")
            .expect("text style update should succeed");

        assert!(changed);
        assert_eq!(text_style, "centered");
        assert_eq!(row_value["text_style"], json!("centered"));
        assert!(row_value["fields"]["es"].get("html_preview").is_none());
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
