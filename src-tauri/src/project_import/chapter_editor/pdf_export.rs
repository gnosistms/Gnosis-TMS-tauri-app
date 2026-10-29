use super::book_export::{book_title, single_line_title, BookItemInput};
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
use tauri::{path::BaseDirectory, Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

mod font_fallback;
mod font_preferences;
mod font_review;
mod page_preview;
mod preview_fonts;

pub(crate) use preview_fonts::{start_project_book_preview_fonts, BookPreviewFontsInput};

pub(crate) use page_preview::{start_project_book_page_preview, BookPagePreviewInput};

use super::chapter_export::{
    apply_print_custom_html_policy, build_scoped_export_document,
    download_public_image_bytes_detailed, export_text_style, footnote_paragraphs, inline_segments,
    inline_visible_text, load_export_chapters, ExportBlock, ExportChapterFileInput, ExportDocument,
    ExportImage, InlineStyleState,
};
use super::list_style::{
    is_list_text_style, list_events, list_items, list_kind, ListEvent, ListItem, ListKind,
    ListLevelFormat,
};

const PDF_EXPORT_EVENT: &str = "chapter-pdf-export-progress";
const FONT_REVISION: &str =
    "google-fonts-684b69db51d59a3137ec0152fa3a3afc6f1b3814-cormorant-gnosis-2";
const MAX_FONT_BYTES: u64 = 30 * 1024 * 1024;
const TYPST_COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
const CANCELLED: &str = "__GNOSIS_PDF_EXPORT_CANCELLED__";
const MAX_TYPST_DIAGNOSTIC_BYTES: usize = 128 * 1024;
const MAX_TYPST_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const PDF_IMAGE_PREPARATION_REVISION: &str = "pdf-images-v1";
const PDF_IMAGE_DOWNLOAD_WORKERS: usize = 12;
const PDF_IMAGE_PROCESSING_WORKERS: usize = 4;
const PDF_IMAGE_DOWNLOAD_BUFFER: usize = 4;

#[derive(Clone, Debug, PartialEq)]
enum PreparedTypstImage {
    File {
        path: String,
        /// Height-to-width ratio from the image header; `None` when the format
        /// keeps its dimensions where a cheap scan cannot reach them.
        aspect: Option<f64>,
    },
    Placeholder(String),
}

enum ResolvedPdfImage {
    Bytes(Vec<u8>),
    Placeholder(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PdfImageCacheTarget {
    Chapter(String),
    Book,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PdfImageCacheScope {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    project_full_name: Option<String>,
    target: PdfImageCacheTarget,
}

impl PdfImageCacheScope {
    fn from_input(input: &PdfChapterExportInput) -> Self {
        Self {
            installation_id: input.installation_id,
            repo_name: input.repo_name.clone(),
            project_id: input.project_id.clone(),
            project_full_name: input.project_full_name.clone(),
            target: if input.chapter_ids.is_empty() && input.book_items.is_empty() {
                PdfImageCacheTarget::Chapter(input.chapter_id.clone())
            } else {
                PdfImageCacheTarget::Book
            },
        }
    }
}

#[derive(Clone)]
struct PdfImageCacheSession {
    scope: PdfImageCacheScope,
    // None disables reuse if the optional cache was unavailable at job start.
    generation: Option<u64>,
}

#[derive(Clone)]
struct CachedPreparedPdfImage {
    fingerprint: String,
    bytes: Arc<Vec<u8>>,
    aspect: Option<f64>,
}

#[derive(Default)]
struct PdfImagePreparationCache {
    scope: Option<PdfImageCacheScope>,
    generation: u64,
    entries: HashMap<String, CachedPreparedPdfImage>,
}

struct PdfWorkspacePreparationOptions<'a> {
    footnote_links_as_plain_text: bool,
    paper_size: &'a str,
    image_cache_session: &'a PdfImageCacheSession,
    layout: TypstLayout<'a>,
}

/// What a workspace is typeset for. Book page previews reuse the export
/// renderer so their layout cannot drift from the PDF.
#[derive(Clone, Copy)]
enum TypstLayout<'a> {
    Export,
    /// Pagination only: the book's text, with every image a placeholder that is
    /// never downloaded or decoded and no drop caps, so a whole book typesets in
    /// about a second. Page numbers are read back with `typst eval`.
    TextOnly,
    /// A contents section drawn from an earlier `TextOnly` pass's page numbers.
    ContentsProof(&'a page_preview::ContentsProof),
}

impl PdfImagePreparationCache {
    fn begin_export(&mut self, scope: &PdfImageCacheScope) -> PdfImageCacheSession {
        if self.scope.as_ref() != Some(scope) {
            self.scope = Some(scope.clone());
            self.generation = self.generation.wrapping_add(1);
            self.entries.clear();
        }
        PdfImageCacheSession {
            scope: scope.clone(),
            generation: Some(self.generation),
        }
    }

    fn matches(&self, session: &PdfImageCacheSession) -> bool {
        self.scope.as_ref() == Some(&session.scope) && session.generation == Some(self.generation)
    }

    fn get(
        &self,
        session: &PdfImageCacheSession,
        key: &str,
        fingerprint: &str,
    ) -> Option<CachedPreparedPdfImage> {
        self.matches(session)
            .then(|| self.entries.get(key))
            .flatten()
            .filter(|entry| entry.fingerprint == fingerprint)
            .cloned()
    }

    fn insert(
        &mut self,
        session: &PdfImageCacheSession,
        key: String,
        entry: CachedPreparedPdfImage,
    ) {
        // An older export must not reactivate an evicted target, including after
        // chapter -> book -> the same chapter switches back to a fresh generation.
        if self.matches(session) {
            self.entries.insert(key, entry);
        }
    }
}

fn pdf_image_preparation_cache() -> &'static Mutex<PdfImagePreparationCache> {
    static CACHE: OnceLock<Mutex<PdfImagePreparationCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(PdfImagePreparationCache::default()))
}

fn begin_pdf_image_cache(scope: &PdfImageCacheScope) -> PdfImageCacheSession {
    pdf_image_preparation_cache()
        .lock()
        .ok()
        .map(|mut cache| cache.begin_export(scope))
        .unwrap_or_else(|| PdfImageCacheSession {
            scope: scope.clone(),
            generation: None,
        })
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
    #[serde(default)]
    chapter_ids: Vec<String>,
    #[serde(default)]
    project_title: String,
    #[serde(default)]
    book_items: Vec<BookItemInput>,
    language_code: String,
    #[serde(default)]
    omit_custom_html: Option<bool>,
    #[serde(default)]
    footnote_links_as_plain_text: bool,
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
    saved_fallback_fonts: Vec<font_preferences::SavedFontChoice>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    font_review: Option<font_review::FontReview>,
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
    source: FontSource,
}

#[derive(Clone, Copy)]
enum FontSource {
    /// Fetched from a pinned upstream URL on first use.
    Download(&'static str),
    /// Shipped inside the app bundle, at this path under the resource directory.
    /// Used for fonts we patch ourselves, which no upstream URL can serve.
    Bundled(&'static str),
}

fn pdf_jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct PendingFontReview {
    review_id: String,
    approved: Arc<AtomicBool>,
    choices: Vec<font_fallback::FontChoice>,
}

fn pdf_font_reviews() -> &'static Mutex<HashMap<String, PendingFontReview>> {
    static REVIEWS: OnceLock<Mutex<HashMap<String, PendingFontReview>>> = OnceLock::new();
    REVIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn approve_gtms_chapter_pdf_fonts(
    app: &AppHandle,
    job_id: &str,
    review_id: &str,
) -> Result<bool, String> {
    approve_pending_font_review(job_id, review_id, |choices| {
        font_preferences::save(app, choices)
    })
}

pub(crate) fn forget_gtms_pdf_font_approval(
    app: &AppHandle,
    font_id: &str,
) -> Result<bool, String> {
    font_preferences::forget(app, font_id)
}

fn approve_pending_font_review(
    job_id: &str,
    review_id: &str,
    save: impl FnOnce(&[font_fallback::FontChoice]) -> Result<(), String>,
) -> Result<bool, String> {
    let reviews = pdf_font_reviews()
        .lock()
        .map_err(|_| "The PDF font review is unavailable.".to_string())?;
    let Some(review) = reviews
        .get(job_id)
        .filter(|review| review.review_id == review_id)
    else {
        return Ok(false);
    };
    save(&review.choices)?;
    review.approved.store(true, Ordering::Release);
    Ok(true)
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
                if let Ok(mut reviews) = pdf_font_reviews().lock() {
                    reviews.remove(&self.job_id);
                }
            }
        }
    }
}

const FONT_ASSETS: &[FontAsset] = &[
    FontAsset {
        file_name: "EBGaramond-Roman.ttf",
        family: "EB Garamond",
        language: "base",
        size: 851_176,
        sha256: "ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/f8c1d3d6cc75e30d77130bdcbfbff27e3b6233fe/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf"),
    },
    FontAsset {
        file_name: "EBGaramond-Italic.ttf",
        family: "EB Garamond",
        language: "base",
        size: 754_468,
        sha256: "bba2c4499c93c9612b90b9825d32b07da52fce2fe57562a1eb6b833553f93c4e",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/f8c1d3d6cc75e30d77130bdcbfbff27e3b6233fe/ofl/ebgaramond/EBGaramond-Italic%5Bwght%5D.ttf"),
    },
    // Latin body and heading typeface. Covers Vietnamese natively; Greek and the
    // rare IAST ṝ fall through to EB Garamond.
    FontAsset {
        file_name: "CrimsonPro-Roman.ttf",
        family: "Crimson Pro",
        language: "latin",
        size: 246_324,
        sha256: "16aa9fb7300a93637da51fac03a071b2ff08b6bbf65f99c794c25f040b58af6a",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/crimsonpro/CrimsonPro%5Bwght%5D.ttf"),
    },
    FontAsset {
        file_name: "CrimsonPro-Italic.ttf",
        family: "Crimson Pro",
        language: "latin",
        size: 253_176,
        sha256: "a74dc11dcf2fbb1452064e42395a40a907ca630b49cff86012223785e52b2559",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/crimsonpro/CrimsonPro-Italic%5Bwght%5D.ttf"),
    },
    // The Kindred-style display faces: Alegreya carries chapter titles and body
    // headings, Great Vibes the drop cap that opens a chapter. Latin-script
    // exports only — CJK and Arabic keep their own heading faces. Both cover
    // Vietnamese natively.
    FontAsset {
        file_name: "Alegreya-Roman.ttf",
        family: "Alegreya",
        language: "latin",
        size: 425_288,
        sha256: "ba5564634b93a8f8ba57b48cd4f1ae7417d2b4656fbac779028679b00de3cf12",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/alegreya/Alegreya%5Bwght%5D.ttf"),
    },
    FontAsset {
        file_name: "Alegreya-Italic.ttf",
        family: "Alegreya",
        language: "latin",
        size: 425_852,
        sha256: "fa915eec76227935dc5fb678953c94b71287c360928013cfdb441dfe52f5a391",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/alegreya/Alegreya-Italic%5Bwght%5D.ttf"),
    },
    FontAsset {
        file_name: "GreatVibes-Regular.ttf",
        family: "Great Vibes",
        language: "latin",
        size: 457_588,
        sha256: "8d509802186f1b51572531ecf313e8098f9a5bfdfaca93f0c9b34467f9982d15",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/greatvibes/GreatVibes-Regular.ttf"),
    },
    // Cormorant Garamond with its Vietnamese accents corrected. Upstream draws each
    // accent twice — compact when marks stack, tall when one stands alone — so â and
    // ầ disagree inside a single word. See scripts/patch-cormorant-vietnamese-accents.py
    // and plans/cormorant-circumflex-fix-plan.md. No longer the heading typeface —
    // it trails the Latin body list purely as a glyph-coverage fallback.
    FontAsset {
        file_name: "CormorantGaramondGnosis-Roman.ttf",
        family: "Cormorant Garamond Gnosis",
        language: "latin",
        size: 1_196_284,
        sha256: "e2e361f2ac62f380cfed516c849a3b8361656cb873daac4a889fee08da8be2af",
        source: FontSource::Bundled("fonts/CormorantGaramondGnosis-Roman.ttf"),
    },
    FontAsset {
        file_name: "CormorantGaramondGnosis-Italic.ttf",
        family: "Cormorant Garamond Gnosis",
        language: "latin",
        size: 716_268,
        sha256: "272df0b7134851b43ba7ec27f91e987025c5d82fef2309a5bdb8bb4875cc0a9a",
        source: FontSource::Bundled("fonts/CormorantGaramondGnosis-Italic.ttf"),
    },
    FontAsset {
        file_name: "ShipporiMincho-Regular.ttf",
        family: "Shippori Mincho",
        language: "ja",
        size: 8_677_284,
        sha256: "769b5269f0f9bc6534b352c0e6bd856a566e03ff788f107191c2d835863570b2",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/d0b2d1307ad5d6b579d627a6e5abd25952484b96/ofl/shipporimincho/ShipporiMincho-Regular.ttf"),
    },
    FontAsset {
        file_name: "ShipporiMincho-Bold.ttf",
        family: "Shippori Mincho",
        language: "ja",
        size: 8_563_788,
        sha256: "63bc4eddc74793f671c3ab827c5175e773ffbe569d0bf50ee65375ea9e3bc286",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/d0b2d1307ad5d6b579d627a6e5abd25952484b96/ofl/shipporimincho/ShipporiMincho-Bold.ttf"),
    },
    // Hebrew scripture is quoted inside otherwise Latin-script chapters, so this is
    // pulled in by the content scan rather than by the chapter's language. Chosen over
    // Frank Ruhl Libre and David Libre for its complete niqqud and cantillation marks
    // (55/55, against 21 and 23) — quotations are usually pointed.
    FontAsset {
        file_name: "NotoSerifHebrew.ttf",
        family: "Noto Serif Hebrew",
        language: "hebrew",
        size: 183_600,
        sha256: "93caef921360788dc3b0e32136bb26f16bc57717ec482d48fc7fd43820617165",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserifhebrew/NotoSerifHebrew%5Bwdth,wght%5D.ttf"),
    },
    // Sanskrit in Devanagari. Romanised (IAST) Sanskrit needs nothing extra — Cormorant
    // already covers all of ā ī ū ṛ ṝ ḷ ṃ ḥ ś ṣ ṭ ḍ ṇ — so this is fetched only for
    // documents that quote the script itself.
    FontAsset {
        file_name: "NotoSerifDevanagari.ttf",
        family: "Noto Serif Devanagari",
        language: "devanagari",
        size: 757_692,
        sha256: "1191e07bfeb062d80e252eb85b0eafdfbda1e350707a2a60628668e8f677dbbb",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserifdevanagari/NotoSerifDevanagari%5Bwdth,wght%5D.ttf"),
    },
    FontAsset {
        file_name: "NotoSerifSC.ttf",
        family: "Noto Serif SC",
        language: "zh-hans",
        size: 25_125_512,
        sha256: "050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf"),
    },
    FontAsset {
        file_name: "NotoSerifTC.ttf",
        family: "Noto Serif TC",
        language: "zh-hant",
        size: 16_851_596,
        sha256: "0077e18f57c6908f4a000969880940bdb0dad057c0e8d98b49dc364c3d1b09c6",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoseriftc/NotoSerifTC%5Bwght%5D.ttf"),
    },
    FontAsset {
        file_name: "NotoSerifKR.ttf",
        family: "Noto Serif KR",
        language: "ko",
        size: 23_795_420,
        sha256: "11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notoserifkr/NotoSerifKR%5Bwght%5D.ttf"),
    },
    FontAsset {
        file_name: "NotoNaskhArabic.ttf",
        family: "Noto Naskh Arabic",
        language: "arabic",
        size: 307_592,
        sha256: "67b5a525a661b607971fbd3f96a81b89d3a768e74534fca84f18ac97e6fab72f",
        source: FontSource::Download("https://raw.githubusercontent.com/google/fonts/684b69db51d59a3137ec0152fa3a3afc6f1b3814/ofl/notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf"),
    },
];

pub(crate) fn inspect_gtms_chapter_pdf_fonts(
    app: &AppHandle,
    input: PdfFontInspectionInput,
) -> Result<PdfFontInspection, String> {
    if input.language_code.trim().is_empty() {
        return Err("Choose the export language first.".to_string());
    }
    let omit_custom_html = input.omit_custom_html.unwrap_or(true);
    let show_link_urls = input.footnote_links_as_plain_text;
    let document = load_export_document(
        app,
        &ExportChapterFileInput {
            job_id: String::new(),
            installation_id: input.installation_id,
            repo_name: input.repo_name,
            project_id: input.project_id,
            project_full_name: input.project_full_name,
            chapter_id: input.chapter_id,
            chapter_ids: input.chapter_ids,
            project_title: input.project_title,
            book_items: input.book_items,
            language_code: input.language_code,
            format: "pdf".to_string(),
            output_path: String::new(),
            paper_size: "us-letter".to_string(),
            footnote_links_as_plain_text: show_link_urls,
            omit_custom_html,
        },
    )?;
    let document = apply_print_custom_html_policy(&document, omit_custom_html);
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
            saved_fallback_fonts: Vec::new(),
        });
    }

    let assets = required_fonts_for_document(&document);
    let font_dir = pdf_font_dir(app)?;
    let required_bytes = assets.iter().map(|asset| asset.size).sum();
    let missing_bytes = assets
        .iter()
        .filter(|asset| !valid_cached_font(&font_dir.join(asset.file_name), **asset))
        .map(|asset| asset.size)
        .sum();
    let approved = font_preferences::load(app)?;
    let saved_fallback_fonts = relevant_saved_fonts(
        &document,
        &font_dir,
        show_link_urls,
        missing_bytes == 0,
        &approved,
    )?;
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
        saved_fallback_fonts,
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

