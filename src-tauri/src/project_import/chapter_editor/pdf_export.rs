use super::*;
use crate::util::atomic_replace;
use reqwest::blocking::Client as BlockingClient;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use uuid::Uuid;

use super::chapter_export::{
    apply_print_custom_html_policy, build_export_document, download_public_image_bytes_detailed,
    inline_segments, ExportBlock, ExportChapterFileInput, ExportDocument, ExportImage,
    InlineStyleState,
};

const PDF_EXPORT_EVENT: &str = "chapter-pdf-export-progress";
const FONT_REVISION: &str = "google-fonts-684b69db51d59a3137ec0152fa3a3afc6f1b3814";
const MAX_FONT_BYTES: u64 = 30 * 1024 * 1024;
const TYPST_COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
const CANCELLED: &str = "__GNOSIS_PDF_EXPORT_CANCELLED__";
const MAX_TYPST_DIAGNOSTIC_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
enum PreparedTypstImage {
    File(String),
    Placeholder(String),
}

enum ResolvedPdfImage {
    Bytes(Vec<u8>),
    Placeholder(String),
}

pub(crate) type PdfChapterExportInput = ExportChapterFileInput;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfFontInspectionInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    #[serde(default)]
    project_full_name: Option<String>,
    chapter_id: String,
    language_code: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PdfFontInspection {
    supported: bool,
    message: String,
    required_bytes: u64,
    missing_bytes: u64,
    installed: bool,
    font_families: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfExportProgressPayload {
    job_id: String,
    status: String,
    stage: String,
    message: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    progress_current: u64,
    progress_total: u64,
    progress_unit: String,
    progress_indeterminate: bool,
}

#[derive(Clone, Copy)]
struct PdfProgressValue {
    current: u64,
    total: u64,
    unit: &'static str,
    indeterminate: bool,
}

impl PdfProgressValue {
    const fn determinate(current: u64, total: u64, unit: &'static str) -> Self {
        Self {
            current,
            total,
            unit,
            indeterminate: false,
        }
    }

    const fn indeterminate() -> Self {
        Self {
            current: 0,
            total: 0,
            unit: "",
            indeterminate: true,
        }
    }

    const fn none() -> Self {
        Self {
            current: 0,
            total: 0,
            unit: "",
            indeterminate: false,
        }
    }
}

#[derive(Clone, Copy)]
struct FontAsset {
    file_name: &'static str,
    family: &'static str,
    language: &'static str,
    size: u64,
    sha256: &'static str,
    url: &'static str,
}

fn pdf_jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct PdfJobRegistration {
    job_id: String,
    cancelled: Arc<AtomicBool>,
}

impl Drop for PdfJobRegistration {
    fn drop(&mut self) {
        if let Ok(mut jobs) = pdf_jobs().lock() {
            if jobs
                .get(&self.job_id)
                .is_some_and(|current| Arc::ptr_eq(current, &self.cancelled))
            {
                jobs.remove(&self.job_id);
            }
        }
    }
}

const FONT_ASSETS: &[FontAsset] = &[
    FontAsset {
        file_name: "NotoSerif.ttf",
        family: "Noto Serif",
        language: "base",
        size: 1_887_192,
        sha256: "4d8e6761424656867019081a1a01336f3cb086982682698714054fc33f782713",
        url: "https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserif/NotoSerif%5Bwdth,wght%5D.ttf",
    },
    FontAsset {
        file_name: "NotoSerif-Italic.ttf",
        family: "Noto Serif",
        language: "base",
        size: 2_448_496,
        sha256: "e87acbc6c0efd0d9a20d6a8cbbda2b266c14be3a3a6f5af8ec9d7b2460570ad1",
        url: "https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserif/NotoSerif-Italic%5Bwdth,wght%5D.ttf",
    },
    FontAsset {
        file_name: "NotoSerifJP.ttf",
        family: "Noto Serif JP",
        language: "ja",
        size: 13_574_352,
        sha256: "2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc",
        url: "https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf",
    },
    FontAsset {
        file_name: "NotoSerifSC.ttf",
        family: "Noto Serif SC",
        language: "zh-hans",
        size: 25_125_512,
        sha256: "050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9",
        url: "https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf",
    },
    FontAsset {
        file_name: "NotoSerifTC.ttf",
        family: "Noto Serif TC",
        language: "zh-hant",
        size: 16_851_596,
        sha256: "0077e18f57c6908f4a000969880940bdb0dad057c0e8d98b49dc364c3d1b09c6",
        url: "https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoseriftc/NotoSerifTC%5Bwght%5D.ttf",
    },
    FontAsset {
        file_name: "NotoSerifKR.ttf",
        family: "Noto Serif KR",
        language: "ko",
        size: 23_795_420,
        sha256: "11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3",
        url: "https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf",
    },
    FontAsset {
        file_name: "NotoNaskhArabic.ttf",
        family: "Noto Naskh Arabic",
        language: "arabic",
        size: 307_592,
        sha256: "67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f",
        url: "https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf",
    },
];

pub(crate) fn inspect_gtms_chapter_pdf_fonts(
    app: &AppHandle,
    input: PdfFontInspectionInput,
) -> Result<PdfFontInspection, String> {
    if input.language_code.trim().is_empty() {
        return Err("Choose the export language first.".to_string());
    }
    let document = load_export_document(
        app,
        &ExportChapterFileInput {
            job_id: String::new(),
            installation_id: input.installation_id,
            repo_name: input.repo_name,
            project_id: input.project_id,
            project_full_name: input.project_full_name,
            chapter_id: input.chapter_id,
            language_code: input.language_code,
            format: "pdf".to_string(),
            output_path: String::new(),
            paper_size: "us-letter".to_string(),
            footnote_links_as_plain_text: false,
            omit_custom_html: true,
        },
    )?;
    if let Some(script) = unsupported_pdf_language(&document.language_code) {
        return Ok(PdfFontInspection {
            supported: false,
            message: format!(
                "PDF export does not yet include the {script} print fonts. Use DOCX or HTML for this language for now."
            ),
            required_bytes: 0,
            missing_bytes: 0,
            installed: false,
            font_families: Vec::new(),
        });
    }

    let assets = required_fonts(&document.language_code);
    let font_dir = pdf_font_dir(app)?;
    let required_bytes = assets.iter().map(|asset| asset.size).sum();
    let missing_bytes = assets
        .iter()
        .filter(|asset| !valid_cached_font(&font_dir.join(asset.file_name), **asset))
        .map(|asset| asset.size)
        .sum();
    let font_families = assets
        .iter()
        .map(|asset| asset.family.to_string())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(PdfFontInspection {
        supported: true,
        message: String::new(),
        required_bytes,
        missing_bytes,
        installed: missing_bytes == 0,
        font_families,
    })
}

pub(crate) fn cancel_gtms_chapter_pdf_export(job_id: &str) -> Result<bool, String> {
    let normalized = job_id.trim();
    if normalized.is_empty() {
        return Ok(false);
    }
    let jobs = pdf_jobs()
        .lock()
        .map_err(|_| "The PDF export cancellation state is unavailable.".to_string())?;
    let Some(cancelled) = jobs.get(normalized) else {
        return Ok(false);
    };
    cancelled.store(true, Ordering::Release);
    Ok(true)
}

fn unsupported_pdf_language(language_code: &str) -> Option<&'static str> {
    let normalized = language_code.trim().to_ascii_lowercase().replace('_', "-");
    let base = normalized.split('-').next().unwrap_or_default();
    match base {
        "am" | "ti" => Some("Ethiopic"),
        "as" | "bn" => Some("Bengali"),
        "bo" | "dz" => Some("Tibetan"),
        "dv" => Some("Thaana"),
        "gu" => Some("Gujarati"),
        "he" | "yi" => Some("Hebrew"),
        "hi" | "mr" | "ne" | "sa" => Some("Devanagari"),
        "hy" => Some("Armenian"),
        "ii" => Some("Yi"),
        "iu" => Some("Canadian Aboriginal syllabics"),
        "ka" => Some("Georgian"),
        "km" => Some("Khmer"),
        "kn" => Some("Kannada"),
        "lo" => Some("Lao"),
        "ml" => Some("Malayalam"),
        "my" => Some("Myanmar"),
        "or" => Some("Odia"),
        "pa" => Some("Gurmukhi"),
        "ps" | "sd" | "ug" | "ur" => Some("required Arabic-script"),
        "si" => Some("Sinhala"),
        "ta" => Some("Tamil"),
        "te" => Some("Telugu"),
        "th" => Some("Thai"),
        _ => None,
    }
}

