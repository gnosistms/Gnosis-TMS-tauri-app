mod alignment_cancellation;
mod chapter_editor;
mod chapter_editor_comments;
mod chapter_import;
mod chapter_lifecycle;
mod import_sample;
mod link_import;
mod project_git;

use crate::installation_access::{
    ensure_installation_allows_chapter_writes, ensure_installation_allows_project_management,
};
use crate::state::ProjectImportBatchCancelStore;
use tauri::AppHandle;

pub(crate) use import_sample::save_project_import_sample;

pub(crate) use self::chapter_editor::{
    fetch_public_image_dimensions, list_imported_editor_conflict_refs,
    normalize_chapter_settings_value, persist_imported_editor_conflict_entries,
    repo_has_imported_editor_conflicts, resolve_chapter_json_git_conflict_from_stage_texts,
    resolve_export_settings_git_conflict, resolve_project_json_git_conflict_from_stage_texts,
    resolve_row_git_conflict_from_stage_texts, unescaped_footnote_marker_sequence,
    ImportedEditorConflictRef, PendingImportedEditorConflictEntry, ResolvedEditorConflictAction,
    EXPORT_SETTINGS_PATH,
};

#[tauri::command]
pub(crate) fn start_book_redundancy(
    app: AppHandle,
    input: chapter_editor::BookRedundancyInput,
) -> Result<(), String> {
    chapter_editor::start_book_redundancy_job(app, input)
}
#[tauri::command]
pub(crate) fn cancel_book_redundancy(request_id: String) -> Result<(), String> {
    chapter_editor::cancel_book_redundancy_job(&request_id)
}
#[tauri::command]
pub(crate) async fn book_redundancy_cache(
    app: AppHandle,
    input: chapter_editor::BookRedundancyCacheInput,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        chapter_editor::book_redundancy_cache_sync(&app, input)
    })
    .await
    .map_err(|_| "Could not load book review choices.".to_string())?
}
#[tauri::command]
pub(crate) async fn load_project_export_settings(
    app: AppHandle,
    input: chapter_editor::ProjectExportSettingsInput,
) -> Result<chapter_editor::ExportSettingsSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        chapter_editor::load_project_export_settings_sync(&app, input)
    })
    .await
    .map_err(|_| "Could not load local export settings.".to_string())?
}

#[tauri::command]
pub(crate) fn start_project_export_settings_sync(
    app: AppHandle,
    input: chapter_editor::ProjectExportSettingsInput,
) -> Result<(), String> {
    // The IPC path returns immediately. Access recovery and Git run on the job
    // worker; even an offline failure leaves the frontend's local draft intact.
    tauri::async_runtime::spawn(async move {
        let worker = app.clone();
        let request_id = input.request_id.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let preflight = if input.settings.is_some() {
                crate::installation_access::require_command_access(
                    &worker,
                    input.installation_id,
                    ensure_installation_allows_chapter_writes,
                )
            } else {
                Ok(())
            };
            chapter_editor::synchronize_export_settings_event(&worker, input, preflight)
        })
        .await;
        use tauri::Emitter;
        match result {
            Ok(event) => {
                let _ = app.emit("project-export-settings", event);
            }
            Err(_) => {
                let _ = app.emit("project-export-settings", serde_json::json!({
                "requestId": request_id, "settings": null, "error": "Could not synchronize export settings."
            }));
            }
        }
    });
    Ok(())
}