fn relevant_saved_fonts(
    document: &ExportDocument,
    font_dir: &Path,
    show_link_urls: bool,
    fonts_installed: bool,
    approved: &[font_fallback::FontChoice],
) -> Result<Vec<font_preferences::SavedFontChoice>, String> {
    if !fonts_installed || approved.is_empty() {
        return Ok(Vec::new());
    }
    let missing = font_fallback::missing_characters(
        document,
        font_dir,
        show_link_urls,
        &AtomicBool::new(false),
    )?;
    Ok(if missing.is_empty() {
        Vec::new()
    } else {
        font_preferences::summaries(approved)
    })
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
    {
        let mut jobs = pdf_jobs()
            .lock()
            .map_err(|_| "The PDF export state is unavailable.".to_string())?;
        if jobs.contains_key(&job_id) {
            return Err("This PDF export is already running.".to_string());
        }
        jobs.insert(job_id.clone(), cancelled.clone());
    }
    // Accept the target in request order, before asynchronous loading/font work.
    // Image workers cannot reactivate an older target after a newer request.
    let image_cache_session = begin_pdf_image_cache(&PdfImageCacheScope::from_input(&input));
    let task_app = app.clone();
    let task_job_id = job_id.clone();
    tauri::async_runtime::spawn(async move {
        let _registration = PdfJobRegistration {
            job_id: task_job_id.clone(),
            cancelled: cancelled.clone(),
        };
        let result = run_pdf_export(
            &task_app,
            &task_job_id,
            input,
            cancelled,
            image_cache_session,
        )
        .await;
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
    image_cache_session: PdfImageCacheSession,
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
    let prepared_document = apply_print_custom_html_policy(&document, omit_custom_html);
    let font_assets = required_fonts_for_document(&prepared_document);
    let font_dir = tauri::async_runtime::spawn_blocking(move || {
        ensure_fonts(&font_app, &font_job_id, font_assets, &font_cancelled)
    })
    .await
    .map_err(|error| format!("The PDF font worker failed: {error}"))??;

    check_cancelled(&cancelled)?;
    let prep_font_dir = font_dir.clone();
    let prep_cancelled = cancelled.clone();
    let prep_app = app.clone();
    let prep_job_id = job_id.to_string();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        let options = PdfWorkspacePreparationOptions {
            footnote_links_as_plain_text,
            paper_size,
            image_cache_session: &image_cache_session,
            layout: TypstLayout::Export,
        };
        prepare_pdf_workspace(
            &prep_app,
            &prep_job_id,
            &prepared_document,
            &prep_font_dir,
            &options,
            &prep_cancelled,
        )
    })
    .await
    .map_err(|error| format!("The PDF image worker failed: {error}"))??;
    let workspace = prepared.workspace;
    let fallback_fonts = prepared.fallback_fonts;
    let _workspace_cleanup = WorkspaceCleanup(workspace.clone());

    if let Some(review) = prepared.review {
        emit_progress(
            app,
            job_id,
            "running",
            "font-review-preparing",
            "Preparing highlighted font samples…",
            PdfProgressValue::indeterminate(),
        );
        compile_typst(
            app,
            &workspace,
            &font_dir,
            &fallback_fonts,
            "font-review.typ",
            "font-review-{p}.svg",
            &cancelled,
        )
        .await?;
        let review_workspace = workspace.clone();
        let review = tauri::async_runtime::spawn_blocking(move || {
            font_review::read_review(&review_workspace, review)
        })
        .await
        .map_err(|_| "The PDF font review worker failed.".to_string())??;
        await_font_review(app, job_id, review, prepared.approval_choices, &cancelled).await?;
    }

    emit_progress(
        app,
        job_id,
        "running",
        "typesetting",
        "Typesetting the PDF…",
        PdfProgressValue::indeterminate(),
    );

    let rendered_path = workspace.join("chapter.pdf");
    compile_typst(
        app,
        &workspace,
        &font_dir,
        &fallback_fonts,
        "chapter.typ",
        "chapter.pdf",
        &cancelled,
    )
    .await?;

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

async fn compile_typst(
    app: &AppHandle,
    workspace: &Path,
    font_dir: &Path,
    fallback_fonts: &[PathBuf],
    source_name: &str,
    rendered_name: &str,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let mut arguments: Vec<std::ffi::OsString> = vec!["compile".into()];
    arguments.extend(typst_world_arguments(workspace, font_dir, fallback_fonts)?);
    arguments.extend([
        workspace.join(source_name).into_os_string(),
        workspace.join(rendered_name).into_os_string(),
    ]);
    run_typst(app, arguments, cancelled).await.map(|_| ())
}

/// Typesets `source_name` and returns `expression` evaluated against the laid-out
/// document, serialized as JSON.
async fn eval_typst(
    app: &AppHandle,
    workspace: &Path,
    font_dir: &Path,
    fallback_fonts: &[PathBuf],
    source_name: &str,
    expression: &str,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, String> {
    let mut arguments: Vec<std::ffi::OsString> = vec![
        "eval".into(),
        expression.into(),
        "--in".into(),
        workspace.join(source_name).into_os_string(),
    ];
    arguments.extend(typst_world_arguments(workspace, font_dir, fallback_fonts)?);
    run_typst(app, arguments, cancelled).await
}

fn typst_world_arguments(
    workspace: &Path,
    font_dir: &Path,
    fallback_fonts: &[PathBuf],
) -> Result<Vec<std::ffi::OsString>, String> {
    let mut arguments: Vec<std::ffi::OsString> = vec![
        "--root".into(),
        workspace.as_os_str().to_owned(),
        "--font-path".into(),
        font_dir.as_os_str().to_owned(),
        "--ignore-system-fonts".into(),
        "--package-path".into(),
        workspace.join("packages").into_os_string(),
    ];
    let mut font_directories = BTreeSet::new();
    for path in fallback_fonts {
        if !path.is_file() {
            return Err(
                "A selected fallback font is no longer installed. Please export again.".to_string(),
            );
        }
        if let Some(directory) = path.parent() {
            font_directories.insert(directory.to_path_buf());
        }
    }
    for directory in font_directories {
        arguments.extend(["--font-path".into(), directory.into_os_string()]);
    }
    Ok(arguments)
}

/// Runs the bundled Typst CLI and returns its standard output.
async fn run_typst(
    app: &AppHandle,
    arguments: Vec<std::ffi::OsString>,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, String> {
    check_cancelled(cancelled)?;
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
        .args(arguments)
        .spawn()
        .map_err(|error| format!("Could not start the bundled Typst compiler: {error}"))?;
    let mut child = Some(child);
    let started = std::time::Instant::now();
    let mut stderr = Vec::new();
    let mut stdout = Vec::new();
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
            Ok(Some(CommandEvent::Stdout(bytes))) => {
                if stdout.len() + bytes.len() > MAX_TYPST_OUTPUT_BYTES {
                    if let Some(child) = child.take() {
                        let _ = child.kill();
                    }
                    return Err("The PDF renderer returned too much data.".to_string());
                }
                stdout.extend_from_slice(&bytes);
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
    // Typst can exit successfully with an unknown family and render missing-glyph
    // boxes. Never let a font-name mismatch turn approval into silent data loss.
    if String::from_utf8_lossy(&stderr).contains("unknown font family:") {
        return Err("A selected font could not be loaded by the PDF renderer. Try another installed font, or export as DOCX or HTML.".to_string());
    }

    Ok(stdout)
}

async fn await_font_review(
    app: &AppHandle,
    job_id: &str,
    review: font_review::FontReview,
    choices: Vec<font_fallback::FontChoice>,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let approved = Arc::new(AtomicBool::new(false));
    pdf_font_reviews()
        .lock()
        .map_err(|_| "The PDF font review is unavailable.".to_string())?
        .insert(
            job_id.to_string(),
            PendingFontReview {
                review_id: review.review_id.clone(),
                approved: approved.clone(),
                choices,
            },
        );
    app.emit(
        PDF_EXPORT_EVENT,
        PdfExportProgressPayload {
            job_id: job_id.to_string(),
            status: "font-review".into(),
            stage: "font-review".into(),
            message: "Review the fallback fonts before publishing.".into(),
            downloaded_bytes: 0,
            total_bytes: 0,
            progress_current: 0,
            progress_total: 0,
            progress_unit: String::new(),
            progress_indeterminate: false,
            font_review: Some(review),
        },
    )
    .map_err(|_| "Could not display the PDF font review.".to_string())?;
    loop {
        check_cancelled(cancelled)?;
        if approved.load(Ordering::Acquire) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    if let Ok(mut reviews) = pdf_font_reviews().lock() {
        reviews.remove(job_id);
    }
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
    let chapters = load_export_chapters(app, &repo_path, input)?;
    let head_sha = current_repo_head_sha(&repo_path);
    let full_name =
        resolve_project_full_name_for_pdf(&repo_path, input.project_full_name.as_deref());
    build_scoped_export_document(
        app,
        &repo_path,
        &chapters,
        input,
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

/// Every character the PDF will have to render, title and captions included.
fn document_characters(document: &ExportDocument) -> BTreeSet<char> {
    let mut characters = BTreeSet::new();
    characters.extend(document.title.chars());
    for block in &document.blocks {
        match block {
            ExportBlock::Text { text, .. }
            | ExportBlock::Attribution { text }
            | ExportBlock::Footnote { text, .. } => {
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
    characters
}

/// Scripts a chapter uses that its declared language would not have asked for — Hebrew
/// scripture or Chinese names quoted inside a Vietnamese chapter, say. Without this the
/// export is refused outright, because Typst reports nothing: it exits successfully and
/// renders tofu boxes instead. Scripts with no font here keep failing the preflight,
/// which is the honest outcome.
fn document_scripts(document: &ExportDocument) -> BTreeSet<&'static str> {
    let mut scripts = BTreeSet::new();
    for character in document_characters(document) {
        let code = character as u32;
        let script = match code {
            0x0590..=0x05FF | 0xFB1D..=0xFB4F => Some("hebrew"),
            // Devanagari, its extended block, and the Vedic marks Sanskrit uses.
            0x0900..=0x097F | 0xA8E0..=0xA8FF | 0x1CD0..=0x1CFF => Some("devanagari"),
            // Han, including the Extension A and compatibility blocks. Noto Serif SC
            // covers traditional and simplified alike, so one font serves both.
            0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF => Some("zh-hans"),
            _ => None,
        };
        if let Some(script) = script {
            scripts.insert(script);
        }
    }
    scripts
}

fn required_fonts_for_document(document: &ExportDocument) -> Vec<FontAsset> {
    required_fonts(&document.language_code, &document_scripts(document))
}

fn required_fonts(language_code: &str, extra_scripts: &BTreeSet<&'static str>) -> Vec<FontAsset> {
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
        // EB Garamond ships with every language: it is the Latin fallback inside the
        // CJK and Arabic families, and the Greek fallback behind Crimson Pro for Latin.
        .filter(|asset| match asset.language {
            "base" => true,
            "latin" => language.is_none(),
            script => Some(script) == language || extra_scripts.contains(script),
        })
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
    assets: Vec<FontAsset>,
    cancelled: &AtomicBool,
) -> Result<PathBuf, String> {
    let font_dir = pdf_font_dir(app)?;
    fs::create_dir_all(&font_dir)
        .map_err(|error| format!("Could not create the PDF font cache: {error}"))?;
    let total = assets.iter().map(|asset| asset.size).sum();
    let mut completed = 0u64;
    for asset in assets {
        check_cancelled(cancelled)?;
        let path = font_dir.join(asset.file_name);
        if valid_cached_font(&path, asset) {
            completed += asset.size;
            continue;
        }
        match asset.source {
            FontSource::Bundled(resource) => {
                emit_progress(
                    app,
                    job_id,
                    "running",
                    "downloading-fonts",
                    &format!("Preparing {} for PDF export…", asset.family),
                    PdfProgressValue::determinate(completed, total, "bytes"),
                );
                install_bundled_font(app, &font_dir, asset, resource)?;
            }
            FontSource::Download(_) => {
                emit_progress(
                    app,
                    job_id,
                    "running",
                    "downloading-fonts",
                    &format!("Downloading {} for PDF export…", asset.family),
                    PdfProgressValue::determinate(completed, total, "bytes"),
                );
                download_font(app, job_id, &font_dir, asset, completed, total, cancelled)?;
            }
        }
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

/// Copy a font that ships inside the app bundle into the PDF font cache. Typst is
/// given a single directory to read, so bundled fonts have to land beside the
/// downloaded ones rather than being referenced in place.
fn install_bundled_font(
    app: &AppHandle,
    font_dir: &Path,
    asset: FontAsset,
    resource: &str,
) -> Result<(), String> {
    let source = app
        .path()
        .resolve(resource, BaseDirectory::Resource)
        .map_err(|error| format!("Could not locate the bundled PDF font: {error}"))?;
    let temp_path = font_dir.join(format!(".{}.{}.bundled", asset.file_name, Uuid::now_v7()));
    fs::copy(&source, &temp_path)
        .map_err(|error| format!("Could not install the bundled PDF font: {error}"))?;
    if temp_path.metadata().map(|meta| meta.len()).ok() != Some(asset.size)
        || hash_file(&temp_path).as_deref() != Some(asset.sha256)
    {
        let _ = fs::remove_file(&temp_path);
        return Err("The bundled PDF font failed its integrity check.".to_string());
    }
    atomic_replace(&temp_path, &font_dir.join(asset.file_name))
        .map_err(|error| format!("Could not install the bundled PDF font: {error}"))
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
    let FontSource::Download(url) = asset.source else {
        return Err("This PDF font ships with the app and is not downloaded.".to_string());
    };
    let client = BlockingClient::builder()
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| format!("Could not initialize the PDF font download: {error}"))?;
    let mut response = client
        .get(url)
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
    options: &PdfWorkspacePreparationOptions<'_>,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    check_cancelled(cancelled)?;
    let image_paths = if matches!(options.layout, TypstLayout::TextOnly) {
        // Book section images (logo, full-page images) are simply left out.
        document
            .blocks
            .iter()
            .filter_map(|block| match block {
                ExportBlock::Image { image, .. } => Some((
                    export_image_key(image),
                    PreparedTypstImage::Placeholder(String::new()),
                )),
                _ => None,
            })
            .collect()
    } else {
        prepare_typst_images(
            app,
            job_id,
            workspace,
            document,
            options.image_cache_session,
            cancelled,
        )?
    };
    fs::write(workspace.join("flourish.svg"), CHAPTER_FLOURISH_SVG)
        .map_err(|error| format!("Could not prepare the title ornament for the PDF: {error}"))?;
    write_droplet_package(workspace)?;
    let mut source = typst_preamble(document, options.paper_size);
    if document.book_parts.is_empty() {
        source.push_str(&render_typst_chapter(
            document,
            &image_paths,
            options,
            cancelled,
            None,
            false,
        )?);
    } else {
        source.push_str(&render_typst_book(
            document,
            &image_paths,
            options,
            cancelled,
        )?);
    }
    if matches!(options.layout, TypstLayout::TextOnly) {
        source.push_str(BOOK_PAGINATION_RULE);
    }
    fs::write(workspace.join("chapter.typ"), source)
        .map_err(|error| format!("Could not write the temporary Typst document: {error}"))
}

// This is the chapter style: book chapters and standalone exports use this
// exact renderer, including title promotion, ornaments, floats, and drop caps.
fn render_typst_chapter(
    document: &ExportDocument,
    image_paths: &HashMap<String, PreparedTypstImage>,
    options: &PdfWorkspacePreparationOptions<'_>,
    cancelled: &AtomicBool,
    chapter_number: Option<usize>,
    book_chapter: bool,
) -> Result<String, String> {
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
    let leading_title = leading_heading_title(document);
    let title = leading_title.as_deref().unwrap_or(document.title.as_str());
    let cover_end = chapter_cover_end(&document.blocks, leading_title.is_some());
    let image_cover =
        cover_end.is_some_and(|end| matches!(document.blocks[end], ExportBlock::Image { .. }));
    // The ornament under the chapter title; referenced by the gnosis-title rule.
    let mut source = String::new();
    // No spacer after the title: it is a top float now, and its `clearance`
    // provides the gap to whatever the page starts with.
    source.push_str(&format!(
        "#gnosis-title({}{}{})\n",
        typst_string(title),
        chapter_number
            .map(|number| format!(", number: {number}"))
            .unwrap_or_default(),
        if image_cover { ", tight: true" } else { "" }
    ));
    let (emission_order, trailing_start) = typst_block_emission_order(
        &document.blocks,
        image_paths,
        cover_end.map_or(0, |end| end + 1),
    );
    let dropcap_index = if latin_body(&document.language_code)
        && !matches!(options.layout, TypstLayout::TextOnly)
    {
        dropcap_block_index(&document.blocks, &emission_order, leading_title.is_some())
    } else {
        None
    };
    let mut indent_next = false;
    let mut set_citation = None;
    let mut cover_open = cover_end.is_some();
    for block_index in emission_order {
        let block = &document.blocks[block_index];
        check_cancelled(cancelled)?;
        // Checked before anything else, so a citation already set inside its quote
        // (and skipped below) cannot carry the cover's page break away with it.
        if cover_open && cover_end.is_some_and(|end| block_index > end) {
            source.push_str("#pagebreak(weak: true)\n");
            cover_open = false;
        }
        // A leading H1 promoted to the chapter title is not also printed as a
        // body heading — it has become the title above.
        if leading_title.is_some() && block_index == 0 {
            continue;
        }
        match block {
            ExportBlock::Text { text_style, text } => {
                let footnotes = anchored_footnotes
                    .get(&block_index)
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                let inline = match list_kind(text_style) {
                    // A list row is set whole, as one native Typst list.
                    Some(kind) => {
                        let items = list_items(text);
                        let texts = items
                            .iter()
                            .map(|item| item.text.as_str())
                            .collect::<Vec<_>>();
                        let items_inline = render_inline_typst_parts_with_footnotes(
                            &texts,
                            footnotes,
                            options.footnote_links_as_plain_text,
                        );
                        render_typst_list(kind, &items, &items_inline)
                    }
                    None => render_inline_typst_with_footnotes(
                        text,
                        footnotes,
                        options.footnote_links_as_plain_text,
                    ),
                };
                let style = export_text_style(Some(text_style));
                let plain = !matches!(
                    style.as_str(),
                    "heading1" | "heading2" | "quote" | "blockquote" | "centered" | "indented"
                ) && !is_list_text_style(&style);
                if latin_body(&document.language_code) {
                    let amount = if plain && indent_next && Some(block_index) != dropcap_index {
                        "1.5em"
                    } else {
                        "0pt"
                    };
                    source.push_str(&format!(
                        "#set par(first-line-indent: (amount: {amount}, all: true))\n"
                    ));
                }
                let dropcap = Some(block_index) == dropcap_index;
                let citation = match document.blocks.get(block_index + 1) {
                    Some(ExportBlock::Attribution { text }) => Some(text),
                    _ => None,
                };
                let cited_block = citation.filter(|_| !dropcap).and_then(|citation| {
                    render_typst_cited_text_block(
                        text_style,
                        &inline,
                        &render_inline_typst(citation, false),
                        cover_open,
                    )
                });
                if let Some(cited_block) = cited_block {
                    source.push_str(&cited_block);
                    set_citation = Some(block_index + 1);
                } else {
                    let mut text_block =
                        render_typst_text_block(text_style, &inline, dropcap, cover_open);
                    if book_chapter && style == "heading1" {
                        // Keep the metadata outside heading content (where a label
                        // binds to the heading itself), directly before it rather
                        // than in a wrapping block: a block would replace the
                        // heading's own spacing with paragraph spacing. Typst
                        // carries the zero-size metadata forward with the sticky
                        // heading, so the entry still lands on the heading's page.
                        text_block = format!("#metadata((title: {}, numbering: \"1\", level: 1)) <gnosis-book-entry>\n{text_block}", typst_string(&inline_visible_text(text)));
                    }
                    if citation.is_some() {
                        // A heading or drop-cap opening cannot carry its citation
                        // as a last line; both are short enough to move with it
                        // to the next page as one unit.
                        source.push_str(&format!(
                            "#block(sticky: true, breakable: true)[{text_block}]\n"
                        ));
                    } else {
                        source.push_str(&text_block);
                    }
                }
                if !inline_visible_text(text).trim().is_empty() {
                    indent_next = plain;
                }
            }
            ExportBlock::Attribution { text } => {
                indent_next = false;
                // Already set as the last line of the block it cites.
                if set_citation == Some(block_index) {
                    continue;
                }
                // Resolve below in body-text units, outside the smaller citation.
                // Block spacing collapses with larger following gaps and at page
                // boundaries; 1.5em adds about half a line over normal paragraphs.
                source.push_str(&format!(
                    "#block(width: 100%, below: 1.5em)[#align(right)[#text(size: 0.8em, tracking: 0.06em)[#upper[{}]]]]\n\n",
                    render_inline_typst(text, false)
                ));
            }
            ExportBlock::Separator => {
                indent_next = false;
                source.push_str(
                    "#v(1em)\n#align(center, image(\"flourish.svg\", width: 0.66in))\n#v(1em)\n",
                )
            }
            ExportBlock::Footnote { number, text, .. } if !anchored_numbers.contains(number) => {
                source.push_str(&format!(
                    "#footnote[{}]\n",
                    render_footnote_typst(text, options.footnote_links_as_plain_text)
                ));
            }
            ExportBlock::Footnote { .. } => {}
            ExportBlock::Image { image, caption } => {
                indent_next = false;
                let prepared = image_paths
                    .get(&export_image_key(image))
                    .ok_or_else(|| "An image could not be prepared for the PDF.".to_string())?;
                let body = match prepared {
                    PreparedTypstImage::File { path, .. } => {
                        if caption.trim().is_empty() {
                            format!("gnosis-image({})", typst_string(path))
                        } else {
                            // The caption goes to gnosis-image as well as to the
                            // figure: the helper only measures it, so the image
                            // shrinks by exactly the height the caption will take.
                            format!(
                                "gnosis-image({}, caption: [{}])",
                                typst_string(path),
                                render_typst_image_caption(caption)
                            )
                        }
                    }
                    PreparedTypstImage::Placeholder(message) => {
                        render_typst_image_placeholder(message)
                    }
                };
                // Floating exists so following text can flow around the image.
                // A trailing image has no following text, so it stays in flow:
                // it lands directly under the chapter's final lines when it
                // fits there, and at the top of the next page when it does not
                // — never above text and never at the foot of an empty page.
                let cover = Some(block_index) == cover_end;
                let floating = block_index < trailing_start && !cover;
                let figure = if caption.trim().is_empty() {
                    let placement = if floating { ", placement: auto" } else { "" };
                    format!("#figure({body}{placement})")
                } else {
                    render_typst_figure(&body, caption, floating)
                };
                if cover {
                    // A cover image stays under the title. The 1fr block is the
                    // space the title leaves on the page, so gnosis-image measures
                    // that instead of the whole page and shrinks the image to fit.
                    // A 1fr block shrinks to its content's width unless given one,
                    // which would leave a shrunken image off centre.
                    source.push_str(&format!("#block(width: 100%, height: 1fr)[{figure}]\n\n"));
                } else {
                    source.push_str(&format!("{figure}\n\n"));
                }
            }
        }
    }
    Ok(source)
}

// Typst resolves these metadata locations against the final paginated document.
// A contents section can be anywhere; no guessed page counts or extra render jobs.
const BOOK_LAYOUT_RULES: &str = r#"
#set page(numbering: none, header: context {
  let p = here().page()
  let starts = query(<gnosis-chapter-start>)
  let ends = query(<gnosis-chapter-end>)
  for range in starts.zip(ends) {
    if range.first().location().page() < p and p <= range.last().location().page() {
      let label = if calc.rem(p, 2) == 0 { gnosis-book-author } else { gnosis-book-title }
      if label != "" { align(center, text(font: gnosis-book-heading-font, size: 8pt, tracking: 0.1em)[#upper(label)]) }
    }
  }
}, footer: context {
  let p = here().page()
  let starts = query(<gnosis-print-start>)
  let ends = query(<gnosis-print-end>)
  for range in starts.zip(ends) {
    if range.first().location().page() <= p and p <= range.last().location().page() {
      align(center, text(size: 9pt, counter(page).display(range.first().value)))
    }
  }
})
#let gnosis-book-entries() = query(<gnosis-book-entry>).map(entry => (..entry.value, page: numbering(entry.value.numbering, ..counter(page).at(entry.location())), location: entry.location()))
#let gnosis-contents-link(entry, body) = if "location" in entry { link(entry.location, body) } else { body }
// `entries` is called in context. A page preview passes page numbers from an
// earlier pagination pass instead of the live book's entries.
#let gnosis-contents-entries(t, entries, include-h1: false) = {
  set par(justify: false, first-line-indent: 0pt)
  show link: set text(fill: black)
  align(center, text(font: gnosis-book-heading-font, size: 20pt, tracking: 0.08em)[#upper(t)])
  v(2em)
  context {
    for entry in entries() {
      if entry.level == 0 or include-h1 {
        block(width: 100%, above: if entry.level == 0 { 1em } else { 0.78em }, below: 0.78em)[
          #pad(left: if entry.level == 0 { 0em } else { 1.5em })[
            #gnosis-contents-link(entry, grid(columns: (1fr, auto), column-gutter: 1em,
              if entry.level == 0 { text(font: gnosis-book-heading-font)[#if entry.chapter != none { str(entry.chapter) + ". " }#upper(entry.title)] } else { entry.title },
              entry.page,
            ))
          ]
        ]
      }
    }
  }
}
#let gnosis-contents(t, include-h1: false) = gnosis-contents-entries(t, gnosis-book-entries, include-h1: include-h1)
"#;

// Appended to a `TextOnly` book: every contents entry's page and where each
// contents section starts, read back with `typst eval`.
const BOOK_PAGINATION_RULE: &str = r#"
#context [#metadata((
  entries: gnosis-book-entries().map(entry => { let _ = entry.remove("location"); entry }),
  contents: query(<gnosis-contents-start>).map(start => (..start.value, page: counter(page).at(start.location()).first())),
)) <gnosis-book-pagination>]
"#;

// Fit unusually long unbreakable words, but let ordinary titles wrap naturally
// across the full text column. Explicit author line breaks are preserved.
const BOOK_TITLE_FIT_RULE: &str = r#"
#let gnosis-title-fit(words, body) = layout(region => {
  let widest = 0pt
  for word in words {
    let word = upper(word)
    for sample in (word, strong(word), emph(word), strong(emph(word))) {
      let natural-word = measure(sample)
      if measure(sample, width: 1pt).height <= natural-word.height + 0.1pt {
        widest = calc.max(widest, natural-word.width)
      }
    }
  }
  set text(size: if widest > region.width { (region.width / widest) * 1em } else { 1em })
  body
})
"#;

fn render_typst_book(
    document: &ExportDocument,
    image_paths: &HashMap<String, PreparedTypstImage>,
    options: &PdfWorkspacePreparationOptions<'_>,
    cancelled: &AtomicBool,
) -> Result<String, String> {
    let mut source = format!("{BOOK_LAYOUT_RULES}{BOOK_TITLE_FIT_RULE}");
    let mut body_started = false;
    let mut chapter_number = 0usize;
    let title_page = document
        .book_parts
        .iter()
        .find(|part| part.item.kind == "title");
    let book_author = title_page
        .map(|part| part.item.author.as_str())
        .unwrap_or("");
    let header_title = single_line_title(book_title(document));
    let heading_fonts = heading_font_families(document)
        .into_iter()
        .map(typst_string)
        .collect::<Vec<_>>()
        .join(", ");
    source.insert_str(
        0,
        &format!("#let gnosis-book-heading-font = ({heading_fonts})\n#let gnosis-book-author = {}\n#let gnosis-book-title = {}\n", typst_string(book_author), typst_string(&header_title)),
    );
    for (index, part) in document.book_parts.iter().enumerate() {
        check_cancelled(cancelled)?;
        let item = &part.item;
        if !item.image_asset_id.is_empty()
            && !matches!(options.layout, TypstLayout::TextOnly)
            && section_prepared_image(&part.document, image_paths).is_none()
        {
            return Err(
                "Could not prepare a book image. Select the image again before exporting.".into(),
            );
        }
        if index > 0 {
            let side = if item.kind == "copyright" {
                "even"
            } else {
                "odd"
            };
            source.push_str(&format!("#pagebreak(to: \"{side}\")\n"));
        } else if item.kind == "copyright" {
            // A leading copyright page still occupies the verso of a spread.
            source.push_str("#pagebreak(to: \"even\")\n");
        }
        if item.kind == "chapter" && !body_started {
            source.push_str("#counter(page).update(1)\n");
            body_started = true;
        }
        let numbering = match options.layout {
            TypstLayout::ContentsProof(proof) => proof.numbering.as_str(),
            _ if body_started => "1",
            _ => "i",
        };
        let number = if item.kind == "chapter" && item.numbered != Some(false) {
            chapter_number += 1;
            Some(chapter_number)
        } else {
            None
        };
        if item.kind == "chapter" {
            let title = if item.kind == "chapter" {
                leading_heading_title(&part.document).unwrap_or_else(|| part.document.title.clone())
            } else {
                item.title.clone()
            };
            source.push_str(&format!(
                "#metadata((title: {}, numbering: \"{numbering}\", level: 0, chapter: {})) <gnosis-book-entry>\n",
                typst_string(&title), number.map(|value| value.to_string()).unwrap_or_else(|| "none".into())
            ));
        }
        let has_page_numbers = matches!(item.kind.as_str(), "chapter" | "contents");
        if item.kind == "contents" {
            match options.layout {
                TypstLayout::TextOnly => source.push_str(&format!(
                    "#metadata((id: {}, numbering: \"{numbering}\")) <gnosis-contents-start>\n",
                    typst_string(&item.id)
                )),
                // The proof holds only this section: number its pages as the book does.
                TypstLayout::ContentsProof(proof) => {
                    source.push_str(&format!("#counter(page).update({})\n", proof.page));
                }
                TypstLayout::Export => {}
            }
        }
        if has_page_numbers {
            source.push_str(&format!(
                "#metadata(\"{numbering}\") <gnosis-print-start>\n"
            ));
        }
        if item.kind == "chapter" {
            source.push_str("#metadata(none) <gnosis-chapter-start>\n");
            source.push_str(&render_typst_chapter(
                &part.document,
                image_paths,
                options,
                cancelled,
                number,
                true,
            )?);
            source.push_str("#metadata(none) <gnosis-chapter-end>\n");
        } else if item.kind == "contents" {
            let title = typst_string(&item.title);
            let include_h1 = item.include_h1_headings;
            source.push_str(&match options.layout {
                TypstLayout::ContentsProof(proof) => format!(
                    "#gnosis-contents-entries({title}, {}, include-h1: {include_h1})\n",
                    proof.typst_entries()
                ),
                _ => format!("#gnosis-contents({title}, include-h1: {include_h1})\n"),
            });
        } else if item.kind == "title" {
            let title_words = inline_visible_text(&item.title)
                .split_whitespace()
                .map(|word| format!("{},", typst_string(word)))
                .collect::<String>();
            source.push_str(&format!("#align(center)[\n#set par(justify: false, first-line-indent: 0pt, linebreaks: \"simple\")\n#set text(spacing: 100%, hyphenate: false)\n#v(0.2fr)\n#block(width: 100%)[\n#set text(font: ({heading_fonts}), size: 30pt, weight: \"medium\")\n#set par(leading: 0.6em, spacing: 0pt, linebreaks: \"simple\")\n#gnosis-title-fit(({title_words}))[#upper[{}]]\n]\n", render_inline_typst(&item.title, false)));
            if !item.subtitle.trim().is_empty() {
                source.push_str(&format!(
                    "#v(1em)\n#text(font: ({heading_fonts}), size: 14pt)[#upper[{}]]\n",
                    render_inline_typst(&item.subtitle, false)
                ));
            }
            source.push_str("#v(1.4em)\n#image(\"flourish.svg\", width: 0.75in)\n#v(2.5em)\n");
            if !item.author.trim().is_empty() {
                source.push_str(&format!(
                    "#text(font: ({heading_fonts}), size: 15pt)[#upper[{}]]\n",
                    render_inline_typst(&item.author, false)
                ));
            }
            if !item.translator.trim().is_empty() {
                source.push_str(&format!(
                    "#v(1em)\n#text(size: 12pt)[{}]\n",
                    render_inline_typst(&item.translator, false)
                ));
            }
            source.push_str("#v(1fr)\n");
            if let Some(path) = section_prepared_image(&part.document, image_paths) {
                source.push_str(&format!(
                    "#image({}, width: 1.105in, height: 0.595in, fit: \"contain\")\n",
                    typst_string(path)
                ));
            }
            source.push_str("]\n");
        } else if item.kind == "image" {
            source.push_str("#v(1fr)\n#align(center)[\n");
            if let Some(path) = section_prepared_image(&part.document, image_paths) {
                source.push_str(&format!(
                    "#gnosis-image({}, caption: [{}])\n",
                    typst_string(path),
                    render_typst_image_caption(&item.caption)
                ));
            }
            if !item.caption.trim().is_empty() {
                source.push_str(&format!(
                    "#v(0.85em)\n{}\n",
                    render_typst_image_caption(&item.caption)
                ));
            }
            source.push_str("]\n#v(1fr)\n");
        } else {
            if item.kind == "copyright" {
                source.push_str("#v(1fr)\n");
            }
            if item.kind == "dedication" {
                source.push_str("#v(0.22fr)\n#align(center)[\n");
            }
            source.push_str(
                "#[\n#set par(leading: 0.68em, spacing: 1.43em, first-line-indent: 0pt)\n",
            );
            if item.kind == "copyright" {
                source.push_str("#set text(size: 0.8em)\n");
            }
            for block in super::book_export::book_text_blocks(&item.text, "paragraph") {
                match block {
                    ExportBlock::Separator => source.push_str("#v(1em)\n#align(center, image(\"flourish.svg\", width: 0.66in))\n#v(1em)\n"),
                    ExportBlock::Text { text, .. } => {
                        if inline_visible_text(&text).is_empty() {
                            source.push_str("#v(1.25em)\n");
                        } else {
                            source.push_str(&render_inline_typst(&text, options.footnote_links_as_plain_text));
                            source.push_str("#parbreak()\n");
                        }
                    }
                    _ => {}
                }
            }
            source.push_str("]\n");
            if item.kind == "dedication" {
                source.push_str("]\n#v(1fr)\n");
            }
        }
        if has_page_numbers {
            source.push_str("\n#metadata(none) <gnosis-print-end>\n");
        }
    }
    Ok(source)
}

fn section_prepared_image<'a>(
    document: &ExportDocument,
    images: &'a HashMap<String, PreparedTypstImage>,
) -> Option<&'a str> {
    document.blocks.iter().find_map(|block| {
        let ExportBlock::Image { image, .. } = block else {
            return None;
        };
        match images.get(&export_image_key(image)) {
            Some(PreparedTypstImage::File { path, .. }) => Some(path.as_str()),
            _ => None,
        }
    })
}

/// Emission order for blocks. Everything up to the trailing image run keeps
/// document order. The trailing run — consecutive image blocks with nothing
/// after them — is reordered shortest-rendering-first, so the shortest image
/// takes whatever space is left under the chapter's final lines and the taller
/// ones follow on the pages after it. Rendered height at full text width is
/// proportional to the height-to-width ratio, so that ratio is the sort key;
/// placeholders render as short notice boxes and sort ahead of real images.
/// The sort is stable: equal ratios keep their document order. Blocks before
/// `fixed_until` (a chapter's cover) always keep their place.
fn typst_block_emission_order(
    blocks: &[ExportBlock],
    image_paths: &HashMap<String, PreparedTypstImage>,
    fixed_until: usize,
) -> (Vec<usize>, usize) {
    let mut trailing_start = blocks.len();
    while trailing_start > fixed_until
        && matches!(blocks[trailing_start - 1], ExportBlock::Image { .. })
    {
        trailing_start -= 1;
    }
    let estimate = |index: &usize| -> f64 {
        let ExportBlock::Image { image, .. } = &blocks[*index] else {
            return 1.0;
        };
        match image_paths.get(&export_image_key(image)) {
            Some(PreparedTypstImage::File { aspect, .. }) => aspect.unwrap_or(1.0),
            Some(PreparedTypstImage::Placeholder(_)) => 0.2,
            None => 1.0,
        }
    };
    let mut order: Vec<usize> = (0..blocks.len()).collect();
    order[trailing_start..].sort_by(|a, b| estimate(a).total_cmp(&estimate(b)));
    (order, trailing_start)
}

/// The single block that opens with a drop cap: the first paragraph the reader
/// sees (after a leading H1 was promoted to the title), provided it is a plain
/// paragraph that starts with a letter. Chapters that open with a heading,
/// quote, or separator get no drop cap — matching the book-design convention
/// the style imitates — unless the quote is the chapter's cover: the text then
/// opens its own page, so its first paragraph takes the drop cap. Blocks that put
/// nothing in the reading flow at that position are looked past: footnotes
/// (rendered at the page foot), blank rows, and images (floated away or standing
/// as figures — the opening sentence is still the first paragraph).
fn dropcap_block_index(
    blocks: &[ExportBlock],
    emission_order: &[usize],
    title_promoted: bool,
) -> Option<usize> {
    let cover_end = chapter_cover_end(blocks, title_promoted);
    for &index in emission_order {
        if (title_promoted && index == 0) || cover_end.is_some_and(|end| index <= end) {
            continue;
        }
        match &blocks[index] {
            ExportBlock::Footnote { .. } | ExportBlock::Image { .. } => continue,
            ExportBlock::Text { text_style, text } => {
                let first = inline_visible_text(text)
                    .chars()
                    .find(|character| character.is_alphanumeric());
                // Blank rows emit nothing visible — look past them, the way a
                // reader would.
                let Some(first) = first else { continue };
                let style = export_text_style(Some(text_style));
                let plain = !matches!(
                    style.as_str(),
                    "heading1" | "heading2" | "quote" | "blockquote" | "centered" | "indented"
                ) && !is_list_text_style(&style);
                return (plain && first.is_alphabetic()).then_some(index);
            }
            _ => return None,
        }
    }
    None
}

/// The last block of a chapter's cover page. When the first thing after the title
/// is a quote or an image, it stands alone beneath the title and the chapter text
/// starts on the next page, so the title and its epigraph or image read as a cover
/// for the chapter. A quote cover is the run of consecutive quotes with their
/// citations, so a multi-paragraph epigraph (or a pair of them) stays together; an
/// image cover is that one image. Blocks that put nothing in the reading flow are
/// looked past: a leading H1 promoted to the title, blank rows, and footnotes (set
/// at the page foot). With nothing visible after the opener there is no cover: the
/// opener already has the page to itself.
fn chapter_cover_end(blocks: &[ExportBlock], title_promoted: bool) -> Option<usize> {
    let blank = |block: &ExportBlock| match block {
        ExportBlock::Footnote { .. } => true,
        ExportBlock::Text { text, .. } => inline_visible_text(text).trim().is_empty(),
        _ => false,
    };
    let quote = |block: &ExportBlock| {
        !blank(block)
            && matches!(block, ExportBlock::Text { text_style, .. }
                if matches!(export_text_style(Some(text_style)).as_str(), "quote" | "blockquote"))
    };
    let start = if title_promoted { 1 } else { 0 };
    let first = (start..blocks.len()).find(|index| !blank(&blocks[*index]))?;
    let mut end = first;
    if quote(&blocks[first]) {
        for (index, block) in blocks.iter().enumerate().skip(first + 1) {
            let citation = index == end + 1
                && quote(&blocks[end])
                && matches!(block, ExportBlock::Attribution { .. });
            if quote(block) || citation {
                end = index;
            } else if !blank(block) {
                break;
            }
        }
    } else if !matches!(blocks[first], ExportBlock::Image { .. }) {
        return None;
    }
    blocks[end + 1..]
        .iter()
        .any(|block| !blank(block))
        .then_some(end)
}

struct PreparedPdfWorkspace {
    workspace: PathBuf,
    review: Option<font_review::PreparedFontReview>,
    fallback_fonts: Vec<PathBuf>,
    approval_choices: Vec<font_fallback::FontChoice>,
}

fn prepare_pdf_workspace(
    app: &AppHandle,
    job_id: &str,
    document: &ExportDocument,
    font_dir: &Path,
    options: &PdfWorkspacePreparationOptions<'_>,
    cancelled: &AtomicBool,
) -> Result<PreparedPdfWorkspace, String> {
    check_cancelled(cancelled)?;
    let workspace = pdf_workspace()?;
    let result = (|| {
        let approved = font_preferences::load(app)?;
        let plan = font_fallback::resolve(
            document,
            font_dir,
            options.footnote_links_as_plain_text,
            &approved,
            cancelled,
        )?;
        if !plan.missing.is_empty() {
            report_font_coverage_gap(app, &plan, document);
        }
        plan.validate()?;
        prepare_typst_workspace(Some(app), job_id, &workspace, document, options, cancelled)?;
        let unapproved = plan.unapproved(&approved);
        if !plan.fonts.is_empty() {
            let chapter_path = workspace.join("chapter.typ");
            let source = fs::read_to_string(&chapter_path)
                .map_err(|_| "Could not prepare the PDF font choices.".to_string())?;
            fs::write(&chapter_path, format!("{}{source}", plan.rules(false)))
                .map_err(|_| "Could not prepare the PDF font choices.".to_string())?;
        }
        let review = if unapproved.fonts.is_empty() {
            None
        } else {
            Some(font_review::prepare(
                &workspace,
                document,
                options,
                &plan,
                &unapproved,
            )?)
        };
        let fallback_fonts = plan.fonts.iter().map(|font| font.path.clone()).collect();
        Ok(PreparedPdfWorkspace {
            workspace: workspace.clone(),
            review,
            fallback_fonts,
            approval_choices: unapproved.fonts.iter().map(|font| font.choice()).collect(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&workspace);
    }
    result
}

fn report_font_coverage_gap(
    app: &AppHandle,
    plan: &font_fallback::FontFallbackPlan,
    document: &ExportDocument,
) {
    static REPORTED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    // Only the in-process dedup key includes codepoints; no text, raw characters,
    // codepoint sequence, font paths, or excerpts cross the telemetry boundary.
    let signature = format!(
        "{:x}",
        Sha256::digest(plan.missing.iter().collect::<String>().as_bytes())
    );
    if let Ok(mut reported) = REPORTED.get_or_init(|| Mutex::new(HashSet::new())).lock() {
        if reported.len() >= 256 || !reported.insert(signature) {
            return;
        }
        let _ = app.emit("chapter-pdf-font-coverage-gap", plan.diagnostic(document));
    }
}

/// `cover` marks a block on a chapter's cover page (see `chapter_cover_end`), where
/// a short quote is centred.
fn render_typst_text_block(style: &str, inline: &str, dropcap: bool, cover: bool) -> String {
    if style == "chapter_heading" {
        return format!("#pagebreak(weak: true)\n= {inline}\n\n");
    }
    match export_text_style(Some(style)).as_str() {
        "heading1" => format!("= {inline}\n\n"),
        "heading2" => format!("== {inline}\n\n"),
        "quote" | "blockquote" if cover => format!("#gnosis-quote(cover: true)[{inline}]\n\n"),
        "quote" | "blockquote" => format!("#gnosis-quote[{inline}]\n\n"),
        "centered" => format!("#align(center)[{inline}]\n\n"),
        "indented" => format!("#pad(left: 2em)[{inline}]\n\n"),
        // `inline` is the whole list, from `render_typst_list`.
        list if is_list_text_style(list) => format!("{inline}\n\n"),
        _ if dropcap => format!("#gnosis-dropcap[{inline}]\n\n"),
        _ => format!("{inline}\n\n"),
    }
}

/// A block followed by a citation, with the citation set as the block's own last
/// line. Typst never leaves a paragraph's last line alone at the top of a page, so
/// the citation always crosses a page break together with at least one line of the
/// text it cites. A separate citation block could only be held to its text with
/// `sticky`, and Typst moves a sticky block whole instead of splitting it, which
/// left long quotes jumping to the next page. Headings return `None`: they cannot
/// carry a citation line. `cover` is as for `render_typst_text_block`.
fn render_typst_cited_text_block(
    style: &str,
    inline: &str,
    citation: &str,
    cover: bool,
) -> Option<String> {
    if style == "chapter_heading" {
        return None;
    }
    let citation_line = format!("#gnosis-citation[{citation}]");
    let cover_argument = if cover { ", cover: true" } else { "" };
    match export_text_style(Some(style)).as_str() {
        "heading1" | "heading2" => None,
        // Only quotes have citations.
        list if is_list_text_style(list) => None,
        "quote" | "blockquote" => Some(format!(
            "#gnosis-quote(citation: [{citation}]{cover_argument})[{inline}]\n\n"
        )),
        "centered" => Some(format!(
            "#block(below: 1.5em)[#align(center)[{inline}{citation_line}]]\n\n"
        )),
        "indented" => Some(format!(
            "#block(below: 1.5em)[#pad(left: 2em)[{inline}{citation_line}]]\n\n"
        )),
        _ => Some(format!("#block(below: 1.5em)[{inline}{citation_line}]\n\n")),
    }
}

fn prepare_typst_images(
    app: Option<&AppHandle>,
    job_id: &str,
    workspace: &Path,
    document: &ExportDocument,
    cache_session: &PdfImageCacheSession,
    cancelled: &AtomicBool,
) -> Result<HashMap<String, PreparedTypstImage>, String> {
    prepare_typst_images_with_cache(
        app,
        job_id,
        workspace,
        document,
        cache_session,
        cancelled,
        pdf_image_preparation_cache(),
    )
}

fn prepare_typst_images_with_cache(
    app: Option<&AppHandle>,
    job_id: &str,
    workspace: &Path,
    document: &ExportDocument,
    cache_session: &PdfImageCacheSession,
    cancelled: &AtomicBool,
    image_cache: &Mutex<PdfImagePreparationCache>,
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

    let mut cached_images = HashMap::new();
    let mut pending_images = Vec::new();
    for (key, image, caption) in unique {
        check_cancelled(cancelled)?;
        let (fingerprint, source_bytes) = pdf_image_fingerprint(&image)?;
        let cached = image_cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(cache_session, &key, &fingerprint));
        if let Some(cached) = cached {
            cached_images.insert(key, cached);
        } else {
            pending_images.push((key, image, caption, fingerprint, source_bytes));
        }
    }

    let total_images = (cached_images.len() + pending_images.len()) as u64;
    let cached_count = cached_images.len() as u64;
    if let Some(app) = app {
        emit_progress(
            app,
            job_id,
            "running",
            "preparing-images",
            &if pending_images.is_empty() {
                format!("Reusing prepared images ({total_images} of {total_images})…")
            } else {
                format!("Preparing images ({cached_count} of {total_images})…")
            },
            PdfProgressValue::determinate(cached_count, total_images, "items"),
        );
    }
    let pending_order = pending_images
        .iter()
        .map(|(key, _, _, fingerprint, _)| (key.clone(), fingerprint.clone()))
        .collect::<Vec<_>>();
    let results = Mutex::new(HashMap::<String, Result<ResolvedPdfImage, String>>::new());
    let completed = std::sync::atomic::AtomicU64::new(cached_count);
    run_pdf_image_pipeline(
        pending_images,
        cancelled,
        |(key, image, caption, _, source_bytes)| {
            let resolved = match source_bytes {
                Some(bytes) => Ok(ResolvedPdfImage::Bytes(bytes)),
                None => resolve_pdf_image(&image, &caption),
            };
            (key, resolved)
        },
        |(key, resolved)| {
            let result = resolved.map(|resolved| match resolved {
                ResolvedPdfImage::Bytes(bytes) => {
                    ResolvedPdfImage::Bytes(optimize_pdf_image_bytes(bytes))
                }
                placeholder => placeholder,
            });
            if let Ok(mut results) = results.lock() {
                results.insert(key, result);
            } else {
                return;
            }
            let current = completed.fetch_add(1, Ordering::AcqRel) + 1;
            if let Some(app) = app {
                emit_progress(
                    app,
                    job_id,
                    "running",
                    "preparing-images",
                    &format!("Preparing images ({current} of {total_images})…"),
                    PdfProgressValue::determinate(current, total_images, "items"),
                );
            }
        },
    );
    check_cancelled(cancelled)?;

    let mut results = results
        .lock()
        .map_err(|_| "The PDF image worker results are unavailable.".to_string())?;
    let mut prepared_images = HashMap::new();
    for (index, (key, fingerprint)) in pending_order.into_iter().enumerate() {
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
                let aspect = typst_image_aspect(&bytes);
                let bytes = Arc::new(bytes);
                fs::write(workspace.join(&relative), bytes.as_slice()).map_err(|error| {
                    format!("Could not prepare an image for PDF export: {error}")
                })?;
                if let Ok(mut cache) = image_cache.lock() {
                    cache.insert(
                        cache_session,
                        key.clone(),
                        CachedPreparedPdfImage {
                            fingerprint,
                            bytes,
                            aspect,
                        },
                    );
                }
                prepared_images.insert(
                    key,
                    PreparedTypstImage::File {
                        path: relative,
                        aspect,
                    },
                );
            }
            ResolvedPdfImage::Placeholder(message) => {
                prepared_images.insert(key, PreparedTypstImage::Placeholder(message));
            }
        }
    }
    let cached_offset = prepared_images.len();
    for (index, (key, cached)) in cached_images.into_iter().enumerate() {
        let extension = typst_image_extension(cached.bytes.as_slice()).ok_or_else(|| {
            "A cached image uses a format that Typst cannot include in the PDF.".to_string()
        })?;
        let relative = format!("images/image-{}.{extension}", cached_offset + index);
        fs::write(workspace.join(&relative), cached.bytes.as_slice())
            .map_err(|error| format!("Could not reuse a prepared PDF image: {error}"))?;
        prepared_images.insert(
            key,
            PreparedTypstImage::File {
                path: relative,
                aspect: cached.aspect,
            },
        );
    }
    Ok(prepared_images)
}

/// Downloads can run ahead of the CPU workers, but the bounded handoff keeps
/// downloaded originals from accumulating for the entire document. Progress is
/// reported by `process` only after the image is fully prepared.
fn run_pdf_image_pipeline<T: Send, R: Send>(
    pending: Vec<T>,
    cancelled: &AtomicBool,
    resolve: impl Fn(T) -> R + Sync,
    process: impl Fn(R) + Sync,
) {
    if pending.is_empty() || cancelled.load(Ordering::Acquire) {
        return;
    }
    let download_workers = pending.len().min(PDF_IMAGE_DOWNLOAD_WORKERS);
    let processing_workers = pending.len().min(PDF_IMAGE_PROCESSING_WORKERS);
    let queue = Mutex::new(VecDeque::from(pending));
    std::thread::scope(|scope| {
        let (sender, receiver) = std::sync::mpsc::sync_channel(PDF_IMAGE_DOWNLOAD_BUFFER);
        let receiver = Arc::new(Mutex::new(receiver));
        for _ in 0..processing_workers {
            let receiver = receiver.clone();
            let process = &process;
            scope.spawn(move || {
                while !cancelled.load(Ordering::Acquire) {
                    let next = receiver
                        .lock()
                        .ok()
                        .and_then(|receiver| receiver.recv().ok());
                    let Some(next) = next else { return };
                    if cancelled.load(Ordering::Acquire) {
                        return;
                    }
                    process(next);
                }
            });
        }
        // Only workers retain the receiver. On cancellation their exit disconnects
        // the channel, releasing downloaders blocked on a full queue.
        drop(receiver);
        for _ in 0..download_workers {
            let sender = sender.clone();
            let queue = &queue;
            let resolve = &resolve;
            scope.spawn(move || {
                while !cancelled.load(Ordering::Acquire) {
                    let next = queue.lock().ok().and_then(|mut queue| queue.pop_front());
                    let Some(next) = next else { return };
                    let resolved = resolve(next);
                    if cancelled.load(Ordering::Acquire) || sender.send(resolved).is_err() {
                        return;
                    }
                }
            });
        }
        // Receivers finish when all download workers have sent their last image.
        drop(sender);
    });
}

fn pdf_image_fingerprint(image: &ExportImage) -> Result<(String, Option<Vec<u8>>), String> {
    let mut digest = Sha256::new();
    digest.update(PDF_IMAGE_PREPARATION_REVISION.as_bytes());
    digest.update([0]);
    match image {
        ExportImage::Url(url) => {
            // A changed URL is a changed image input. Keeping the successful bytes
            // avoids another network request on repeated exports of this target.
            digest.update(b"url\0");
            digest.update(url.as_bytes());
            Ok((format!("{:x}", digest.finalize()), None))
        }
        ExportImage::Upload { absolute_path, .. } => {
            let bytes = fs::read(absolute_path).map_err(|_| {
                "An uploaded image is missing from the local project. Sync the project and try again."
                    .to_string()
            })?;
            digest.update(b"upload\0");
            digest.update(&bytes);
            Ok((format!("{:x}", digest.finalize()), Some(bytes)))
        }
    }
}

/// Print-resolution pixel caps: 300 DPI over the letter text area
/// (8.5in − 2×0.85in margins wide, 11in − 2×0.8in margins tall). Images larger
/// than the page can use are downscaled to fit these bounds before Typst sees
/// them; smaller images are never upscaled.
const PDF_IMAGE_MAX_WIDTH: u32 = 2040;
const PDF_IMAGE_MAX_HEIGHT: u32 = 2820;
const PDF_IMAGE_JPEG_QUALITY: u8 = 95;

/// Recompresses raster images to keep the PDF small. PDF has no WebP support,
/// so Typst decodes WebP to raw pixels and embeds them losslessly deflated —
/// a few lossy WebPs balloon a chapter to tens of megabytes. JPEG is the one
/// format Typst passes through in its original compressed form, so WebP is
/// flattened onto a white background (alpha discarded by design — book pages
/// are white) and re-encoded as JPEG. PNG keeps its format so line art stays
/// crisp, and JPEG keeps its bytes untouched; both are only downscaled when
/// they exceed print resolution. Any decode or encode failure returns the
/// original bytes — worst case is a large PDF, never a failed export.
fn optimize_pdf_image_bytes(bytes: Vec<u8>) -> Vec<u8> {
    use image::imageops::FilterType;

    let oversized =
        |width: u32, height: u32| width > PDF_IMAGE_MAX_WIDTH || height > PDF_IMAGE_MAX_HEIGHT;
    let encode_jpeg = |image: &image::RgbImage| -> Option<Vec<u8>> {
        let mut out = Vec::new();
        image
            .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
                std::io::Cursor::new(&mut out),
                PDF_IMAGE_JPEG_QUALITY,
            ))
            .ok()?;
        Some(out)
    };
    let flatten_onto_white = |decoded: image::DynamicImage| -> image::RgbImage {
        let rgba = decoded.into_rgba8();
        let mut flat = image::RgbImage::new(rgba.width(), rgba.height());
        for (source, target) in rgba.pixels().zip(flat.pixels_mut()) {
            let alpha = u32::from(source[3]);
            for channel in 0..3 {
                target[channel] =
                    ((u32::from(source[channel]) * alpha + 255 * (255 - alpha)) / 255) as u8;
            }
        }
        flat
    };

    match typst_image_extension(&bytes) {
        Some("webp") => {
            let Ok(mut decoded) = image::load_from_memory(&bytes) else {
                return bytes;
            };
            if oversized(decoded.width(), decoded.height()) {
                decoded = decoded.resize(
                    PDF_IMAGE_MAX_WIDTH,
                    PDF_IMAGE_MAX_HEIGHT,
                    FilterType::Lanczos3,
                );
            }
            encode_jpeg(&flatten_onto_white(decoded)).unwrap_or(bytes)
        }
        Some("png") => {
            let Ok(decoded) = image::load_from_memory(&bytes) else {
                return bytes;
            };
            if !oversized(decoded.width(), decoded.height()) {
                return bytes;
            }
            let resized = decoded.resize(
                PDF_IMAGE_MAX_WIDTH,
                PDF_IMAGE_MAX_HEIGHT,
                FilterType::Lanczos3,
            );
            let mut out = Vec::new();
            match resized.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png) {
                Ok(()) => out,
                Err(_) => bytes,
            }
        }
        Some("jpg") => {
            let Some((width, height)) = jpeg_dimensions(&bytes) else {
                return bytes;
            };
            if !oversized(width, height) {
                return bytes;
            }
            // Re-encoding drops EXIF metadata, including the orientation tag —
            // a camera photo stored rotated would come out sideways. Those pass
            // through at full size instead.
            let head = &bytes[..bytes.len().min(65536)];
            if head.windows(6).any(|window| window == b"Exif\x00\x00") {
                return bytes;
            }
            let Ok(decoded) = image::load_from_memory(&bytes) else {
                return bytes;
            };
            let resized = decoded.resize(
                PDF_IMAGE_MAX_WIDTH,
                PDF_IMAGE_MAX_HEIGHT,
                FilterType::Lanczos3,
            );
            encode_jpeg(&resized.into_rgb8()).unwrap_or(bytes)
        }
        _ => bytes,
    }
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

/// The calligraphic flourish rendered under every chapter title. A single-path
/// vector (evenodd fill) so Typst embeds it as scalable line art, not a raster.
const CHAPTER_FLOURISH_SVG: &str = include_str!("chapter_flourish.svg");

/// The `droplet` Typst package (MIT), vendored so the drop-cap import resolves
/// from the workspace's `--package-path` without touching the network. The
/// version here must match the `#import "@preview/droplet:…"` in the preamble.
const DROPLET_VERSION: &str = "0.3.1";

/// Great Vibes' advance widths exclude calligraphic swashes. Typst's `measure`
/// reports those advances, so `droplet` otherwise lets painted ink collide with
/// every line beside the cap. These values are the base capitals' furthest
/// right-side ink overhangs at the three-line size, measured from the pinned
/// GreatVibes-Regular.ttf. Vietnamese letters use their bare Latin capital for
/// sizing. Most also use it for horizontal clearance, but the right-side horns
/// on the Ơ and Ư families receive separate clearance metrics. The original
/// glyph is rendered afterward at the base capital's fixed size and position.
const DROP_CAP_METRICS_RULE: &str = r#"#let gnosis-dropcap-base(letter) = (
  "À": "A", "Á": "A", "Ả": "A", "Ã": "A", "Ạ": "A",
  "Ă": "A", "Ằ": "A", "Ắ": "A", "Ẳ": "A", "Ẵ": "A", "Ặ": "A",
  "Â": "A", "Ầ": "A", "Ấ": "A", "Ẩ": "A", "Ẫ": "A", "Ậ": "A",
  "Đ": "D",
  "È": "E", "É": "E", "Ẻ": "E", "Ẽ": "E", "Ẹ": "E",
  "Ê": "E", "Ề": "E", "Ế": "E", "Ể": "E", "Ễ": "E", "Ệ": "E",
  "Ì": "I", "Í": "I", "Ỉ": "I", "Ĩ": "I", "Ị": "I",
  "Ò": "O", "Ó": "O", "Ỏ": "O", "Õ": "O", "Ọ": "O",
  "Ô": "O", "Ồ": "O", "Ố": "O", "Ổ": "O", "Ỗ": "O", "Ộ": "O",
  "Ơ": "O", "Ờ": "O", "Ớ": "O", "Ở": "O", "Ỡ": "O", "Ợ": "O",
  "Ù": "U", "Ú": "U", "Ủ": "U", "Ũ": "U", "Ụ": "U",
  "Ư": "U", "Ừ": "U", "Ứ": "U", "Ử": "U", "Ữ": "U", "Ự": "U",
  "Ỳ": "Y", "Ý": "Y", "Ỷ": "Y", "Ỹ": "Y", "Ỵ": "Y",
).at(letter, default: letter)
#let gnosis-dropcap-clearance-base(letter) = (
  "Ơ": "Ơ", "Ờ": "Ơ", "Ớ": "Ơ", "Ở": "Ơ", "Ỡ": "Ơ", "Ợ": "Ơ",
  "Ư": "Ư", "Ừ": "Ư", "Ứ": "Ư", "Ử": "Ư", "Ữ": "Ư", "Ự": "Ư",
).at(letter, default: gnosis-dropcap-base(letter))
#let gnosis-dropcap-optical-gap(letter) = if gnosis-dropcap-clearance-base(letter) == "Ư" {
  0.18em
} else {
  0.35em
}
#let gnosis-dropcap-gap(letter) = gnosis-dropcap-optical-gap(letter) + (
  "A": 0.53em, "B": 0.17em, "C": 0.47em, "D": 0.04em,
  "E": 0.16em, "F": 1.30em, "G": 0.24em, "H": 0.46em,
  "I": 0.84em, "J": 0.77em, "K": 1.36em, "L": 0.57em,
  "M": 0.41em, "N": 0.48em, "O": 0.65em, "P": 0.64em,
  "Q": 0.23em, "R": 0.32em, "S": 0.22em, "T": 1.74em,
  "U": 0.20em, "V": 0.24em, "W": 0.12em, "X": 0.95em,
  "Y": 0.40em, "Z": 1.23em,
  "Ơ": 0.65em, "Ư": 0.64em,
).at(gnosis-dropcap-clearance-base(letter), default: 0pt)
// How many lines the cap drops: the paragraph's own line count, up to three.
// Counted at the full width: beside the cap the lines are narrower, so the text
// can only run on below the cap, never stop short of its foot and leave a gap.
#let gnosis-dropcap-lines(body, width) = {
  let height(content) = measure(block(width: width, content)).height
  let slack = (0.5em).to-absolute()
  if height(body) <= height([X]) + slack { 1 } else if height(body) <= height([X\ X]) + slack { 2 } else { 3 }
}
"#;
const DROPLET_PACKAGE_FILES: &[(&str, &str)] = &[
    ("typst.toml", include_str!("droplet/typst.toml")),
    ("LICENSE", include_str!("droplet/LICENSE")),
    ("src/lib.typ", include_str!("droplet/src/lib.typ")),
    ("src/droplet.typ", include_str!("droplet/src/droplet.typ")),
    ("src/extract.typ", include_str!("droplet/src/extract.typ")),
    ("src/split.typ", include_str!("droplet/src/split.typ")),
    ("src/util.typ", include_str!("droplet/src/util.typ")),
];