/// Starts a PDF export and returns immediately. Completion and failure are sent through
/// `chapter-pdf-export-progress`, keyed by the returned job id.
pub(crate) fn start_gtms_chapter_pdf_export(
    app: AppHandle,
    input: PdfChapterExportInput,
) -> Result<String, String> {
    if input.output_path.trim().is_empty() {
        return Err("Choose a file path for the PDF export.".to_string());
    }
    if input.language_code.trim().is_empty() {
        return Err("Choose the export language first.".to_string());
    }
    normalize_pdf_paper_size(&input.paper_size)?;

    let job_id = if input.job_id.trim().is_empty() {
        Uuid::now_v7().to_string()
    } else {
        input.job_id.trim().to_string()
    };
    let cancelled = Arc::new(AtomicBool::new(false));
    pdf_jobs()
        .lock()
        .map_err(|_| "The PDF export state is unavailable.".to_string())?
        .insert(job_id.clone(), cancelled.clone());
    let task_app = app.clone();
    let task_job_id = job_id.clone();
    tauri::async_runtime::spawn(async move {
        let _registration = PdfJobRegistration {
            job_id: task_job_id.clone(),
            cancelled: cancelled.clone(),
        };
        let result = run_pdf_export(&task_app, &task_job_id, input, cancelled).await;
        match result {
            Ok(()) => emit_progress(
                &task_app,
                &task_job_id,
                "complete",
                "complete",
                "PDF export complete.",
                PdfProgressValue::determinate(1, 1, "steps"),
            ),
            Err(message) if message == CANCELLED => emit_progress(
                &task_app,
                &task_job_id,
                "cancelled",
                "cancelled",
                "PDF export cancelled.",
                PdfProgressValue::none(),
            ),
            Err(message) => emit_progress(
                &task_app,
                &task_job_id,
                "error",
                "error",
                &message,
                PdfProgressValue::none(),
            ),
        }
    });
    Ok(job_id)
}