use self::{
    chapter_editor::{
        acknowledge_project_transfer_status, add_subtitle_translation_sync,
        apply_aligned_translation_to_gtms_chapter_sync, apply_gtms_editor_ai_review_result_sync,
        apply_gtms_editor_ai_review_results_batch_sync,
        approve_gtms_chapter_pdf_fonts as approve_gtms_chapter_pdf_fonts_task,
        cancel_gtms_chapter_pdf_export as cancel_gtms_chapter_pdf_export_task,
        clear_gtms_editor_imported_conflict_sync, clear_gtms_editor_reviewed_markers_sync,
        duplicate_gtms_editor_language_image_sync, export_gtms_chapter_file_sync,
        forget_gtms_pdf_font_approval as forget_gtms_pdf_font_approval_task,
        get_project_transfer_status, import_project_book_image_sync,
        initialize_gtms_project_repo_sync, insert_gtms_editor_row_sync,
        inspect_gtms_chapter_pdf_fonts as inspect_gtms_chapter_pdf_fonts_sync,
        list_local_gtms_project_files_sync, list_project_transfer_statuses,
        load_gtms_chapter_editor_data_sync, load_gtms_editor_changed_after_my_edit_sync,
        load_gtms_editor_field_history_sync, load_gtms_editor_row_sync,
        merge_gtms_editor_rows_sync, permanently_delete_gtms_editor_row_sync,
        preflight_aligned_translation_to_gtms_chapter_sync, purge_local_gtms_project_repo_sync,
        remove_gtms_editor_language_image_sync, restore_gtms_editor_field_from_history_sync,
        reverse_gtms_editor_batch_replace_commit_sync, save_gtms_editor_language_image_url_sync,
        start_gtms_chapter_pdf_export as start_gtms_chapter_pdf_export_task,
        start_project_book_page_preview as start_project_book_page_preview_task,
        start_project_book_preview_fonts as start_project_book_preview_fonts_task,
        start_project_transfer, start_team_chapter_copy, start_wordpress_caption_enrichment,
        update_gtms_chapter_glossary_links_sync, update_gtms_chapter_language_selection_sync,
        update_gtms_chapter_languages_sync, update_gtms_chapter_workflow_status_sync,
        update_gtms_editor_row_field_flag_sync, update_gtms_editor_row_fields_batch_sync,
        update_gtms_editor_row_fields_sync, update_gtms_editor_row_lifecycle_sync,
        update_gtms_editor_row_text_style_sync, upload_gtms_editor_language_image_sync,
        AddSubtitleTranslationInput, AlignedTranslationApplyInput, AlignedTranslationApplyResponse,
        AlignedTranslationPreflightInput, AlignedTranslationPreflightResponse,
        ApplyEditorAiReviewResultInput, ApplyEditorAiReviewResultResponse,
        ApplyEditorAiReviewResultsBatchInput, ApplyEditorAiReviewResultsBatchResponse,
        BookPagePreviewInput, BookPreviewFontsInput, ClearEditorReviewedMarkersInput,
        ClearEditorReviewedMarkersResponse, ClearImportedEditorConflictInput,
        DuplicateEditorLanguageImageInput, ExportChapterFileInput, ExportChapterFileResponse,
        ImportBookImageInput, ImportedBookImage, InitializeProjectRepoInput,
        InitializeProjectRepoResponse, InsertEditorRowInput, InsertEditorRowResponse,
        ListLocalProjectFilesInput, LoadChapterEditorInput, LoadChapterEditorResponse,
        LoadEditorChangedAfterMyEditInput, LoadEditorChangedAfterMyEditResponse,
        LoadEditorFieldHistoryInput, LoadEditorFieldHistoryResponse, LoadEditorRowInput,
        LoadEditorRowResponse, LocalProjectFilesResponse, MergeEditorRowsInput,
        MergeEditorRowsResponse, PdfChapterExportInput, PdfFontInspection, PdfFontInspectionInput,
        ProjectTransferInput, ProjectTransferStatus, ProjectTransferStatusInput,
        PurgeLocalProjectRepoInput, RemoveEditorLanguageImageInput, RestoreEditorFieldHistoryInput,
        RestoreEditorFieldHistoryResponse, ReverseEditorBatchReplaceCommitInput,
        ReverseEditorBatchReplaceCommitResponse, SaveEditorLanguageImageResponse,
        SaveEditorLanguageImageUrlInput, SaveEditorRowWithConcurrencyResponse,
        TeamChapterCopyInput, UpdateChapterGlossaryLinksInput, UpdateChapterGlossaryLinksResponse,
        UpdateChapterLanguageSelectionInput, UpdateChapterLanguageSelectionResponse,
        UpdateChapterLanguagesInput, UpdateChapterLanguagesResponse,
        UpdateChapterWorkflowStatusInput, UpdateChapterWorkflowStatusResponse,
        UpdateEditorRowFieldFlagInput, UpdateEditorRowFieldFlagResponse,
        UpdateEditorRowFieldsBatchInput, UpdateEditorRowFieldsBatchResponse,
        UpdateEditorRowFieldsInput, UpdateEditorRowLifecycleInput,
        UpdateEditorRowLifecycleResponse, UpdateEditorRowTextStyleInput,
        UpdateEditorRowTextStyleResponse, UploadEditorLanguageImageInput,
    },
    chapter_editor_comments::{
        delete_gtms_editor_row_comment_sync, load_gtms_editor_row_comments_sync,
        save_gtms_editor_row_comment_sync, DeleteEditorRowCommentInput,
        DeleteEditorRowCommentResponse, LoadEditorRowCommentsInput, LoadEditorRowCommentsResponse,
        SaveEditorRowCommentInput, SaveEditorRowCommentResponse,
    },
    chapter_import::{
        extract_project_translation_text_sync, import_docx_to_gtms_sync, import_html_to_gtms_sync,
        import_project_files_to_gtms_sync, import_srt_to_gtms_sync, import_txt_to_gtms_sync,
        import_xlsx_to_gtms_sync, ExtractProjectTranslationTextInput,
        ExtractProjectTranslationTextResponse, ImportDocxInput, ImportHtmlInput,
        ImportProjectFilesInput, ImportProjectFilesResponse, ImportSrtInput, ImportTxtInput,
        ImportXlsxInput, ImportXlsxResponse,
    },
    chapter_lifecycle::{
        clear_deleted_gtms_chapters_sync, permanently_delete_gtms_chapter_sync,
        rename_gtms_chapter_sync, update_gtms_chapter_lifecycle_sync, ClearDeletedChaptersInput,
        ClearDeletedChaptersResponse, RenameChapterInput, RenameChapterResponse,
        UpdateChapterLifecycleInput, UpdateChapterLifecycleResponse,
    },
    link_import::{
        resolve_project_import_link_sync, ResolveProjectImportLinkInput,
        ResolveProjectImportLinkResponse,
    },
};

