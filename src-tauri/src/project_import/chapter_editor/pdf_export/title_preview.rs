use super::super::book_export::{section_document, BookPart};
use super::*;

const PREVIEW_EVENT: &str = "book-title-preview";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TitlePagePreviewInput {
    request_id: String,
    language_code: String,
    paper_size: String,
    item: BookItemInput,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TitlePagePreviewResult {
    request_id: String,
    pages: Vec<String>,
    error: String,
}

/// Returns immediately; `book-title-preview` delivers self-contained SVG pages
/// or an error keyed by requestId. A newer request cancels the previous job.
pub(crate) fn start_project_book_title_preview(
    app: AppHandle,
    input: TitlePagePreviewInput,
) -> Result<(), String> {
    if input.item.kind != "title" || input.request_id.is_empty() {
        return Err("Select a title page to preview.".into());
    }
    normalize_pdf_paper_size(&input.paper_size)?;
    if let Some(script) = unsupported_pdf_language(&input.language_code) {
        return Err(format!(
            "The title preview does not yet include the {script} print fonts."
        ));
    }
    static ACTIVE: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
    let cancelled = Arc::new(AtomicBool::new(false));
    let mut active = ACTIVE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Could not start the title preview. Please try again.".to_string())?;
    if let Some(previous) = active.replace(cancelled.clone()) {
        previous.store(true, Ordering::Release);
    }
    tauri::async_runtime::spawn(async move {
        let request_id = input.request_id.clone();
        let result = render_title_preview(&app, input, cancelled.clone()).await;
        if cancelled.load(Ordering::Acquire) {
            return;
        }
        let (pages, error) = match result {
            Ok(pages) => (pages, String::new()),
            Err(error) => (Vec::new(), error),
        };
        let _ = app.emit(
            PREVIEW_EVENT,
            TitlePagePreviewResult {
                request_id,
                pages,
                error,
            },
        );
    });
    Ok(())
}

async fn render_title_preview(
    app: &AppHandle,
    input: TitlePagePreviewInput,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<String>, String> {
    let prepare_app = app.clone();
    let prepare_cancelled = cancelled.clone();
    let (prepared, font_dir) = tauri::async_runtime::spawn_blocking(move || {
        check_cancelled(&prepare_cancelled)?;
        let section = section_document(&prepare_app, &input.item, &input.language_code, &[])?;
        let document = ExportDocument {
            title: input.item.title.clone(),
            language_code: input.language_code,
            blocks: Vec::new(),
            book_parts: vec![BookPart {
                item: input.item,
                document: section,
            }],
        };
        let font_dir = ensure_fonts(
            &prepare_app,
            &input.request_id,
            required_fonts_for_document(&document),
            &prepare_cancelled,
        )?;
        // A preview must never switch or evict the user's active book/chapter
        // export cache. Its only image is the local publisher-logo asset.
        let session = PdfImageCacheSession {
            scope: PdfImageCacheScope {
                installation_id: 0,
                repo_name: String::new(),
                project_id: None,
                project_full_name: None,
                target: PdfImageCacheTarget::Book,
            },
            generation: None,
        };
        let options = PdfWorkspacePreparationOptions {
            paper_size: normalize_pdf_paper_size(&input.paper_size)?,
            footnote_links_as_plain_text: true,
            image_cache_session: &session,
        };
        let prepared = prepare_pdf_workspace(
            &prepare_app,
            &input.request_id,
            &document,
            &font_dir,
            &options,
            &prepare_cancelled,
        )?;
        Ok::<_, String>((prepared, font_dir))
    })
    .await
    .map_err(|_| "Could not prepare the title preview. Please try again.".to_string())??;
    let _cleanup = WorkspaceCleanup(prepared.workspace.clone());
    compile_typst(
        app,
        &prepared.workspace,
        &font_dir,
        &prepared.fallback_fonts,
        "chapter.typ",
        "title-{p}.svg",
        &cancelled,
    )
    .await?;
    tauri::async_runtime::spawn_blocking(move || read_preview_pages(&prepared.workspace))
        .await
        .map_err(|_| "Could not read the title preview. Please try again.".to_string())?
}

fn read_preview_pages(workspace: &Path) -> Result<Vec<String>, String> {
    let mut pages = Vec::new();
    for index in 1.. {
        let path = workspace.join(format!("title-{index}.svg"));
        if !path.is_file() {
            break;
        }
        let bytes = fs::read(path).map_err(|_| "Could not read the title preview.".to_string())?;
        pages.push(format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    }
    if pages.is_empty() {
        return Err("The typesetter did not produce a title preview. Please try again.".into());
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_rendered_page_as_image_data_and_reports_missing_output() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        assert!(read_preview_pages(&workspace).is_err());
        for index in 1..=2 {
            fs::write(
                workspace.join(format!("title-{index}.svg")),
                format!("<svg>{index}</svg>"),
            )
            .unwrap();
        }
        let pages = read_preview_pages(&workspace).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[1], "data:image/svg+xml;base64,PHN2Zz4yPC9zdmc+");
    }
}