async fn run_pdf_export(
    app: &AppHandle,
    job_id: &str,
    input: PdfChapterExportInput,
    cancelled: Arc<AtomicBool>,
) -> Result<(), String> {
    let paper_size = normalize_pdf_paper_size(&input.paper_size)?;
    emit_progress(
        app,
        job_id,
        "running",
        "preparing",
        "Preparing the chapter…",
        PdfProgressValue::indeterminate(),
    );
    let load_app = app.clone();
    let load_input = input;
    let (document, output_path, footnote_links_as_plain_text, omit_custom_html) =
        tauri::async_runtime::spawn_blocking(move || {
            let document = load_export_document(&load_app, &load_input)?;
            Ok::<_, String>((
                document,
                PathBuf::from(&load_input.output_path),
                load_input.footnote_links_as_plain_text,
                load_input.omit_custom_html,
            ))
        })
        .await
        .map_err(|error| format!("The PDF preparation worker failed: {error}"))??;

    let language_code = document.language_code.clone();
    if let Some(script) = unsupported_pdf_language(&language_code) {
        return Err(format!(
            "PDF export does not yet include the {script} print fonts. Use DOCX or HTML for this language for now."
        ));
    }
    let font_app = app.clone();
    let font_job_id = job_id.to_string();
    let font_cancelled = cancelled.clone();
    let font_dir = tauri::async_runtime::spawn_blocking(move || {
        ensure_fonts(&font_app, &font_job_id, &language_code, &font_cancelled)
    })
    .await
    .map_err(|error| format!("The PDF font worker failed: {error}"))??;

    check_cancelled(&cancelled)?;
    let prepared_document = apply_print_custom_html_policy(&document, omit_custom_html);
    let prep_font_dir = font_dir.clone();
    let prep_cancelled = cancelled.clone();
    let prep_app = app.clone();
    let prep_job_id = job_id.to_string();
    let workspace = tauri::async_runtime::spawn_blocking(move || {
        prepare_pdf_workspace(
            &prep_app,
            &prep_job_id,
            &prepared_document,
            footnote_links_as_plain_text,
            paper_size,
            &prep_font_dir,
            &prep_cancelled,
        )
    })
    .await
    .map_err(|error| format!("The PDF image worker failed: {error}"))??;
    let _workspace_cleanup = WorkspaceCleanup(workspace.clone());

    emit_progress(
        app,
        job_id,
        "running",
        "typesetting",
        "Typesetting the PDF…",
        PdfProgressValue::indeterminate(),
    );

    let source_path = workspace.join("chapter.typ");
    let rendered_path = workspace.join("chapter.pdf");
    let command =
        if cfg!(debug_assertions) {
            std::env::var_os("GNOSIS_TYPST_BIN")
                .map(|path| app.shell().command(path))
                .unwrap_or(app.shell().sidecar("typst").map_err(|error| {
                    format!("The bundled Typst compiler is unavailable: {error}")
                })?)
        } else {
            app.shell()
                .sidecar("typst")
                .map_err(|error| format!("The bundled Typst compiler is unavailable: {error}"))?
        };
    let (mut receiver, child) = command
        .args([
            "compile".into(),
            "--root".into(),
            workspace.as_os_str().to_owned(),
            "--font-path".into(),
            font_dir.as_os_str().to_owned(),
            "--ignore-system-fonts".into(),
            source_path.as_os_str().to_owned(),
            rendered_path.as_os_str().to_owned(),
        ])
        .spawn()
        .map_err(|error| format!("Could not start the bundled Typst compiler: {error}"))?;
    let mut child = Some(child);
    let started = std::time::Instant::now();
    let mut stderr = Vec::new();
    let exit_code = loop {
        if cancelled.load(Ordering::Acquire) {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
            return Err(CANCELLED.to_string());
        }
        if started.elapsed() >= TYPST_COMPILE_TIMEOUT {
            if let Some(child) = child.take() {
                let _ = child.kill();
            }
            return Err("PDF layout took too long. Try exporting a smaller chapter or checking unusually large images.".to_string());
        }
        match tokio::time::timeout(Duration::from_millis(200), receiver.recv()).await {
            Ok(Some(CommandEvent::Stderr(bytes))) => {
                let remaining = MAX_TYPST_DIAGNOSTIC_BYTES.saturating_sub(stderr.len());
                stderr.extend_from_slice(&bytes[..bytes.len().min(remaining)]);
            }
            Ok(Some(CommandEvent::Terminated(payload))) => break payload.code,
            Ok(Some(CommandEvent::Error(error))) => {
                return Err(format!("The bundled Typst compiler failed: {error}"));
            }
            Ok(Some(_)) | Err(_) => {}
            Ok(None) => break None,
        }
    };
    if exit_code != Some(0) {
        let details = String::from_utf8_lossy(&stderr);
        return Err(format_typst_error(&details));
    }

    emit_progress(
        app,
        job_id,
        "running",
        "saving",
        "Saving the finished PDF…",
        PdfProgressValue::determinate(0, 1, "steps"),
    );
    check_cancelled(&cancelled)?;
    install_rendered_pdf(&rendered_path, &output_path)?;
    Ok(())
}

fn load_export_document(
    app: &AppHandle,
    input: &PdfChapterExportInput,
) -> Result<ExportDocument, String> {
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    let chapter_file: StoredChapterFile =
        read_json_file(&chapter_path.join("chapter.json"), "chapter.json")?;
    let languages = sanitize_chapter_languages(&chapter_file.languages);
    if !languages
        .iter()
        .any(|language| language.code == input.language_code)
    {
        return Err("The selected export language is not available in this file.".to_string());
    }
    let rows = load_editor_rows(&chapter_path.join("rows"))?;
    let head_sha = current_repo_head_sha(&repo_path);
    let full_name =
        resolve_project_full_name_for_pdf(&repo_path, input.project_full_name.as_deref());
    build_export_document(
        &repo_path,
        &chapter_file,
        &rows,
        &input.language_code,
        full_name.as_deref(),
        head_sha.as_deref().unwrap_or_default(),
    )
}

fn resolve_project_full_name_for_pdf(repo_path: &Path, supplied: Option<&str>) -> Option<String> {
    let supplied = supplied.unwrap_or_default().trim();
    if !supplied.is_empty() {
        return Some(supplied.trim_end_matches(".git").to_string());
    }
    let remote = git_output(repo_path, &["config", "--get", "remote.origin.url"]).ok()?;
    let trimmed = remote.trim().trim_end_matches(".git");
    trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .or_else(|| trimmed.strip_prefix("git@github.com:"))
        .map(|value| value.trim_matches('/').to_string())
}

fn required_fonts(language_code: &str) -> Vec<FontAsset> {
    let normalized = language_code.trim().to_ascii_lowercase().replace('_', "-");
    let language = if normalized.starts_with("ja") {
        Some("ja")
    } else if normalized.starts_with("ko") {
        Some("ko")
    } else if normalized.starts_with("zh-hant")
        || normalized.starts_with("zh-tw")
        || normalized.starts_with("zh-hk")
    {
        Some("zh-hant")
    } else if normalized.starts_with("zh") {
        Some("zh-hans")
    } else if normalized.starts_with("ar") || normalized.starts_with("fa") {
        Some("arabic")
    } else {
        None
    };
    FONT_ASSETS
        .iter()
        .copied()
        .filter(|asset| asset.language == "base" || Some(asset.language) == language)
        .collect()
}

