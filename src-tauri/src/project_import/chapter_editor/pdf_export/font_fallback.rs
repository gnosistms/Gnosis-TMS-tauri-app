//! Installed fonts are inspected locally and used in place. Review and publication
//! use explicit family choices for the affected characters.
use super::*;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Default)]
pub(super) struct FontFallbackPlan {
    pub fonts: Vec<ResolvedFont>,
    pub missing: BTreeSet<char>,
    pub unresolved: BTreeSet<String>,
}

#[derive(Clone)]
pub(super) struct ResolvedFont {
    pub family: String,
    pub clusters: BTreeSet<String>,
    pub path: PathBuf,
    style: &'static str,
    weight: u16,
    stretch_percent: f64,
}

/// An approval belongs to a font face, rather than a document or a set of glyphs.
/// It remains valid for other characters covered by that same installed face.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FontChoice {
    family: String,
    style: String,
    weight: u16,
    stretch_percent: f64,
}

impl FontChoice {
    pub fn id(&self) -> String {
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(self).unwrap_or_default())
        )
    }

    pub fn family(&self) -> &str {
        &self.family
    }
}

impl ResolvedFont {
    pub fn choice(&self) -> FontChoice {
        FontChoice {
            family: self.family.clone(),
            style: self.style.to_string(),
            weight: self.weight,
            stretch_percent: self.stretch_percent,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CoverageDiagnostic {
    pub primary_families: Vec<String>,
    pub fallback_families: Vec<String>,
    pub unicode_blocks: Vec<String>,
    pub missing_character_count: usize,
    pub recovered: bool,
}

// Format controls and variation selectors affect shaping but do not require an
// independent cmap glyph. Base characters and combining marks still do.
fn needs_glyph(ch: char) -> bool {
    !ch.is_control()
        && !ch.is_whitespace()
        && !matches!(ch as u32,
        0x00AD | 0x034F | 0x061C | 0x180B..=0x180F | 0x200B..=0x200F |
        0x202A..=0x202E | 0x2060..=0x206F | 0xFE00..=0xFE0F | 0xFEFF |
        0x13430..=0x13455 | 0xE0000..=0xE0FFF)
}

// Each entry corresponds to a separately styled text node emitted by
// render_styled_typst_text. Regex show rules cannot cross these boundaries.
fn rendered_runs(text: &str, show_link_urls: bool) -> Vec<String> {
    let mut result = Vec::new();
    for segment in inline_segments(&text.nfc().collect::<String>()) {
        result.push(segment.text);
        if show_link_urls {
            if let Some(link) = segment.style.link {
                result.push(format!("({link})"));
            }
        }
    }
    result
}

fn rendered_texts(document: &ExportDocument, show_link_urls: bool) -> Vec<String> {
    let mut texts = vec![leading_heading_title(document)
        .unwrap_or_else(|| document.title.clone())
        .nfc()
        .collect::<String>()
        .to_uppercase()];
    for block in &document.blocks {
        match block {
            ExportBlock::Text { text, .. }
            | ExportBlock::Attribution { text }
            | ExportBlock::Image { caption: text, .. } => texts.extend(rendered_runs(text, false)),
            ExportBlock::Footnote { text, .. } => texts.extend(rendered_runs(text, show_link_urls)),
            ExportBlock::Separator => {}
        }
    }
    texts
}

struct CachedCoverage {
    size: u64,
    modified: Option<std::time::SystemTime>,
    bits: Arc<Vec<u64>>,
}

// A complete Unicode coverage bitset occupies 136 KiB, even for large CJK fonts.
// Keep coverage rather than entire font files in memory. The pinned font-cache
// revision and file metadata invalidate entries when the underlying font changes.
fn font_coverage(path: &Path) -> Result<Arc<Vec<u64>>, String> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedCoverage>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let error = || "A required PDF font is missing. Try the export again.".to_string();
    let metadata = fs::metadata(path).map_err(|_| error())?;
    let modified = metadata.modified().ok();
    if let Ok(entries) = cache.lock() {
        if let Some(entry) = entries
            .get(path)
            .filter(|entry| entry.size == metadata.len() && entry.modified == modified)
        {
            return Ok(entry.bits.clone());
        }
    }
    let bytes = fs::read(path).map_err(|_| error())?;
    let face = ttf_parser::Face::parse(&bytes, 0).map_err(|_| error())?;
    let mut bits = vec![0u64; 0x110000 / 64];
    for table in face
        .tables()
        .cmap
        .into_iter()
        .flat_map(|cmap| cmap.subtables)
        .filter(|table| table.is_unicode())
    {
        table.codepoints(|code| {
            if code < 0x110000
                && char::from_u32(code).is_some_and(|ch| face.glyph_index(ch).is_some())
            {
                bits[code as usize / 64] |= 1 << (code % 64);
            }
        });
    }
    let bits = Arc::new(bits);
    if let Ok(mut entries) = cache.lock() {
        entries.insert(
            path.to_path_buf(),
            CachedCoverage {
                size: metadata.len(),
                modified,
                bits: bits.clone(),
            },
        );
    }
    Ok(bits)
}

fn missing_from_texts(
    texts: &[String],
    document: &ExportDocument,
    font_dir: &Path,
    cancelled: &AtomicBool,
) -> Result<BTreeSet<char>, String> {
    let mut uncovered: BTreeSet<char> = texts
        .iter()
        .flat_map(|text| text.chars())
        .filter(|ch| needs_glyph(*ch))
        .collect();
    for asset in required_fonts_for_document(document) {
        check_cancelled(cancelled)?;
        if uncovered.is_empty() {
            break;
        }
        let bits = font_coverage(&font_dir.join(asset.file_name))?;
        uncovered.retain(|ch| bits[*ch as usize / 64] & (1 << (*ch as u32 % 64)) == 0);
    }
    Ok(uncovered)
}

/// Coverage only: no installed-font discovery or fallback selection. Safe for the
/// export dialog's background inspection as well as the real export preflight.
pub(super) fn missing_characters(
    document: &ExportDocument,
    font_dir: &Path,
    show_link_urls: bool,
    cancelled: &AtomicBool,
) -> Result<BTreeSet<char>, String> {
    missing_from_texts(
        &rendered_texts(document, show_link_urls),
        document,
        font_dir,
        cancelled,
    )
}

pub(super) fn resolve(
    document: &ExportDocument,
    font_dir: &Path,
    show_link_urls: bool,
    approved: &[FontChoice],
    cancelled: &AtomicBool,
) -> Result<FontFallbackPlan, String> {
    let texts = rendered_texts(document, show_link_urls);
    let uncovered = missing_from_texts(&texts, document, font_dir, cancelled)?;
    let clusters = fallback_clusters(&texts, &uncovered);
    if uncovered.is_empty() {
        return Ok(FontFallbackPlan::default());
    }
    resolve_from_files(
        uncovered,
        clusters,
        &installed_font_files(cancelled)?,
        approved,
        cancelled,
    )
}

fn fallback_clusters(texts: &[String], missing: &BTreeSet<char>) -> BTreeSet<String> {
    texts
        .iter()
        .flat_map(|text| text.graphemes(true))
        .filter(|cluster| cluster.chars().any(|ch| missing.contains(&ch)))
        .map(str::to_owned)
        .collect()
}

fn font_family(face: &ttf_parser::Face<'_>) -> Option<String> {
    // Keep name decoding and style stripping aligned with bundled Typst 0.15.1:
    // https://github.com/typst/typst/blob/v0.15.1/crates/typst-library/src/text/font/info.rs
    // Name ID 16 groups some display faces that Typst keeps separate.
    let name = face
        .names()
        .into_iter()
        .filter(|name| name.name_id == ttf_parser::name_id::FAMILY)
        .filter_map(decode_font_name)
        .find(|name| !name.trim().is_empty())?;
    let family = typst_family_name(&name);
    (!family.is_empty() && !family.eq_ignore_ascii_case("LastResort")).then(|| family.to_string())
}

fn decode_font_name(name: ttf_parser::name::Name<'_>) -> Option<String> {
    name.to_string().or_else(|| {
        (name.platform_id == ttf_parser::PlatformId::Macintosh && name.encoding_id == 0).then(
            || {
                encoding_rs::MACINTOSH
                    .decode_without_bom_handling(name.name)
                    .0
                    .into_owned()
            },
        )
    })
}

fn typst_family_name(name: &str) -> &str {
    const SEPARATORS: [char; 3] = [' ', '-', '_'];
    const MODIFIERS: &[&str] = &[
        "extra", "ext", "ex", "x", "semi", "sem", "sm", "demi", "dem", "ultra",
    ];
    const SUFFIXES: &[&str] = &[
        "normal",
        "italic",
        "oblique",
        "slanted",
        "thin",
        "th",
        "hairline",
        "light",
        "lt",
        "regular",
        "medium",
        "med",
        "md",
        "bold",
        "bd",
        "demi",
        "extb",
        "black",
        "blk",
        "bk",
        "heavy",
        "narrow",
        "condensed",
        "cond",
        "cn",
        "cd",
        "compressed",
        "expanded",
        "exp",
        "vf",
        "var",
        "variable",
    ];
    let family = name.trim().trim_start_matches('.');
    let lower = family.to_ascii_lowercase();
    let mut end = family.len();
    loop {
        let original_end = end;
        let mut candidate = &lower[..end];
        while let Some(shorter) = SUFFIXES
            .iter()
            .find_map(|suffix| candidate.strip_suffix(suffix))
        {
            candidate = shorter;
        }
        if candidate.len() == end {
            break;
        }
        if let Some(shorter) = candidate.strip_suffix(SEPARATORS) {
            end = shorter.len();
            candidate = shorter;
        }
        if let Some(shorter) = MODIFIERS
            .iter()
            .find_map(|modifier| candidate.strip_suffix(modifier))
            .and_then(|prefix| prefix.strip_suffix(SEPARATORS))
        {
            end = shorter.len();
        }
        // A style-like ending inside a family word is not a face suffix.
        if end == original_end {
            break;
        }
    }
    &family[..end]
}

fn embeddable(face: &ttf_parser::Face<'_>) -> bool {
    matches!(
        face.permissions(),
        Some(
            ttf_parser::Permissions::Installable
                | ttf_parser::Permissions::PreviewAndPrint
                | ttf_parser::Permissions::Editable
        )
    ) && face.is_subsetting_allowed()
        && face.is_outline_embedding_allowed()
        && (face.tables().glyf.is_some()
            || face.tables().cff.is_some()
            || face.tables().cff2.is_some())
}

fn resolve_from_files(
    missing: BTreeSet<char>,
    mut unresolved: BTreeSet<String>,
    files: &[PathBuf],
    approved: &[FontChoice],
    cancelled: &AtomicBool,
) -> Result<FontFallbackPlan, String> {
    let mut candidates = Vec::new();
    for path in files {
        check_cancelled(cancelled)?;
        let Ok(bytes) = fs::read(path) else { continue };
        for index in 0..ttf_parser::fonts_in_collection(&bytes).unwrap_or(1) {
            let Ok(face) = ttf_parser::Face::parse(&bytes, index) else {
                continue;
            };
            if !embeddable(&face) {
                continue;
            }
            let Some(family) = font_family(&face) else {
                continue;
            };
            let clusters: BTreeSet<String> = unresolved
                .iter()
                .filter(|cluster| {
                    cluster
                        .chars()
                        .filter(|ch| needs_glyph(*ch))
                        .all(|ch| face.glyph_index(ch).is_some())
                })
                .cloned()
                .collect();
            if !clusters.is_empty() {
                // Prefer one face for as much of the missing script as possible.
                // Stable file order breaks ties; normal faces precede italics.
                candidates.push((
                    face.is_italic(),
                    ResolvedFont {
                        family,
                        clusters,
                        path: path.clone(),
                        style: if face.is_italic() {
                            "italic"
                        } else if face.is_oblique() {
                            "oblique"
                        } else {
                            "normal"
                        },
                        weight: face.weight().to_number(),
                        stretch_percent: match face.width().to_number() {
                            1 => 50.0,
                            2 => 62.5,
                            3 => 75.0,
                            4 => 87.5,
                            6 => 112.5,
                            7 => 125.0,
                            8 => 150.0,
                            9 => 200.0,
                            _ => 100.0,
                        },
                    },
                ));
            }
        }
    }
    let mut fonts = Vec::new();
    while !unresolved.is_empty() {
        check_cancelled(cancelled)?;
        let best = candidates
            .iter()
            .enumerate()
            .map(|(i, (italic, font))| {
                (
                    approved.contains(&font.choice()),
                    font.clusters.intersection(&unresolved).count(),
                    !italic,
                    i,
                )
            })
            .filter(|(_, count, _, _)| *count > 0)
            .max_by(|a, b| {
                a.0.cmp(&b.0)
                    .then(a.1.cmp(&b.1))
                    .then(a.2.cmp(&b.2))
                    .then(b.3.cmp(&a.3))
            });
        let Some((_, _, _, index)) = best else { break };
        let (_, mut font) = candidates.remove(index);
        font.clusters.retain(|cluster| unresolved.remove(cluster));
        fonts.push(font);
    }
    Ok(FontFallbackPlan {
        fonts,
        missing,
        unresolved,
    })
}

fn installed_font_files(cancelled: &AtomicBool) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    #[cfg(target_os = "macos")]
    roots.extend([
        PathBuf::from("/System/Library/Fonts"),
        PathBuf::from("/Library/Fonts"),
    ]);
    #[cfg(target_os = "windows")]
    {
        if let Some(windir) = std::env::var_os("WINDIR") {
            roots.push(PathBuf::from(windir).join("Fonts"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            roots.push(PathBuf::from(local).join("Microsoft/Windows/Fonts"));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    roots.extend([
        PathBuf::from("/usr/share/fonts"),
        PathBuf::from("/usr/local/share/fonts"),
    ]);
    if let Some(home) = std::env::var_os(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    }) {
        let root = PathBuf::from(home);
        if cfg!(target_os = "macos") {
            roots.push(root.join("Library/Fonts"));
        }
        if cfg!(target_os = "linux") {
            roots.push(root.join(".fonts"));
            roots.push(root.join(".local/share/fonts"));
        }
    }
    let mut visited = HashSet::new();
    let mut files = BTreeSet::new();
    while let Some(root) = roots.pop() {
        check_cancelled(cancelled)?;
        let Ok(root) = root.canonicalize() else {
            continue;
        };
        if !visited.insert(root.clone()) {
            continue;
        }
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                roots.push(path);
            } else if path.extension().and_then(|s| s.to_str()).is_some_and(|s| {
                matches!(
                    s.to_ascii_lowercase().as_str(),
                    "ttf" | "otf" | "ttc" | "otc"
                )
            }) {
                files.insert(path);
            }
        }
    }
    let mut files: Vec<_> = files.into_iter().collect();
    // Noto faces provide broad script coverage without borrowing decorative or
    // symbol-encoded glyphs from display fonts. Remaining order is deterministic.
    files.sort_by_key(|path| {
        (
            !path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
                .starts_with("noto"),
            path.clone(),
        )
    });
    Ok(files)
}

impl FontFallbackPlan {
    pub fn unapproved(&self, approved: &[FontChoice]) -> Self {
        let fonts: Vec<_> = self
            .fonts
            .iter()
            .filter(|font| !approved.contains(&font.choice()))
            .cloned()
            .collect();
        let characters: BTreeSet<_> = fonts
            .iter()
            .flat_map(|font| font.clusters.iter())
            .flat_map(|cluster| cluster.chars())
            .collect();
        Self {
            fonts,
            missing: self.missing.intersection(&characters).copied().collect(),
            unresolved: self.unresolved.clone(),
        }
    }

    pub fn affected(&self, text: &str, show_link_urls: bool) -> bool {
        let runs = rendered_runs(text, show_link_urls);
        if self.fonts.is_empty() {
            return runs
                .iter()
                .flat_map(|run| run.chars())
                .any(|ch| self.missing.contains(&ch));
        }
        runs.iter()
            .flat_map(|run| run.graphemes(true))
            .any(|cluster| {
                self.fonts
                    .iter()
                    .any(|font| font.clusters.contains(cluster))
            })
    }

    pub fn rules(&self, highlight: bool) -> String {
        self.rules_with_highlights(|_| highlight)
    }

    pub fn review_rules(&self, review: &Self) -> String {
        self.rules_with_highlights(|font| {
            review
                .fonts
                .iter()
                .any(|candidate| candidate.choice() == font.choice())
        })
    }

    fn rules_with_highlights(&self, highlight: impl Fn(&ResolvedFont) -> bool) -> String {
        let mut rules = String::new();
        for font in &self.fonts {
            // Select the face whose coverage and embedding rights were checked.
            // An unrelated bold/italic face in the same family may lack a glyph.
            let body = format!(
                "text(font: {}, style: {}, weight: {}, stretch: {}%, fallback: false, it)",
                typst_string(&font.family),
                typst_string(font.style),
                font.weight,
                font.stretch_percent,
            );
            for starts_with_mark in [false, true] {
                let pattern = font
                    .clusters
                    .iter()
                    .filter(|cluster| {
                        cluster
                            .chars()
                            .next()
                            .is_some_and(unicode_normalization::char::is_combining_mark)
                            == starts_with_mark
                    })
                    .map(|s| regex::escape(s))
                    .collect::<Vec<_>>()
                    .join("|");
                if pattern.is_empty() {
                    continue;
                }
                let body = if highlight(font) {
                    // An isolated combining mark can have zero advance. Give its
                    // review highlight visible width without changing text layout.
                    let extent = if starts_with_mark {
                        ", extent: 0.35em"
                    } else {
                        ""
                    };
                    format!("highlight(fill: rgb(\"fff0a6\"){extent}, {body})")
                } else {
                    body.clone()
                };
                rules.push_str(&format!(
                    "#show regex({}): it => {body}\n",
                    typst_string(&pattern)
                ));
            }
        }
        rules
    }

    pub fn diagnostic(&self, document: &ExportDocument) -> CoverageDiagnostic {
        CoverageDiagnostic {
            primary_families: required_fonts_for_document(document)
                .iter()
                .map(|a| a.family.to_string())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            fallback_families: self
                .fonts
                .iter()
                .map(|f| f.family.clone())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            unicode_blocks: self
                .missing
                .iter()
                .map(|ch| unicode_block(*ch).to_string())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            missing_character_count: self.missing.len(),
            recovered: self.unresolved.is_empty(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.unresolved.is_empty() {
            return Ok(());
        }
        let labels = self
            .unresolved
            .iter()
            .flat_map(|s| s.chars())
            .filter(|ch| self.missing.contains(ch))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .take(8)
            .map(|ch| format!("{ch} (U+{:04X})", ch as u32))
            .collect::<Vec<_>>()
            .join(", ");
        Err(format!("No installed font suitable for PDF embedding could render these characters: {labels}. Install a font that supports them, then try again, or export as DOCX or HTML."))
    }
}

fn unicode_block(ch: char) -> &'static str {
    match ch as u32 {
        0x13000..=0x1345F => "Egyptian Hieroglyphs",
        0x13460..=0x143FF => "Egyptian Hieroglyphs Extended-A",
        0x0000..=0x024F | 0x1E00..=0x1EFF => "Latin",
        0x0300..=0x036F => "Combining Diacritical Marks",
        0x0370..=0x03FF | 0x1F00..=0x1FFF => "Greek",
        0x0400..=0x052F => "Cyrillic",
        0x0590..=0x05FF | 0xFB1D..=0xFB4F => "Hebrew",
        0x0600..=0x08FF | 0xFB50..=0xFDFF | 0xFE70..=0xFEFF => "Arabic",
        0x0900..=0x097F | 0xA8E0..=0xA8FF | 0x1CD0..=0x1CFF => "Devanagari",
        0x2000..=0x2BFF => "Punctuation and Symbols",
        0x3400..=0x9FFF | 0xF900..=0xFAFF | 0x20000..=0x323AF => "CJK Ideographs",
        0x1F000..=0x1FAFF => "Emoji and Pictographs",
        _ => "Other Unicode blocks",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn font_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/fonts/CormorantGaramondGnosis-Roman.ttf")
    }

    #[test]
    fn renderer_family_names_strip_abbreviations_and_separated_modifiers() {
        for (name, expected) in [
            ("Noto Sans Armenian Blk", "Noto Sans Armenian"),
            ("Noto Sans Myanmar ExtBd", "Noto Sans Myanmar"),
            ("Noto Serif Myanmar ExtLt", "Noto Serif Myanmar"),
            ("Noto Sans Myanmar SemBd", "Noto Sans Myanmar"),
            ("Noto Sans Myanmar Med", "Noto Sans Myanmar"),
            ("Avenir Next Condensed Demi Bold", "Avenir Next"),
            (" .Example-ExtraLight_Italic ", "Example"),
            ("Noto Sans EgyptHiero", "Noto Sans EgyptHiero"),
            ("Footlight", "Footlight"),
            ("Font Ultra", "Font Ultra"),
            ("宋體-繁", "宋體-繁"),
        ] {
            assert_eq!(typst_family_name(name), expected, "{name}");
        }
    }

    #[test]
    fn renderer_name_decoding_includes_mac_roman_records() {
        let mac_name = ttf_parser::name::Name {
            platform_id: ttf_parser::PlatformId::Macintosh,
            encoding_id: 0,
            language_id: 0,
            name_id: ttf_parser::name_id::FAMILY,
            name: b"Gurmukhi MT",
        };
        assert_eq!(mac_name.to_string(), None, "ttf-parser omits legacy names");
        assert_eq!(decode_font_name(mac_name).as_deref(), Some("Gurmukhi MT"));
        assert_eq!(
            decode_font_name(ttf_parser::name::Name {
                name: b"Caf\x8e",
                ..mac_name
            })
            .as_deref(),
            Some("Café")
        );
        let unicode: Vec<_> = "Localized name"
            .encode_utf16()
            .flat_map(u16::to_be_bytes)
            .collect();
        assert_eq!(
            decode_font_name(ttf_parser::name::Name {
                platform_id: ttf_parser::PlatformId::Windows,
                encoding_id: 1,
                language_id: 0x0409,
                name: &unicode,
                ..mac_name
            })
            .as_deref(),
            Some("Localized name")
        );
        assert_eq!(
            decode_font_name(ttf_parser::name::Name {
                encoding_id: 1,
                ..mac_name
            }),
            None
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn installed_abbreviated_and_legacy_names_compile_in_the_renderer() {
        for (file, character, family) in [
            (
                "/System/Library/Fonts/NotoSansArmenian.ttc",
                '\u{0531}',
                "Noto Sans Armenian",
            ),
            (
                "/System/Library/Fonts/NotoSansMyanmar.ttc",
                '\u{1000}',
                "Noto Sans Myanmar",
            ),
            (
                "/System/Library/Fonts/Supplemental/Gurmukhi.ttf",
                '\u{0A15}',
                "Gurmukhi MT",
            ),
        ] {
            let path = PathBuf::from(file);
            if !path.exists() {
                continue;
            }
            let plan = resolve_from_files(
                BTreeSet::from([character]),
                BTreeSet::from([character.to_string()]),
                std::slice::from_ref(&path),
                &[],
                &AtomicBool::new(false),
            )
            .unwrap();
            plan.validate().unwrap();
            assert_eq!(plan.fonts[0].family, family);
            let Some(binary) = std::env::var_os("GNOSIS_TYPST_BIN") else {
                continue;
            };
            let workspace = pdf_workspace().unwrap();
            let _cleanup = WorkspaceCleanup(workspace.clone());
            fs::write(workspace.join("names.typ"), format!("{}#set page(width: 100pt, height: auto)\n#set text(fallback: false)\n#text({})", plan.rules(false), typst_string(&character.to_string()))).unwrap();
            let output = std::process::Command::new(binary)
                .args(["compile", "--ignore-system-fonts", "--font-path"])
                .arg(path.parent().unwrap())
                .arg(workspace.join("names.typ"))
                .arg(workspace.join("names.svg"))
                .output()
                .unwrap();
            let diagnostics = String::from_utf8_lossy(&output.stderr);
            assert!(output.status.success(), "{family}: {diagnostics}");
            assert!(
                !diagnostics.contains("unknown font family:"),
                "{family}: {diagnostics}"
            );
        }
    }

    #[test]
    fn combining_fallback_clusters_follow_bold_italic_and_link_runs() {
        for text in [
            "A<b>\u{0301}</b>",
            "A<i>\u{0301}</i>",
            "A<a href=\"https://example.test\">\u{0301}</a>",
        ] {
            let document = ExportDocument {
                book_parts: Vec::new(),
                title: "Title".into(),
                language_code: "vi".into(),
                blocks: vec![ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: text.into(),
                }],
            };
            let missing = BTreeSet::from(['\u{0301}']);
            let clusters = fallback_clusters(&rendered_texts(&document, false), &missing);
            assert_eq!(clusters, BTreeSet::from(["\u{0301}".into()]), "{text}");
            let plan = resolve_from_files(
                missing,
                clusters,
                &[font_path()],
                &[],
                &AtomicBool::new(false),
            )
            .unwrap();
            plan.validate().unwrap();
            assert!(plan.affected(text, false));
            assert!(!plan.affected("A", false));
            let rules = plan.rules(true);
            assert!(
                rules.contains("extent: 0.35em"),
                "zero-advance marks need visible highlights"
            );
            assert!(!plan.rules(false).contains("highlight"));
        }
    }

    #[test]
    fn footnote_url_fallback_is_a_separate_rendered_run() {
        let text = "<a href=\"https://example.test/\u{13153}\">Reference</a>";
        assert_eq!(
            rendered_runs(text, true),
            ["Reference", "(https://example.test/\u{13153})"]
        );
        assert_eq!(rendered_runs(text, false), ["Reference"]);
    }

    #[test]
    fn resolves_whole_clusters_using_the_installed_file() {
        let plan = resolve_from_files(
            BTreeSet::from(['A']),
            BTreeSet::from(["A".into()]),
            &[font_path()],
            &[],
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(plan.unresolved.is_empty());
        assert_eq!(plan.fonts.len(), 1);
        assert_eq!(plan.fonts[0].path, font_path());
        assert!(plan.rules(true).contains("highlight(fill:"));
        assert!(!plan.rules(false).contains("highlight"));
    }

    #[test]
    fn cached_coverage_matches_glyph_lookup_and_invalidates_changed_files() {
        let path = font_path();
        let first = font_coverage(&path).unwrap();
        let second = font_coverage(&path).unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        let bytes = fs::read(&path).unwrap();
        let face = ttf_parser::Face::parse(&bytes, 0).unwrap();
        for ch in ['A', 'ễ', 'Ω', '\u{13153}'] {
            assert_eq!(
                first[ch as usize / 64] & (1 << (ch as u32 % 64)) != 0,
                face.glyph_index(ch).is_some()
            );
        }
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let copied = workspace.join("fixture.ttf");
        fs::write(&copied, bytes).unwrap();
        assert!(font_coverage(&copied).is_ok());
        fs::write(&copied, b"invalid changed font").unwrap();
        assert!(font_coverage(&copied).is_err());
    }

    #[test]
    fn saved_approval_prefers_that_face_for_other_documents_and_new_characters() {
        let italic = font_path().with_file_name("CormorantGaramondGnosis-Italic.ttf");
        let first = resolve_from_files(
            BTreeSet::from(['A']),
            BTreeSet::from(["A".into()]),
            std::slice::from_ref(&italic),
            &[],
            &AtomicBool::new(false),
        )
        .unwrap();
        let persisted = serde_json::to_string(&vec![first.fonts[0].choice()]).unwrap();
        let approved: Vec<FontChoice> = serde_json::from_str(&persisted).unwrap();
        let next = resolve_from_files(
            BTreeSet::from(['B']),
            BTreeSet::from(["B".into()]),
            &[font_path(), italic.clone()],
            &approved,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(next.fonts[0].path, italic);
        assert!(next.unapproved(&approved).fonts.is_empty());
        // If the approved font has gone away, a replacement requires approval.
        let replaced = resolve_from_files(
            BTreeSet::from(['B']),
            BTreeSet::from(["B".into()]),
            &[font_path()],
            &approved,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(replaced.unapproved(&approved).fonts.len(), 1);
        let unavailable = resolve_from_files(
            BTreeSet::from(['B']),
            BTreeSet::from(["B".into()]),
            &[],
            &approved,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(unavailable.validate().is_err());
    }

    #[test]
    fn mixed_approvals_review_and_highlight_only_the_new_face() {
        let cancelled = AtomicBool::new(false);
        let old = resolve_from_files(
            BTreeSet::from(['A']),
            BTreeSet::from(["A".into()]),
            &[font_path()],
            &[],
            &cancelled,
        )
        .unwrap();
        let new = resolve_from_files(
            BTreeSet::from(['B']),
            BTreeSet::from(["B".into()]),
            &[font_path().with_file_name("CormorantGaramondGnosis-Italic.ttf")],
            &[],
            &cancelled,
        )
        .unwrap();
        let approved = vec![old.fonts[0].choice()];
        let plan = FontFallbackPlan {
            fonts: vec![old.fonts[0].clone(), new.fonts[0].clone()],
            missing: BTreeSet::from(['A', 'B']),
            unresolved: BTreeSet::new(),
        };
        let review = plan.unapproved(&approved);
        assert!(!review.affected("Only A was approved", false));
        assert!(review.affected("New B", false));
        assert_eq!(review.fonts.len(), 1);
        assert_eq!(
            plan.review_rules(&review)
                .matches("highlight(fill:")
                .count(),
            1
        );
        assert_eq!(plan.rules(false).matches("#show regex").count(), 2);
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        let document = ExportDocument {
            book_parts: Vec::new(),
            title: "Title".into(),
            language_code: "vi".into(),
            blocks: vec![
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "A".into(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "B".into(),
                },
                ExportBlock::Text {
                    text_style: "paragraph".into(),
                    text: "A B".into(),
                },
            ],
        };
        let session = begin_pdf_image_cache(&PdfImageCacheScope {
            installation_id: 1,
            repo_name: "test".into(),
            project_id: None,
            project_full_name: None,
            target: PdfImageCacheTarget::Chapter("another-document".into()),
        });
        let options = PdfWorkspacePreparationOptions {
            footnote_links_as_plain_text: false,
            paper_size: "a4",
            image_cache_session: &session,
        };
        let prepared =
            font_review::prepare(&workspace, &document, &options, &plan, &review).unwrap();
        assert_eq!(prepared.labels, ["Paragraph 2", "Paragraph 3"]);
        let source = fs::read_to_string(workspace.join("font-review.typ")).unwrap();
        assert!(source.contains("#text(\"A B\")"));
        assert!(!source.contains("#text(\"A\")"));
    }

    #[test]
    fn rejects_partial_clusters_and_unknown_glyphs() {
        let plan = resolve_from_files(
            BTreeSet::from(['\u{10FFFF}']),
            BTreeSet::from(["A\u{10FFFF}".into()]),
            &[font_path()],
            &[],
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(plan.fonts.is_empty());
        assert!(plan.validate().unwrap_err().contains("U+10FFFF"));
    }

    #[test]
    fn resolves_collection_faces_and_respects_embedding_permissions() {
        let bytes = fs::read(font_path()).unwrap();
        let count = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
        let workspace = pdf_workspace().unwrap();
        let _cleanup = WorkspaceCleanup(workspace.clone());
        // A one-face TTC fixture: sfnt table offsets are relative to the entire
        // collection, so adjust them by the length of the TTC header.
        let mut collection = b"ttcf\0\x01\0\0\0\0\0\x01\0\0\0\x10".to_vec();
        collection.extend_from_slice(&bytes);
        for index in 0..count {
            let offset = 16 + 12 + 16 * index + 8;
            let value = u32::from_be_bytes(collection[offset..offset + 4].try_into().unwrap()) + 16;
            collection[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
        }
        let path = workspace.join("fixture.ttc");
        fs::write(&path, collection).unwrap();
        let plan = resolve_from_files(
            BTreeSet::from(['A']),
            BTreeSet::from(["A".into()]),
            &[path],
            &[],
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(plan.unresolved.is_empty());
        let mut restricted = bytes;
        for index in 0..count {
            let entry = 12 + 16 * index;
            if &restricted[entry..entry + 4] == b"OS/2" {
                let table =
                    u32::from_be_bytes(restricted[entry + 8..entry + 12].try_into().unwrap())
                        as usize;
                restricted[table + 8..table + 10].copy_from_slice(&2u16.to_be_bytes());
            }
        }
        let path = workspace.join("restricted.ttf");
        fs::write(&path, restricted).unwrap();
        let plan = resolve_from_files(
            BTreeSet::from(['A']),
            BTreeSet::from(["A".into()]),
            &[path],
            &[],
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(plan.fonts.is_empty());
        assert!(plan.validate().is_err());
    }

    #[test]
    fn excludes_control_glyphs_but_checks_combining_marks() {
        assert!(!needs_glyph('\u{200D}'));
        assert!(!needs_glyph('\u{FE0F}'));
        assert!(needs_glyph('\u{0301}'));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn installed_egyptian_font_covers_reported_characters() {
        let path = PathBuf::from(
            "/System/Library/Fonts/Supplemental/NotoSansEgyptianHieroglyphs-Regular.ttf",
        );
        if !path.exists() {
            return;
        }
        let missing = BTreeSet::from(['\u{13153}', '\u{1318E}', '\u{13296}', '\u{133CF}']);
        let plan = resolve_from_files(
            missing.clone(),
            missing.iter().map(char::to_string).collect(),
            &[path],
            &[],
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(plan.unresolved.is_empty());
        assert_eq!(plan.fonts[0].family, "Noto Sans EgyptHiero");
    }
}
