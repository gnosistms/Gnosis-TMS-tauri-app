use super::super::book_export::{section_document, BookPart};
use super::*;

const PREVIEW_EVENT: &str = "book-page-preview";
/// Paginated books kept for quick contents edits: a few paper/language/layout
/// variants of the open book.
const MAX_CACHED_PAGINATIONS: usize = 4;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BookPagePreviewInput {
    request_id: String,
    language_code: String,
    paper_size: String,
    item: BookItemInput,
    /// Contents only: the book its page numbers are typeset from.
    #[serde(default)]
    book: Option<ContentsBookScope>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentsBookScope {
    installation_id: i64,
    repo_name: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    project_full_name: Option<String>,
    #[serde(default)]
    project_title: String,
    book_items: Vec<BookItemInput>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BookPagePreviewResult {
    request_id: String,
    pages: Vec<String>,
    error: String,
}

/// Page numbers from a `TextOnly` pass, in book order (the contents' order).
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub(super) struct PaginatedEntry {
    title: String,
    level: u8,
    #[serde(default)]
    chapter: Option<u64>,
    page: String,
}

#[derive(Debug, Deserialize, PartialEq)]
struct ContentsStart {
    id: String,
    numbering: String,
    page: i64,
}

#[derive(Debug, Deserialize, PartialEq)]
struct BookPagination {
    entries: Vec<PaginatedEntry>,
    contents: Vec<ContentsStart>,
}

/// A contents section rendered on its own, numbered as it falls in the book.
pub(super) struct ContentsProof {
    entries: Vec<PaginatedEntry>,
    pub(super) page: i64,
    pub(super) numbering: String,
}

impl ContentsProof {
    /// The entries argument of `gnosis-contents-entries`.
    pub(super) fn typst_entries(&self) -> String {
        let entries = self
            .entries
            .iter()
            .map(|entry| {
                format!(
                    "(title: {}, level: {}, chapter: {}, page: {}),",
                    typst_string(&entry.title),
                    entry.level,
                    entry
                        .chapter
                        .map_or_else(|| "none".to_string(), |chapter| chapter.to_string()),
                    typst_string(&entry.page)
                )
            })
            .collect::<String>();
        format!("() => ({entries})")
    }
}

/// Returns immediately; `book-page-preview` delivers self-contained SVG pages
/// or an error keyed by requestId. A newer request cancels the previous job.
pub(crate) fn start_project_book_page_preview(
    app: AppHandle,
    input: BookPagePreviewInput,
) -> Result<(), String> {
    let previewable = match input.item.kind.as_str() {
        "title" => true,
        "contents" => input.book.is_some(),
        _ => false,
    };
    if !previewable || input.request_id.is_empty() {
        return Err("Select a title page or table of contents to preview.".into());
    }
    normalize_pdf_paper_size(&input.paper_size)?;
    if let Some(script) = unsupported_pdf_language(&input.language_code) {
        return Err(format!(
            "The page preview does not yet include the {script} print fonts."
        ));
    }
    static ACTIVE: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
    let cancelled = Arc::new(AtomicBool::new(false));
    let mut active = ACTIVE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Could not start the page preview. Please try again.".to_string())?;
    if let Some(previous) = active.replace(cancelled.clone()) {
        previous.store(true, Ordering::Release);
    }
    tauri::async_runtime::spawn(async move {
        let request_id = input.request_id.clone();
        let result = render_page_preview(&app, input, cancelled.clone()).await;
        if cancelled.load(Ordering::Acquire) {
            return;
        }
        let (pages, error) = match result {
            Ok(pages) => (pages, String::new()),
            Err(error) => (Vec::new(), error),
        };
        let _ = app.emit(
            PREVIEW_EVENT,
            BookPagePreviewResult {
                request_id,
                pages,
                error,
            },
        );
    });
    Ok(())
}

fn page_preview_document(item: BookItemInput, section: ExportDocument) -> ExportDocument {
    ExportDocument {
        title: item.title.clone(),
        language_code: section.language_code.clone(),
        // Shared image/font preparation scans the flattened blocks, while the
        // book renderer reads book_parts. Keep both views, as full export does.
        blocks: section.blocks.clone(),
        book_parts: vec![BookPart {
            item,
            document: section,
        }],
    }
}

// A preview must never switch or evict the user's active book/chapter export
// cache. Its only prepared image is a local book asset (the publisher logo).
fn preview_image_session() -> PdfImageCacheSession {
    PdfImageCacheSession {
        scope: PdfImageCacheScope {
            installation_id: 0,
            repo_name: String::new(),
            project_id: None,
            project_full_name: None,
            target: PdfImageCacheTarget::Book,
        },
        generation: None,
    }
}

async fn render_page_preview(
    app: &AppHandle,
    input: BookPagePreviewInput,
    cancelled: Arc<AtomicBool>,
) -> Result<Vec<String>, String> {
    let paper_size = normalize_pdf_paper_size(&input.paper_size)?;
    let proof = match &input.book {
        Some(book) if input.item.kind == "contents" => Some(
            contents_proof(
                app,
                &input.request_id,
                book,
                &input.item,
                &input.language_code,
                paper_size,
            )
            .await?,
        ),
        _ => None,
    };
    let prepare_app = app.clone();
    let prepare_cancelled = cancelled.clone();
    let (prepared, font_dir) = tauri::async_runtime::spawn_blocking(move || {
        check_cancelled(&prepare_cancelled)?;
        // Contents entries are only listed for font coverage here; the proof
        // supplies the rendered titles and their page numbers.
        let titles = proof
            .iter()
            .flat_map(|proof| proof.entries.iter().map(|entry| entry.title.clone()))
            .collect::<Vec<_>>();
        let section = section_document(&prepare_app, &input.item, &input.language_code, &titles)?;
        let document = page_preview_document(input.item, section);
        let font_dir = ensure_fonts(
            &prepare_app,
            &input.request_id,
            required_fonts_for_document(&document),
            &prepare_cancelled,
        )?;
        let session = preview_image_session();
        let options = PdfWorkspacePreparationOptions {
            paper_size,
            footnote_links_as_plain_text: true,
            image_cache_session: &session,
            layout: proof
                .as_ref()
                .map_or(TypstLayout::Export, TypstLayout::ContentsProof),
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
    .map_err(|_| "Could not prepare the page preview. Please try again.".to_string())??;
    let _cleanup = WorkspaceCleanup(prepared.workspace.clone());
    compile_typst(
        app,
        &prepared.workspace,
        &font_dir,
        &prepared.fallback_fonts,
        "chapter.typ",
        "page-{p}.svg",
        &cancelled,
    )
    .await?;
    tauri::async_runtime::spawn_blocking(move || read_preview_pages(&prepared.workspace))
        .await
        .map_err(|_| "Could not read the page preview. Please try again.".to_string())?
}

async fn contents_proof(
    app: &AppHandle,
    request_id: &str,
    book: &ContentsBookScope,
    item: &BookItemInput,
    language_code: &str,
    paper_size: &'static str,
) -> Result<ContentsProof, String> {
    let input = book_export_input(book, language_code, paper_size);
    let key_app = app.clone();
    let (key, input) = tauri::async_runtime::spawn_blocking(move || {
        pagination_key(&key_app, &input).map(|key| (key, input))
    })
    .await
    .map_err(|_| "Could not prepare the contents preview. Please try again.".to_string())??;
    let pagination = book_pagination(app, request_id, key, input).await?;
    let start = pagination.contents.iter().find(|start| start.id == item.id);
    Ok(ContentsProof {
        entries: pagination.entries.clone(),
        page: start.map_or(1, |start| start.page),
        numbering: start.map_or_else(|| "i".to_string(), |start| start.numbering.clone()),
    })
}

/// The book scope as PDF export loads it. Contents titles and H1 inclusion are
/// cleared: neither moves a chapter, so editing them reuses the cached pass.
fn book_export_input(
    book: &ContentsBookScope,
    language_code: &str,
    paper_size: &str,
) -> PdfChapterExportInput {
    let book_items = book
        .book_items
        .iter()
        .map(|item| {
            let mut item = item.clone();
            if item.kind == "contents" {
                item.title.clear();
                item.include_h1_headings = false;
            }
            item
        })
        .collect::<Vec<_>>();
    PdfChapterExportInput {
        job_id: String::new(),
        installation_id: book.installation_id,
        repo_name: book.repo_name.clone(),
        project_id: book.project_id.clone(),
        project_full_name: book.project_full_name.clone(),
        chapter_id: String::new(),
        chapter_ids: book_items
            .iter()
            .filter(|item| item.kind == "chapter")
            .map(|item| item.chapter_id.clone())
            .collect(),
        project_title: book.project_title.clone(),
        book_items,
        language_code: language_code.to_string(),
        format: "pdf".into(),
        output_path: String::new(),
        paper_size: paper_size.to_string(),
        footnote_links_as_plain_text: true,
        omit_custom_html: false,
    }
}

/// Saved chapter edits always move the repo HEAD, so it versions the text.
fn pagination_key(app: &AppHandle, input: &PdfChapterExportInput) -> Result<String, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    let head = current_repo_head_sha(&repo_path).unwrap_or_default();
    let scope = serde_json::to_string(&(
        input.installation_id,
        &input.repo_name,
        &input.project_id,
        &input.project_title,
        &input.book_items,
        &input.language_code,
        &input.paper_size,
    ))
    .map_err(|_| "Could not prepare the contents preview.".to_string())?;
    Ok(format!("{head}:{scope}"))
}

type PaginationCell = Arc<tokio::sync::OnceCell<Arc<BookPagination>>>;

fn pagination_cache() -> &'static Mutex<Vec<(String, PaginationCell)>> {
    static CACHE: OnceLock<Mutex<Vec<(String, PaginationCell)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Vec::new()))
}

/// Requests for the same book share one pass, even while it is still running,
/// so a superseded preview never restarts pagination. A failed pass is retried
/// by the next request.
async fn book_pagination(
    app: &AppHandle,
    request_id: &str,
    key: String,
    input: PdfChapterExportInput,
) -> Result<Arc<BookPagination>, String> {
    let cell = {
        let mut cache = pagination_cache()
            .lock()
            .map_err(|_| "Could not prepare the contents preview.".to_string())?;
        let cell = match cache.iter().position(|(cached, _)| *cached == key) {
            Some(index) => cache.remove(index).1,
            None => PaginationCell::default(),
        };
        cache.push((key, cell.clone()));
        if cache.len() > MAX_CACHED_PAGINATIONS {
            cache.remove(0);
        }
        cell
    };
    cell.get_or_try_init(|| paginate_book(app, request_id, input))
        .await
        .cloned()
}

async fn paginate_book(
    app: &AppHandle,
    request_id: &str,
    input: PdfChapterExportInput,
) -> Result<Arc<BookPagination>, String> {
    // Shared by every waiting request, so no single preview may cancel it.
    let uncancelled = Arc::new(AtomicBool::new(false));
    let prepare_app = app.clone();
    let prepare_cancelled = uncancelled.clone();
    let request_id = request_id.to_string();
    let (prepared, font_dir) = tauri::async_runtime::spawn_blocking(move || {
        let document = apply_print_custom_html_policy(
            &load_export_document(&prepare_app, &input)?,
            input.omit_custom_html,
        );
        let font_dir = ensure_fonts(
            &prepare_app,
            &request_id,
            required_fonts_for_document(&document),
            &prepare_cancelled,
        )?;
        let session = preview_image_session();
        let options = PdfWorkspacePreparationOptions {
            paper_size: normalize_pdf_paper_size(&input.paper_size)?,
            footnote_links_as_plain_text: input.footnote_links_as_plain_text,
            image_cache_session: &session,
            layout: TypstLayout::TextOnly,
        };
        let prepared = prepare_pdf_workspace(
            &prepare_app,
            &request_id,
            &document,
            &font_dir,
            &options,
            &prepare_cancelled,
        )?;
        Ok::<_, String>((prepared, font_dir))
    })
    .await
    .map_err(|_| "Could not prepare the contents preview. Please try again.".to_string())??;
    let _cleanup = WorkspaceCleanup(prepared.workspace.clone());
    let output = eval_typst(
        app,
        &prepared.workspace,
        &font_dir,
        &prepared.fallback_fonts,
        "chapter.typ",
        PAGINATION_EXPRESSION,
        &uncancelled,
    )
    .await?;
    serde_json::from_slice(&output)
        .map(Arc::new)
        .map_err(|_| "Could not read the contents page numbers. Please try again.".to_string())
}

const PAGINATION_EXPRESSION: &str = "query(<gnosis-book-pagination>).first().value";

fn read_preview_pages(workspace: &Path) -> Result<Vec<String>, String> {
    let mut pages = Vec::new();
    for index in 1.. {
        let path = workspace.join(format!("page-{index}.svg"));
        if !path.is_file() {
            break;
        }
        let bytes = fs::read(path).map_err(|_| "Could not read the page preview.".to_string())?;
        pages.push(format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
    }
    if pages.is_empty() {
        return Err("The typesetter did not produce a page preview. Please try again.".into());
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::super::super::chapter_export::{apply_book_chapter_title, build_export_document};
    use super::*;

    fn run_typst_for_test(arguments: &[&std::ffi::OsStr], workspace: &Path) -> Option<Vec<u8>> {
        let (Some(binary), Some(fonts)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return None;
        };
        let output = std::process::Command::new(binary)
            .args(arguments)
            .args(["--ignore-system-fonts", "--font-path"])
            .arg(fonts)
            .arg("--root")
            .arg(workspace)
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        Some(output.stdout)
    }

    fn book_item(id: &str, kind: &str, title: &str) -> BookItemInput {
        BookItemInput {
            id: id.into(),
            kind: kind.into(),
            chapter_id: if kind == "chapter" {
                id.into()
            } else {
                String::new()
            },
            title: title.into(),
            ..Default::default()
        }
    }

    fn text(style: &str, text: &str) -> ExportBlock {
        ExportBlock::Text {
            text_style: style.into(),
            text: text.into(),
        }
    }

    fn book(parts: Vec<BookPart>) -> ExportDocument {
        ExportDocument {
            title: "Book".into(),
            language_code: "en".into(),
            blocks: parts
                .iter()
                .flat_map(|part| part.document.blocks.clone())
                .collect(),
            book_parts: parts,
        }
    }

    fn part(item: BookItemInput, blocks: Vec<ExportBlock>) -> BookPart {
        BookPart {
            document: ExportDocument {
                title: item.title.clone(),
                language_code: "en".into(),
                blocks,
                book_parts: Vec::new(),
            },
            item,
        }
    }

    fn text_only_options(session: &PdfImageCacheSession) -> PdfWorkspacePreparationOptions<'_> {
        PdfWorkspacePreparationOptions {
            paper_size: "a5",
            footnote_links_as_plain_text: true,
            image_cache_session: session,
            layout: TypstLayout::TextOnly,
        }
    }

    #[test]
    fn text_only_pagination_never_fetches_images_or_sets_drop_caps() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let mut title = book_item("title", "title", "A Book");
        // A missing asset would fail a real export; pagination leaves it out.
        title.image_asset_id = "missing.png".into();
        let mut contents = book_item("toc", "contents", "Contents");
        contents.include_h1_headings = true;
        let long = "Words that fill the page. ".repeat(400);
        let document = book(vec![
            part(title, Vec::new()),
            part(contents, vec![text("heading1", "Contents")]),
            part(
                book_item("one", "chapter", "One"),
                vec![
                    text("heading1", "One"),
                    text("paragraph", &long),
                    ExportBlock::Image {
                        // Unreachable: a download attempt would fail the test.
                        image: ExportImage::Url("http://127.0.0.1:9/never.png".into()),
                        caption: "Never fetched".into(),
                    },
                    text("heading1", "Inside one"),
                    text("paragraph", &long),
                ],
            ),
            part(
                book_item("two", "chapter", "Two"),
                vec![text("heading1", "Two"), text("paragraph", "Short.")],
            ),
        ]);
        let session = preview_image_session();
        prepare_typst_workspace(
            None,
            "",
            &workspace,
            &document,
            &text_only_options(&session),
            &AtomicBool::new(false),
        )
        .unwrap();
        let source = fs::read_to_string(workspace.join("chapter.typ")).unwrap();
        assert!(!source.contains("#gnosis-dropcap["));
        assert!(!source.contains("never.png"));
        assert!(source.contains("<gnosis-contents-start>"));
        assert!(source.ends_with(BOOK_PAGINATION_RULE));
        let Some(output) = run_typst_for_test(
            &[
                "eval".as_ref(),
                PAGINATION_EXPRESSION.as_ref(),
                "--in".as_ref(),
                workspace.join("chapter.typ").as_os_str(),
            ],
            &workspace,
        ) else {
            return;
        };
        let pagination: BookPagination = serde_json::from_slice(&output).unwrap();
        let pages = pagination
            .entries
            .iter()
            .map(|entry| (entry.title.as_str(), entry.level, entry.page.as_str()))
            .collect::<Vec<_>>();
        // Title on i, contents on iii; One starts the arabic numbering, its H1
        // follows several pages of text, and Two opens on the next odd page.
        assert_eq!(pages[0], ("One", 0, "1"));
        assert_eq!(pages[1].0, "Inside one");
        assert_eq!(pages[1].1, 1);
        assert!(pages[1].2.parse::<u32>().unwrap() > 3);
        let two = pages[2].2.parse::<u32>().unwrap();
        assert_eq!(pages[2].0, "Two");
        assert!(two % 2 == 1 && two > pages[1].2.parse::<u32>().unwrap());
        assert_eq!(pagination.entries[0].chapter, Some(1));
        assert_eq!(pagination.entries[1].chapter, None);
        assert_eq!(
            pagination.contents,
            vec![ContentsStart {
                id: "toc".into(),
                numbering: "i".into(),
                page: 3
            }]
        );

        // The contents alone, numbered from that pass, matches the book's layout.
        let proof = ContentsProof {
            entries: pagination.entries,
            page: 3,
            numbering: "i".into(),
        };
        let proof_workspace = pdf_workspace().unwrap();
        let _proof_cleanup = WorkspaceCleanup(proof_workspace.clone());
        let mut contents = book_item("toc", "contents", "Contents");
        contents.include_h1_headings = true;
        let proof_document = book(vec![part(contents, vec![text("heading1", "Contents")])]);
        let options = PdfWorkspacePreparationOptions {
            layout: TypstLayout::ContentsProof(&proof),
            ..text_only_options(&session)
        };
        prepare_typst_workspace(
            None,
            "",
            &proof_workspace,
            &proof_document,
            &options,
            &AtomicBool::new(false),
        )
        .unwrap();
        let source = fs::read_to_string(proof_workspace.join("chapter.typ")).unwrap();
        assert!(source.contains("#counter(page).update(3)\n#metadata(\"i\") <gnosis-print-start>"));
        assert!(source.contains(&format!(
            "(title: \"Two\", level: 0, chapter: 2, page: \"{two}\"),"
        )));
        run_typst_for_test(
            &[
                "compile".as_ref(),
                proof_workspace.join("chapter.typ").as_os_str(),
                proof_workspace.join("page-{p}.svg").as_os_str(),
            ],
            &proof_workspace,
        );
        assert_eq!(read_preview_pages(&proof_workspace).unwrap().len(), 1);
        if let Some(destination) = std::env::var_os("GNOSIS_CONTENTS_SMOKE_OUTPUT") {
            fs::copy(proof_workspace.join("page-1.svg"), destination).unwrap();
        }
    }

    #[test]
    fn contents_proof_entries_are_a_typst_closure() {
        let proof = ContentsProof {
            entries: vec![
                PaginatedEntry {
                    title: "Đầu \"tiên\"".into(),
                    level: 0,
                    chapter: Some(1),
                    page: "1".into(),
                },
                PaginatedEntry {
                    title: "Heading".into(),
                    level: 1,
                    chapter: None,
                    page: "4".into(),
                },
            ],
            page: 3,
            numbering: "i".into(),
        };
        assert_eq!(
            proof.typst_entries(),
            "() => ((title: \"Đầu \\\"tiên\\\"\", level: 0, chapter: 1, page: \"1\"),(title: \"Heading\", level: 1, chapter: none, page: \"4\"),)"
        );
        let empty = ContentsProof {
            entries: Vec::new(),
            page: 1,
            numbering: "i".into(),
        };
        assert_eq!(empty.typst_entries(), "() => ()");
    }

    #[test]
    fn accepts_the_frontend_contents_request() {
        // The shape requestBookPagePreview sends, including bookExportItems fields.
        let input: BookPagePreviewInput = serde_json::from_value(serde_json::json!({
            "requestId": "request",
            "languageCode": "vi",
            "paperSize": "a5",
            "item": { "id": "toc", "kind": "contents", "chapterId": "", "title": "Mục lục",
                "subtitle": "", "author": "", "translator": "", "text": "", "caption": "",
                "imageAssetId": "", "includeH1Headings": true, "exclusions": [], "reviewRevision": "" },
            "book": {
                "installationId": 7, "repoName": "perfect-matrimony", "projectId": "project",
                "projectFullName": "team/perfect-matrimony", "projectTitle": "Hôn Nhân Hoàn Hảo",
                "bookItems": [
                    { "id": "toc", "kind": "contents", "chapterId": "", "title": "Mục lục", "includeH1Headings": true, "exclusions": [], "reviewRevision": "" },
                    { "id": "c1", "kind": "chapter", "chapterId": "c1", "title": "chapter-01", "titleOverride": null, "numbered": true, "exclusions": [], "reviewRevision": "" },
                ],
            },
        }))
        .unwrap();
        assert!(input.item.include_h1_headings);
        let book = input.book.unwrap();
        assert_eq!(book.installation_id, 7);
        let export = book_export_input(&book, &input.language_code, "a5");
        assert_eq!(export.chapter_ids, vec!["c1".to_string()]);
        assert_eq!(export.book_items[1].numbered, Some(true));
        // A title-page request carries no book scope.
        let title: BookPagePreviewInput = serde_json::from_value(serde_json::json!({
            "requestId": "request", "languageCode": "vi", "paperSize": "a5",
            "item": { "id": "title", "kind": "title", "title": "Hôn Nhân" },
        }))
        .unwrap();
        assert!(title.book.is_none());
    }

    #[test]
    fn contents_title_and_h1_choice_reuse_the_cached_pagination() {
        let mut contents = book_item("toc", "contents", "Contents");
        contents.include_h1_headings = true;
        let scope = ContentsBookScope {
            installation_id: 1,
            repo_name: "book".into(),
            project_id: Some("project".into()),
            project_full_name: None,
            project_title: "Book".into(),
            book_items: vec![contents, book_item("one", "chapter", "One")],
        };
        let input = book_export_input(&scope, "vi", "a5");
        assert_eq!(input.chapter_ids, vec!["one".to_string()]);
        assert_eq!(input.book_items[0].title, "");
        assert!(!input.book_items[0].include_h1_headings);
        assert_eq!(input.book_items[1].title, "One");
    }

    /// Times the text-only pass on a real local project, for example:
    /// GNOSIS_PAGINATION_SMOKE_REPO=…/projects/perfect-matrimony
    /// GNOSIS_PAGINATION_SMOKE_LANGUAGE=vi, plus the Typst smoke variables.
    #[test]
    fn real_book_pagination_smoke() {
        let (Some(repo), Some(language)) = (
            std::env::var_os("GNOSIS_PAGINATION_SMOKE_REPO").map(PathBuf::from),
            std::env::var("GNOSIS_PAGINATION_SMOKE_LANGUAGE").ok(),
        ) else {
            return;
        };
        let started = std::time::Instant::now();
        let mut chapter_dirs = fs::read_dir(repo.join("chapters"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        chapter_dirs.sort();
        let mut parts = vec![
            part(book_item("title", "title", "Book"), Vec::new()),
            part(book_item("toc", "contents", "Mục lục"), Vec::new()),
        ];
        for dir in chapter_dirs {
            let chapter: StoredChapterFile =
                read_json_file(&dir.join("chapter.json"), "chapter.json").unwrap();
            if chapter.lifecycle.state == "deleted"
                || !chapter.languages.iter().any(|entry| entry.code == language)
            {
                continue;
            }
            let rows = load_editor_rows(&dir.join("rows")).unwrap();
            let item = BookItemInput {
                numbered: Some(true),
                ..book_item(&chapter.chapter_id, "chapter", &chapter.title)
            };
            let document = apply_book_chapter_title(
                build_export_document(&repo, &chapter, &rows, &language, None, "").unwrap(),
                &item,
            );
            parts.push(BookPart { item, document });
        }
        let mut document = book(parts);
        document.language_code = language;
        let document = apply_print_custom_html_policy(&document, false);
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let session = preview_image_session();
        prepare_typst_workspace(
            None,
            "",
            &workspace,
            &document,
            &text_only_options(&session),
            &AtomicBool::new(false),
        )
        .unwrap();
        let loaded = started.elapsed();
        let typeset = std::time::Instant::now();
        let output = run_typst_for_test(
            &[
                "eval".as_ref(),
                PAGINATION_EXPRESSION.as_ref(),
                "--in".as_ref(),
                workspace.join("chapter.typ").as_os_str(),
            ],
            &workspace,
        )
        .unwrap();
        let pagination: BookPagination = serde_json::from_slice(&output).unwrap();
        eprintln!(
            "loaded {} chapters in {loaded:?}; paginated in {:?}",
            document.book_parts.len() - 2,
            typeset.elapsed()
        );
        for entry in &pagination.entries {
            eprintln!("{} {} … {}", entry.level, entry.title, entry.page);
        }
        // The contents typeset alone from those numbers, and in the book itself.
        let Some(output) = std::env::var_os("GNOSIS_CONTENTS_SMOKE_DIR").map(PathBuf::from) else {
            return;
        };
        let start = &pagination.contents[0];
        let page = start.page.to_string();
        run_typst_for_test(
            &[
                "compile".as_ref(),
                "--ppi".as_ref(),
                "100".as_ref(),
                "--pages".as_ref(),
                page.as_ref(),
                workspace.join("chapter.typ").as_os_str(),
                output.join("book-{p}.png").as_os_str(),
            ],
            &workspace,
        );
        let proof = ContentsProof {
            entries: pagination.entries.clone(),
            page: start.page,
            numbering: start.numbering.clone(),
        };
        let contents = document
            .book_parts
            .iter()
            .find(|part| part.item.kind == "contents")
            .unwrap();
        let mut proof_document = book(vec![contents.clone()]);
        proof_document.language_code = document.language_code.clone();
        let proof_workspace = pdf_workspace().unwrap();
        let _proof_cleanup = WorkspaceCleanup(proof_workspace.clone());
        let options = PdfWorkspacePreparationOptions {
            layout: TypstLayout::ContentsProof(&proof),
            ..text_only_options(&session)
        };
        prepare_typst_workspace(
            None,
            "",
            &proof_workspace,
            &proof_document,
            &options,
            &AtomicBool::new(false),
        )
        .unwrap();
        run_typst_for_test(
            &[
                "compile".as_ref(),
                "--ppi".as_ref(),
                "100".as_ref(),
                proof_workspace.join("chapter.typ").as_os_str(),
                output.join("proof-{p}.png").as_os_str(),
            ],
            &proof_workspace,
        );
    }

    #[test]
    fn publisher_logo_is_prepared_in_the_title_preview_and_compiles() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let logo = include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src-ui/assets/brand/gnosisvn-caduceus-logo.svg"
        ));
        let logo = crate::project_import::chapter_editor::book_svg::sanitize(logo).unwrap();
        let path = workspace.join("publisher.svg");
        fs::write(&path, logo).unwrap();
        let item = BookItemInput {
            id: "title".into(),
            kind: "title".into(),
            title: "Hôn Nhân Hoàn Hảo".into(),
            image_asset_id: "publisher.svg".into(),
            ..Default::default()
        };
        let section = ExportDocument {
            title: item.title.clone(),
            language_code: "vi".into(),
            book_parts: Vec::new(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "heading1".into(),
                    text: item.title.clone(),
                },
                ExportBlock::Image {
                    image: ExportImage::Upload {
                        repo_relative_path: "publisher.svg".into(),
                        raw_url: None,
                        absolute_path: path,
                    },
                    caption: String::new(),
                },
            ],
        };
        let document = page_preview_document(item, section);
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
            paper_size: "a5",
            footnote_links_as_plain_text: true,
            image_cache_session: &session,
            layout: TypstLayout::Export,
        };
        prepare_typst_workspace(
            None,
            "",
            &workspace,
            &document,
            &options,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(document.blocks, document.book_parts[0].document.blocks);
        let source = fs::read_to_string(workspace.join("chapter.typ")).unwrap();
        assert!(source.contains("images/image-0.svg"));
        assert!(source.contains("width: 1.105in, height: 0.595in"));
        let (Some(binary), Some(fonts)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        for output_name in ["page-{p}.svg", "page.pdf"] {
            let output = std::process::Command::new(&binary)
                .args(["compile", "--ignore-system-fonts", "--font-path"])
                .arg(&fonts)
                .arg("--root")
                .arg(&workspace)
                .arg("--package-path")
                .arg(workspace.join("packages"))
                .arg(workspace.join("chapter.typ"))
                .arg(workspace.join(output_name))
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        assert_eq!(read_preview_pages(&workspace).unwrap().len(), 1);
        if let Some(destination) = std::env::var_os("GNOSIS_LOGO_SMOKE_OUTPUT") {
            let destination = PathBuf::from(destination);
            fs::copy(workspace.join("page.pdf"), &destination).unwrap();
            fs::copy(
                workspace.join("page-1.svg"),
                destination.with_extension("svg"),
            )
            .unwrap();
        }
    }

    #[test]
    fn reads_every_rendered_page_as_image_data_and_reports_missing_output() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        assert!(read_preview_pages(&workspace).is_err());
        for index in 1..=2 {
            fs::write(
                workspace.join(format!("page-{index}.svg")),
                format!("<svg>{index}</svg>"),
            )
            .unwrap();
        }
        let pages = read_preview_pages(&workspace).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[1], "data:image/svg+xml;base64,PHN2Zz4yPC9zdmc+");
    }
}