fn pdf_font_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the Gnosis TMS data folder: {error}"))?
        .join("pdf-fonts")
        .join(FONT_REVISION))
}

fn ensure_fonts(
    app: &AppHandle,
    job_id: &str,
    language_code: &str,
    cancelled: &AtomicBool,
) -> Result<PathBuf, String> {
    let font_dir = pdf_font_dir(app)?;
    fs::create_dir_all(&font_dir)
        .map_err(|error| format!("Could not create the PDF font cache: {error}"))?;
    let assets = required_fonts(language_code);
    let total = assets.iter().map(|asset| asset.size).sum();
    let mut completed = 0u64;
    for asset in assets {
        check_cancelled(cancelled)?;
        let path = font_dir.join(asset.file_name);
        if valid_cached_font(&path, asset) {
            completed += asset.size;
            continue;
        }
        emit_progress(
            app,
            job_id,
            "running",
            "downloading-fonts",
            &format!("Downloading {} for PDF export…", asset.family),
            PdfProgressValue::determinate(completed, total, "bytes"),
        );
        download_font(app, job_id, &font_dir, asset, completed, total, cancelled)?;
        completed += asset.size;
    }
    emit_progress(
        app,
        job_id,
        "running",
        "fonts-ready",
        "PDF fonts are ready.",
        PdfProgressValue::determinate(completed, total, "bytes"),
    );
    Ok(font_dir)
}

fn valid_cached_font(path: &Path, asset: FontAsset) -> bool {
    path.metadata().map(|metadata| metadata.len()).ok() == Some(asset.size)
        && hash_file(path).as_deref() == Some(asset.sha256)
}

fn hash_file(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

fn download_font(
    app: &AppHandle,
    job_id: &str,
    font_dir: &Path,
    asset: FontAsset,
    completed: u64,
    total: u64,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let client = BlockingClient::builder()
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| format!("Could not initialize the PDF font download: {error}"))?;
    let mut response = client
        .get(asset.url)
        .header("User-Agent", "gnosis-tms-pdf-export")
        .send()
        .map_err(|_| {
            "Could not download the PDF font. Check your internet connection and try again."
                .to_string()
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Could not download the PDF font (HTTP {}).",
            response.status()
        ));
    }
    if response.content_length().unwrap_or(asset.size) > MAX_FONT_BYTES {
        return Err("The PDF font download was unexpectedly large.".to_string());
    }
    let temp_path = font_dir.join(format!(".{}.{}.download", asset.file_name, Uuid::now_v7()));
    let _temp_cleanup = TemporaryFileCleanup(temp_path.clone());
    let mut file = fs::File::create(&temp_path)
        .map_err(|error| format!("Could not create the PDF font cache file: {error}"))?;
    let mut downloaded = 0u64;
    let mut next_progress_emit = 512 * 1024u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        check_cancelled(cancelled)?;
        let count = response
            .read(&mut buffer)
            .map_err(|_| "The PDF font download was interrupted. Try again.".to_string())?;
        if count == 0 {
            break;
        }
        downloaded += count as u64;
        if downloaded > MAX_FONT_BYTES {
            let _ = fs::remove_file(&temp_path);
            return Err("The PDF font download was unexpectedly large.".to_string());
        }
        file.write_all(&buffer[..count])
            .map_err(|error| format!("Could not save the PDF font: {error}"))?;
        if downloaded >= next_progress_emit || downloaded == asset.size {
            emit_progress(
                app,
                job_id,
                "running",
                "downloading-fonts",
                &format!("Downloading {} for PDF export…", asset.family),
                PdfProgressValue::determinate(
                    completed + downloaded.min(asset.size),
                    total,
                    "bytes",
                ),
            );
            next_progress_emit = downloaded.saturating_add(512 * 1024);
        }
    }
    file.sync_all()
        .map_err(|error| format!("Could not finish saving the PDF font: {error}"))?;
    if downloaded != asset.size || hash_file(&temp_path).as_deref() != Some(asset.sha256) {
        let _ = fs::remove_file(&temp_path);
        return Err("The downloaded PDF font failed its integrity check. Try again.".to_string());
    }
    atomic_replace(&temp_path, &font_dir.join(asset.file_name))
        .map_err(|error| format!("Could not install the PDF font: {error}"))
}

fn check_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::Acquire) {
        Err(CANCELLED.to_string())
    } else {
        Ok(())
    }
}

struct TemporaryFileCleanup(PathBuf);

impl Drop for TemporaryFileCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn pdf_workspace() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("gnosis-pdf-export-{}", Uuid::now_v7()));
    fs::create_dir_all(path.join("images"))
        .map_err(|error| format!("Could not prepare the temporary PDF workspace: {error}"))?;
    Ok(path)
}

struct WorkspaceCleanup(PathBuf);