#[tauri::command]
pub(crate) async fn initialize_gtms_project_repo(
    app: AppHandle,
    input: InitializeProjectRepoInput,
) -> Result<InitializeProjectRepoResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        initialize_gtms_project_repo_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The local project repo initialization worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_xlsx_to_gtms(
    app: AppHandle,
    input: ImportXlsxInput,
) -> Result<ImportXlsxResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        import_xlsx_to_gtms_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The XLSX import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_txt_to_gtms(
    app: AppHandle,
    input: ImportTxtInput,
) -> Result<ImportXlsxResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        import_txt_to_gtms_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The TXT import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_srt_to_gtms(
    app: AppHandle,
    input: ImportSrtInput,
) -> Result<ImportXlsxResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        import_srt_to_gtms_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The SRT import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_docx_to_gtms(
    app: AppHandle,
    input: ImportDocxInput,
) -> Result<ImportXlsxResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        import_docx_to_gtms_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The DOCX import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_html_to_gtms(
    app: AppHandle,
    input: ImportHtmlInput,
) -> Result<ImportXlsxResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        import_html_to_gtms_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The HTML import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_project_files_to_gtms(
    app: AppHandle,
    cancel_store: tauri::State<'_, ProjectImportBatchCancelStore>,
    input: ImportProjectFilesInput,
) -> Result<ImportProjectFilesResponse, String> {
    let canceled_batch_ids = cancel_store.canceled_batch_ids.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        import_project_files_to_gtms_sync(&app, canceled_batch_ids, input)
    })
    .await
    .map_err(|error| format!("The project files import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cancel_project_import_batch(
    cancel_store: tauri::State<'_, ProjectImportBatchCancelStore>,
    batch_id: String,
) -> Result<(), String> {
    let normalized_batch_id = batch_id.trim();
    if normalized_batch_id.is_empty() {
        return Ok(());
    }
    cancel_store
        .canceled_batch_ids
        .lock()
        .map_err(|_| "The project import cancellation state is unavailable.".to_string())?
        .insert(normalized_batch_id.to_string());
    Ok(())
}

#[tauri::command]
pub(crate) async fn resolve_project_import_link(
    input: ResolveProjectImportLinkInput,
) -> Result<ResolveProjectImportLinkResponse, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_project_import_link_sync(input))
        .await
        .map_err(|error| format!("The link import worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn extract_project_translation_text(
    input: ExtractProjectTranslationTextInput,
) -> Result<ExtractProjectTranslationTextResponse, String> {
    tauri::async_runtime::spawn_blocking(move || extract_project_translation_text_sync(input))
        .await
        .map_err(|error| format!("The translation text extraction worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_project_book_image(
    app: AppHandle,
    input: ImportBookImageInput,
) -> Result<ImportedBookImage, String> {
    tauri::async_runtime::spawn_blocking(move || import_project_book_image_sync(&app, input))
        .await
        .map_err(|error| format!("The book image worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn export_gtms_chapter_file(
    app: AppHandle,
    input: ExportChapterFileInput,
) -> Result<ExportChapterFileResponse, String> {
    tauri::async_runtime::spawn_blocking(move || export_gtms_chapter_file_sync(&app, input))
        .await
        .map_err(|error| format!("The chapter export worker failed: {error}"))?
}

/// Returns immediately with a job id. PDF preparation, one-time font download,
/// and Typst compilation report through `chapter-pdf-export-progress` events.
#[tauri::command]
pub(crate) async fn start_gtms_chapter_pdf_export(
    app: AppHandle,
    input: PdfChapterExportInput,
) -> Result<String, String> {
    start_gtms_chapter_pdf_export_task(app, input)
}

/// Returns immediately; `book-preview-fonts` delivers cached PDF fonts and metrics.
#[tauri::command]
pub(crate) fn start_project_book_preview_fonts(
    app: AppHandle,
    input: BookPreviewFontsInput,
) -> Result<(), String> {
    start_project_book_preview_fonts_task(app, input)
}

/// Starts immediately; `book-page-preview` reports rendered SVG pages or errors
/// keyed by the caller's requestId, without blocking the IPC path.
#[tauri::command]
pub(crate) fn start_project_book_page_preview(
    app: AppHandle,
    input: BookPagePreviewInput,
) -> Result<(), String> {
    start_project_book_page_preview_task(app, input)
}

#[tauri::command]
pub(crate) async fn inspect_gtms_chapter_pdf_fonts(
    app: AppHandle,
    input: PdfFontInspectionInput,
) -> Result<PdfFontInspection, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_gtms_chapter_pdf_fonts_sync(&app, input))
        .await
        .map_err(|error| format!("The PDF font inspection worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn cancel_gtms_chapter_pdf_export(job_id: String) -> Result<bool, String> {
    cancel_gtms_chapter_pdf_export_task(&job_id)
}

#[tauri::command]
pub(crate) async fn approve_gtms_chapter_pdf_fonts(
    app: AppHandle,
    job_id: String,
    review_id: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        approve_gtms_chapter_pdf_fonts_task(&app, &job_id, &review_id)
    })
    .await
    .map_err(|_| "Could not save the PDF font approval.".to_string())?
}

#[tauri::command]
pub(crate) async fn forget_gtms_pdf_font_approval(
    app: AppHandle,
    font_id: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || forget_gtms_pdf_font_approval_task(&app, &font_id))
        .await
        .map_err(|_| "Could not forget the PDF font approval.".to_string())?
}

/// Returns immediately after validation; the copy runs in a background task
/// and reports via `team-chapter-copy-progress` events keyed by `jobId`.
#[tauri::command]
pub(crate) async fn copy_gtms_chapter_to_team(
    app: AppHandle,
    input: TeamChapterCopyInput,
    session_token: String,
) -> Result<(), String> {
    start_team_chapter_copy(app, input, session_token)
}

/// Returns immediately after validation; the transfer runs in a background
/// task and reports via `team-project-transfer-progress` events keyed by
/// `jobId`.
#[tauri::command]
pub(crate) async fn transfer_gtms_project_to_team(
    app: AppHandle,
    input: ProjectTransferInput,
    session_token: String,
) -> Result<(), String> {
    start_project_transfer(app, input, session_token)
}

#[tauri::command]
pub(crate) async fn get_gtms_project_transfer_status(
    app: AppHandle,
    input: ProjectTransferStatusInput,
) -> Result<Option<ProjectTransferStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || get_project_transfer_status(&app, input))
        .await
        .map_err(|error| format!("The project transfer status worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gtms_project_transfer_statuses(
    app: AppHandle,
) -> Result<Vec<ProjectTransferStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || list_project_transfer_statuses(&app))
        .await
        .map_err(|error| format!("The project transfer status listing worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn acknowledge_gtms_project_transfer_status(
    app: AppHandle,
    input: ProjectTransferStatusInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || acknowledge_project_transfer_status(&app, input))
        .await
        .map_err(|error| format!("The project transfer acknowledgement worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn preflight_aligned_translation_to_gtms_chapter(
    app: AppHandle,
    input: AlignedTranslationPreflightInput,
    request_id: Option<String>,
) -> Result<AlignedTranslationPreflightResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        let cancellation = alignment_cancellation::Registration::new(request_id)?;
        cancellation.run(|| preflight_aligned_translation_to_gtms_chapter_sync(&app, input))
    })
    .await
    .map_err(|error| format!("The aligned translation preflight worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn apply_aligned_translation_to_gtms_chapter(
    app: AppHandle,
    input: AlignedTranslationApplyInput,
    request_id: Option<String>,
) -> Result<AlignedTranslationApplyResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        let cancellation = alignment_cancellation::Registration::new(request_id)?;
        cancellation.run(|| apply_aligned_translation_to_gtms_chapter_sync(&app, input))
    })
    .await
    .map_err(|error| format!("The aligned translation apply worker failed: {error}"))?
}

