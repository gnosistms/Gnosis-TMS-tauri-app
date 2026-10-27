use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BookPreviewFontsInput {
    request_id: String,
    language_code: String,
    #[serde(default)]
    texts: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserFont {
    family: String,
    file_path: String,
    style: &'static str,
    weight: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewTypography {
    body_families: Vec<String>,
    heading_families: Vec<String>,
    direction: &'static str,
    body_size_pt: f64,
    line_height: f64,
    front_matter_line_height: f64,
    footnote_line_height: f64,
    heading_line_height: f64,
    word_spacing_em: f64,
    latin: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FontsReady {
    request_id: String,
    fonts: Vec<BrowserFont>,
    profile: Option<PreviewTypography>,
    error: String,
}

/// Returns immediately. `book-preview-fonts` delivers the cached print font
/// paths and their typography metrics, or an error, keyed by requestId.
pub(crate) fn start_project_book_preview_fonts(
    app: AppHandle,
    input: BookPreviewFontsInput,
) -> Result<(), String> {
    if input.request_id.is_empty() || input.language_code.is_empty() {
        return Err("Choose the preview language first.".into());
    }
    static ACTIVE: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
    let cancelled = Arc::new(AtomicBool::new(false));
    let mut active = ACTIVE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Could not prepare preview fonts. Please try again.".to_string())?;
    if let Some(previous) = active.replace(cancelled.clone()) {
        previous.store(true, Ordering::Release);
    }
    let worker_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let request_id = input.request_id.clone();
        let worker_cancelled = cancelled.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let document = ExportDocument {
                title: String::new(),
                language_code: input.language_code,
                blocks: input
                    .texts
                    .into_iter()
                    .map(|text| ExportBlock::Text {
                        text_style: "paragraph".into(),
                        text,
                    })
                    .collect(),
                book_parts: Vec::new(),
            };
            let assets = required_fonts_for_document(&document);
            let font_dir = ensure_fonts(
                &worker_app,
                &input.request_id,
                assets.clone(),
                &worker_cancelled,
            )?;
            let profile = typography(&document, &font_dir)?;
            let fonts = assets
                .iter()
                .map(|asset| BrowserFont {
                    family: asset.family.into(),
                    file_path: font_dir
                        .join(asset.file_name)
                        .to_string_lossy()
                        .into_owned(),
                    style: if asset.file_name.contains("Italic") {
                        "italic"
                    } else {
                        "normal"
                    },
                    weight: if asset.file_name.contains("Bold") {
                        "700"
                    } else if matches!(asset.family, "Great Vibes" | "Shippori Mincho") {
                        "400"
                    } else {
                        "100 900"
                    },
                })
                .collect();
            Ok::<_, String>((fonts, profile))
        })
        .await
        .map_err(|_| "Could not prepare preview fonts. Please try again.".to_string())
        .and_then(|result| result);
        if cancelled.load(Ordering::Acquire) {
            return;
        }
        let (fonts, profile, error) = match result {
            Ok((fonts, profile)) => (fonts, Some(profile), String::new()),
            Err(error) => (Vec::new(), None, error),
        };
        let _ = app.emit(
            "book-preview-fonts",
            FontsReady {
                request_id,
                fonts,
                profile,
                error,
            },
        );
    });
    Ok(())
}

fn font_metrics(font_dir: &Path, family: &str) -> Result<(f64, f64), String> {
    let asset = FONT_ASSETS
        .iter()
        .find(|asset| {
            asset.family == family
                && !asset.file_name.contains("Italic")
                && !asset.file_name.contains("Bold")
        })
        .ok_or_else(|| "The PDF preview font is unavailable.".to_string())?;
    let bytes = fs::read(font_dir.join(asset.file_name))
        .map_err(|_| "Could not read the PDF preview font.".to_string())?;
    let face = ttf_parser::Face::parse(&bytes, 0)
        .map_err(|_| "Could not read the PDF preview font metrics.".to_string())?;
    let units = f64::from(face.units_per_em());
    let cap = face
        .capital_height()
        .filter(|height| *height > 0)
        .map(f64::from)
        .unwrap_or(units * 0.7)
        / units;
    let space = face
        .glyph_index(' ')
        .and_then(|glyph| face.glyph_hor_advance(glyph))
        .map(f64::from)
        .unwrap_or(units * 0.25)
        / units;
    Ok((cap, space))
}

fn typography(document: &ExportDocument, font_dir: &Path) -> Result<PreviewTypography, String> {
    let (families, direction, body_size_pt, leading) = body_font_style(document);
    let headings = heading_font_families(document);
    let (cap, space) = font_metrics(font_dir, families[0])?;
    let (heading_cap, _) = font_metrics(font_dir, headings[0])?;
    let latin = latin_body(&document.language_code);
    Ok(PreviewTypography {
        body_families: families.into_iter().map(String::from).collect(),
        heading_families: headings.into_iter().map(String::from).collect(),
        direction,
        body_size_pt,
        line_height: cap + leading,
        front_matter_line_height: cap + 0.68,
        footnote_line_height: cap + 0.5,
        heading_line_height: heading_cap + leading,
        word_spacing_em: if latin { space * 0.1 } else { 0.0 },
        latin,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_metrics_come_from_the_actual_print_fonts() {
        let Some(font_dir) = std::env::var_os("GNOSIS_TYPST_SMOKE_FONT_DIR") else {
            return;
        };
        let document = ExportDocument {
            title: String::new(),
            language_code: "vi".into(),
            blocks: Vec::new(),
            book_parts: Vec::new(),
        };
        let profile = typography(&document, Path::new(&font_dir)).unwrap();
        assert_eq!(profile.body_families[0], "Crimson Pro");
        assert_eq!(profile.heading_families[0], "Alegreya");
        assert_eq!(profile.body_size_pt, 11.5);
        assert!((profile.line_height - 1.3532421875).abs() < 0.00001);
        assert!((profile.front_matter_line_height - 1.2532421875).abs() < 0.00001);
        assert!(profile.word_spacing_em > 0.0 && profile.word_spacing_em < 0.1);
    }
}