impl Drop for WorkspaceCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn prepare_typst_workspace(
    app: Option<&AppHandle>,
    job_id: &str,
    workspace: &Path,
    document: &ExportDocument,
    footnote_links_as_plain_text: bool,
    paper_size: &str,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    check_cancelled(cancelled)?;
    let image_paths = prepare_typst_images(app, job_id, workspace, document, cancelled)?;
    let mut anchored_footnotes: HashMap<usize, Vec<(usize, String)>> = HashMap::new();
    let mut anchored_numbers = HashSet::new();
    for block in &document.blocks {
        if let ExportBlock::Footnote {
            number,
            marker,
            anchor_block: Some(anchor_block),
            text,
        } = block
        {
            anchored_footnotes
                .entry(*anchor_block)
                .or_default()
                .push((*marker, text.clone()));
            anchored_numbers.insert(*number);
        }
    }
    let mut source = typst_preamble(document, paper_size);
    source.push_str(&format!(
        "#align(center)[#text(size: 22pt, weight: \"bold\")[#text({})]]\n#v(1.2em)\n",
        typst_string(&document.title)
    ));
    for (block_index, block) in document.blocks.iter().enumerate() {
        check_cancelled(cancelled)?;
        match block {
            ExportBlock::Text { text_style, text } => {
                let inline = render_inline_typst_with_footnotes(
                    text,
                    anchored_footnotes
                        .get(&block_index)
                        .map(Vec::as_slice)
                        .unwrap_or_default(),
                    footnote_links_as_plain_text,
                );
                match normalize_editor_text_style_value(Some(text_style)).as_str() {
                    "heading1" => source.push_str(&format!("= {inline}\n\n")),
                    "heading2" => source.push_str(&format!("== {inline}\n\n")),
                    "quote" | "blockquote" => {
                        source.push_str(&format!("#quote(block: true)[{inline}]\n\n"))
                    }
                    "centered" => source.push_str(&format!("#align(center)[{inline}]\n\n")),
                    "indented" => source.push_str(&format!("#pad(left: 2em)[{inline}]\n\n")),
                    _ => source.push_str(&format!("{inline}\n\n")),
                }
            }
            ExportBlock::Separator => {
                source.push_str("#line(length: 100%, stroke: 0.5pt)\n#v(0.8em)\n")
            }
            ExportBlock::Footnote { number, text, .. } if !anchored_numbers.contains(number) => {
                source.push_str(&format!(
                    "#footnote[{}]\n",
                    render_inline_typst(text, footnote_links_as_plain_text)
                ));
            }
            ExportBlock::Footnote { .. } => {}
            ExportBlock::Image { image, caption } => {
                let prepared = image_paths
                    .get(&export_image_key(image))
                    .ok_or_else(|| "An image could not be prepared for the PDF.".to_string())?;
                let body = match prepared {
                    PreparedTypstImage::File(relative) => {
                        format!("image({}, width: 90%)", typst_string(relative))
                    }
                    PreparedTypstImage::Placeholder(message) => {
                        render_typst_image_placeholder(message)
                    }
                };
                if caption.trim().is_empty() {
                    source.push_str(&format!("#align(center)[#{body}]\n\n"));
                } else {
                    source.push_str(&format!(
                        "#figure({body}, caption: [{}])\n\n",
                        render_typst_image_caption(caption)
                    ));
                }
            }
        }
    }
    fs::write(workspace.join("chapter.typ"), source)
        .map_err(|error| format!("Could not write the temporary Typst document: {error}"))
}

fn prepare_pdf_workspace(
    app: &AppHandle,
    job_id: &str,
    document: &ExportDocument,
    footnote_links_as_plain_text: bool,
    paper_size: &str,
    font_dir: &Path,
    cancelled: &AtomicBool,
) -> Result<PathBuf, String> {
    validate_document_glyphs(document, font_dir)?;
    check_cancelled(cancelled)?;
    let workspace = pdf_workspace()?;
    if let Err(error) = prepare_typst_workspace(
        Some(app),
        job_id,
        &workspace,
        document,
        footnote_links_as_plain_text,
        paper_size,
        cancelled,
    ) {
        let _ = fs::remove_dir_all(&workspace);
        return Err(error);
    }
    Ok(workspace)
}

fn prepare_typst_images(
    app: Option<&AppHandle>,
    job_id: &str,
    workspace: &Path,
    document: &ExportDocument,
    cancelled: &AtomicBool,
) -> Result<HashMap<String, PreparedTypstImage>, String> {
    let mut unique = Vec::new();
    let mut seen = HashSet::new();
    for block in &document.blocks {
        if let ExportBlock::Image { image, caption } = block {
            let key = export_image_key(image);
            if seen.insert(key.clone()) {
                unique.push((key, image.clone(), caption.clone()));
            }
        }
    }
    if unique.is_empty() {
        if let Some(app) = app {
            emit_progress(
                app,
                job_id,
                "running",
                "preparing-images",
                "No images need preparation.",
                PdfProgressValue::determinate(0, 0, "items"),
            );
        }
        return Ok(HashMap::new());
    }

    let total_images = unique.len() as u64;
    if let Some(app) = app {
        emit_progress(
            app,
            job_id,
            "running",
            "preparing-images",
            &format!("Preparing images (0 of {total_images})…"),
            PdfProgressValue::determinate(0, total_images, "items"),
        );
    }
    let queue = Arc::new(Mutex::new(VecDeque::from(unique.clone())));
    let results = Arc::new(Mutex::new(HashMap::<
        String,
        Result<ResolvedPdfImage, String>,
    >::new()));
    let completed = Arc::new(std::sync::atomic::AtomicU64::new(0));
    std::thread::scope(|scope| {
        for _ in 0..unique.len().min(4) {
            let queue = queue.clone();
            let results = results.clone();
            let completed = completed.clone();
            let progress_app = app.cloned();
            let progress_job_id = job_id.to_string();
            scope.spawn(move || loop {
                if cancelled.load(Ordering::Acquire) {
                    return;
                }
                let next = queue.lock().ok().and_then(|mut queue| queue.pop_front());
                let Some((key, image, caption)) = next else {
                    return;
                };
                let result = resolve_pdf_image(&image, &caption);
                if let Ok(mut results) = results.lock() {
                    results.insert(key, result);
                } else {
                    return;
                }
                let current = completed.fetch_add(1, Ordering::AcqRel) + 1;
                if let Some(progress_app) = &progress_app {
                    emit_progress(
                        progress_app,
                        &progress_job_id,
                        "running",
                        "preparing-images",
                        &format!("Preparing images ({current} of {total_images})…"),
                        PdfProgressValue::determinate(current, total_images, "items"),
                    );
                }
            });
        }
    });
    check_cancelled(cancelled)?;

    let mut results = results
        .lock()
        .map_err(|_| "The PDF image worker results are unavailable.".to_string())?;
    let mut prepared_images = HashMap::new();
    for (index, (key, _, _)) in unique.into_iter().enumerate() {
        let resolved = results
            .remove(&key)
            .ok_or_else(|| "An image could not be prepared for the PDF.".to_string())??;
        match resolved {
            ResolvedPdfImage::Bytes(bytes) => {
                let extension = typst_image_extension(&bytes).ok_or_else(|| {
                    "An uploaded image uses a format that Typst cannot include in the PDF."
                        .to_string()
                })?;
                let relative = format!("images/image-{index}.{extension}");
                fs::write(workspace.join(&relative), bytes).map_err(|error| {
                    format!("Could not prepare an image for PDF export: {error}")
                })?;
                prepared_images.insert(key, PreparedTypstImage::File(relative));
            }
            ResolvedPdfImage::Placeholder(message) => {
                prepared_images.insert(key, PreparedTypstImage::Placeholder(message));
            }
        }
    }
    Ok(prepared_images)
}