#[tauri::command]
pub(crate) fn cancel_aligned_translation(request_id: String) -> Result<bool, String> {
    alignment_cancellation::cancel(&request_id)
}

#[tauri::command]
/// Returns immediately after access preflight; results arrive on subtitle-translation-result.
pub(crate) async fn add_srt_translation_to_gtms_chapter(
    app: AppHandle,
    input: AddSubtitleTranslationInput,
    request_id: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        let request_id = request_id.unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
        let cancellation = alignment_cancellation::Registration::new(Some(request_id.clone()))?;
        let completion_app = app.clone();
        let worker = tauri::async_runtime::spawn_blocking(move || {
            cancellation.run(|| add_subtitle_translation_sync(&app, input))
        });
        tauri::async_runtime::spawn(async move {
            let result = worker
                .await
                .unwrap_or_else(|_| Err("The subtitle translation worker failed.".into()));
            let payload = match result {
                Ok(response) => serde_json::json!({"requestId":request_id,"response":response}),
                Err(error) => serde_json::json!({"requestId":request_id,"error":error}),
            };
            let _ = tauri::Emitter::emit(&completion_app, "subtitle-translation-result", payload);
        });
        Ok(serde_json::json!({"status":"started"}))
    })
    .await
    .map_err(|_| "Could not start subtitle translation.".to_string())?
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
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        update_gtms_chapter_language_selection_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The chapter settings worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_chapter_languages(
    app: AppHandle,
    input: UpdateChapterLanguagesInput,
    session_token: String,
) -> Result<UpdateChapterLanguagesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        update_gtms_chapter_languages_sync(&app, input, &session_token)
    })
    .await
    .map_err(|error| format!("The chapter languages worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_chapter_glossary_links(
    app: AppHandle,
    input: UpdateChapterGlossaryLinksInput,
) -> Result<UpdateChapterGlossaryLinksResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        update_gtms_chapter_glossary_links_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The chapter glossary worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_chapter_workflow_status(
    app: AppHandle,
    input: UpdateChapterWorkflowStatusInput,
) -> Result<UpdateChapterWorkflowStatusResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        update_gtms_chapter_workflow_status_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The chapter status worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_editor_row_fields(
    app: AppHandle,
    input: UpdateEditorRowFieldsInput,
) -> Result<SaveEditorRowWithConcurrencyResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        update_gtms_editor_row_fields_sync(&app, input)
    })
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
pub(crate) async fn clear_gtms_editor_imported_conflict(
    app: AppHandle,
    input: ClearImportedEditorConflictInput,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        clear_gtms_editor_imported_conflict_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The imported row conflict clear worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_editor_row_fields_batch(
    app: AppHandle,
    input: UpdateEditorRowFieldsBatchInput,
) -> Result<UpdateEditorRowFieldsBatchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        update_gtms_editor_row_fields_batch_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row batch update worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn merge_gtms_editor_rows(
    app: AppHandle,
    input: MergeEditorRowsInput,
) -> Result<MergeEditorRowsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        merge_gtms_editor_rows_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row merge worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn insert_gtms_editor_row_before(
    app: AppHandle,
    input: InsertEditorRowInput,
) -> Result<InsertEditorRowResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        insert_gtms_editor_row_sync(&app, input, true)
    })
    .await
    .map_err(|error| format!("The row insert worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn insert_gtms_editor_row_after(
    app: AppHandle,
    input: InsertEditorRowInput,
) -> Result<InsertEditorRowResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        insert_gtms_editor_row_sync(&app, input, false)
    })
    .await
    .map_err(|error| format!("The row insert worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_editor_row_field_flag(
    app: AppHandle,
    input: UpdateEditorRowFieldFlagInput,
) -> Result<UpdateEditorRowFieldFlagResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        update_gtms_editor_row_field_flag_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row flag update worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn update_gtms_editor_row_text_style(
    app: AppHandle,
    input: UpdateEditorRowTextStyleInput,
) -> Result<UpdateEditorRowTextStyleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        update_gtms_editor_row_text_style_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row text style worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_gtms_editor_language_image_url(
    app: AppHandle,
    input: SaveEditorLanguageImageUrlInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    let worker_app = app.clone();
    let worker_input = input.clone();
    let response = tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &worker_app,
            worker_input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        save_gtms_editor_language_image_url_sync(&worker_app, worker_input)
    })
    .await
    .map_err(|error| format!("The row image URL worker failed: {error}"))??;
    start_wordpress_caption_enrichment(app, input, &response);
    Ok(response)
}