/// Writes the vendored droplet package into the workspace's local package root.
/// Written for every export — the path is cheap, and the compile command always
/// passes `--package-path`, so the layout must exist regardless of language.
fn write_droplet_package(workspace: &Path) -> Result<(), String> {
    let root = workspace
        .join("packages")
        .join("preview")
        .join("droplet")
        .join(DROPLET_VERSION);
    fs::create_dir_all(root.join("src"))
        .map_err(|error| format!("Could not prepare the PDF drop-cap package: {error}"))?;
    for (name, contents) in DROPLET_PACKAGE_FILES {
        fs::write(root.join(name), contents)
            .map_err(|error| format!("Could not prepare the PDF drop-cap package: {error}"))?;
    }
    Ok(())
}

/// Latin-script exports get the Kindred-style extras — Alegreya titles and
/// headings, a Great Vibes drop cap. The same prefixes the font selection uses.
fn latin_body(language_code: &str) -> bool {
    let code = language_code.to_ascii_lowercase().replace('_', "-");
    !(code.starts_with("ja")
        || code.starts_with("ko")
        || code.starts_with("zh")
        || code.starts_with("ar")
        || code.starts_with("fa"))
}

fn heading_font_families(document: &ExportDocument) -> Vec<&'static str> {
    if latin_body(&document.language_code) {
        vec!["Alegreya", "EB Garamond", "Cormorant Garamond Gnosis"]
    } else {
        let code = document
            .language_code
            .to_ascii_lowercase()
            .replace('_', "-");
        let family = if code.starts_with("ja") {
            "Shippori Mincho"
        } else if code.starts_with("ko") {
            "Noto Serif KR"
        } else if code.starts_with("zh-hant")
            || code.starts_with("zh-tw")
            || code.starts_with("zh-hk")
        {
            "Noto Serif TC"
        } else if code.starts_with("zh") {
            "Noto Serif SC"
        } else {
            "Noto Naskh Arabic"
        };
        vec![family, "EB Garamond"]
    }
}