fn export_image_key(image: &ExportImage) -> String {
    match image {
        ExportImage::Url(url) => format!("url:{url}"),
        ExportImage::Upload { absolute_path, .. } => {
            format!("file:{}", absolute_path.to_string_lossy())
        }
    }
}

fn resolve_pdf_image(image: &ExportImage, caption: &str) -> Result<ResolvedPdfImage, String> {
    match image {
        ExportImage::Url(url) => match download_public_image_bytes_detailed(url) {
            Ok(bytes) if typst_image_extension(&bytes).is_some() => {
                Ok(ResolvedPdfImage::Bytes(bytes))
            }
            Ok(_) => Ok(ResolvedPdfImage::Placeholder(remote_image_failure_message(
                url,
                caption,
                "the response is not a supported PNG, JPEG, GIF, WebP, or SVG image",
            ))),
            Err(error) => Ok(ResolvedPdfImage::Placeholder(remote_image_failure_message(
                url,
                caption,
                &error.to_string(),
            ))),
        },
        ExportImage::Upload { absolute_path, .. } => fs::read(absolute_path)
            .map(ResolvedPdfImage::Bytes)
            .map_err(|_| {
                "An uploaded image is missing from the local project. Sync the project and try again."
                    .to_string()
            }),
    }
}

fn remote_image_failure_message(url: &str, caption: &str, reason: &str) -> String {
    let host = url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_string))
        .unwrap_or_else(|| "unknown host".to_string());
    let caption = truncate_image_label(caption.trim(), 90);
    let identity = if caption.is_empty() {
        format!("Image from {host}")
    } else {
        format!("Image “{caption}” from {host}")
    };
    format!("{identity} could not be included: {reason}.")
}

fn truncate_image_label(value: &str, max_chars: usize) -> String {
    let mut characters = value.chars();
    let prefix = characters.by_ref().take(max_chars).collect::<String>();
    if characters.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn normalize_pdf_paper_size(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "us-letter" => Ok("us-letter"),
        "us-legal" => Ok("us-legal"),
        "us-executive" => Ok("us-executive"),
        "us-tabloid" => Ok("us-tabloid"),
        "a3" => Ok("a3"),
        "a4" => Ok("a4"),
        "a5" => Ok("a5"),
        "iso-b5" => Ok("iso-b5"),
        _ => Err("Choose a supported PDF paper size.".to_string()),
    }
}

fn typst_preamble(document: &ExportDocument, paper_size: &str) -> String {
    let code = document
        .language_code
        .to_ascii_lowercase()
        .replace('_', "-");
    let (families, direction) = if code.starts_with("ja") {
        (vec!["Noto Serif JP", "Noto Serif"], "ltr")
    } else if code.starts_with("ko") {
        (vec!["Noto Serif KR", "Noto Serif"], "ltr")
    } else if code.starts_with("zh-hant") || code.starts_with("zh-tw") || code.starts_with("zh-hk")
    {
        (vec!["Noto Serif TC", "Noto Serif"], "ltr")
    } else if code.starts_with("zh") {
        (vec!["Noto Serif SC", "Noto Serif"], "ltr")
    } else if code.starts_with("ar") || code.starts_with("fa") {
        (vec!["Noto Naskh Arabic", "Noto Serif"], "rtl")
    } else {
        (vec!["Noto Serif"], "ltr")
    };
    let family_list = families
        .iter()
        .map(|family| typst_string(family))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "#set page(paper: \"{paper_size}\", margin: (x: 0.85in, y: 0.8in), numbering: \"1\")\n#set text(font: ({family_list}), size: 11pt, lang: {}, dir: {direction})\n#set par(justify: true, leading: 0.65em)\n#show link: set text(fill: rgb(\"245c8a\"))\n\n",
        typst_string(&document.language_code)
    )
}

fn render_inline_typst(text: &str, show_link_urls: bool) -> String {
    inline_segments(text)
        .into_iter()
        .map(|segment| render_styled_typst_text(&segment.text, &segment.style, show_link_urls))
        .collect::<Vec<_>>()
        .join("")
}

fn render_typst_image_caption(caption: &str) -> String {
    format!(
        "#text(style: \"italic\")[{}]",
        render_inline_typst(caption, false)
    )
}

fn render_typst_image_placeholder(message: &str) -> String {
    format!(
        "block(width: 90%, inset: 12pt, stroke: 0.7pt + rgb(\"999999\"), fill: rgb(\"f7f7f7\"), radius: 4pt)[#align(center)[#text(style: \"italic\", fill: rgb(\"666666\"))[#text({})]]]",
        typst_string(message)
    )
}

fn render_inline_typst_with_footnotes(
    text: &str,
    footnotes: &[(usize, String)],
    footnote_links_as_plain_text: bool,
) -> String {
    if footnotes.is_empty() {
        return render_inline_typst(text, false);
    }
    let notes = footnotes
        .iter()
        .map(|(marker, text)| (*marker, text.as_str()))
        .collect::<HashMap<_, _>>();
    let mut rendered = String::new();
    let mut used = HashSet::new();
    for segment in inline_segments(text) {
        let mut cursor = 0usize;
        while let Some((start, end, marker)) =
            next_unescaped_footnote_marker(&segment.text, cursor, &notes, &used)
        {
            rendered.push_str(&render_styled_typst_text(
                &segment.text[cursor..start],
                &segment.style,
                false,
            ));
            if let Some(note) = notes.get(&marker) {
                rendered.push_str(&format!(
                    "#footnote[{}]",
                    render_inline_typst(note, footnote_links_as_plain_text)
                ));
                used.insert(marker);
            }
            cursor = end;
        }
        rendered.push_str(&render_styled_typst_text(
            &segment.text[cursor..],
            &segment.style,
            false,
        ));
    }
    rendered
}