#[tauri::command]
pub(crate) async fn upload_gtms_editor_language_image(
    app: AppHandle,
    input: UploadEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        upload_gtms_editor_language_image_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row image upload worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn remove_gtms_editor_language_image(
    app: AppHandle,
    input: RemoveEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        remove_gtms_editor_language_image_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row image removal worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn duplicate_gtms_editor_language_image(
    app: AppHandle,
    input: DuplicateEditorLanguageImageInput,
) -> Result<SaveEditorLanguageImageResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        duplicate_gtms_editor_language_image_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row image duplication worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn clear_gtms_editor_reviewed_markers(
    app: AppHandle,
    input: ClearEditorReviewedMarkersInput,
) -> Result<ClearEditorReviewedMarkersResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        clear_gtms_editor_reviewed_markers_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The reviewed marker batch update worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn apply_gtms_editor_ai_review_result(
    app: AppHandle,
    input: ApplyEditorAiReviewResultInput,
) -> Result<ApplyEditorAiReviewResultResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        apply_gtms_editor_ai_review_result_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The AI review result worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn apply_gtms_editor_ai_review_results_batch(
    app: AppHandle,
    input: ApplyEditorAiReviewResultsBatchInput,
) -> Result<ApplyEditorAiReviewResultsBatchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        apply_gtms_editor_ai_review_results_batch_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The AI review batch result worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn soft_delete_gtms_editor_row(
    app: AppHandle,
    input: UpdateEditorRowLifecycleInput,
) -> Result<UpdateEditorRowLifecycleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
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
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
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
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
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
pub(crate) async fn load_gtms_editor_changed_after_my_edit(
    app: AppHandle,
    input: LoadEditorChangedAfterMyEditInput,
) -> Result<LoadEditorChangedAfterMyEditResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        load_gtms_editor_changed_after_my_edit_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The changed-rows worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn restore_gtms_editor_field_from_history(
    app: AppHandle,
    input: RestoreEditorFieldHistoryInput,
) -> Result<RestoreEditorFieldHistoryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
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
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        save_gtms_editor_row_comment_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row comment save worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn delete_gtms_editor_row_comment(
    app: AppHandle,
    input: DeleteEditorRowCommentInput,
) -> Result<DeleteEditorRowCommentResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
        delete_gtms_editor_row_comment_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The row comment delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn reverse_gtms_editor_batch_replace_commit(
    app: AppHandle,
    input: ReverseEditorBatchReplaceCommitInput,
) -> Result<ReverseEditorBatchReplaceCommitResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_chapter_writes,
        )?;
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
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        rename_gtms_chapter_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The chapter rename worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn soft_delete_gtms_chapter(
    app: AppHandle,
    input: UpdateChapterLifecycleInput,
) -> Result<UpdateChapterLifecycleResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
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
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
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
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        permanently_delete_gtms_chapter_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The chapter permanent delete worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn clear_deleted_gtms_chapters(
    app: AppHandle,
    input: ClearDeletedChaptersInput,
) -> Result<ClearDeletedChaptersResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::installation_access::require_command_access(
            &app,
            input.installation_id,
            ensure_installation_allows_project_management,
        )?;
        clear_deleted_gtms_chapters_sync(&app, input)
    })
    .await
    .map_err(|error| format!("The clear deleted files worker failed: {error}"))?
}