fn body_font_style(document: &ExportDocument) -> (Vec<&'static str>, &'static str, f64, f64) {
    let code = document
        .language_code
        .to_ascii_lowercase()
        .replace('_', "-");
    if code.starts_with("ja") {
        (vec!["Shippori Mincho", "EB Garamond"], "ltr", 11.0, 0.65)
    } else if code.starts_with("ko") {
        (vec!["Noto Serif KR", "EB Garamond"], "ltr", 11.0, 0.65)
    } else if code.starts_with("zh-hant") || code.starts_with("zh-tw") || code.starts_with("zh-hk")
    {
        (vec!["Noto Serif TC", "EB Garamond"], "ltr", 11.0, 0.65)
    } else if code.starts_with("zh") {
        (vec!["Noto Serif SC", "EB Garamond"], "ltr", 11.0, 0.65)
    } else if code.starts_with("ar") || code.starts_with("fa") {
        (vec!["Noto Naskh Arabic", "EB Garamond"], "rtl", 11.0, 0.65)
    } else {
        // Crimson Pro is the body and heading typeface. It covers Vietnamese
        // natively; EB Garamond trails for Greek and the odd IAST diacritic
        // (ṝ), and the patched Cormorant build stays as a last-resort
        // glyph-coverage fallback — never for appearance.
        (
            vec!["Crimson Pro", "EB Garamond", "Cormorant Garamond Gnosis"],
            "ltr",
            11.5,
            0.78,
        )
    }
}

fn typst_preamble(document: &ExportDocument, paper_size: &str) -> String {
    let (families, direction, size_pt, leading_em) = body_font_style(document);
    let family_list = families
        .iter()
        .map(|family| typst_string(family))
        .collect::<Vec<_>>()
        .join(", ");
    let latin = latin_body(&document.language_code);
    // Crimson Pro carries five stray Greek glyphs (Δ Σ Ω μ π), so per-glyph fallback
    // would split a Greek word across typefaces mid-run. Force whole Greek runs to
    // EB Garamond wherever Crimson Pro leads the body.
    let greek_rule = if latin {
        format!("{GREEK_RUN_RULE_PREFIX}{})\n", typst_string("EB Garamond"))
    } else {
        String::new()
    };
    // Kindred style: Alegreya leads titles and body headings on Latin-script
    // exports, with the body's own fallbacks behind it. Body headings are set
    // in capitals so an H2, only half a point above the body size, still reads
    // as a heading. The space below a heading is the body's own leading, so it
    // sits one ordinary line above its text instead of crowding it; `em` here
    // would follow the larger heading size. Other scripts keep their body
    // families for headings.
    let heading_families = heading_font_families(document);
    let heading_family_list = heading_families
        .iter()
        .map(|family| typst_string(family))
        .collect::<Vec<_>>()
        .join(", ");
    let heading_rule = if latin {
        format!("#show heading: set text(font: ({heading_family_list}), weight: \"regular\")\n#show heading: upper\n#show heading.where(level: 1): set text(size: 14.5pt)\n#show heading.where(level: 2): set text(size: 12pt)\n#show heading: set block(above: 1.3em, below: {size_pt}pt * {leading_em})\n")
    } else {
        String::new()
    };
    // Kindred style: the opening letter of a chapter drops across up to three
    // lines in Great Vibes — as many as the paragraph has (see
    // `gnosis-dropcap-lines`), and none for a one-line paragraph. A smaller cap
    // scales its gap with it: the per-letter gaps are tuned for three lines. The
    // body families trail the letter's font list so a glyph Great Vibes lacks
    // falls back to the body serif instead of tofu. The droplet package resolves
    // from the vendored copy in the workspace.
    let dropcap_rule = if latin {
        let letter_families = std::iter::once("Great Vibes")
            .chain(families.iter().copied())
            .map(typst_string)
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            r#"#import "@preview/droplet:{DROPLET_VERSION}": dropcap
{DROP_CAP_METRICS_RULE}#let gnosis-dropcap(body) = layout(region => {{
  let lines = gnosis-dropcap-lines(body, region.width)
  if lines == 1 {{ return body }}
  let scale = measure([x\ ] * lines).height / measure([x\ ] * 3).height
  dropcap(height: lines, gap: letter => gnosis-dropcap-gap(letter) * scale, sizing-transform: gnosis-dropcap-base, top-edge: "cap-height", bottom-edge: "descender", font: ({letter_families}), body)
}})
"#
        )
    } else {
        String::new()
    };
    // The chapter title is emitted as plain styled text, not a Typst heading. The
    // title is a top float: Typst assigns float slots in source order and has no
    // other way to keep a later `placement: auto` image from being hoisted above
    // content that precedes it on the page. As the first float, the title always
    // holds the top of page one and image floats stack below it. The full-width
    // block keeps the centring that `place` would otherwise collapse. A small
    // calligraphic flourish (written into the workspace by
    // `prepare_typst_workspace`) sits under the title text, spaced as in the
    // Vellum Kindred reference: one line's distance below the title (the weak
    // spacer replaces the default paragraph spacing instead of adding to it),
    // then a wider clearance before the body begins. Kindred style: the title
    // renders in the heading family, all caps with a little letterspacing. Over
    // an image cover (`tight: true`) the title sits higher and closer to the
    // image, 2em above and 2.5em below instead of 5.5em and 6em, so the image
    // keeps more of the page.
    let title_rule = format!(
        "#let gnosis-title(t, number: none, tight: false) = place(top, float: true, clearance: if tight {{ 2.5em }} else {{ 6em }}, block(width: 100%, align(center)[#v(if tight {{ 2em }} else {{ 5.5em }}, weak: false)#if number != none {{ text(font: ({heading_family_list}), size: 12pt, str(number)); v(0.75em) }}#text(font: ({heading_family_list}), size: 16pt, weight: \"regular\", tracking: 0.1em)[#upper(t)]#v(1.2em, weak: false)#image(\"flourish.svg\", width: 0.75in)]))\n"
    );
    let margins = if paper_size == "a5" {
        "(inside: 22mm, outside: 19mm, top: 20mm, bottom: 20mm)"
    } else {
        "(x: 0.85in, y: 0.8in)"
    };
    let word_spacing = if latin {
        "#set text(spacing: 110%)\n"
    } else {
        ""
    };
    format!(
        "#set page(paper: \"{paper_size}\", margin: {margins}, numbering: \"1\")\n#set text(font: ({family_list}), size: {size_pt}pt, lang: {}, dir: {direction})\n{word_spacing}#set par(justify: true, leading: {leading_em}em, spacing: {leading_em}em)\n{GNOSIS_FOOTNOTE_RULE}{greek_rule}{heading_rule}{dropcap_rule}{title_rule}#show link: set text(fill: rgb(\"245c8a\"))\n{GNOSIS_IMAGE_RULE}{GNOSIS_QUOTE_RULE}\n",
        typst_string(&document.language_code)
    )
}

/// Greek and polytonic Greek blocks, held to one family so a word is never split
/// across typefaces. Completed with the family name and a closing parenthesis.
const GREEK_RUN_RULE_PREFIX: &str =
    "#show regex(\"[\\u{0370}-\\u{03FF}\\u{1F00}-\\u{1FFF}]+\"): set text(font: ";

/// Knuth-style footnotes: a normal baseline number sits in a fixed, right-aligned
/// gutter while wrapped lines share one stable left edge and later paragraphs
/// indent their first lines. Typst's native
/// footnote callout remains untouched, so references in the body stay superscripted.
/// The marker is rebuilt as a link to preserve navigation in exported PDFs.
///
/// Like Knuth's manmac.tex, which opens every footnote with a `\smallskip` (3pt on
/// 9pt baselines), consecutive notes are a third of a line further apart than the
/// lines inside a note, so a note's indented second paragraph is not mistaken for
/// the next note. The gap is measured like leading, from one note's last baseline
/// to the next note's cap height, and its em is the body text's, not the 0.85em
/// footnote text's: 0.73em is the footnotes' 0.5em leading (0.425em of body text)
/// plus about a third of a Crimson Pro footnote line.
///
/// Widow prevention is off inside entries, so a footnote may run over with a single
/// line rather than be kept whole. A three-line footnote has no split that keeps two
/// lines on each page, so Typst moved its referencing line to the next page instead,
/// leaving a gap above the footnotes and a widow in the body text. Orphan prevention
/// stays: a footnote never starts with a lone line at the foot of a page.
const GNOSIS_FOOTNOTE_RULE: &str = r#"#set footnote.entry(indent: 0em, gap: 0.73em)
#show footnote.entry: it => {
  let marker-width = 12pt
  let marker-gap = 3pt
  let nums = counter(footnote).at(it.note.location())
  let number = numbering(it.note.numbering, ..nums)
  let marker = link(it.note.location(), number + [.])
  grid(
    columns: (marker-width, 1fr),
    column-gutter: marker-gap,
    align: (end + top, start + top),
    marker,
    context block[
      #set text(costs: (widow: 0%))
      #set par(first-line-indent: (amount: 1.5em, all: false), spacing: par.leading)
      #it.note.body
    ],
  )
}
"#;

/// Scales an image to the full text width, but never taller than the space its own
/// caption leaves on the page. The caption content is passed in purely so it can be
/// measured: the cap is the region height minus the measured caption height, the
/// figure's body-to-caption gap (Typst's 0.65em default), and 1.5em of float
/// clearance headroom. A fixed fraction cannot do this — it overflows when a caption
/// runs long (Typst then prints the caption over the page number rather than
/// shrinking the figure) and wastes the reserve when the caption is short or absent.
/// The cap is a maximum, not a fixed height — a plain `height:` would reserve the
/// space for small images too, stranding them on pages of their own. A tall image
/// hits the cap before its width reaches the margins, so it is centred at the capped
/// height.
///
/// The measurement uses absolute lengths taken from `layout`: `measure` has no
/// container to resolve a relative width against, so `width: 100%` there reports the
/// wrong height and the cap never applies.
const GNOSIS_IMAGE_RULE: &str = "#let gnosis-image(path, caption: none) = layout(region => {\n  let width = region.width\n  let reserved = if caption == none { 0pt } else {\n    measure(block(width: width, caption)).height + (0.85em).to-absolute()\n  }\n  let limit = region.height - reserved - (1.5em).to-absolute()\n  let natural = measure(image(path, width: width))\n  if natural.height > limit { align(center, image(path, height: limit)) } else { image(path, width: width) }\n})\n";