fn next_unescaped_footnote_marker(
    text: &str,
    cursor: usize,
    notes: &HashMap<usize, &str>,
    used: &HashSet<usize>,
) -> Option<(usize, usize, usize)> {
    let mut search = cursor;
    while let Some(relative) = text[search..].find('[') {
        let start = search + relative;
        let close_relative = text[start + 1..].find(']')?;
        let end = start + close_relative + 2;
        let marker = text[start + 1..end - 1].parse::<usize>().ok();
        let slash_count = text[..start]
            .chars()
            .rev()
            .take_while(|ch| *ch == '\\')
            .count();
        if let Some(marker) = marker {
            if slash_count % 2 == 0 && notes.contains_key(&marker) && !used.contains(&marker) {
                return Some((start, end, marker));
            }
        }
        search = end;
    }
    None
}

fn render_styled_typst_text(text: &str, style: &InlineStyleState, show_link_urls: bool) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut rendered = format!("#text({})", typst_string(text));
    if style.bold {
        rendered = format!("#strong[{rendered}]");
    }
    if style.italic {
        rendered = format!("#emph[{rendered}]");
    }
    if style.underline {
        rendered = format!("#underline[{rendered}]");
    }
    if let Some(link) = &style.link {
        let suffix = if show_link_urls {
            format!(" #text({})", typst_string(&format!("({link})")))
        } else {
            String::new()
        };
        rendered = format!("#link({})[{rendered}]{suffix}", typst_string(link));
    }
    rendered
}

fn validate_document_glyphs(document: &ExportDocument, font_dir: &Path) -> Result<(), String> {
    let font_data = required_fonts(&document.language_code)
        .into_iter()
        .map(|asset| {
            fs::read(font_dir.join(asset.file_name))
                .map_err(|_| "A required PDF font is missing. Try the export again.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut characters = BTreeSet::new();
    characters.extend(document.title.chars());
    for block in &document.blocks {
        match block {
            ExportBlock::Text { text, .. } | ExportBlock::Footnote { text, .. } => {
                for segment in inline_segments(text) {
                    characters.extend(segment.text.chars());
                }
            }
            ExportBlock::Image { caption, .. } => {
                for segment in inline_segments(caption) {
                    characters.extend(segment.text.chars());
                }
            }
            ExportBlock::Separator => {}
        }
    }
    let missing = characters
        .into_iter()
        .filter(|ch| !ch.is_control() && !ch.is_whitespace())
        .filter(|ch| {
            !font_data.iter().any(|data| {
                ttf_parser::Face::parse(data, 0)
                    .ok()
                    .and_then(|face| face.glyph_index(*ch))
                    .is_some()
            })
        })
        .take(8)
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    let labels = missing
        .iter()
        .map(|ch| format!("{ch} (U+{:04X})", *ch as u32))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "The selected PDF fonts do not contain every character in this chapter: {labels}. Use DOCX or HTML for this document for now."
    ))
}

fn typst_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "");
    format!("\"{escaped}\"")
}

fn typst_image_extension(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if data.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some("gif")
    } else if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        Some("webp")
    } else if data.starts_with(b"%PDF-") {
        Some("pdf")
    } else if String::from_utf8_lossy(&data[..data.len().min(512)]).contains("<svg") {
        Some("svg")
    } else {
        None
    }
}

fn install_rendered_pdf(rendered_path: &Path, output_path: &Path) -> Result<(), String> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the PDF destination folder: {error}"))?;
    }
    let file_name = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("chapter.pdf");
    let temporary = output_path.with_file_name(format!(".{file_name}.{}.tmp", Uuid::now_v7()));
    fs::copy(rendered_path, &temporary)
        .map_err(|error| format!("Could not copy the finished PDF: {error}"))?;
    atomic_replace(&temporary, output_path)
        .map_err(|error| format!("Could not save the finished PDF: {error}"))
}

fn format_typst_error(details: &str) -> String {
    let compact = details
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("error:") || line.starts_with("help:"))
        .take(2)
        .collect::<Vec<_>>()
        .join(" ");
    if compact.is_empty() {
        "Typst could not compile this chapter as a PDF.".to_string()
    } else {
        format!("Typst could not compile this chapter as a PDF: {compact}")
    }
}

