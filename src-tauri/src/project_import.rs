mod chapter_editor;
mod chapter_editor_comments;
mod chapter_import;
mod chapter_lifecycle;
mod project_git;

use tauri::AppHandle;

use self::{
    chapter_editor::{
        clear_gtms_editor_reviewed_markers_sync, initialize_gtms_project_repo_sync,
        insert_gtms_editor_row_sync, list_local_gtms_project_files_sync,
        load_gtms_chapter_editor_data_sync, load_gtms_editor_field_history_sync,
        load_gtms_editor_row_sync, permanently_delete_gtms_editor_row_sync,
        purge_local_gtms_project_repo_sync, restore_gtms_editor_field_from_history_sync,
        reverse_gtms_editor_batch_replace_commit_sync, update_gtms_chapter_glossary_links_sync,
        update_gtms_chapter_language_selection_sync, update_gtms_editor_row_field_flag_sync,
        update_gtms_editor_row_fields_batch_sync, update_gtms_editor_row_fields_sync,
        update_gtms_editor_row_lifecycle_sync, ClearEditorReviewedMarkersInput,
        ClearEditorReviewedMarkersResponse,
        InitializeProjectRepoInput, InitializeProjectRepoResponse, InsertEditorRowInput,
        InsertEditorRowResponse, ListLocalProjectFilesInput, LoadChapterEditorInput,
        LoadChapterEditorResponse, LoadEditorFieldHistoryInput, LoadEditorFieldHistoryResponse,
        LoadEditorRowInput, LoadEditorRowResponse, LocalProjectFilesResponse,
        PurgeLocalProjectRepoInput, RestoreEditorFieldHistoryInput,
        RestoreEditorFieldHistoryResponse, ReverseEditorBatchReplaceCommitInput,
        ReverseEditorBatchReplaceCommitResponse, SaveEditorRowWithConcurrencyResponse,
        UpdateChapterGlossaryLinksInput, UpdateChapterGlossaryLinksResponse,
        UpdateChapterLanguageSelectionInput, UpdateChapterLanguageSelectionResponse,
        UpdateEditorRowFieldFlagInput, UpdateEditorRowFieldFlagResponse,
        UpdateEditorRowFieldsBatchInput, UpdateEditorRowFieldsBatchResponse,
        UpdateEditorRowFieldsInput, UpdateEditorRowLifecycleInput,
        UpdateEditorRowLifecycleResponse,
    },
    chapter_editor_comments::{
        delete_gtms_editor_row_comment_sync, load_gtms_editor_row_comments_sync,
        save_gtms_editor_row_comment_sync, DeleteEditorRowCommentInput,
        DeleteEditorRowCommentResponse, LoadEditorRowCommentsInput, LoadEditorRowCommentsResponse,
        SaveEditorRowCommentInput, SaveEditorRowCommentResponse,
    },
    chapter_import::{import_xlsx_to_gtms_sync, ImportXlsxInput, ImportXlsxResponse},
    chapter_lifecycle::{
        permanently_delete_gtms_chapter_sync, rename_gtms_chapter_sync,
        update_gtms_chapter_lifecycle_sync, RenameChapterInput, RenameChapterResponse,
        UpdateChapterLifecycleInput, UpdateChapterLifecycleResponse,
    },
};