/// Quotations and their citations.
///
/// `gnosis-citation` is a citation set as the last line of the paragraph it cites
/// (see `render_typst_cited_text_block`), drawn where a separate citation block
/// would be: a paragraph space and a quarter em below the text instead of one
/// line's leading (the box's top inset adds the difference; the quarter em keeps
/// the citation from reading as one more line of the text) and flush with the
/// right edge of the text it cites. In a quote that edge is inside the quote's 1em
/// padding, not at the right margin: on a chapter cover, with no body text to show
/// the margin, a citation out there seemed to hang past the quote. Inside a quote
/// the text is 0.9em, so `scale` keeps its lengths in body-text units.
///
/// `gnosis-quote` keeps a quotation of up to six lines on one page and lets a longer
/// one split like any paragraph. Typst has no keep-together-if-short setting, so the
/// quote is measured against six lines of the same quote, with half an em of slack
/// for lines a footnote marker makes a little taller. Its own 1.5em above and below
/// replace Typst's built-in 2.4em and 1.8em, which are dropped at the wrapper's
/// edges.
///
/// On a chapter cover (`cover: true`) a quote that fits on one line is centred
/// rather than left alone at the start of an empty page: the quote shrinks to its
/// text in a centred box, and its citation is stacked under it, one quote line and
/// a quarter em below it and padded like the quote, so it ends with the quote text
/// as on a full-width quote. A citation line inside the paragraph cannot do this,
/// because its `h(1fr)` would stretch the box back to the full width. The centring
/// block is given the full width explicitly: the wrapping block otherwise shrinks
/// to the box, leaving `align` nothing to centre in.
const GNOSIS_QUOTE_RULE: &str = r#"#let gnosis-citation(body, scale: 1) = [#linebreak(justify: false)#h(1fr)#context box(inset: (top: (par.spacing + 0.25em) / scale - par.leading))[#text(size: 0.8em / scale, style: "normal", tracking: 0.06em)[#upper(body)]]]
#let gnosis-quote-body(body, citation) = quote(block: true)[#set par(first-line-indent: 0pt)
#text(size: 0.9em, style: "normal")[#body#if citation != none { gnosis-citation(citation, scale: 0.9) }]]
#let gnosis-quote(body, citation: none, cover: false) = block(above: 1.5em, below: 1.5em, layout(region => {
  let height(content) = measure(block(width: region.width, content)).height
  let slack = (0.5em).to-absolute()
  if cover and height(gnosis-quote-body(body, none)) <= height(gnosis-quote-body([X], none)) + slack {
    let cited = if citation == none { () } else { (align(right, pad(x: 1em, text(size: 0.8em, style: "normal", tracking: 0.06em)[#upper(citation)])),) }
    return block(width: region.width, align(center, box(stack(spacing: 0.9 * par.leading + 0.25em, gnosis-quote-body(body, none), ..cited))))
  }
  let quoted = gnosis-quote-body(body, citation)
  let sample = gnosis-quote-body(range(6).map(_ => [X]).join(linebreak()), citation)
  block(breakable: height(quoted) > height(sample) + slack, quoted)
}))
"#;

fn render_inline_typst(text: &str, show_link_urls: bool) -> String {
    let normalized = text.nfc().collect::<String>();
    inline_segments(&normalized)
        .into_iter()
        .map(|segment| render_styled_typst_text(&segment.text, &segment.style, show_link_urls))
        .collect::<Vec<_>>()
        .join("")
}

fn render_footnote_typst(text: &str, show_link_urls: bool) -> String {
    footnote_paragraphs(text)
        .iter()
        .map(|paragraph| {
            if inline_visible_text(paragraph).is_empty() {
                // An authored empty paragraph still occupies a line.
                "#text(\"\\u{a0}\")".to_string()
            } else {
                render_inline_typst(paragraph, show_link_urls)
            }
        })
        .collect::<Vec<_>>()
        .join("#parbreak()")
}

/// When the first block is an H1, that heading becomes the chapter title (the same
/// rule the WordPress and other exports follow). A heading that anchors a footnote is
/// not eligible — promoting it to the title would strip the block and orphan the note.
fn leading_heading_title(document: &ExportDocument) -> Option<String> {
    let ExportBlock::Text { text_style, text } = document.blocks.first()? else {
        return None;
    };
    if normalize_editor_text_style_value(Some(text_style)) != "heading1" {
        return None;
    }
    let anchors_footnote = document.blocks.iter().any(|block| {
        matches!(
            block,
            ExportBlock::Footnote {
                anchor_block: Some(0),
                ..
            }
        )
    });
    if anchors_footnote {
        return None;
    }
    let title = inline_visible_text(text).trim().to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn render_typst_image_caption(caption: &str) -> String {
    // Vellum's reference captions use approximately 75% of body size and
    // centered, non-justified lines.
    format!(
        "#align(center)[#set par(justify: false, first-line-indent: 0pt)\n#text(size: 0.75em)[{}]]",
        render_inline_typst(caption, false)
    )
}

/// With `floating`, `placement: auto` makes the figure a float: when the image does
/// not fit in the space left on the current page, the following text flows into that
/// space and the image moves to the top or bottom of a nearby page, instead of
/// leaving the rest of the page empty. The trade-off is that an image can land a
/// page away from the paragraph it followed in the editor. Trailing images at the
/// end of a chapter are emitted non-floating instead — see
/// `typst_block_emission_order`.
fn render_typst_figure(body: &str, caption: &str, floating: bool) -> String {
    let placement = if floating { ", placement: auto" } else { "" };
    format!(
        "#figure({body}, caption: [{}], gap: 0.85em, numbering: none{placement})",
        render_typst_image_caption(caption)
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
    render_inline_typst_parts_with_footnotes(&[text], footnotes, footnote_links_as_plain_text)
        .pop()
        .unwrap_or_default()
}

/// Renders the parts of one block (a paragraph, or the items of a list) that share
/// the block's footnotes. Each footnote is set at its marker in the first part that
/// has it.
fn render_inline_typst_parts_with_footnotes(
    texts: &[&str],
    footnotes: &[(usize, String)],
    footnote_links_as_plain_text: bool,
) -> Vec<String> {
    if footnotes.is_empty() {
        return texts
            .iter()
            .map(|text| render_inline_typst(text, false))
            .collect();
    }
    let notes = footnotes
        .iter()
        .map(|(marker, text)| (*marker, text.as_str()))
        .collect::<HashMap<_, _>>();
    let mut used = HashSet::new();
    let mut parts = Vec::new();
    // Adjacent markers separate with a superscript comma (the footmisc/AMA
    // convention), so [1][2] renders as ¹,² rather than ¹² (which reads as
    // note 12). Typst has no automatic separator yet — if a future Typst
    // release groups adjacent footnotes itself (typst/typst#7627), drop this.
    let mut last_emitted_footnote = false;
    for text in texts {
        let normalized = text.nfc().collect::<String>();
        let mut rendered = String::new();
        last_emitted_footnote = false;
        for segment in inline_segments(&normalized) {
            let mut cursor = 0usize;
            while let Some((start, end, marker)) =
                next_unescaped_footnote_marker(&segment.text, cursor, &notes, &used)
            {
                let leading =
                    render_styled_typst_text(&segment.text[cursor..start], &segment.style, false);
                if !leading.is_empty() {
                    last_emitted_footnote = false;
                }
                rendered.push_str(&leading);
                if let Some(note) = notes.get(&marker) {
                    if last_emitted_footnote {
                        rendered.push_str("#super[,]");
                    }
                    rendered.push_str(&format!(
                        "#footnote[{}]",
                        render_footnote_typst(note, footnote_links_as_plain_text)
                    ));
                    used.insert(marker);
                    last_emitted_footnote = true;
                }
                cursor = end;
            }
            let trailing = render_styled_typst_text(&segment.text[cursor..], &segment.style, false);
            if !trailing.is_empty() {
                last_emitted_footnote = false;
            }
            rendered.push_str(&trailing);
        }
        parts.push(rendered);
    }
    // Footnotes anchored to this block whose markers never appeared inline are
    // row-level footnotes: attach their references to the end of the block, matching
    // the editor preview's append-remaining rule. This keeps a footnote stuck to the
    // end of its own paragraph instead of floating onto the next one. An appended
    // reference is just another adjacent marker, so it takes the same superscript
    // comma when it directly follows one.
    let mut appended = footnotes
        .iter()
        .filter(|(marker, _)| !used.contains(marker))
        .collect::<Vec<_>>();
    appended.sort_by_key(|(marker, _)| *marker);
    if let Some(rendered) = parts.last_mut() {
        for (marker, note) in appended {
            if last_emitted_footnote {
                rendered.push_str("#super[,]");
            }
            rendered.push_str(&format!(
                "#footnote[{}]",
                render_footnote_typst(note, footnote_links_as_plain_text)
            ));
            used.insert(*marker);
            last_emitted_footnote = true;
        }
    }
    parts
}

/// A list row as one native Typst list, with `items_inline` holding each item's
/// rendered inline content. Each nested list sets its own level's marker or
/// numbering, and Typst restarts the count of every list.
fn render_typst_list(kind: ListKind, items: &[ListItem], items_inline: &[String]) -> String {
    let mut source = String::new();
    for event in list_events(kind, items) {
        match event {
            ListEvent::OpenList(format) => match typst_list_numbering(format) {
                Some(numbering) => {
                    source.push_str(&format!("#enum(numbering: {}, ", typst_string(numbering)))
                }
                None => source.push_str(&format!("#list(marker: {}, ", typst_list_marker(format))),
            },
            ListEvent::OpenItem(index) => {
                source.push('[');
                source.push_str(items_inline.get(index).map(String::as_str).unwrap_or(""));
            }
            ListEvent::CloseItem => source.push_str("], "),
            ListEvent::CloseList(_) => source.push(')'),
        }
    }
    source
}

/// Typst's own numbering patterns. Its letters continue past z as aa, ab, …
fn typst_list_numbering(format: ListLevelFormat) -> Option<&'static str> {
    match format {
        ListLevelFormat::Decimal => Some("1."),
        ListLevelFormat::LowerAlpha => Some("a."),
        ListLevelFormat::LowerRoman => Some("i."),
        ListLevelFormat::UpperAlpha => Some("A."),
        ListLevelFormat::UpperRoman => Some("I."),
        ListLevelFormat::Disc | ListLevelFormat::Circle | ListLevelFormat::Square => None,
    }
}

/// Bullets are drawn rather than set as text: the body fonts may have no ◦ or ▪,
/// and a fallback font's glyphs differ in size and weight. Each shape is centred
/// near the x-height, where a bullet glyph sits.
fn typst_list_marker(format: ListLevelFormat) -> &'static str {
    match format {
        ListLevelFormat::Circle => {
            "box(baseline: -0.12em, circle(radius: 0.11em, stroke: 0.05em + black))"
        }
        ListLevelFormat::Square => "box(baseline: -0.12em, square(size: 0.22em, fill: black))",
        _ => "box(baseline: -0.11em, circle(radius: 0.12em, fill: black))",
    }
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

/// Height-to-width ratio read from the image header. Used only to sort a
/// trailing image run shortest-rendering-first, so a rough value is fine and
/// `None` (unknown) is acceptable — the caller falls back to a neutral ratio.
fn typst_image_aspect(data: &[u8]) -> Option<f64> {
    fn ratio(width: u32, height: u32) -> Option<f64> {
        if width == 0 {
            None
        } else {
            Some(height as f64 / width as f64)
        }
    }
    if data.starts_with(b"\x89PNG\r\n\x1a\n") && data.len() >= 24 {
        let width = u32::from_be_bytes(data[16..20].try_into().ok()?);
        let height = u32::from_be_bytes(data[20..24].try_into().ok()?);
        return ratio(width, height);
    }
    if data.starts_with(b"\xff\xd8\xff") {
        let (width, height) = jpeg_dimensions(data)?;
        return ratio(width, height);
    }
    if (data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a")) && data.len() >= 10 {
        let width = u16::from_le_bytes([data[6], data[7]]) as u32;
        let height = u16::from_le_bytes([data[8], data[9]]) as u32;
        return ratio(width, height);
    }
    if data.len() >= 30 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        let (width, height) = webp_dimensions(data)?;
        return ratio(width, height);
    }
    let head = String::from_utf8_lossy(&data[..data.len().min(2048)]);
    if head.contains("<svg") {
        return svg_aspect(&head);
    }
    None
}

fn jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let mut index = 2usize;
    while index + 4 <= data.len() {
        if data[index] != 0xff {
            return None;
        }
        let marker = data[index + 1];
        // Standalone markers carry no length payload.
        if (0xd0..=0xd9).contains(&marker) || marker == 0x01 {
            index += 2;
            continue;
        }
        // Start-of-frame markers hold the dimensions (height first).
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if index + 9 > data.len() {
                return None;
            }
            let height = u16::from_be_bytes([data[index + 5], data[index + 6]]) as u32;
            let width = u16::from_be_bytes([data[index + 7], data[index + 8]]) as u32;
            return Some((width, height));
        }
        let length = u16::from_be_bytes([data[index + 2], data[index + 3]]) as usize;
        if length < 2 {
            return None;
        }
        index += 2 + length;
    }
    None
}

fn webp_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    match &data[12..16] {
        b"VP8X" if data.len() >= 30 => {
            let width = 1 + u32::from_le_bytes([data[24], data[25], data[26], 0]);
            let height = 1 + u32::from_le_bytes([data[27], data[28], data[29], 0]);
            Some((width, height))
        }
        b"VP8 " if data.len() >= 30 => {
            let width = (u16::from_le_bytes([data[26], data[27]]) & 0x3fff) as u32;
            let height = (u16::from_le_bytes([data[28], data[29]]) & 0x3fff) as u32;
            Some((width, height))
        }
        b"VP8L" if data.len() >= 25 && data[20] == 0x2f => {
            let bits = &data[21..25];
            let width = 1 + (((bits[1] as u32 & 0x3f) << 8) | bits[0] as u32);
            let height = 1
                + (((bits[3] as u32 & 0x0f) << 10)
                    | ((bits[2] as u32) << 2)
                    | (bits[1] as u32 >> 6));
            Some((width, height))
        }
        _ => None,
    }
}