fn emit_progress(
    app: &AppHandle,
    job_id: &str,
    status: &str,
    stage: &str,
    message: &str,
    progress: PdfProgressValue,
) {
    let (downloaded_bytes, total_bytes) = if progress.unit == "bytes" {
        (progress.current, progress.total)
    } else {
        (0, 0)
    };
    let _ = app.emit(
        PDF_EXPORT_EVENT,
        PdfExportProgressPayload {
            job_id: job_id.to_string(),
            status: status.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
            downloaded_bytes,
            total_bytes,
            progress_current: progress.current,
            progress_total: progress.total,
            progress_unit: progress.unit.to_string(),
            progress_indeterminate: progress.indeterminate,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_font_selection_uses_the_matching_serif_family() {
        assert!(required_fonts("ja-JP")
            .iter()
            .any(|font| font.family == "Noto Serif JP"));
        assert!(required_fonts("zh-TW")
            .iter()
            .any(|font| font.family == "Noto Serif TC"));
        assert!(required_fonts("ar")
            .iter()
            .any(|font| font.family == "Noto Naskh Arabic"));
        assert_eq!(required_fonts("es").len(), 2);
    }

    #[test]
    fn typst_strings_escape_code_boundaries() {
        assert_eq!(typst_string("a\\b\"c\nd"), "\"a\\\\b\\\"c\\nd\"");
    }

    #[test]
    fn native_footnotes_replace_their_exact_mid_paragraph_marker() {
        let rendered = render_inline_typst_with_footnotes(
            "Before <b>[2]</b> after.",
            &[(2, "Mid-paragraph note".to_string())],
            false,
        );
        assert_eq!(
            rendered,
            "#text(\"Before \")#footnote[#text(\"Mid-paragraph note\")]#text(\" after.\")"
        );
    }

    #[test]
    fn escaped_and_unmatched_footnote_markers_stay_literal() {
        let rendered = render_inline_typst_with_footnotes(
            r"Escaped \[1] and unmatched [3].",
            &[(1, "Note".to_string())],
            false,
        );
        assert!(!rendered.contains("#footnote"));
        assert!(rendered.contains("[3]"));
    }

    #[test]
    fn unsupported_language_scripts_are_gated_before_download() {
        assert_eq!(unsupported_pdf_language("hi-IN"), Some("Devanagari"));
        assert_eq!(unsupported_pdf_language("he"), Some("Hebrew"));
        assert_eq!(unsupported_pdf_language("en"), None);
        assert_eq!(unsupported_pdf_language("ja"), None);
    }

    #[test]
    fn paper_size_selection_is_allowlisted_and_defaults_to_letter() {
        assert_eq!(normalize_pdf_paper_size(""), Ok("us-letter"));
        assert_eq!(normalize_pdf_paper_size(" A4 "), Ok("a4"));
        assert_eq!(normalize_pdf_paper_size("iso-b5"), Ok("iso-b5"));
        assert!(normalize_pdf_paper_size("custom); #panic(").is_err());

        let document = ExportDocument {
            title: "Paper test".to_string(),
            language_code: "en".to_string(),
            blocks: Vec::new(),
        };
        assert!(typst_preamble(&document, "a4").contains("paper: \"a4\""));
    }

    #[test]
    fn image_captions_are_wrapped_in_italic_text() {
        let caption = render_typst_image_caption("A <b>bold</b> caption");
        assert!(caption.starts_with("#text(style: \"italic\")["));
        assert!(caption.contains("#strong["));
    }

    #[test]
    fn remote_image_failures_identify_the_caption_host_and_reason() {
        let resolved = resolve_pdf_image(
            &ExportImage::Url("http://127.0.0.1/private.png".to_string()),
            "A diagnostic caption",
        )
        .expect("remote failures should become placeholders");
        let ResolvedPdfImage::Placeholder(message) = resolved else {
            panic!("expected a placeholder");
        };
        assert!(message.contains("A diagnostic caption"));
        assert!(message.contains("127.0.0.1"));
        assert!(message.contains("does not resolve exclusively to public addresses"));
        let typst = render_typst_image_placeholder(&message);
        assert!(typst.starts_with("block(width: 90%"));
        assert!(typst.contains("Image “A diagnostic caption”"));
    }

    #[test]
    fn long_remote_image_captions_are_bounded_in_diagnostics() {
        let message = remote_image_failure_message(
            "https://images.example.com/example.png",
            &"x".repeat(120),
            "the image download timed out",
        );
        assert!(message.contains(&format!("{}…", "x".repeat(90))));
        assert!(!message.contains(&"x".repeat(91)));
        assert!(message.contains("images.example.com"));
        assert!(message.contains("timed out"));
    }

    #[test]
    fn detects_typst_image_formats() {
        assert_eq!(typst_image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(typst_image_extension(b"RIFF0000WEBPrest"), Some("webp"));
        assert_eq!(typst_image_extension(b"<svg xmlns='x'></svg>"), Some("svg"));
    }

    #[test]
    fn generated_typst_compiles_when_smoke_runtime_is_configured() {
        let Some(typst_binary) = std::env::var_os("GNOSIS_TYPST_BIN") else {
            return;
        };
        let Some(font_dir) = std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR") else {
            return;
        };
        let workspace = pdf_workspace().expect("smoke workspace");
        let smoke_image = workspace.join("source.svg");
        fs::write(
            &smoke_image,
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#c87900"/></svg>"##,
        )
        .expect("write smoke image");
        let document = ExportDocument {
            title: "PDF smoke test".to_string(),
            language_code: "en".to_string(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "heading_1".to_string(),
                    text: "A <b>safe</b> heading".to_string(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".to_string(),
                    text: "Text with <a href=\"https://example.com\">a link</a> and a mid-paragraph [1] reference."
                        .to_string(),
                },
                ExportBlock::Text {
                    text_style: "centered".to_string(),
                    text: "Centered text".to_string(),
                },
                ExportBlock::Text {
                    text_style: "indented".to_string(),
                    text: "Indented text".to_string(),
                },
                ExportBlock::Footnote {
                    number: 1,
                    marker: 1,
                    anchor_block: Some(1),
                    text: "A footnote".to_string(),
                },
                ExportBlock::Image {
                    image: ExportImage::Upload {
                        repo_relative_path: "smoke.svg".to_string(),
                        raw_url: None,
                        absolute_path: smoke_image,
                    },
                    caption: "An <b>italic caption</b>".to_string(),
                },
                ExportBlock::Image {
                    image: ExportImage::Url("http://127.0.0.1/unavailable.png".to_string()),
                    caption: "Unavailable remote image".to_string(),
                },
            ],
        };
        prepare_typst_workspace(
            None,
            "",
            &workspace,
            &document,
            true,
            "a4",
            &AtomicBool::new(false),
        )
        .expect("render Typst source");
        let output = std::process::Command::new(typst_binary)
            .args([
                "compile",
                "--root",
                workspace.to_str().expect("workspace path"),
                "--font-path",
                Path::new(&font_dir).to_str().expect("font path"),
                "--ignore-system-fonts",
                workspace.join("chapter.typ").to_str().expect("source path"),
                workspace.join("chapter.pdf").to_str().expect("output path"),
            ])
            .output()
            .expect("run Typst");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let pdf = fs::read(workspace.join("chapter.pdf")).expect("compiled PDF");
        assert!(pdf.starts_with(b"%PDF-"));
        let _ = fs::remove_dir_all(workspace);
    }
}