#[tauri::command]
pub(crate) async fn initialize_gtms_project_repo(
    app: AppHandle,
    input: InitializeProjectRepoInput,
) -> Result<InitializeProjectRepoResponse, String> {
    tauri::async_runtime::spawn_blocking(move || initialize_gtms_project_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The local project repo initialization worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_xlsx_to_gtms(
    app: AppHandle,
    input: ImportXlsxInput,
) -> Result<ImportXlsxResponse, String> {
    tauri::async_runtime::spawn_blocking(move || import_xlsx_to_gtms_sync(&app, input))
        .await
        .map_err(|error| format!("The XLSX import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_chapter_editor_data(
    app: AppHandle,
    input: LoadChapterEditorInput,
) -> Result<LoadChapterEditorResponse, String> {
    tauri::async_runtime::spawn_blocking(move || load_gtms_chapter_editor_data_sync(&app, input))
        .await
        .map_err(|error| format!("The chapter load worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_local_gtms_project_files(
    app: AppHandle,
    input: ListLocalProjectFilesInput,
) -> Result<Vec<LocalProjectFilesResponse>, String> {
    tauri::async_runtime::spawn_blocking(move || list_local_gtms_project_files_sync(&app, input))
        .await
        .map_err(|error| format!("The local project file listing worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn purge_local_gtms_project_repo(
    app: AppHandle,
    input: PurgeLocalProjectRepoInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || purge_local_gtms_project_repo_sync(&app, input))
        .await
        .map_err(|error| format!("The local project repo removal worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_chapter_language_selection(
    app: AppHandle,
    input: UpdateChapterLanguageSelectionInput,
) -> Result<UpdateChapterLanguageSelectionResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_chapter_language_selection_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The chapter settings worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_chapter_glossary_links(
    app: AppHandle,
    input: UpdateChapterGlossaryLinksInput,
) -> Result<UpdateChapterGlossaryLinksResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_chapter_glossary_links_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The chapter glossary worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_editor_row_fields(
    app: AppHandle,
    input: UpdateEditorRowFieldsInput,
) -> Result<SaveEditorRowWithConcurrencyResponse, String> {
    tauri::async_runtime::spawn_blocking(move || update_gtms_editor_row_fields_sync(&app, input))
        .await
        .map_err(|error| format!("The row update worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_editor_row(
    app: AppHandle,
    input: LoadEditorRowInput,
) -> Result<LoadEditorRowResponse, String> {
    tauri::async_runtime::spawn_blocking(move || load_gtms_editor_row_sync(&app, input))
        .await
        .map_err(|error| format!("The row reload worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_editor_row_fields_batch(
    app: AppHandle,
    input: UpdateEditorRowFieldsBatchInput,
) -> Result<UpdateEditorRowFieldsBatchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_editor_row_fields_batch_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row batch update worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn insert_gtms_editor_row_before(
    app: AppHandle,
    input: InsertEditorRowInput,
) -> Result<InsertEditorRowResponse, String> {
    tauri::async_runtime::spawn_blocking(move || insert_gtms_editor_row_sync(&app, input, true))
        .await
        .map_err(|error| format!("The row insert worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn insert_gtms_editor_row_after(
    app: AppHandle,
    input: InsertEditorRowInput,
) -> Result<InsertEditorRowResponse, String> {
    tauri::async_runtime::spawn_blocking(move || insert_gtms_editor_row_sync(&app, input, false))
        .await
        .map_err(|error| format!("The row insert worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_editor_row_field_flag(
    app: AppHandle,
    input: UpdateEditorRowFieldFlagInput,
) -> Result<UpdateEditorRowFieldFlagResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_editor_row_field_flag_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row flag update worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn clear_gtms_editor_reviewed_markers(
    app: AppHandle,
    input: ClearEditorReviewedMarkersInput,
) -> Result<ClearEditorReviewedMarkersResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        clear_gtms_editor_reviewed_markers_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The reviewed marker batch update worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn soft_delete_gtms_editor_row(
    app: AppHandle,
    input: UpdateEditorRowLifecycleInput,
) -> Result<UpdateEditorRowLifecycleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_editor_row_lifecycle_sync(&app, input, "deleted")
    })
    .await
    .map_err(|error| format!("The row delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn restore_gtms_editor_row(
    app: AppHandle,
    input: UpdateEditorRowLifecycleInput,
) -> Result<UpdateEditorRowLifecycleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_editor_row_lifecycle_sync(&app, input, "active")
    })
    .await
    .map_err(|error| format!("The row restore worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn permanently_delete_gtms_editor_row(
    app: AppHandle,
    input: UpdateEditorRowLifecycleInput,
) -> Result<UpdateEditorRowLifecycleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        permanently_delete_gtms_editor_row_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row permanent delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_editor_field_history(
    app: AppHandle,
    input: LoadEditorFieldHistoryInput,
) -> Result<LoadEditorFieldHistoryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || load_gtms_editor_field_history_sync(&app, input))
        .await
        .map_err(|error| format!("The row history worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn restore_gtms_editor_field_from_history(
    app: AppHandle,
    input: RestoreEditorFieldHistoryInput,
) -> Result<RestoreEditorFieldHistoryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        restore_gtms_editor_field_from_history_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row history restore worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_gtms_editor_row_comments(
    app: AppHandle,
    input: LoadEditorRowCommentsInput,
) -> Result<LoadEditorRowCommentsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || load_gtms_editor_row_comments_sync(&app, input))
        .await
        .map_err(|error| format!("The row comments worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_gtms_editor_row_comment(
    app: AppHandle,
    input: SaveEditorRowCommentInput,
) -> Result<SaveEditorRowCommentResponse, String> {
    tauri::async_runtime::spawn_blocking(move || save_gtms_editor_row_comment_sync(&app, input))
        .await
        .map_err(|error| format!("The row comment save worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_gtms_editor_row_comment(
    app: AppHandle,
    input: DeleteEditorRowCommentInput,
) -> Result<DeleteEditorRowCommentResponse, String> {
    tauri::async_runtime::spawn_blocking(move || delete_gtms_editor_row_comment_sync(&app, input))
        .await
        .map_err(|error| format!("The row comment delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn reverse_gtms_editor_batch_replace_commit(
    app: AppHandle,
    input: ReverseEditorBatchReplaceCommitInput,
) -> Result<ReverseEditorBatchReplaceCommitResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        reverse_gtms_editor_batch_replace_commit_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The batch replace undo worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn rename_gtms_chapter(
    app: AppHandle,
    input: RenameChapterInput,
) -> Result<RenameChapterResponse, String> {
    tauri::async_runtime::spawn_blocking(move || rename_gtms_chapter_sync(&app, input))
        .await
        .map_err(|error| format!("The chapter rename worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn soft_delete_gtms_chapter(
    app: AppHandle,
    input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_chapter_lifecycle_sync(&app, input, "deleted")
    })
    .await
    .map_err(|error| format!("The chapter delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn restore_gtms_chapter(
    app: AppHandle,
    input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_gtms_chapter_lifecycle_sync(&app, input, "active")
    })
    .await
    .map_err(|error| format!("The chapter restore worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn permanently_delete_gtms_chapter(
    app: AppHandle,
    input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || permanently_delete_gtms_chapter_sync(&app, input))
        .await
        .map_err(|error| format!("The chapter permanent delete worker failed: {error}"))?
}