fn svg_aspect(head: &str) -> Option<f64> {
    let tag_start = head.find("<svg")?;
    let tag_end = head[tag_start..].find('>')? + tag_start;
    // Normalise quote style so one attribute scan handles both.
    let tag = head[tag_start..tag_end].replace('\'', "\"");
    let attribute = |name: &str| -> Option<f64> {
        let at = tag.find(&format!("{name}=\""))? + name.len() + 2;
        let value = &tag[at..at + tag[at..].find('"')?];
        let numeric: String = value
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        numeric.parse::<f64>().ok()
    };
    if let (Some(width), Some(height)) = (attribute("width"), attribute("height")) {
        if width > 0.0 {
            return Some(height / width);
        }
    }
    let at = tag.find("viewBox=\"")? + 9;
    let value = &tag[at..at + tag[at..].find('"')?];
    let parts: Vec<f64> = value
        .split_whitespace()
        .filter_map(|part| part.parse::<f64>().ok())
        .collect();
    match parts.as_slice() {
        [_, _, width, height] if *width > 0.0 => Some(height / width),
        _ => None,
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
            font_review: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_font_control_only_appears_for_exported_coverage_gaps() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let mut document = ExportDocument {
            book_parts: Vec::new(),
            title: "Title".into(),
            language_code: "vi".into(),
            blocks: vec![ExportBlock::Text {
                text_style: "paragraph".into(),
                text: "Plain text".into(),
            }],
        };
        let bytes = fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/fonts/CormorantGaramondGnosis-Roman.ttf"),
        )
        .unwrap();
        for asset in required_fonts_for_document(&document) {
            fs::write(workspace.join(asset.file_name), &bytes).unwrap();
        }
        let approved: Vec<font_fallback::FontChoice> = serde_json::from_value(serde_json::json!([{
            "family": "Noto Sans EgyptHiero", "style": "normal", "weight": 400, "stretchPercent": 100.0
        }])).unwrap();
        assert!(
            relevant_saved_fonts(&document, &workspace, false, true, &approved)
                .unwrap()
                .is_empty()
        );
        document.blocks.push(ExportBlock::Text {
            text_style: "custom_html".into(),
            text: "<p>\u{13153}</p>".into(),
        });
        assert_eq!(
            relevant_saved_fonts(&document, &workspace, false, true, &approved)
                .unwrap()
                .len(),
            1
        );
        let omitted = apply_print_custom_html_policy(&document, true);
        assert!(
            relevant_saved_fonts(&omitted, &workspace, false, true, &approved)
                .unwrap()
                .is_empty()
        );
        assert!(
            relevant_saved_fonts(&document, &workspace, false, false, &approved)
                .unwrap()
                .is_empty()
        );
        assert!(
            relevant_saved_fonts(&document, &workspace, false, true, &[])
                .unwrap()
                .is_empty()
        );
        let mut document = omitted;
        document.blocks.push(ExportBlock::Footnote {
            number: 1,
            marker: 1,
            anchor_block: Some(0),
            text: "<a href=\"https://example.test/\u{13153}\">Reference</a>".into(),
        });
        assert!(
            relevant_saved_fonts(&document, &workspace, false, true, &approved)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            relevant_saved_fonts(&document, &workspace, true, true, &approved)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn font_approval_requires_the_current_review_and_job_cleanup_removes_it() {
        let job_id = Uuid::now_v7().to_string();
        let cancelled = Arc::new(AtomicBool::new(false));
        pdf_jobs()
            .lock()
            .unwrap()
            .insert(job_id.clone(), cancelled.clone());
        let approved = Arc::new(AtomicBool::new(false));
        pdf_font_reviews().lock().unwrap().insert(
            job_id.clone(),
            PendingFontReview {
                review_id: "current-review".into(),
                approved: approved.clone(),
                choices: Vec::new(),
            },
        );
        assert!(
            !approve_pending_font_review(&job_id, "stale-review", |_| panic!(
                "Stale approvals must not be saved"
            ))
            .unwrap()
        );
        assert!(!approved.load(Ordering::Acquire));
        assert!(
            approve_pending_font_review(
                &job_id,
                "current-review",
                |_| Err("Could not save".into())
            )
            .is_err()
        );
        assert!(
            !approved.load(Ordering::Acquire),
            "Saving must succeed before publication resumes"
        );
        assert!(approve_pending_font_review(&job_id, "current-review", |_| Ok(())).unwrap());
        assert!(approved.load(Ordering::Acquire));
        let registration = PdfJobRegistration {
            job_id: job_id.clone(),
            cancelled,
        };
        drop(registration);
        assert!(
            !approve_pending_font_review(&job_id, "current-review", |_| panic!(
                "Closed reviews must not save a preference"
            ))
            .unwrap()
        );
        assert!(!pdf_jobs().lock().unwrap().contains_key(&job_id));
    }

    fn exercise_pdf_image_pipeline(cancel_when_full: bool) {
        use std::sync::{atomic::AtomicUsize, mpsc, Condvar};

        let cancelled = AtomicBool::new(false);
        let download_gate = (Mutex::new(false), Condvar::new());
        let process_gate = (Mutex::new(false), Condvar::new());
        let active_downloads = AtomicUsize::new(0);
        let peak_downloads = AtomicUsize::new(0);
        let active_processing = AtomicUsize::new(0);
        let peak_processing = AtomicUsize::new(0);
        let processed = Mutex::new(Vec::new());
        let (events, received) = mpsc::channel();
        let wait_for_gate = |gate: &(Mutex<bool>, Condvar)| {
            let mut open = gate.0.lock().unwrap();
            while !*open {
                open = gate.1.wait(open).unwrap();
            }
        };
        let open_gate = |gate: &(Mutex<bool>, Condvar)| {
            *gate.0.lock().unwrap() = true;
            gate.1.notify_all();
        };
        let total = 64;
        let observation = std::thread::scope(|scope| {
            let pipeline = scope.spawn(|| {
                run_pdf_image_pipeline(
                    (0..total).collect(),
                    &cancelled,
                    |item| {
                        let active = active_downloads.fetch_add(1, Ordering::AcqRel) + 1;
                        peak_downloads.fetch_max(active, Ordering::AcqRel);
                        events.send(true).unwrap();
                        wait_for_gate(&download_gate);
                        active_downloads.fetch_sub(1, Ordering::AcqRel);
                        item
                    },
                    |item| {
                        let active = active_processing.fetch_add(1, Ordering::AcqRel) + 1;
                        peak_processing.fetch_max(active, Ordering::AcqRel);
                        events.send(false).unwrap();
                        wait_for_gate(&process_gate);
                        processed.lock().unwrap().push(item);
                        active_processing.fetch_sub(1, Ordering::AcqRel);
                    },
                );
            });
            let observation = (|| -> Result<(), String> {
                // All twelve downloads must be able to start before any completes.
                for _ in 0..PDF_IMAGE_DOWNLOAD_WORKERS {
                    if !received
                        .recv_timeout(Duration::from_secs(5))
                        .map_err(|e| e.to_string())?
                    {
                        return Err("Processing started before a download finished".into());
                    }
                }
                open_gate(&download_gate);
                let mut downloads = PDF_IMAGE_DOWNLOAD_WORKERS;
                let mut processing = 0;
                // Hold CPU workers busy until both the handoff queue and the
                // download workers are full. This also exercises blocked senders.
                let capacity = PDF_IMAGE_DOWNLOAD_WORKERS
                    + PDF_IMAGE_DOWNLOAD_BUFFER
                    + PDF_IMAGE_PROCESSING_WORKERS;
                while downloads < capacity || processing < PDF_IMAGE_PROCESSING_WORKERS {
                    if received
                        .recv_timeout(Duration::from_secs(5))
                        .map_err(|e| e.to_string())?
                    {
                        downloads += 1;
                    } else {
                        processing += 1;
                    }
                }
                match received.recv_timeout(Duration::from_millis(100)) {
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    _ => return Err("Downloads exceeded the bounded pipeline capacity".into()),
                }
                if cancel_when_full {
                    cancelled.store(true, Ordering::Release);
                }
                Ok(())
            })();
            // Release workers even on an observation timeout, so failures do not
            // leave the scoped threads waiting on the test gates.
            open_gate(&download_gate);
            open_gate(&process_gate);
            pipeline.join().unwrap();
            observation
        });
        observation.unwrap();
        assert_eq!(
            peak_downloads.load(Ordering::Acquire),
            PDF_IMAGE_DOWNLOAD_WORKERS
        );
        assert_eq!(
            peak_processing.load(Ordering::Acquire),
            PDF_IMAGE_PROCESSING_WORKERS
        );
        let mut processed = processed.into_inner().unwrap();
        if cancel_when_full {
            assert_eq!(processed.len(), PDF_IMAGE_PROCESSING_WORKERS);
        } else {
            processed.sort_unstable();
            assert_eq!(processed, (0..total).collect::<Vec<_>>());
        }
    }

    #[test]
    fn pdf_image_pipeline_overlaps_twelve_downloads_with_four_processors() {
        exercise_pdf_image_pipeline(false);
    }

    #[test]
    fn pdf_image_pipeline_cancels_with_downloaders_blocked_on_full_queue() {
        exercise_pdf_image_pipeline(true);
    }

    #[test]
    fn pdf_image_pipeline_skips_empty_and_cancelled_work() {
        for pending in [Vec::<usize>::new(), vec![1, 2, 3]] {
            run_pdf_image_pipeline(
                pending,
                &AtomicBool::new(true),
                |_| panic!("Cancelled or empty work must not download"),
                |_: ()| panic!("Cancelled or empty work must not process"),
            );
        }
    }

    fn test_image_cache_scope(chapter_id: &str) -> PdfImageCacheScope {
        PdfImageCacheScope {
            installation_id: 7,
            repo_name: "book".to_string(),
            project_id: Some("project-1".to_string()),
            project_full_name: Some("team/book".to_string()),
            target: PdfImageCacheTarget::Chapter(chapter_id.to_string()),
        }
    }

    #[test]
    fn pdf_image_cache_scope_tracks_book_identity_instead_of_its_anchor_or_layout() {
        let mut input: PdfChapterExportInput = serde_json::from_value(serde_json::json!({
            "installationId": 7, "repoName": "book", "projectId": "project-1",
            "projectFullName": "team/book", "chapterId": "chapter-5",
            "languageCode": "en", "format": "pdf", "outputPath": "/tmp/first.pdf"
        }))
        .unwrap();
        let chapter = PdfImageCacheScope::from_input(&input);
        assert_eq!(
            chapter.target,
            PdfImageCacheTarget::Chapter("chapter-5".into())
        );
        input.chapter_ids = vec!["chapter-5".into(), "chapter-6".into()];
        let book = PdfImageCacheScope::from_input(&input);
        assert_eq!(book.target, PdfImageCacheTarget::Book);
        assert_ne!(chapter, book);
        input.chapter_id = "chapter-6".into();
        input.chapter_ids.reverse();
        input.project_title = "Revised title".into();
        input.language_code = "vi".into();
        input.paper_size = "a5".into();
        input.output_path = "/tmp/revised.pdf".into();
        input.omit_custom_html = true;
        assert_eq!(book, PdfImageCacheScope::from_input(&input));
        input.chapter_ids.truncate(1);
        assert_eq!(book, PdfImageCacheScope::from_input(&input));
        input.chapter_ids.clear();
        input.book_items.push(BookItemInput {
            id: "title".into(),
            kind: "title".into(),
            ..Default::default()
        });
        assert_eq!(book, PdfImageCacheScope::from_input(&input));
        input.project_id = Some("another-project".into());
        assert_ne!(book, PdfImageCacheScope::from_input(&input));
    }

    #[test]
    fn pdf_image_cache_rejects_stale_workers_even_after_switching_back() {
        let chapter = test_image_cache_scope("chapter-5");
        let book = PdfImageCacheScope {
            target: PdfImageCacheTarget::Book,
            ..chapter.clone()
        };
        let entry = || CachedPreparedPdfImage {
            fingerprint: "v1".into(),
            bytes: Arc::new(vec![1]),
            aspect: None,
        };
        let mut cache = PdfImagePreparationCache::default();
        let old_chapter = cache.begin_export(&chapter);
        cache.insert(&old_chapter, "image".into(), entry());
        let old_book = cache.begin_export(&book);
        assert!(cache.entries.is_empty());
        cache.insert(&old_chapter, "stale".into(), entry());
        assert!(cache.entries.is_empty());
        let new_chapter = cache.begin_export(&chapter);
        cache.insert(&old_chapter, "stale".into(), entry());
        cache.insert(&old_book, "stale".into(), entry());
        assert!(cache.entries.is_empty());
        cache.insert(&new_chapter, "image".into(), entry());
        let repeat = cache.begin_export(&chapter);
        assert!(cache.get(&repeat, "image", "v1").is_some());
        assert!(cache.get(&old_chapter, "image", "v1").is_none());
        let disabled = PdfImageCacheSession {
            scope: chapter,
            generation: None,
        };
        assert!(cache.get(&disabled, "image", "v1").is_none());
        cache.insert(&disabled, "disabled".into(), entry());
        assert!(!cache.entries.contains_key("disabled"));
    }

    #[test]
    fn pdf_image_cache_pipeline_reuses_whole_books_and_evicts_on_target_switch() {
        let sources = pdf_workspace().unwrap();
        let _source_cleanup = WorkspaceCleanup(sources.clone());
        let first_path = sources.join("chapter-5.webp");
        let second_path = sources.join("chapter-6.webp");
        let logo_path = sources.join("publisher.png");
        fs::write(&first_path, webp_fixture(40, 30, [200, 0, 0, 255])).unwrap();
        fs::write(&second_path, webp_fixture(40, 30, [0, 200, 0, 255])).unwrap();
        fs::write(&logo_path, png_fixture(30, 20)).unwrap();
        let image_block = |path: &Path| ExportBlock::Image {
            image: ExportImage::Upload {
                repo_relative_path: path.file_name().unwrap().to_string_lossy().into(),
                raw_url: None,
                absolute_path: path.into(),
            },
            caption: String::new(),
        };
        let chapter_doc = ExportDocument {
            title: "Chapter 5".into(),
            language_code: "en".into(),
            blocks: vec![image_block(&first_path)],
            book_parts: vec![],
        };
        let mut book_doc = ExportDocument {
            title: "Book".into(),
            language_code: "en".into(),
            blocks: vec![
                image_block(&first_path),
                image_block(&second_path),
                image_block(&logo_path),
                image_block(&first_path),
            ],
            book_parts: vec![],
        };
        let chapter = test_image_cache_scope("chapter-5");
        let book = PdfImageCacheScope {
            target: PdfImageCacheTarget::Book,
            ..chapter.clone()
        };
        let cache = Mutex::new(PdfImagePreparationCache::default());
        let prepare = |scope: &PdfImageCacheScope, document: &ExportDocument| {
            let session = cache.lock().unwrap().begin_export(scope);
            let workspace = pdf_workspace().unwrap();
            let _cleanup = WorkspaceCleanup(workspace.clone());
            let prepared = prepare_typst_images_with_cache(
                None,
                "test",
                &workspace,
                document,
                &session,
                &AtomicBool::new(false),
                &cache,
            )
            .unwrap();
            let snapshot = cache.lock().unwrap().entries.clone();
            assert_eq!(prepared.len(), snapshot.len());
            for (key, image) in prepared {
                let PreparedTypstImage::File { path, .. } = image else {
                    panic!("Expected a prepared image")
                };
                assert_eq!(
                    fs::read(workspace.join(path)).unwrap(),
                    *snapshot[&key].bytes
                );
            }
            snapshot
        };
        let chapter_first = prepare(&chapter, &chapter_doc);
        let book_first = prepare(&book, &book_doc);
        let first_key = export_image_key(&match &chapter_doc.blocks[0] {
            ExportBlock::Image { image, .. } => image.clone(),
            _ => unreachable!(),
        });
        let second_key = export_image_key(&match &book_doc.blocks[1] {
            ExportBlock::Image { image, .. } => image.clone(),
            _ => unreachable!(),
        });
        assert_eq!(
            book_first.len(),
            3,
            "Duplicate images in the book prepare once"
        );
        assert_eq!(
            typst_image_extension(&book_first[&first_key].bytes),
            Some("jpg")
        );
        assert!(!Arc::ptr_eq(
            &chapter_first[&first_key].bytes,
            &book_first[&first_key].bytes
        ));
        let book_repeat = prepare(&book, &book_doc);
        for (key, entry) in &book_first {
            assert!(Arc::ptr_eq(&entry.bytes, &book_repeat[key].bytes));
        }
        fs::write(second_path, webp_fixture(40, 30, [0, 0, 200, 255])).unwrap();
        let revised = prepare(&book, &book_doc);
        for (key, entry) in &book_repeat {
            assert_eq!(
                Arc::ptr_eq(&entry.bytes, &revised[key].bytes),
                key != &second_key
            );
        }
        book_doc.blocks.reverse();
        book_doc.title = "Revised book title".into();
        let reordered = prepare(&book, &book_doc);
        for (key, entry) in &revised {
            assert!(Arc::ptr_eq(&entry.bytes, &reordered[key].bytes));
        }
        let chapter_again = prepare(&chapter, &chapter_doc);
        assert_eq!(chapter_again.len(), 1);
        assert!(!Arc::ptr_eq(
            &chapter_again[&first_key].bytes,
            &reordered[&first_key].bytes
        ));
        let chapter_repeat = prepare(&chapter, &chapter_doc);
        assert!(Arc::ptr_eq(
            &chapter_repeat[&first_key].bytes,
            &chapter_again[&first_key].bytes
        ));
        let book_again = prepare(&book, &book_doc);
        assert_eq!(book_again.len(), 3);
        assert!(!Arc::ptr_eq(
            &book_again[&first_key].bytes,
            &chapter_repeat[&first_key].bytes
        ));
    }

    #[test]
    fn pdf_image_cache_reuses_matches_invalidates_individually_and_clears_by_chapter() {
        let chapter_a = test_image_cache_scope("chapter-a");
        let chapter_b = test_image_cache_scope("chapter-b");
        let mut cache = PdfImagePreparationCache::default();
        let session_a = cache.begin_export(&chapter_a);
        cache.insert(
            &session_a,
            "file:first".to_string(),
            CachedPreparedPdfImage {
                fingerprint: "first-v1".to_string(),
                bytes: Arc::new(vec![1, 2, 3]),
                aspect: Some(0.5),
            },
        );
        cache.insert(
            &session_a,
            "file:second".to_string(),
            CachedPreparedPdfImage {
                fingerprint: "second-v1".to_string(),
                bytes: Arc::new(vec![4, 5, 6]),
                aspect: Some(1.0),
            },
        );

        assert!(cache.get(&session_a, "file:first", "first-v1").is_some());
        assert!(cache.get(&session_a, "file:first", "first-v2").is_none());
        assert!(cache.get(&session_a, "file:second", "second-v1").is_some());

        let session_b = cache.begin_export(&chapter_b);
        assert!(cache.get(&session_b, "file:first", "first-v1").is_none());
        assert!(cache.entries.is_empty());
    }

    #[test]
    fn uploaded_pdf_image_fingerprint_tracks_file_content() {
        let path = std::env::temp_dir().join(format!("gnosis-pdf-cache-{}.png", Uuid::now_v7()));
        fs::write(&path, b"first image bytes").expect("write first image");
        let image = ExportImage::Upload {
            repo_relative_path: "image.png".to_string(),
            raw_url: None,
            absolute_path: path.clone(),
        };
        let (first, first_bytes) = pdf_image_fingerprint(&image).expect("fingerprint first image");
        fs::write(&path, b"changed image bytes").expect("write changed image");
        let (changed, changed_bytes) =
            pdf_image_fingerprint(&image).expect("fingerprint changed image");
        let _ = fs::remove_file(path);

        assert_ne!(first, changed);
        assert_eq!(
            first_bytes.as_deref(),
            Some(b"first image bytes".as_slice())
        );
        assert_eq!(
            changed_bytes.as_deref(),
            Some(b"changed image bytes".as_slice())
        );
    }

    #[test]
    fn language_font_selection_uses_the_matching_serif_family() {
        assert!(required_fonts("ja-JP", &BTreeSet::new())
            .iter()
            .any(|font| font.family == "Shippori Mincho"));
        assert_eq!(
            required_fonts("ja-JP", &BTreeSet::new())
                .iter()
                .filter(|font| font.family == "Shippori Mincho")
                .count(),
            2
        );
        assert!(required_fonts("zh-TW", &BTreeSet::new())
            .iter()
            .any(|font| font.family == "Noto Serif TC"));
        assert!(required_fonts("ar", &BTreeSet::new())
            .iter()
            .any(|font| font.family == "Noto Naskh Arabic"));
        let latin_fonts = required_fonts("vi", &BTreeSet::new());
        assert_eq!(latin_fonts.len(), 9);
        // The Kindred display faces ship with every Latin-script export.
        assert_eq!(
            latin_fonts
                .iter()
                .filter(|font| font.family == "Alegreya")
                .count(),
            2
        );
        assert_eq!(
            latin_fonts
                .iter()
                .filter(|font| font.family == "Great Vibes")
                .count(),
            1
        );
        // Roman and italic both ship, so italic body text stays in the same family.
        assert_eq!(
            latin_fonts
                .iter()
                .filter(|font| font.family == "Crimson Pro")
                .count(),
            2
        );
        // The patched Cormorant build stays as a last-resort glyph-coverage fallback.
        assert_eq!(
            latin_fonts
                .iter()
                .filter(|font| font.family == "Cormorant Garamond Gnosis")
                .count(),
            2
        );
        // EB Garamond ships alongside it: the Greek fallback behind Crimson Pro —
        // dropping the Greek fallback broke Greek quotations in 0.8.68.
        assert_eq!(
            latin_fonts
                .iter()
                .filter(|font| font.family == "EB Garamond")
                .count(),
            2
        );
        // Non-Latin scripts need it too, as their Latin fallback.
        assert_eq!(
            required_fonts("ja", &BTreeSet::new())
                .iter()
                .filter(|font| font.family == "EB Garamond")
                .count(),
            2
        );
        assert!(!required_fonts("ja", &BTreeSet::new())
            .iter()
            .any(|font| font.family == "Crimson Pro"));
        assert!(!required_fonts("ja", &BTreeSet::new())
            .iter()
            .any(|font| font.family == "Cormorant Garamond Gnosis"));
    }

    #[test]
    fn quoted_scripts_pull_in_their_own_fonts() {
        let plain = ExportDocument {
            book_parts: Vec::new(),
            title: "Tâm vũ trụ".to_string(),
            language_code: "vi".to_string(),
            blocks: vec![ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "Tiếng Việt, chữ Hy Lạp ἀρχή, và IAST oṃ bhūr vareṇyaṃ.".to_string(),
            }],
        };
        // Greek rides along with EB Garamond, and romanised Sanskrit is plain Latin
        // that the body/heading fonts already cover, so nothing extra is fetched.
        // The 25 MB CJK font in particular must never be downloaded for a chapter
        // with no Han.
        assert!(document_scripts(&plain).is_empty());
        let fonts = required_fonts_for_document(&plain);
        assert!(!fonts.iter().any(|font| font.family.starts_with("Noto")));

        let quoting = ExportDocument {
            book_parts: Vec::new(),
            title: "Ông 伏羲".to_string(),
            language_code: "vi".to_string(),
            blocks: vec![ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "Danh xưng אֱלֹהִים và ॐ भूर्भुवः svaḥ.".to_string(),
            }],
        };
        let scripts = document_scripts(&quoting);
        // Han in the title counts too — the title is rendered like any other text.
        assert!(scripts.contains("zh-hans"));
        assert!(scripts.contains("hebrew"));
        assert!(scripts.contains("devanagari"));
        let fonts = required_fonts_for_document(&quoting);
        assert!(fonts.iter().any(|font| font.family == "Noto Serif SC"));
        assert!(fonts.iter().any(|font| font.family == "Noto Serif Hebrew"));
        assert!(fonts
            .iter()
            .any(|font| font.family == "Noto Serif Devanagari"));
        // Cormorant is still pulled in for Latin-language documents as a
        // glyph-coverage fallback, even though Crimson Pro leads the body.
        assert!(fonts
            .iter()
            .any(|font| font.family == "Cormorant Garamond Gnosis"));
        // Traditional characters are covered by SC, so TC is never pulled in as well.
        assert!(!fonts.iter().any(|font| font.family == "Noto Serif TC"));
    }

    fn text_block(style: &str, text: &str) -> ExportBlock {
        ExportBlock::Text {
            text_style: style.to_string(),
            text: text.to_string(),
        }
    }

    #[test]
    fn a_leading_h1_becomes_the_chapter_title() {
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "File Title".to_string(),
            language_code: "en".to_string(),
            blocks: vec![
                text_block("heading1", "The <b>Real</b> Title"),
                text_block("paragraph", "Body."),
            ],
        };
        // Inline markup is stripped to visible text, matching the WordPress rule.
        assert_eq!(
            leading_heading_title(&document).as_deref(),
            Some("The Real Title")
        );
    }

    #[test]
    fn a_non_heading_first_line_leaves_the_file_title_in_place() {
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "File Title".to_string(),
            language_code: "en".to_string(),
            blocks: vec![text_block("paragraph", "Just a paragraph.")],
        };
        assert_eq!(leading_heading_title(&document), None);
    }

    #[test]
    fn a_leading_h1_that_anchors_a_footnote_is_not_promoted() {
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "File Title".to_string(),
            language_code: "en".to_string(),
            blocks: vec![
                text_block("heading1", "Title with note[^1]"),
                ExportBlock::Footnote {
                    number: 1,
                    marker: 1,
                    anchor_block: Some(0),
                    text: "A note.".to_string(),
                },
            ],
        };
        // Promoting it would strip the heading and orphan the footnote.
        assert_eq!(leading_heading_title(&document), None);
    }

    #[test]
    fn title_pages_wrap_naturally_and_preserve_explicit_breaks() {
        use super::super::book_export::{BookItemInput, BookPart};
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let titles = [
            "Hôn Nhân Hoàn Hảo",
            "A Journey Through the World of Ideas",
            "The Art of Change",
            "Über außergewöhnliche Wege und neue Möglichkeiten",
            "A longer title about changing the way we see the world",
            "Hôn Nhân\nHoàn Hảo",
            "First soft\u{2028}Second soft",
            "The <i>Art</i> of Change",
            "Supercalifragilisticexpialidocious",
        ];
        let document = ExportDocument {
            title: "Title layout examples".into(),
            language_code: "vi".into(),
            blocks: Vec::new(),
            book_parts: titles
                .iter()
                .enumerate()
                .map(|(index, title)| BookPart {
                    item: BookItemInput {
                        id: format!("title-{index}"),
                        kind: "title".into(),
                        title: (*title).into(),
                        subtitle: "A subtitle about love and the inner life".into(),
                        author: "Example Author".into(),
                        translator: "Example Translator".into(),
                        ..Default::default()
                    },
                    document: ExportDocument {
                        title: (*title).into(),
                        language_code: "vi".into(),
                        blocks: Vec::new(),
                        book_parts: Vec::new(),
                    },
                })
                .collect(),
        };
        let session = begin_pdf_image_cache(&test_image_cache_scope("title-layout"));
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
        let source = fs::read_to_string(workspace.join("chapter.typ")).unwrap();
        assert_eq!(source.matches("#gnosis-title-fit(").count(), titles.len());
        assert!(source.contains("size: 14pt"));
        assert!(!source.contains("gnosis-balanced-title"));
        assert!(source.contains("Hôn Nhân\\nHoàn Hảo"));
        let (Some(binary), Some(fonts)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        let pdf = workspace.join("titles.pdf");
        let output = std::process::Command::new(&binary)
            .args(["compile", "--ignore-system-fonts", "--font-path"])
            .arg(&fonts)
            .arg("--root")
            .arg(&workspace)
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .arg(workspace.join("chapter.typ"))
            .arg(&pdf)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        // Compile the identical source to SVG, just as the live preview does.
        let svg = workspace.join("title-{p}.svg");
        let output = std::process::Command::new(&binary)
            .args(["compile", "--ignore-system-fonts", "--font-path"])
            .arg(&fonts)
            .arg("--root")
            .arg(&workspace)
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .arg(workspace.join("chapter.typ"))
            .arg(&svg)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(fs::read_to_string(workspace.join("title-1.svg"))
            .unwrap()
            .contains("<svg"));
        if let Some(destination) = std::env::var_os("GNOSIS_TITLE_SMOKE_OUTPUT") {
            let destination = PathBuf::from(destination);
            fs::copy(pdf, &destination).unwrap();
            fs::copy(
                workspace.join("title-1.svg"),
                destination.with_extension("svg"),
            )
            .unwrap();
            fs::copy(
                workspace.join("title-11.svg"),
                destination.with_file_name("manual-break.svg"),
            )
            .unwrap();
        }
    }

    #[test]
    fn composed_book_uses_shared_chapters_and_final_contents_locations() {
        use super::super::book_export::{BookItemInput, BookPart};
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let text = |value: &str| ExportBlock::Text {
            text_style: "paragraph".into(),
            text: value.into(),
        };
        let part = |kind: &str, title: &str, body: Vec<ExportBlock>| BookPart {
            item: BookItemInput {
                id: format!("{kind}-{title}"),
                kind: kind.into(),
                title: title.into(),
                text: if kind == "copyright" {
                    "© Example\n<i>All rights reserved.</i><hr>Second edition".into()
                } else if kind == "dedication" {
                    "For our readers.".into()
                } else {
                    String::new()
                },
                subtitle: if kind == "title" {
                    "A subtitle".into()
                } else {
                    String::new()
                },
                author: if kind == "title" {
                    "An Author".into()
                } else {
                    String::new()
                },
                ..Default::default()
            },
            document: ExportDocument {
                title: title.into(),
                language_code: "en".into(),
                blocks: body,
                book_parts: Vec::new(),
            },
        };
        let mut parts = vec![
            part("title", "A Book", vec![text("A Book")]),
            part("copyright", "Copyright", vec![text("© Example")]),
            part("dedication", "Dedication", vec![text("For our readers.")]),
            part(
                "chapter",
                "Chapter One",
                vec![
                    text("An opening paragraph in the chapter style, long enough to continue beside the decorative initial for several complete lines. The next paragraph should begin with the traditional first-line indent. This representative text also checks that normal word spacing and line spacing remain comfortable on a small A5 page."),
                    text("The second paragraph starts with an indent and no blank line above it. This is the ordinary rhythm used throughout the body of the book."),
                    text_block("heading1", "A first-level heading"),
                    text_block("heading2", "A second-level heading"),
                    text_block("quote", "A quotation keeps its upright default and can retain <i>an explicitly italic phrase</i>."),
                    ExportBlock::Attribution { text: "— An Example Author".into() },
                    text_block("centered", "A centered paragraph"),
                    text_block("indented", "An indented paragraph"),
                    text("A paragraph with a footnote [1] and ordinary text after the reference."),
                    ExportBlock::Footnote { number: 1, marker: 1, anchor_block: Some(8), text: "A representative footnote long enough to wrap onto another line. It keeps an upright body and <i>explicit italic words</i>.".into() },
                    ExportBlock::Separator,
                    text(&"A paragraph to fill the book and verify pagination. ".repeat(700)),
                ],
            ),
            part(
                "chapter",
                "Chapter Two",
                vec![text_block("heading1", "Chapter Two"), text(
                    "Another opening paragraph, with a drop cap of its own.",
                )],
            ),
            // Contents deliberately follows the chapters.
            part("contents", "Mục lục", vec![text("Mục lục")]),
        ];
        parts
            .iter_mut()
            .find(|part| part.item.kind == "contents")
            .unwrap()
            .item
            .include_h1_headings = true;
        parts[4].document.blocks[0] = ExportBlock::Text {
            text_style: "heading1".into(),
            text: "Original source title".into(),
        };
        parts[4].item.title_override = Some("Chapter Two".into());
        parts[4].document = super::super::chapter_export::apply_book_chapter_title(
            parts[4].document.clone(),
            &parts[4].item,
        );
        let mut interlude = part(
            "chapter",
            "Interlude",
            vec![
                text("An unnumbered chapter stays in the book and contents."),
                text_block("heading1", "Inside Interlude"),
                text("Its internal headings can still appear in the contents."),
            ],
        );
        interlude.item.numbered = Some(false);
        parts.insert(4, interlude);
        let illustration = workspace.join("illustration.svg");
        fs::write(&illustration, br##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500"><rect width="300" height="500" fill="#b79858"/><circle cx="150" cy="240" r="90" fill="#fff4da"/></svg>"##).unwrap();
        let image = ExportImage::Upload {
            repo_relative_path: "illustration.svg".into(),
            raw_url: None,
            absolute_path: illustration,
        };
        parts[0].item.image_asset_id = "logo.svg".into();
        parts[0].document.blocks.push(ExportBlock::Image {
            image: image.clone(),
            caption: String::new(),
        });
        let mut plate = part(
            "image",
            "An illustration",
            vec![ExportBlock::Image {
                image,
                caption: "A full-page illustration".into(),
            }],
        );
        plate.item.image_asset_id = "illustration.svg".into();
        plate.item.caption = "A full-page illustration".into();
        parts.insert(parts.len() - 1, plate);
        let document = ExportDocument {
            title: "A Book".into(),
            language_code: "en".into(),
            blocks: parts
                .iter()
                .flat_map(|part| part.document.blocks.clone())
                .collect(),
            book_parts: parts,
        };
        let cache_session = begin_pdf_image_cache(&test_image_cache_scope("book-smoke"));
        let options = PdfWorkspacePreparationOptions {
            footnote_links_as_plain_text: true,
            paper_size: "a5",
            image_cache_session: &cache_session,
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
        let source_path = workspace.join("chapter.typ");
        let mut source = fs::read_to_string(&source_path).unwrap();
        assert_eq!(source.matches("#gnosis-dropcap[").count(), 3);
        assert_eq!(source.matches("#gnosis-title(\"Chapter").count(), 2);
        assert!(!source.contains("Original source title"));
        assert!(source.contains("#pagebreak(to: \"even\")"));
        assert!(source
            .contains("numbering(entry.value.numbering, ..counter(page).at(entry.location()))"));
        assert!(
            source.find("#gnosis-title(\"Chapter Two\",").unwrap()
                < source.find("#gnosis-contents(\"Mục lục\",").unwrap()
        );
        assert!(source.contains("size: 30pt"));
        assert!(source.contains("#let gnosis-book-heading-font = (\"Alegreya\""));
        assert!(
            source.contains("#set par(leading: 0.68em, spacing: 1.43em, first-line-indent: 0pt)")
        );
        assert!(source.contains("#text(\"© Example\")#parbreak()"));
        assert!(source.contains("#gnosis-title(\"Chapter One\", number: 1)"));
        assert!(source.contains("#gnosis-title(\"Interlude\")"));
        assert!(source.contains("#gnosis-title(\"Chapter Two\", number: 2)"));
        assert!(source.contains("title: \"Interlude\", numbering: \"1\", level: 0, chapter: none"));
        assert!(source.contains("title: \"Inside Interlude\", numbering: \"1\", level: 1"));
        // Chapter separators use the same flourish as the copyright page's.
        assert_eq!(
            source
                .matches("#align(center, image(\"flourish.svg\", width: 0.66in))")
                .count(),
            2
        );
        let (Some(binary), Some(font_dir)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        source.push_str("\n#context [#metadata(query(<gnosis-book-entry>).map(entry => (title: entry.value.title, physical: entry.location().page(), page: counter(page).at(entry.location()).first(), numbering: entry.value.numbering, chapter: entry.value.at(\"chapter\", default: none)))) <gnosis-page-audit>]\n");
        fs::write(&source_path, source).unwrap();
        let pdf_path = workspace.join("book.pdf");
        let output = std::process::Command::new(&binary)
            .arg("compile")
            .arg("--root")
            .arg(&workspace)
            .arg("--font-path")
            .arg(&font_dir)
            .arg("--ignore-system-fonts")
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .arg(&source_path)
            .arg(&pdf_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let query = std::process::Command::new(&binary)
            .arg("query")
            .arg("--root")
            .arg(&workspace)
            .arg("--font-path")
            .arg(&font_dir)
            .arg("--ignore-system-fonts")
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .arg("--field")
            .arg("value")
            .arg(&source_path)
            .arg("<gnosis-page-audit>")
            .output()
            .unwrap();
        assert!(
            query.status.success(),
            "{}",
            String::from_utf8_lossy(&query.stderr)
        );
        let pages: serde_json::Value = serde_json::from_slice(&query.stdout).unwrap();
        let pages = pages[0]
            .as_array()
            .unwrap_or_else(|| panic!("Unexpected page audit: {pages}"));
        let one = pages
            .iter()
            .find(|entry| entry["title"] == "Chapter One")
            .unwrap();
        let two = pages
            .iter()
            .find(|entry| entry["title"] == "Chapter Two")
            .unwrap();
        assert_eq!(one["page"], 1);
        assert_eq!(one["chapter"], 1);
        assert_eq!(two["chapter"], 2);
        let interlude = pages
            .iter()
            .find(|entry| entry["title"] == "Interlude")
            .unwrap();
        assert!(interlude["chapter"].is_null());
        assert_eq!(interlude["numbering"], "1");
        assert!(pages
            .iter()
            .any(|entry| entry["title"] == "Inside Interlude"));
        assert!(two["page"].as_u64().unwrap() > 1);
        assert!(!one["physical"].as_u64().unwrap().is_multiple_of(2));
        assert!(!two["physical"].as_u64().unwrap().is_multiple_of(2));
        assert!(!pages.iter().any(|entry| entry["title"] == "Copyright"
            || entry["title"] == "A Book"
            || entry["title"] == "Mục lục"));
        if let Some(destination) = std::env::var_os("GNOSIS_BOOK_SMOKE_OUTPUT") {
            fs::copy(pdf_path, destination).unwrap();
        }
    }

    #[test]
    fn book_h1_contents_entries_stay_unwrapped_on_their_heading_page() {
        use super::super::book_export::{BookItemInput, BookPart};
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        // Each chapter pushes its H1 one line further down, so the sweep crosses
        // a page break and some H1s must start (or be carried to) a new page.
        let parts: Vec<BookPart> = (1..=36)
            .map(|fillers| {
                let mut blocks = vec![text_block("heading1", &format!("Chapter {fillers}"))];
                blocks
                    .extend((0..fillers).map(|_| text_block("paragraph", "A one-line paragraph.")));
                blocks.push(text_block("heading1", &format!("Section {fillers}")));
                blocks.push(text_block(
                    "paragraph",
                    &"Text that follows the heading. ".repeat(20),
                ));
                BookPart {
                    item: BookItemInput {
                        id: format!("chapter-{fillers}"),
                        kind: "chapter".into(),
                        title: format!("Chapter {fillers}"),
                        ..Default::default()
                    },
                    document: ExportDocument {
                        title: format!("Chapter {fillers}"),
                        language_code: "en".into(),
                        blocks,
                        book_parts: Vec::new(),
                    },
                }
            })
            .collect();
        let document = ExportDocument {
            title: "A Book".into(),
            language_code: "en".into(),
            blocks: parts
                .iter()
                .flat_map(|part| part.document.blocks.clone())
                .collect(),
            book_parts: parts,
        };
        let cache_session = begin_pdf_image_cache(&test_image_cache_scope("book-h1"));
        let options = PdfWorkspacePreparationOptions {
            footnote_links_as_plain_text: true,
            paper_size: "us-letter",
            image_cache_session: &cache_session,
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
        let source_path = workspace.join("chapter.typ");
        let mut source = fs::read_to_string(&source_path).unwrap();
        // A wrapping block would replace the heading's own spacing.
        assert!(source.contains(
            "#metadata((title: \"Section 1\", numbering: \"1\", level: 1)) <gnosis-book-entry>\n= "
        ));
        assert!(!source.contains("#block(sticky: true, breakable: false)"));
        let (Some(binary), Some(font_dir)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        source.push_str("\n#context [#metadata(query(<gnosis-book-entry>).filter(entry => entry.value.level == 1).map(entry => { let it = query(selector(heading).after(entry.location())).first(); (entry: entry.location().page(), heading: it.location().page(), starts-page: query(selector(par).before(entry.location())).last().location().page() < it.location().page()) })) <gnosis-h1-audit>]\n");
        fs::write(&source_path, source).unwrap();
        let query = std::process::Command::new(&binary)
            .arg("query")
            .arg("--root")
            .arg(&workspace)
            .arg("--font-path")
            .arg(&font_dir)
            .arg("--ignore-system-fonts")
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .arg("--field")
            .arg("value")
            .arg(&source_path)
            .arg("<gnosis-h1-audit>")
            .output()
            .unwrap();
        assert!(
            query.status.success(),
            "{}",
            String::from_utf8_lossy(&query.stderr)
        );
        let audit: serde_json::Value = serde_json::from_slice(&query.stdout).unwrap();
        let sections = audit[0]
            .as_array()
            .unwrap_or_else(|| panic!("Unexpected H1 audit: {audit}"));
        assert_eq!(sections.len(), 36);
        for section in sections {
            assert_eq!(section["entry"], section["heading"], "{section}");
        }
        assert!(sections
            .iter()
            .any(|section| section["starts-page"] == true));
    }

    #[test]
    fn project_book_export_starts_chapters_on_new_pages_without_promoting_the_first_title() {
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "Book".into(),
            language_code: "en".into(),
            blocks: vec![ExportBlock::Text {
                text_style: "chapter_heading".into(),
                text: "Chapter One".into(),
            }],
        };
        assert_eq!(leading_heading_title(&document), None);
        assert_eq!(dropcap_block_index(&document.blocks, &[0], false), None);
        assert_eq!(
            render_typst_text_block("chapter_heading", "Chapter One", false, false),
            "#pagebreak(weak: true)\n= Chapter One\n\n"
        );
        assert!(document_characters(&document).contains(&'B'));
    }

    #[test]
    fn images_are_capped_by_their_measured_caption_height() {
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "Images".to_string(),
            language_code: "vi".to_string(),
            blocks: Vec::new(),
        };
        let preamble = typst_preamble(&document, "a4");
        // The helper must be defined before any figure can call it.
        assert!(preamble.contains("#let gnosis-image(path, caption: none) = layout("));
        // The cap comes from measuring the actual caption, not a fixed fraction —
        // a long caption must shrink the image, a missing one must free the space.
        assert!(preamble.contains("measure(block(width: width, caption)).height"));
        assert!(!preamble.contains("region.height * 0.82"));
        // A maximum, not a fixed height: small images must not reserve the full cap.
        assert!(preamble.contains("if natural.height > limit"));
        // measure() needs an absolute width or it reports the wrong height and the
        // cap silently never applies.
        assert!(preamble.contains("measure(image(path, width: width))"));
        assert!(!preamble.contains("measure(image(path, width: 90%))"));
    }

    #[test]
    fn typst_footnotes_use_a_fixed_hanging_gutter() {
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "Footnotes".to_string(),
            language_code: "vi".to_string(),
            blocks: Vec::new(),
        };
        let preamble = typst_preamble(&document, "a4");

        // The native in-text callout stays intact; only entries at the foot of the
        // page are rebuilt with a baseline number and a stable text column.
        // A third of a footnote line separates consecutive notes.
        assert!(preamble.contains("#set footnote.entry(indent: 0em, gap: 0.73em)"));
        assert!(preamble.contains("let marker-width = 12pt"));
        assert!(preamble.contains("let marker-gap = 3pt"));
        assert!(preamble.contains("number + [.]"));
        assert!(preamble.contains("columns: (marker-width, 1fr)"));
        assert!(preamble.contains("column-gutter: marker-gap"));
        assert!(preamble.contains("align: (end + top, start + top)"));
        assert!(preamble
            .contains("first-line-indent: (amount: 1.5em, all: false), spacing: par.leading"));
        assert!(preamble.contains("#it.note.body"));
        // A footnote may run over with one line; only widows are released, so the
        // orphan rule still keeps two lines at the foot of the first page.
        assert!(preamble.contains("#set text(costs: (widow: 0%))"));
    }

    #[test]
    fn typst_font_selection_uses_crimson_pro_for_latin_body_and_headings() {
        let vietnamese = ExportDocument {
            book_parts: Vec::new(),
            title: "Vietnamese".to_string(),
            language_code: "vi".to_string(),
            blocks: Vec::new(),
        };
        let japanese = ExportDocument {
            book_parts: Vec::new(),
            title: "Japanese".to_string(),
            language_code: "ja".to_string(),
            blocks: Vec::new(),
        };
        let vietnamese_preamble = typst_preamble(&vietnamese, "a4");
        // Crimson Pro leads body text; EB Garamond and Cormorant trail purely as
        // glyph-coverage fallbacks, never for appearance.
        assert!(vietnamese_preamble
            .contains("font: (\"Crimson Pro\", \"EB Garamond\", \"Cormorant Garamond Gnosis\")"));
        // Kindred style: Alegreya leads body headings on Latin-script exports,
        // with the body fallbacks behind it.
        assert!(vietnamese_preamble.contains(
            "#show heading: set text(font: (\"Alegreya\", \"EB Garamond\", \"Cormorant Garamond Gnosis\"), weight: \"regular\")"
        ));
        // Capitals and a size above the 11.5pt body set H2 apart from body text,
        // still below H1.
        assert!(vietnamese_preamble.contains("#show heading: upper\n"));
        assert!(
            vietnamese_preamble.contains("#show heading.where(level: 1): set text(size: 14.5pt)")
        );
        assert!(vietnamese_preamble.contains("#show heading.where(level: 2): set text(size: 12pt)"));
        // One body line of space below each heading, whatever its size.
        assert!(vietnamese_preamble
            .contains("#show heading: set block(above: 1.3em, below: 11.5pt * 0.78)"));
        assert!(!vietnamese_preamble.contains("Noto Serif"));
        assert!(vietnamese_preamble.contains("size: 11.5pt"));
        assert!(vietnamese_preamble.contains("leading: 0.78em"));
        assert!(vietnamese_preamble.contains("spacing: 110%"));
        // Greek runs are forced to EB Garamond: Crimson Pro carries five stray
        // Greek glyphs (Δ Σ Ω μ π), so per-glyph fallback would split a Greek word
        // across typefaces — dropping this rule broke Greek quotations in 0.8.68.
        assert!(vietnamese_preamble.contains(GREEK_RUN_RULE_PREFIX));
        assert!(vietnamese_preamble.contains("set text(font: \"EB Garamond\")"));
        // Kindred style: the chapter opens with a Great Vibes drop cap; the body
        // families trail the letter's font list so an uncovered glyph falls back
        // to the body serif instead of tofu.
        assert!(vietnamese_preamble.contains(
            "dropcap(height: lines, gap: letter => gnosis-dropcap-gap(letter) * scale, sizing-transform: gnosis-dropcap-base, top-edge: \"cap-height\", bottom-edge: \"descender\", font: (\"Great Vibes\", \"Crimson Pro\", \"EB Garamond\", \"Cormorant Garamond Gnosis\"), body)"
        ));
        // Vietnamese marks do not participate in sizing: the bare capital fixes
        // the font size and baseline while the complete glyph remains visible.
        assert!(vietnamese_preamble.contains("\"Ĩ\": \"I\""));
        assert!(vietnamese_preamble.contains("\"Ỉ\": \"I\""));
        assert!(vietnamese_preamble.contains("\"Ữ\": \"U\""));
        // The gutter normally uses the bare capital's furthest right ink. The
        // right-side horns on Ơ/Ư get their own family metrics.
        assert!(vietnamese_preamble.contains("#let gnosis-dropcap-gap(letter)"));
        assert!(vietnamese_preamble.contains("\"T\": 1.74em"));
        assert!(vietnamese_preamble.contains("\"Ợ\": \"Ơ\""));
        assert!(vietnamese_preamble.contains("\"Ự\": \"Ư\""));
        assert!(vietnamese_preamble.contains("\"Ơ\": 0.65em, \"Ư\": 0.64em"));
        assert!(vietnamese_preamble
            .contains("gnosis-dropcap-clearance-base(letter) == \"Ư\" {\n  0.18em"));
        assert!(vietnamese_preamble
            .contains(".at(gnosis-dropcap-clearance-base(letter), default: 0pt)"));
        assert!(!vietnamese_preamble.contains("\"Ĩ\": 1.20em"));
        assert!(vietnamese_preamble.contains("#import \"@preview/droplet:0.3.1\": dropcap"));
        // The chapter title is emitted as the first top float so a
        // `placement: auto` image can never be hoisted above it on page one.
        // Kindred style: Alegreya, all caps, tracked, with the flourish one line
        // below and a wider clearance before the body text; tighter over an
        // image cover.
        assert!(vietnamese_preamble.contains("#let gnosis-title(t, number: none, tight: false)"));
        assert!(vietnamese_preamble.contains("clearance: if tight { 2.5em } else { 6em }"));
        assert!(vietnamese_preamble.contains("#v(if tight { 2em } else { 5.5em }, weak: false)"));
        assert!(vietnamese_preamble.contains("size: 16pt, weight: \"regular\", tracking: 0.1em"));
        let japanese_preamble = typst_preamble(&japanese, "a4");
        assert!(japanese_preamble.contains("\"Shippori Mincho\", \"EB Garamond\""));
        assert!(japanese_preamble.contains("size: 11pt"));
        assert!(japanese_preamble.contains("leading: 0.65em"));
        assert!(!japanese_preamble.contains("Crimson Pro"));
        assert!(!japanese_preamble.contains("Cormorant Garamond"));
        // Non-Latin exports keep their own heading faces and get no drop cap —
        // Alegreya and Great Vibes have no coverage there.
        assert!(!japanese_preamble.contains("#show heading"));
        assert!(!japanese_preamble.contains("Alegreya"));
        assert!(!japanese_preamble.contains("dropcap"));
        // Non-Latin body faces carry their own Greek coverage, so no Greek run rule.
        assert!(!japanese_preamble.contains(GREEK_RUN_RULE_PREFIX));
        assert!(japanese_preamble.contains("#let gnosis-title(t, number: none, tight: false)"));
        assert!(
            japanese_preamble.contains("font: (\"Shippori Mincho\", \"EB Garamond\"), size: 16pt")
        );
    }

    #[test]
    fn dropcap_targets_only_a_leading_plain_paragraph() {
        let paragraph = |text: &str| ExportBlock::Text {
            text_style: "paragraph".to_string(),
            text: text.to_string(),
        };
        // Plain opening paragraph gets the drop cap.
        let blocks = vec![paragraph("Đức Cha là trí tuệ.")];
        assert_eq!(dropcap_block_index(&blocks, &[0], false), Some(0));
        // A promoted leading H1 is skipped; the paragraph after it is chosen.
        let blocks = vec![
            ExportBlock::Text {
                text_style: "heading1".to_string(),
                text: "Title".to_string(),
            },
            paragraph("It was a dark and stormy night."),
        ];
        assert_eq!(dropcap_block_index(&blocks, &[0, 1], true), Some(1));
        // Anchored footnote records emit nothing at their position — looked past.
        let blocks = vec![
            ExportBlock::Footnote {
                number: 1,
                marker: 1,
                anchor_block: Some(1),
                text: "Note".to_string(),
            },
            paragraph("Opening line."),
        ];
        assert_eq!(dropcap_block_index(&blocks, &[0, 1], false), Some(1));
        // A chapter that opens with a heading, quote, or image gets no drop cap.
        let blocks = vec![
            ExportBlock::Text {
                text_style: "heading2".to_string(),
                text: "Subhead".to_string(),
            },
            paragraph("Body."),
        ];
        assert_eq!(dropcap_block_index(&blocks, &[0, 1], false), None);
        // An opening paragraph that starts with a digit keeps its plain form.
        let blocks = vec![paragraph("1975 was the year it began.")];
        assert_eq!(dropcap_block_index(&blocks, &[0], false), None);
        // Blank leading rows emit nothing — the drop cap lands on the first
        // paragraph a reader actually sees.
        let blocks = vec![
            paragraph(""),
            paragraph("   "),
            paragraph("Đức Cha là trí tuệ."),
        ];
        assert_eq!(dropcap_block_index(&blocks, &[0, 1, 2], false), Some(2));
        // A leading image floats away from the opening text — looked past.
        let blocks = vec![
            ExportBlock::Image {
                image: ExportImage::Url("https://example.com/cover.png".to_string()),
                caption: String::new(),
            },
            paragraph("Đức Cha là trí tuệ."),
        ];
        assert_eq!(dropcap_block_index(&blocks, &[0, 1], false), Some(1));
        // A quote on the chapter's cover leaves the drop cap to the text, which
        // opens the next page.
        let blocks = vec![
            text_block("quote", "An epigraph."),
            ExportBlock::Attribution {
                text: "An Author".to_string(),
            },
            paragraph("Đức Cha là trí tuệ."),
        ];
        assert_eq!(dropcap_block_index(&blocks, &[0, 1, 2], false), Some(2));
    }

    #[test]
    fn dropcaps_drop_as_many_lines_as_their_paragraph_has_up_to_three() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let document = ExportDocument {
            title: "Drop caps".into(),
            language_code: "en".into(),
            blocks: vec![text_block("paragraph", "Body.")],
            book_parts: Vec::new(),
        };
        let session = begin_pdf_image_cache(&test_image_cache_scope("dropcap-lines"));
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
        let source_path = workspace.join("chapter.typ");
        let mut source = fs::read_to_string(&source_path).unwrap();
        assert!(source.contains("let lines = gnosis-dropcap-lines(body, region.width)"));
        let (Some(binary), Some(font_dir)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        // A footnote marker makes its line a little taller without adding one.
        let cases = [
            (1, "One short line."),
            (1, "One short line with a note.#footnote[A note.]"),
            (2, "Two#linebreak()lines."),
            (3, "Three#linebreak()short#linebreak()lines."),
            (3, "#lorem(120)"),
        ];
        for (case, (_, body)) in cases.iter().enumerate() {
            source.push_str(&format!("#layout(region => [#metadata((case: {case}, lines: gnosis-dropcap-lines([{body}], region.width))) <dropcap-audit>])\n#set par(first-line-indent: 0pt)\n#gnosis-dropcap[{body}]\n\n"));
        }
        fs::write(&source_path, source).unwrap();
        let query = std::process::Command::new(&binary)
            .arg("query")
            .arg("--root")
            .arg(&workspace)
            .arg("--font-path")
            .arg(&font_dir)
            .arg("--ignore-system-fonts")
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .arg("--field")
            .arg("value")
            .arg(&source_path)
            .arg("<dropcap-audit>")
            .output()
            .unwrap();
        assert!(
            query.status.success(),
            "{}",
            String::from_utf8_lossy(&query.stderr)
        );
        let audit: Vec<serde_json::Value> = serde_json::from_slice(&query.stdout).unwrap();
        assert_eq!(audit.len(), cases.len());
        for (case, (lines, body)) in cases.iter().enumerate() {
            assert_eq!(audit[case]["lines"], *lines, "{body}");
        }
    }

    #[test]
    fn dropcap_allows_opening_punctuation_before_the_first_letter() {
        let blocks = vec![text_block(
            "paragraph",
            "“Ứng dụng bắt đầu bằng dấu ngoặc kép.",
        )];
        assert_eq!(dropcap_block_index(&blocks, &[0], false), Some(0));

        let numbered = vec![text_block("paragraph", "1. A numbered opening.")];
        assert_eq!(dropcap_block_index(&numbered, &[0], false), None);
    }

    #[test]
    fn quotes_use_smaller_upright_text_and_preserve_inline_emphasis() {
        let quote = render_typst_text_block("quote", "Quotation", false, false);
        assert_eq!(quote, "#gnosis-quote[Quotation]\n\n");
        assert!(GNOSIS_QUOTE_RULE.contains("quote(block: true)"));
        assert!(GNOSIS_QUOTE_RULE.contains("#text(size: 0.9em, style: \"normal\")[#body"));
    }

    #[test]
    fn citations_are_set_as_the_last_line_of_what_they_cite() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let document = ExportDocument {
            title: "Quotes".into(),
            language_code: "vi".into(),
            blocks: vec![
                text_block("paragraph", "Before."),
                text_block("quote", "A cited quotation."),
                ExportBlock::Attribution {
                    text: "Giăng 1:14".into(),
                },
                text_block("quote", "An uncited quotation."),
                text_block("paragraph", "After."),
                text_block("paragraph", "An epigraph-style paragraph."),
                ExportBlock::Attribution {
                    text: "An Author".into(),
                },
            ],
            book_parts: Vec::new(),
        };
        let session = begin_pdf_image_cache(&test_image_cache_scope("quote-spacing"));
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
        let source = fs::read_to_string(workspace.join("chapter.typ")).unwrap();
        assert!(source.contains(
            "#gnosis-quote(citation: [#text(\"Giăng 1:14\")])[#text(\"A cited quotation.\")]"
        ));
        assert!(source.contains("#gnosis-quote[#text(\"An uncited quotation.\")]"));
        assert!(source.contains(
            "#block(below: 1.5em)[#text(\"An epigraph-style paragraph.\")#gnosis-citation[#text(\"An Author\")]]"
        ));
        // No citation is left as a separate block, and nothing has to move whole
        // to the next page to stay with one.
        assert!(!source.contains("#align(right)"));
        assert!(!source.contains("sticky: true, breakable: true"));
    }

    #[test]
    fn short_quotes_stay_on_one_page_and_long_quotes_split_with_their_citation() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let document = ExportDocument {
            title: "Quotes".into(),
            language_code: "vi".into(),
            blocks: vec![text_block("paragraph", "Body.")],
            book_parts: Vec::new(),
        };
        let session = begin_pdf_image_cache(&test_image_cache_scope("quote-page-breaks"));
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
        let (Some(binary), Some(font_dir)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        // Each case starts a page with a different amount of body text, so the
        // quotes meet the page foot at every line position. Markers record the
        // page of each quote's first line, last line, and citation.
        let mark = |case: usize, name: &str| {
            format!("#context [#metadata((case: {case}, mark: \"{name}\", page: here().page())) <quote-audit>]")
        };
        let mut source = typst_preamble(&document, "a5");
        let mut cases = Vec::new();
        for (words, quote_words) in (120..330)
            .step_by(3)
            .flat_map(|words| [(words, 40), (words, 170)])
        {
            let case = cases.len();
            cases.push(quote_words);
            source.push_str(&format!(
                "#pagebreak(weak: true)\n#lorem({words})\n\n#gnosis-quote(citation: [{}Giăng 1:14])[{}#lorem({quote_words}){}]\n\n#lorem(40)\n\n",
                mark(case, "citation"),
                mark(case, "start"),
                mark(case, "end"),
            ));
        }
        let source_path = workspace.join("quotes.typ");
        fs::write(&source_path, source).unwrap();
        let query = std::process::Command::new(&binary)
            .arg("query")
            .arg("--root")
            .arg(&workspace)
            .arg("--font-path")
            .arg(&font_dir)
            .arg("--ignore-system-fonts")
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .arg("--field")
            .arg("value")
            .arg(&source_path)
            .arg("<quote-audit>")
            .output()
            .unwrap();
        assert!(
            query.status.success(),
            "{}",
            String::from_utf8_lossy(&query.stderr)
        );
        let marks: Vec<serde_json::Value> = serde_json::from_slice(&query.stdout).unwrap();
        let page = |case: usize, name: &str| {
            marks
                .iter()
                .find(|entry| entry["case"] == case && entry["mark"] == name)
                .unwrap_or_else(|| panic!("No {name} mark for case {case}"))["page"]
                .as_u64()
                .unwrap()
        };
        let mut long_splits = 0;
        for (case, quote_words) in cases.iter().enumerate() {
            let (start, end, citation) = (
                page(case, "start"),
                page(case, "end"),
                page(case, "citation"),
            );
            assert_eq!(end, citation, "case {case}: citation left its quote");
            if *quote_words == 40 {
                assert_eq!(start, end, "case {case}: a five-line quote was split");
            } else if start < end {
                long_splits += 1;
            }
        }
        assert!(
            long_splits > 10,
            "long quotes moved whole instead of splitting"
        );
    }

    #[test]
    fn opening_quotes_and_images_become_the_chapter_cover() {
        let title = || text_block("heading1", "Title");
        let quote = || text_block("quote", "An epigraph.");
        let citation = || ExportBlock::Attribution {
            text: "An Author".into(),
        };
        let body = || text_block("paragraph", "Body.");
        let blank = || text_block("paragraph", "");
        let image = |name: &str| ExportBlock::Image {
            image: ExportImage::Url(format!("https://example.com/{name}.png")),
            caption: String::new(),
        };
        let footnote = |anchor: usize| ExportBlock::Footnote {
            number: 1,
            marker: 1,
            anchor_block: Some(anchor),
            text: "A note.".into(),
        };
        // A cited quote, looking past blank rows and the quote's footnote.
        assert_eq!(
            chapter_cover_end(
                &[title(), blank(), quote(), citation(), footnote(2), body()],
                true
            ),
            Some(3)
        );
        // Consecutive quotes are one epigraph, even with a blank row between them.
        assert_eq!(
            chapter_cover_end(
                &[title(), quote(), citation(), blank(), quote(), body()],
                true
            ),
            Some(4)
        );
        // Without a promoted title, the first block itself opens the cover.
        assert_eq!(chapter_cover_end(&[quote(), body()], false), Some(0));
        // An image cover is that one image; a second image starts the next page.
        assert_eq!(
            chapter_cover_end(&[title(), image("a"), image("b"), body()], true),
            Some(1)
        );
        assert_eq!(
            chapter_cover_end(&[title(), image("a"), image("b")], true),
            Some(1)
        );
        // Other openers, and openers with nothing after them, make no cover.
        for blocks in [
            vec![title(), body(), quote()],
            vec![title(), text_block("heading2", "Section"), quote(), body()],
            vec![title(), ExportBlock::Separator, image("a"), body()],
            vec![title(), quote(), citation(), blank()],
            vec![title(), blank(), image("a")],
        ] {
            assert_eq!(chapter_cover_end(&blocks, true), None, "{blocks:?}");
        }
    }

    #[test]
    fn chapter_covers_break_before_the_text_center_short_quotes_and_fit_their_image() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        // At full text width this image is far taller than the page, so it only
        // fits under the title if it is capped by the space the title leaves.
        let tall = workspace.join("tall.svg");
        fs::write(
            &tall,
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="400"><rect width="80" height="400" fill="#c87900"/></svg>"##,
        )
        .unwrap();
        let image = ExportBlock::Image {
            image: ExportImage::Upload {
                repo_relative_path: "tall.svg".into(),
                raw_url: None,
                absolute_path: tall,
            },
            caption: "A caption under the cover image.".into(),
        };
        let cases = [
            (
                "quote",
                vec![
                    text_block("quote", "An epigraph."),
                    ExportBlock::Attribution {
                        text: "An Author".into(),
                    },
                ],
            ),
            (
                "long quote",
                vec![
                    text_block("quote", &"A longer epigraph. ".repeat(6)),
                    ExportBlock::Attribution {
                        text: "An Author".into(),
                    },
                ],
            ),
            ("image", vec![image]),
            (
                "none",
                vec![text_block("paragraph", "An opening paragraph.")],
            ),
        ];
        let session = begin_pdf_image_cache(&test_image_cache_scope("chapter-covers"));
        let options = PdfWorkspacePreparationOptions {
            paper_size: "a5",
            footnote_links_as_plain_text: true,
            image_cache_session: &session,
            layout: TypstLayout::Export,
        };
        let typst = std::env::var_os("GNOSIS_TYPST_BIN")
            .zip(std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"));
        for (case, opener) in cases {
            let mut blocks = vec![text_block("heading1", "A Chapter")];
            blocks.extend(opener);
            blocks.push(text_block("heading2", "The text begins"));
            blocks.push(text_block("paragraph", &"Body text. ".repeat(40)));
            let document = ExportDocument {
                title: "A Chapter".into(),
                language_code: "en".into(),
                blocks,
                book_parts: Vec::new(),
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
            let source_path = workspace.join("chapter.typ");
            let mut source = fs::read_to_string(&source_path).unwrap();
            let cover = case != "none";
            assert_eq!(
                source.matches("#pagebreak(weak: true)").count(),
                usize::from(cover),
                "{case}"
            );
            assert_eq!(
                source.contains("#block(width: 100%, height: 1fr)[#figure("),
                case == "image",
                "{case}"
            );
            // The title moves up and closer to an image cover only.
            assert_eq!(
                source.contains("#gnosis-title(\"A Chapter\", tight: true)"),
                case == "image",
                "{case}"
            );
            assert_eq!(
                source.contains("#gnosis-quote(citation: [#text(\"An Author\")], cover: true)["),
                case.ends_with("quote"),
                "{case}"
            );
            let Some((binary, font_dir)) = &typst else {
                continue;
            };
            source.push_str("\n#context [#metadata((text: query(heading).first().location().page(), quote: query(quote).map(it => it.location().page()), quote-x: query(quote).map(it => it.location().position().x.pt()), figure: query(figure).map(it => it.location().page()), caption-fits: query(figure.caption).all(it => it.location().position().y < page.height - 20mm))) <cover-audit>]\n");
            fs::write(&source_path, source).unwrap();
            let query = std::process::Command::new(binary)
                .arg("query")
                .arg("--root")
                .arg(&workspace)
                .arg("--font-path")
                .arg(font_dir)
                .arg("--ignore-system-fonts")
                .arg("--package-path")
                .arg(workspace.join("packages"))
                .arg("--field")
                .arg("value")
                .arg(&source_path)
                .arg("<cover-audit>")
                .output()
                .unwrap();
            assert!(
                query.status.success(),
                "{}",
                String::from_utf8_lossy(&query.stderr)
            );
            let audit: serde_json::Value = serde_json::from_slice(&query.stdout).unwrap();
            let audit = &audit[0];
            assert_eq!(audit["text"], if cover { 2 } else { 1 }, "{case}: {audit}");
            match case {
                "quote" | "long quote" => {
                    assert_eq!(audit["quote"], serde_json::json!([1]), "{audit}");
                    // A5 margins are about 54-62pt: a one-line quote is centred, a
                    // longer one keeps the full measure.
                    let x = audit["quote-x"][0].as_f64().unwrap();
                    assert_eq!(x > 120.0, case == "quote", "{case}: {audit}");
                }
                "image" => {
                    assert_eq!(audit["figure"], serde_json::json!([1]), "{audit}");
                    assert_eq!(audit["caption-fits"], true, "{audit}");
                }
                _ => {}
            }
        }
    }

    #[test]
    fn typst_strings_escape_code_boundaries() {
        assert_eq!(typst_string("a\\b\"c\nd"), "\"a\\\\b\\\"c\\nd\"");
    }

    #[test]
    fn typst_footnote_paragraphs_have_real_boundaries_and_preserve_blank_lines() {
        assert_eq!(
            render_footnote_typst("<i>First\nSecond</i>", false),
            "#emph[#text(\"First\")]#parbreak()#emph[#text(\"Second\")]"
        );
        let blank = render_footnote_typst("First\n\nLast", false);
        assert_eq!(blank.matches("#parbreak()").count(), 2);
        assert!(blank.contains("#text(\"\\u{a0}\")"));
        // Ordinary within-row newlines must retain their old soft-break path.
        assert_eq!(
            render_inline_typst("First\nSecond", false),
            "#text(\"First\\nSecond\")"
        );
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
        // The escaped marker stays literal — no footnote is placed at its position —
        // and the unmatched inline marker is left untouched.
        assert!(rendered.contains("[1]"));
        assert!(rendered.contains("[3]"));
        // The note itself is not dropped: with no usable inline marker it appends to
        // the end of the block.
        assert!(rendered.trim_end().ends_with("#footnote[#text(\"Note\")]"));
    }

    #[test]
    fn row_level_footnotes_append_to_the_end_of_their_paragraph() {
        // A footnote whose marker never appears inline (a row-level footnote) attaches
        // to the end of the paragraph rather than floating onto the next one.
        let rendered = render_inline_typst_with_footnotes(
            "The Tarot of the Bohemians.",
            &[(1, "Astral Light note".to_string())],
            false,
        );
        assert_eq!(
            rendered,
            "#text(\"The Tarot of the Bohemians.\")#footnote[#text(\"Astral Light note\")]"
        );
    }

    #[test]
    fn adjacent_inline_footnote_markers_separate_with_a_superscript_comma() {
        let rendered = render_inline_typst_with_footnotes(
            "Twin[1][2] notes.",
            &[(1, "First".to_string()), (2, "Second".to_string())],
            false,
        );
        assert_eq!(
            rendered,
            "#text(\"Twin\")#footnote[#text(\"First\")]#super[,]#footnote[#text(\"Second\")]#text(\" notes.\")"
        );
    }

    #[test]
    fn adjacent_markers_across_a_style_boundary_still_take_the_comma() {
        // The two markers sit in different styled segments ([1] inside bold,
        // [2] outside), so the adjacency flag must survive the segment change.
        let rendered = render_inline_typst_with_footnotes(
            "<b>Twin[1]</b>[2] notes.",
            &[(1, "First".to_string()), (2, "Second".to_string())],
            false,
        );
        assert_eq!(
            rendered,
            "#strong[#text(\"Twin\")]#footnote[#text(\"First\")]#super[,]#footnote[#text(\"Second\")]#text(\" notes.\")"
        );
    }

    #[test]
    fn space_separated_footnote_markers_keep_the_space_and_get_no_comma() {
        let rendered = render_inline_typst_with_footnotes(
            "Twin[1] [2] notes.",
            &[(1, "First".to_string()), (2, "Second".to_string())],
            false,
        );
        assert_eq!(
            rendered,
            "#text(\"Twin\")#footnote[#text(\"First\")]#text(\" \")#footnote[#text(\"Second\")]#text(\" notes.\")"
        );
    }

    #[test]
    fn appended_row_level_footnote_after_an_inline_marker_takes_the_comma() {
        let rendered = render_inline_typst_with_footnotes(
            "End[1]",
            &[(1, "Inline".to_string()), (2, "Row-level".to_string())],
            false,
        );
        assert_eq!(
            rendered,
            "#text(\"End\")#footnote[#text(\"Inline\")]#super[,]#footnote[#text(\"Row-level\")]"
        );
    }

    #[test]
    fn multiple_appended_row_level_footnotes_separate_with_commas() {
        let rendered = render_inline_typst_with_footnotes(
            "Plain text.",
            &[(1, "First".to_string()), (2, "Second".to_string())],
            false,
        );
        assert_eq!(
            rendered,
            "#text(\"Plain text.\")#footnote[#text(\"First\")]#super[,]#footnote[#text(\"Second\")]"
        );
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
            book_parts: Vec::new(),
            title: "Paper test".to_string(),
            language_code: "en".to_string(),
            blocks: Vec::new(),
        };
        assert!(typst_preamble(&document, "a4").contains("paper: \"a4\""));
    }

    #[test]
    fn image_captions_are_small_upright_text() {
        let caption = render_typst_image_caption("A <b>bold</b> caption");
        assert!(caption.starts_with("#align(center)"));
        assert!(caption.contains("#text(size: 0.75em)["));
        assert!(!caption.contains("italic"));
        assert!(caption.contains("#strong["));
    }

    #[test]
    fn typst_inline_text_is_normalized_to_nfc() {
        let decomposed = "“U\u{031b}\u{0301}ng dụng <i>E\u{0302}\u{0301}</i>";
        let rendered = render_inline_typst(decomposed, false);
        assert_eq!(rendered, "#text(\"“Ứng dụng \")#emph[#text(\"Ế\")]");
        assert!(!rendered.contains('\u{031b}'));
        assert!(!rendered.contains('\u{0302}'));
    }

    #[test]
    fn captioned_images_are_not_numbered() {
        let figure = render_typst_figure(
            "image(\"images/example.png\", width: 90%)",
            "An italic caption",
            true,
        );
        assert!(figure.starts_with("#figure(image("));
        assert!(figure.contains("caption: [#align(center)"));
        assert!(figure.contains("size: 0.75em"));
        assert!(figure.contains("gap: 0.85em"));
        assert!(figure.contains("numbering: none"));
        // Floats fill the gap an oversized image would otherwise leave at the
        // bottom of a page.
        assert!(figure.ends_with("placement: auto)"));
        // Trailing images stay in flow: no following text exists to fill a
        // float's gap, and in-flow placement keeps them after the final lines.
        let trailing = render_typst_figure(
            "image(\"images/example.png\", width: 90%)",
            "An italic caption",
            false,
        );
        assert!(!trailing.contains("placement"));
    }

    #[test]
    fn trailing_images_are_sorted_shortest_first() {
        let image = |name: &str| ExportImage::Upload {
            repo_relative_path: format!("{name}.png"),
            raw_url: None,
            absolute_path: PathBuf::from(format!("/tmp/{name}.png")),
        };
        let block = |name: &str| ExportBlock::Image {
            image: image(name),
            caption: String::new(),
        };
        let blocks = vec![
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "Body".to_string(),
            },
            block("tall"),
            ExportBlock::Text {
                text_style: "paragraph".to_string(),
                text: "More body".to_string(),
            },
            block("wide"),
            block("failed"),
            block("square"),
        ];
        let mut prepared = HashMap::new();
        let file = |name: &str, aspect: f64| {
            (
                export_image_key(&image(name)),
                PreparedTypstImage::File {
                    path: format!("images/{name}.png"),
                    aspect: Some(aspect),
                },
            )
        };
        prepared.extend([file("tall", 1.6), file("wide", 0.4), file("square", 1.0)]);
        prepared.insert(
            export_image_key(&image("failed")),
            PreparedTypstImage::Placeholder("failed".to_string()),
        );
        let (order, trailing_start) = typst_block_emission_order(&blocks, &prepared, 0);
        // The mid-chapter image at index 1 is not part of the trailing run.
        assert_eq!(trailing_start, 3);
        // Placeholder (short notice box) first, then wide, then square.
        assert_eq!(order, vec![0, 1, 2, 4, 3, 5]);
    }

    #[test]
    fn image_aspect_is_read_from_common_format_headers() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend([0, 0, 0, 13]);
        png.extend(b"IHDR");
        png.extend(200u32.to_be_bytes());
        png.extend(100u32.to_be_bytes());
        assert_eq!(typst_image_aspect(&png), Some(0.5));

        let mut gif = b"GIF89a".to_vec();
        gif.extend(100u16.to_le_bytes());
        gif.extend(300u16.to_le_bytes());
        assert_eq!(typst_image_aspect(&gif), Some(3.0));

        // JPEG: APP0 segment, then a baseline SOF0 with height 256, width 512.
        let mut jpg = b"\xff\xd8\xff\xe0\x00\x04\x00\x00".to_vec();
        jpg.extend(b"\xff\xc0\x00\x11\x08\x01\x00\x02\x00");
        assert_eq!(typst_image_aspect(&jpg), Some(0.5));

        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">"#;
        assert_eq!(typst_image_aspect(svg), Some(0.5));
        let svg_viewbox = br#"<svg xmlns='x' viewBox='0 0 600 900'>"#;
        assert_eq!(typst_image_aspect(svg_viewbox), Some(1.5));

        assert_eq!(typst_image_aspect(b"not an image"), None);
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

    fn webp_fixture(width: u32, height: u32, pixel: [u8; 4]) -> Vec<u8> {
        let rgba = image::RgbaImage::from_pixel(width, height, image::Rgba(pixel));
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(rgba)
            .write_with_encoder(image::codecs::webp::WebPEncoder::new_lossless(
                std::io::Cursor::new(&mut out),
            ))
            .expect("encode webp fixture");
        out
    }

    fn png_fixture(width: u32, height: u32) -> Vec<u8> {
        let rgb = image::RgbImage::from_pixel(width, height, image::Rgb([10, 200, 30]));
        let mut out = Vec::new();
        image::DynamicImage::ImageRgb8(rgb)
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .expect("encode png fixture");
        out
    }

    fn jpeg_fixture(width: u32, height: u32) -> Vec<u8> {
        let rgb = image::RgbImage::from_pixel(width, height, image::Rgb([80, 90, 100]));
        let mut out = Vec::new();
        rgb.write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
            std::io::Cursor::new(&mut out),
            90,
        ))
        .expect("encode jpeg fixture");
        out
    }

    #[test]
    fn webp_images_flatten_onto_white_and_become_jpeg() {
        // Fully transparent webp: the flattened JPEG must come out white.
        let optimized = optimize_pdf_image_bytes(webp_fixture(8, 8, [200, 0, 0, 0]));
        assert_eq!(typst_image_extension(&optimized), Some("jpg"));
        let decoded = image::load_from_memory(&optimized)
            .expect("decode")
            .into_rgb8();
        let pixel = decoded.get_pixel(4, 4);
        assert!(
            pixel[0] > 245 && pixel[1] > 245 && pixel[2] > 245,
            "{pixel:?}"
        );
        // Opaque webp keeps its colour.
        let optimized = optimize_pdf_image_bytes(webp_fixture(8, 8, [200, 0, 0, 255]));
        let decoded = image::load_from_memory(&optimized)
            .expect("decode")
            .into_rgb8();
        let pixel = decoded.get_pixel(4, 4);
        assert!(
            pixel[0] > 180 && pixel[1] < 40 && pixel[2] < 40,
            "{pixel:?}"
        );
    }

    #[test]
    fn oversized_rasters_downscale_to_print_resolution() {
        // Oversized webp comes back as a print-resolution JPEG.
        let optimized = optimize_pdf_image_bytes(webp_fixture(2400, 60, [0, 0, 200, 255]));
        assert_eq!(typst_image_extension(&optimized), Some("jpg"));
        let (width, _) = jpeg_dimensions(&optimized).expect("jpeg dimensions");
        assert_eq!(width, PDF_IMAGE_MAX_WIDTH);
        // Oversized png downscales but stays png, so line art keeps its format.
        let optimized = optimize_pdf_image_bytes(png_fixture(2400, 60));
        assert_eq!(typst_image_extension(&optimized), Some("png"));
        let aspect = typst_image_aspect(&optimized).expect("png aspect");
        assert!((aspect - 60.0 / 2400.0).abs() < 0.01);
        // Oversized jpeg without EXIF is re-encoded at print resolution.
        let optimized = optimize_pdf_image_bytes(jpeg_fixture(2400, 60));
        let (width, _) = jpeg_dimensions(&optimized).expect("jpeg dimensions");
        assert_eq!(width, PDF_IMAGE_MAX_WIDTH);
    }

    #[test]
    fn print_sized_images_and_exif_jpegs_pass_through_untouched() {
        let png = png_fixture(300, 200);
        assert_eq!(optimize_pdf_image_bytes(png.clone()), png);
        let jpeg = jpeg_fixture(300, 200);
        assert_eq!(optimize_pdf_image_bytes(jpeg.clone()), jpeg);
        let svg =
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="9000"/>"##.to_vec();
        assert_eq!(optimize_pdf_image_bytes(svg.clone()), svg);
        // An oversized jpeg carrying EXIF keeps its bytes: re-encoding would
        // drop the orientation tag and turn rotated camera photos sideways.
        let mut exif = jpeg_fixture(2400, 60);
        let app1 = [0xff, 0xe1, 0x00, 0x08, b'E', b'x', b'i', b'f', 0x00, 0x00];
        exif.splice(2..2, app1.iter().copied());
        assert_eq!(optimize_pdf_image_bytes(exif.clone()), exif);
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
        // Tall enough that full text width would overflow the page, so the compile
        // exercises the caption-measuring height cap, not just the natural-size path.
        fs::write(
            &smoke_image,
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="80" height="400"><rect width="80" height="400" fill="#c87900"/></svg>"##,
        )
        .expect("write smoke image");
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "Kiểm tra PDF tiếng Việt".to_string(),
            language_code: "vi".to_string(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "heading1".to_string(),
                    text: "Một <b>tiêu đề tiếng Việt</b>".to_string(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".to_string(),
                    // Starts with an opening quote and decomposed Ứ. The export
                    // must normalize it and pass only Ứ—not “Ứ—to metric callbacks.
                    text: "“U\u{031b}\u{0301}ng dụng tiếng Việt <i>ấ ề ỗ ở ữ</i>, một <a href=\"https://example.com\">liên kết</a> và chú thích giữa đoạn [1]."
                        .to_string(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".to_string(),
                    // Greek falls back to EB Garamond; γάμος carries the mu that
                    // Cormorant does have, which is what split the word before.
                    text: "Chữ Hy Lạp: Ἡ ἀρχὴ καὶ γάμος, ρίζα, ἔργα.".to_string(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".to_string(),
                    // Han and pointed Hebrew quoted inside a Vietnamese chapter: both
                    // are pulled in by the content scan, not the declared language.
                    text: "Ông 伏羲, danh xưng אֱלֹהִים, và ॐ भूर्भुवः स्वः.".to_string(),
                },
                ExportBlock::Text {
                    text_style: "quote".to_string(),
                    text: "A quoted passage".to_string(),
                },
                ExportBlock::Attribution { text: "Quote Author".to_string() },
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
                    text: "Một chú thích tiếng Việt".to_string(),
                },
                ExportBlock::Image {
                    image: ExportImage::Upload {
                        repo_relative_path: "smoke.svg".to_string(),
                        raw_url: None,
                        absolute_path: smoke_image.clone(),
                    },
                    caption: "An <b>italic caption</b> long enough to wrap across several lines on an A4 page, so the export must measure it and shrink the tall image by exactly the height these words occupy instead of overflowing past the bottom margin.".to_string(),
                },
                ExportBlock::Image {
                    image: ExportImage::Url("http://127.0.0.1/unavailable.png".to_string()),
                    caption: "Unavailable remote image".to_string(),
                },
                // Uncaptioned images take the caption-less floating-figure path.
                ExportBlock::Image {
                    image: ExportImage::Upload {
                        repo_relative_path: "smoke.svg".to_string(),
                        raw_url: None,
                        absolute_path: smoke_image,
                    },
                    caption: String::new(),
                },
            ],
        };
        let image_cache_session = begin_pdf_image_cache(&test_image_cache_scope("smoke-chapter"));
        let options = PdfWorkspacePreparationOptions {
            footnote_links_as_plain_text: true,
            paper_size: "a4",
            image_cache_session: &image_cache_session,
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
        .expect("render Typst source");
        let chapter_path = workspace.join("chapter.typ");
        let mut source = fs::read_to_string(&chapter_path).expect("read generated Typst");
        let generated_dropcap = source
            .lines()
            .find(|line| line.starts_with("#gnosis-dropcap["))
            .expect("generated drop cap");
        assert!(generated_dropcap.contains("“Ứng dụng"));
        assert!(!source.contains("U\u{031b}\u{0301}"));
        // Exercise the vendored helper directly: punctuation stays in the
        // rendered cap, while both callbacks must receive the core grapheme.
        source.push_str(
            r#"
#let gnosis-test-base(letter) = {
  assert(letter == "Ứ")
  "U"
}
#let gnosis-test-gap(letter) = {
  assert(letter == "Ứ")
  0.35em
}
#dropcap(
  height: 3,
  gap: gnosis-test-gap,
  sizing-transform: gnosis-test-base,
  font: ("Great Vibes", "Crimson Pro"),
)[“Ứng dụng kiểm tra dấu câu.]
"#,
        );
        fs::write(&chapter_path, source).expect("extend Typst smoke source");
        let output = std::process::Command::new(typst_binary)
            .args([
                "compile",
                "--root",
                workspace.to_str().expect("workspace path"),
                "--font-path",
                Path::new(&font_dir).to_str().expect("font path"),
                "--ignore-system-fonts",
                "--package-path",
                workspace.join("packages").to_str().expect("package path"),
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

    #[test]
    fn list_rows_render_as_nested_native_typst_lists() {
        let items = list_items("One\n\t<b>Two</b>\n\t\tThree\nFour");
        let inline = items
            .iter()
            .map(|item| render_inline_typst(&item.text, false))
            .collect::<Vec<_>>();
        assert_eq!(
            render_typst_list(ListKind::Number, &items, &inline),
            "#enum(numbering: \"1.\", [#text(\"One\")#enum(numbering: \"a.\", [#strong[#text(\"Two\")]#enum(numbering: \"i.\", [#text(\"Three\")], )], )], [#text(\"Four\")], )"
        );
        assert_eq!(
            render_typst_list(ListKind::Roman, &items[..2], &inline),
            "#enum(numbering: \"I.\", [#text(\"One\")#enum(numbering: \"A.\", [#strong[#text(\"Two\")]], )], )"
        );
        let bullets = render_typst_list(ListKind::Bullet, &items[..3], &inline);
        assert!(bullets.starts_with(&format!(
            "#list(marker: {}, [#text(\"One\")#list(marker: {}, [",
            typst_list_marker(ListLevelFormat::Disc),
            typst_list_marker(ListLevelFormat::Circle)
        )));
        assert!(bullets.contains(&format!(
            "#list(marker: {}, [#text(\"Three\")], )",
            typst_list_marker(ListLevelFormat::Square)
        )));
        assert_eq!(
            typst_list_numbering(ListLevelFormat::LowerAlpha),
            Some("a.")
        );
        assert_eq!(typst_list_numbering(ListLevelFormat::Disc), None);

        let list = render_typst_list(ListKind::Letter, &items[..1], &inline);
        assert_eq!(
            render_typst_text_block("list_letter", &list, false, false),
            format!("{list}\n\n")
        );
        assert_eq!(
            render_typst_cited_text_block("list_letter", &list, "Citation", false),
            None
        );
        // A list never opens with a drop cap.
        assert_eq!(
            dropcap_block_index(&[text_block("list_bullet", "Apples")], &[0], false),
            None
        );
    }

    #[test]
    fn list_items_share_their_block_footnotes() {
        let footnotes = vec![
            (2, "Second".to_string()),
            (1, "First".to_string()),
            (3, "Unmarked".to_string()),
        ];
        let parts = render_inline_typst_parts_with_footnotes(
            &["a [2]", "b [1] and [2] again", "c"],
            &footnotes,
            false,
        );
        assert_eq!(
            parts,
            vec![
                "#text(\"a \")#footnote[#text(\"Second\")]".to_string(),
                "#text(\"b \")#footnote[#text(\"First\")]#text(\" and [2] again\")".to_string(),
                "#text(\"c\")#footnote[#text(\"Unmarked\")]".to_string(),
            ]
        );
        assert_eq!(
            render_inline_typst_with_footnotes("Text [1]", &footnotes, false),
            "#text(\"Text \")#footnote[#text(\"First\")]#super[,]#footnote[#text(\"Second\")]#super[,]#footnote[#text(\"Unmarked\")]"
        );
    }

    #[test]
    fn list_rows_compile_in_the_pdf_export() {
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let document = ExportDocument {
            title: "Lists".into(),
            language_code: "en".into(),
            blocks: vec![
                text_block(
                    "list_number",
                    "Numbers [1]\n\tLetters\n\t\tNumerals\n\t\t\tNumbers again\nTwo",
                ),
                ExportBlock::Footnote {
                    number: 1,
                    marker: 1,
                    anchor_block: Some(0),
                    text: "A note in a list.".into(),
                },
                text_block("paragraph", "A paragraph after a list."),
                text_block(
                    "list_bullet",
                    "Disc\n\tCircle\n\t\tSquare\n\t\t\tDisc again",
                ),
                text_block("list_letter", "a\n\ti\n\t\t1"),
                text_block(
                    "list_roman",
                    "I\n\tA\n\t\t1\n\t\t\ta\n\t\t\t\ti\n\t\t\t\t\tI again",
                ),
                text_block("paragraph", "The end."),
            ],
            book_parts: Vec::new(),
        };
        let session = begin_pdf_image_cache(&test_image_cache_scope("list-rows"));
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
        let source = fs::read_to_string(workspace.join("chapter.typ")).unwrap();
        assert!(source.contains(
            "#set par(first-line-indent: (amount: 0pt, all: true))\n#enum(numbering: \"1.\", [#text(\"Numbers \")#footnote[#text(\"A note in a list.\")]#enum(numbering: \"a.\", "
        ));
        // A list is not a plain paragraph: it takes no drop cap, and the
        // paragraph after it starts flush, as after a quote.
        assert!(!source.contains("#gnosis-dropcap["));
        assert!(source.contains(
            "#set par(first-line-indent: (amount: 0pt, all: true))\n#text(\"A paragraph after a list.\")"
        ));
        assert!(source.contains("#enum(numbering: \"I.\", [#text(\"I\")#enum(numbering: \"A.\", "));
        assert!(source.contains("#list(marker: box("));
        let (Some(binary), Some(fonts)) = (
            std::env::var_os("GNOSIS_TYPST_BIN"),
            std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR"),
        ) else {
            return;
        };
        let pdf = workspace.join("lists.pdf");
        let output = std::process::Command::new(&binary)
            .args(["compile", "--ignore-system-fonts", "--font-path"])
            .arg(&fonts)
            .arg("--root")
            .arg(&workspace)
            .arg("--package-path")
            .arg(workspace.join("packages"))
            .arg(workspace.join("chapter.typ"))
            .arg(&pdf)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        if let Some(destination) = std::env::var_os("GNOSIS_LIST_SMOKE_OUTPUT") {
            fs::copy(&pdf, PathBuf::from(destination)).unwrap();
        }
    }
}
