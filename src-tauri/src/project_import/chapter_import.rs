use std::{collections::BTreeMap, fs, io::Cursor, path::Path};

use calamine::{open_workbook_auto_from_rs, Data, Reader};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use uuid::Uuid;

use crate::git_commit::{git_commit_as_signed_in_user_with_metadata, GitCommitMetadata};
use crate::project_repo_paths::resolve_project_git_repo_path;

use super::project_git::{
    ensure_clean_git_repo, ensure_gitattributes, ensure_repo_exists, ensure_valid_git_repo,
    git_output, read_json_file, write_json_pretty,
};

const GTMS_FORMAT: &str = "gtms";
const GTMS_FORMAT_VERSION: u32 = 1;
const ORDER_KEY_SPACING: u128 = 1u128 << 104;
const ISO_639_1_LANGUAGE_OPTIONS: &[(&str, &str)] = &[
    ("aa", "Afar"),
    ("ab", "Abkhazian"),
    ("ae", "Avestan"),
    ("af", "Afrikaans"),
    ("ak", "Akan"),
    ("am", "Amharic"),
    ("an", "Aragonese"),
    ("ar", "Arabic"),
    ("as", "Assamese"),
    ("av", "Avaric"),
    ("ay", "Aymara"),
    ("az", "Azerbaijani"),
    ("ba", "Bashkir"),
    ("be", "Belarusian"),
    ("bg", "Bulgarian"),
    ("bi", "Bislama"),
    ("bm", "Bambara"),
    ("bn", "Bangla"),
    ("bo", "Tibetan"),
    ("br", "Breton"),
    ("bs", "Bosnian"),
    ("ca", "Catalan"),
    ("ce", "Chechen"),
    ("ch", "Chamorro"),
    ("co", "Corsican"),
    ("cr", "Cree"),
    ("cs", "Czech"),
    ("cu", "Church Slavic"),
    ("cv", "Chuvash"),
    ("cy", "Welsh"),
    ("da", "Danish"),
    ("de", "German"),
    ("dv", "Dhivehi"),
    ("dz", "Dzongkha"),
    ("ee", "Ewe"),
    ("el", "Greek"),
    ("en", "English"),
    ("eo", "Esperanto"),
    ("es", "Spanish"),
    ("et", "Estonian"),
    ("eu", "Basque"),
    ("fa", "Persian"),
    ("ff", "Fula"),
    ("fi", "Finnish"),
    ("fj", "Fijian"),
    ("fo", "Faroese"),
    ("fr", "French"),
    ("fy", "Western Frisian"),
    ("ga", "Irish"),
    ("gd", "Scottish Gaelic"),
    ("gl", "Galician"),
    ("gn", "Guarani"),
    ("gu", "Gujarati"),
    ("gv", "Manx"),
    ("ha", "Hausa"),
    ("he", "Hebrew"),
    ("hi", "Hindi"),
    ("ho", "Hiri Motu"),
    ("hr", "Croatian"),
    ("ht", "Haitian Creole"),
    ("hu", "Hungarian"),
    ("hy", "Armenian"),
    ("hz", "Herero"),
    ("ia", "Interlingua"),
    ("id", "Indonesian"),
    ("ie", "Interlingue"),
    ("ig", "Igbo"),
    ("ii", "Liangshan Yi"),
    ("ik", "Inupiaq"),
    ("io", "Ido"),
    ("is", "Icelandic"),
    ("it", "Italian"),
    ("iu", "Inuktitut"),
    ("ja", "Japanese"),
    ("jv", "Javanese"),
    ("ka", "Georgian"),
    ("kg", "Kongo"),
    ("ki", "Kikuyu"),
    ("kj", "Kuanyama"),
    ("kk", "Kazakh"),
    ("kl", "Kalaallisut"),
    ("km", "Khmer"),
    ("kn", "Kannada"),
    ("ko", "Korean"),
    ("kr", "Kanuri"),
    ("ks", "Kashmiri"),
    ("ku", "Kurdish"),
    ("kv", "Komi"),
    ("kw", "Cornish"),
    ("ky", "Kyrgyz"),
    ("la", "Latin"),
    ("lb", "Luxembourgish"),
    ("lg", "Ganda"),
    ("li", "Limburgish"),
    ("ln", "Lingala"),
    ("lo", "Lao"),
    ("lt", "Lithuanian"),
    ("lu", "Luba-Katanga"),
    ("lv", "Latvian"),
    ("mg", "Malagasy"),
    ("mh", "Marshallese"),
    ("mi", "Maori"),
    ("mk", "Macedonian"),
    ("ml", "Malayalam"),
    ("mn", "Mongolian"),
    ("mr", "Marathi"),
    ("ms", "Malay"),
    ("mt", "Maltese"),
    ("my", "Burmese"),
    ("na", "Nauru"),
    ("nb", "Norwegian Bokmal"),
    ("nd", "North Ndebele"),
    ("ne", "Nepali"),
    ("ng", "Ndonga"),
    ("nl", "Dutch"),
    ("nn", "Norwegian Nynorsk"),
    ("no", "Norwegian"),
    ("nr", "South Ndebele"),
    ("nv", "Navajo"),
    ("ny", "Nyanja"),
    ("oc", "Occitan"),
    ("oj", "Ojibwa"),
    ("om", "Oromo"),
    ("or", "Odia"),
    ("os", "Ossetic"),
    ("pa", "Punjabi"),
    ("pi", "Pali"),
    ("pl", "Polish"),
    ("ps", "Pashto"),
    ("pt", "Portuguese"),
    ("qu", "Quechua"),
    ("rm", "Romansh"),
    ("rn", "Rundi"),
    ("ro", "Romanian"),
    ("ru", "Russian"),
    ("rw", "Kinyarwanda"),
    ("sa", "Sanskrit"),
    ("sc", "Sardinian"),
    ("sd", "Sindhi"),
    ("se", "North Sami"),
    ("sg", "Sango"),
    ("si", "Sinhala"),
    ("sk", "Slovak"),
    ("sl", "Slovenian"),
    ("sm", "Samoan"),
    ("sn", "Shona"),
    ("so", "Somali"),
    ("sq", "Albanian"),
    ("sr", "Serbian"),
    ("ss", "Swati"),
    ("st", "Southern Sotho"),
    ("su", "Sundanese"),
    ("sv", "Swedish"),
    ("sw", "Swahili"),
    ("ta", "Tamil"),
    ("te", "Telugu"),
    ("tg", "Tajik"),
    ("th", "Thai"),
    ("ti", "Tigrinya"),
    ("tk", "Turkmen"),
    ("tl", "Tagalog"),
    ("tn", "Tswana"),
    ("to", "Tongan"),
    ("tr", "Turkish"),
    ("ts", "Tsonga"),
    ("tt", "Tatar"),
    ("tw", "Twi"),
    ("ty", "Tahitian"),
    ("ug", "Uyghur"),
    ("uk", "Ukrainian"),
    ("ur", "Urdu"),
    ("uz", "Uzbek"),
    ("ve", "Venda"),
    ("vi", "Vietnamese"),
    ("vo", "Volapuk"),
    ("wa", "Walloon"),
    ("wo", "Wolof"),
    ("xh", "Xhosa"),
    ("yi", "Yiddish"),
    ("yo", "Yoruba"),
    ("za", "Zhuang"),
    ("zh", "Chinese"),
    ("zu", "Zulu"),
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportXlsxInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportXlsxResponse {
    chapter_id: String,
    repo_path: String,
    chapter_path: String,
    project_title: String,
    file_title: String,
    worksheet_name: String,
    unit_count: usize,
    languages: Vec<ChapterLanguage>,
    source_word_counts: BTreeMap<String, usize>,
    selected_source_language_code: Option<String>,
    selected_target_language_code: Option<String>,
    language_codes: Vec<String>,
    source_file_name: String,
}

#[derive(Clone)]
struct ParsedWorkbook {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    file_title: String,
    worksheet_name: String,
    source_file_name: String,
    header_blob: Vec<String>,
    languages: Vec<ImportedLanguage>,
    rows: Vec<ImportedRow>,
}

#[derive(Clone)]
struct ImportedLanguage {
    code: String,
    name: String,
    role: &'static str,
}

#[derive(Clone)]
struct ImportedRow {
    external_id: Option<String>,
    description: Option<String>,
    context: Option<String>,
    comments: Vec<GuidanceComment>,
    source_row_number: usize,
    fields: BTreeMap<String, String>,
}

#[derive(Clone, Debug)]
enum ColumnBinding {
    Language { code: String, name: String },
}

#[derive(Deserialize)]
struct ProjectFile {
    title: String,
}

#[derive(Serialize, Deserialize)]
struct ChapterFile {
    format: &'static str,
    format_version: u32,
    #[serde(rename = "appVersion")]
    app_version: String,
    chapter_id: String,
    title: String,
    slug: String,
    lifecycle: LifecycleState,
    source_files: Vec<SourceFile>,
    package_assets: Vec<Value>,
    languages: Vec<ChapterLanguage>,
    #[serde(default)]
    settings: ChapterSettings,
}

#[derive(Serialize, Deserialize)]
struct LifecycleState {
    state: String,
}

fn active_lifecycle_state() -> LifecycleState {
    LifecycleState {
        state: "active".to_string(),
    }
}

#[derive(Serialize, Deserialize)]
struct SourceFile {
    file_id: String,
    format: &'static str,
    path_hint: String,
    filename_template: String,
    file_metadata: SourceFileMetadata,
}

#[derive(Serialize, Deserialize)]
struct SourceFileMetadata {
    source_locale: Option<String>,
    target_locales: Vec<String>,
    header_blob: Vec<String>,
    root_language: Option<String>,
    wrapper_name: Option<String>,
    serialization_hints: BTreeMap<String, Value>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChapterLanguage {
    code: String,
    name: String,
    role: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct ChapterSettings {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    linked_glossaries: Option<ChapterLinkedGlossaries>,
    #[serde(default)]
    default_source_language: Option<String>,
    #[serde(default)]
    default_target_language: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
struct ChapterLinkedGlossaries {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    glossary: Option<ChapterGlossaryLink>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ChapterGlossaryLink {
    glossary_id: String,
    repo_name: String,
}

#[derive(Serialize)]
struct RowFile {
    row_id: String,
    unit_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    external_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    guidance: Option<Guidance>,
    lifecycle: LifecycleState,
    status: RowStatus,
    structure: RowStructure,
    origin: RowOrigin,
    format_state: FormatState,
    placeholders: Vec<Value>,
    variants: Vec<Value>,
    fields: BTreeMap<String, FieldValue>,
    format_metadata: BTreeMap<String, Value>,
}

#[derive(Clone, Serialize)]
struct Guidance {
    description: Option<String>,
    context: Option<String>,
    comments: Vec<GuidanceComment>,
    source_references: Vec<String>,
}

#[derive(Clone, Serialize)]
struct GuidanceComment {
    kind: String,
    text: String,
}

#[derive(Serialize)]
struct RowStatus {
    review_state: &'static str,
    reviewed_at: Option<String>,
    reviewed_by: Option<String>,
    flags: Vec<String>,
}

#[derive(Serialize)]
struct RowStructure {
    source_file: String,
    container_path: BTreeMap<String, Value>,
    order_key: String,
    group_context: Option<String>,
}

#[derive(Serialize)]
struct RowOrigin {
    source_format: &'static str,
    source_sheet: String,
    source_row_number: usize,
}

#[derive(Serialize)]
struct FormatState {
    translatable: bool,
    character_limit: Option<u32>,
    tags: Vec<String>,
    source_state: Option<String>,
    custom_attributes: BTreeMap<String, Value>,
}

#[derive(Serialize)]
struct FieldValue {
    value_kind: &'static str,
    plain_text: String,
    rich_text: Option<Value>,
    notes_html: String,
    attachments: Vec<Value>,
    passthrough_value: Option<Value>,
    editor_flags: FieldEditorFlags,
}

#[derive(Serialize, Default)]
struct FieldEditorFlags {
    reviewed: bool,
    please_check: bool,
}

pub(super) fn import_xlsx_to_gtms_sync(
    app: &AppHandle,
    input: ImportXlsxInput,
) -> Result<ImportXlsxResponse, String> {
    let parsed = parse_xlsx_workbook(input)?;
    let chapter_id = Uuid::now_v7();
    let repo_path = resolve_project_git_repo_path(
        app,
        parsed.installation_id,
        parsed.project_id.as_deref(),
        Some(&parsed.repo_name),
    )?;
    ensure_repo_exists(
    &repo_path,
    "The local project repo is not available yet. Refresh the Projects page first so the repo can be cloned.",
  )?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    ensure_clean_git_repo(
        &repo_path,
        "The local project repo has uncommitted changes. Sync it before adding files.",
    )?;

    let project_title = read_project_title(&repo_path.join("project.json"))?;
    let chapter_slug =
        unique_chapter_slug(&repo_path.join("chapters"), &slugify(&parsed.file_title));
    let chapter_path = repo_path.join("chapters").join(&chapter_slug);
    let rows_path = chapter_path.join("rows");
    let assets_path = chapter_path.join("assets");

    fs::create_dir_all(&rows_path)
        .map_err(|error| format!("Could not create the imported rows folder: {error}"))?;
    fs::create_dir_all(&assets_path)
        .map_err(|error| format!("Could not create the imported assets folder: {error}"))?;

    ensure_gitattributes(&repo_path.join(".gitattributes"))?;

    let chapter_file = build_chapter_file(&parsed, &chapter_id, &chapter_slug);
    write_json_pretty(&chapter_path.join("chapter.json"), &chapter_file)?;

    let unit_count = write_row_files(&parsed, &rows_path)?;

    git_output(&repo_path, &["add", ".gitattributes", "chapters"])?;
    git_commit_as_signed_in_user_with_metadata(
        app,
        &repo_path,
        &format!("Import {}", parsed.source_file_name),
        &[],
        GitCommitMetadata {
            operation: Some("import"),
            status_note: None,
            ai_model: None,
        },
    )?;

    let source_word_counts = build_source_word_counts_from_import(&parsed);
    let selected_source_language_code = parsed
        .languages
        .first()
        .map(|language| language.code.clone());
    let selected_target_language_code = chapter_file.settings.default_target_language.clone();

    Ok(ImportXlsxResponse {
        chapter_id: chapter_id.to_string(),
        repo_path: repo_path.display().to_string(),
        chapter_path: chapter_path.display().to_string(),
        project_title,
        file_title: parsed.file_title,
        worksheet_name: parsed.worksheet_name,
        unit_count,
        languages: chapter_file.languages.clone(),
        source_word_counts,
        selected_source_language_code,
        selected_target_language_code,
        language_codes: parsed
            .languages
            .iter()
            .map(|language| language.code.clone())
            .collect(),
        source_file_name: parsed.source_file_name,
    })
}

fn parse_xlsx_workbook(input: ImportXlsxInput) -> Result<ParsedWorkbook, String> {
    if input.bytes.is_empty() {
        return Err("The selected file is empty.".to_string());
    }

    let mut workbook = open_workbook_auto_from_rs(Cursor::new(input.bytes))
        .map_err(|error| format!("Could not open the workbook: {error}"))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "The workbook does not contain any worksheets.".to_string())?;
    let range = workbook
        .worksheet_range_at(0)
        .ok_or_else(|| "The workbook does not contain any worksheets.".to_string())?
        .map_err(|error| format!("Could not read the first worksheet: {error}"))?;
    let header_row = range
        .rows()
        .next()
        .ok_or_else(|| "The workbook is missing a header row.".to_string())?;

    let header_blob = header_row
        .iter()
        .map(cell_to_trimmed_string)
        .collect::<Vec<_>>();
    let bindings = classify_header_row(&header_blob)?;
    let languages = bindings
        .iter()
        .map(|binding| match binding {
            ColumnBinding::Language { code, name } => (code.clone(), name.clone()),
        })
        .collect::<Vec<_>>();

    if languages.is_empty() {
        return Err(
      "Could not detect any language columns. Add ISO 639-1 two-letter language codes like 'es', 'en', or 'vi' to the first row."
        .to_string(),
    );
    }

    let languages = languages
        .into_iter()
        .enumerate()
        .map(|(index, (code, name))| ImportedLanguage {
            code,
            name,
            role: if index == 0 { "source" } else { "target" },
        })
        .collect::<Vec<_>>();

    let mut rows = Vec::new();
    for (row_index, row) in range.rows().enumerate().skip(1) {
        let external_id = None;
        let description = None;
        let context = None;
        let comments: Vec<GuidanceComment> = Vec::new();
        let mut fields = BTreeMap::new();

        for (column_index, binding) in bindings.iter().enumerate() {
            let value = row
                .get(column_index)
                .map(cell_to_trimmed_string)
                .unwrap_or_default();
            match binding {
                ColumnBinding::Language { code, .. } => {
                    fields.insert(code.clone(), value);
                }
            }
        }

        if row_is_empty(&external_id, &description, &context, &comments, &fields) {
            continue;
        }

        rows.push(ImportedRow {
            external_id,
            description,
            context,
            comments,
            source_row_number: row_index + 1,
            fields,
        });
    }

    Ok(ParsedWorkbook {
        installation_id: input.installation_id,
        repo_name: input.repo_name,
        project_id: input.project_id,
        file_title: humanize_file_stem(&input.file_name),
        worksheet_name: sheet_name,
        source_file_name: input.file_name,
        header_blob,
        languages,
        rows,
    })
}

fn build_chapter_file(
    parsed: &ParsedWorkbook,
    chapter_id: &Uuid,
    chapter_slug: &str,
) -> ChapterFile {
    let source_locale = parsed
        .languages
        .first()
        .map(|language| language.code.clone());
    let target_locales = parsed
        .languages
        .iter()
        .skip(1)
        .map(|language| language.code.clone())
        .collect::<Vec<_>>();
    let mut serialization_hints = BTreeMap::new();
    serialization_hints.insert(
        "worksheet".to_string(),
        Value::String(parsed.worksheet_name.clone()),
    );

    ChapterFile {
        format: GTMS_FORMAT,
        format_version: GTMS_FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        chapter_id: chapter_id.to_string(),
        title: parsed.file_title.clone(),
        slug: chapter_slug.to_string(),
        lifecycle: active_lifecycle_state(),
        source_files: vec![SourceFile {
            file_id: "source-001".to_string(),
            format: "xlsx",
            path_hint: parsed.source_file_name.clone(),
            filename_template: parsed.source_file_name.clone(),
            file_metadata: SourceFileMetadata {
                source_locale,
                target_locales,
                header_blob: parsed.header_blob.clone(),
                root_language: None,
                wrapper_name: None,
                serialization_hints,
            },
        }],
        package_assets: Vec::new(),
        languages: parsed
            .languages
            .iter()
            .map(|language| ChapterLanguage {
                code: language.code.clone(),
                name: language.name.clone(),
                role: language.role.to_string(),
            })
            .collect(),
        settings: ChapterSettings {
            linked_glossaries: None,
            default_source_language: parsed
                .languages
                .first()
                .map(|language| language.code.clone()),
            default_target_language: parsed
                .languages
                .last()
                .map(|language| language.code.clone()),
        },
    }
}

fn write_row_files(parsed: &ParsedWorkbook, rows_path: &Path) -> Result<usize, String> {
    let total_rows = parsed.rows.len();

    for (index, imported_row) in parsed.rows.iter().enumerate() {
        let row_id = Uuid::now_v7().to_string();
        let row_file = build_row_file(parsed, imported_row, index, total_rows, &row_id)?;
        write_json_pretty(&rows_path.join(format!("{row_id}.json")), &row_file)?;
    }

    Ok(total_rows)
}

fn build_row_file(
    parsed: &ParsedWorkbook,
    imported_row: &ImportedRow,
    index: usize,
    total_rows: usize,
    row_id: &str,
) -> Result<RowFile, String> {
    let guidance = if imported_row.description.is_some()
        || imported_row.context.is_some()
        || !imported_row.comments.is_empty()
    {
        Some(Guidance {
            description: imported_row.description.clone(),
            context: imported_row.context.clone(),
            comments: imported_row.comments.clone(),
            source_references: Vec::new(),
        })
    } else {
        None
    };

    let mut container_path = BTreeMap::new();
    container_path.insert(
        "sheet".to_string(),
        Value::String(parsed.worksheet_name.clone()),
    );
    container_path.insert(
        "row".to_string(),
        Value::Number((imported_row.source_row_number as u64).into()),
    );

    let mut fields = BTreeMap::new();
    for language in &parsed.languages {
        let plain_text = imported_row
            .fields
            .get(&language.code)
            .cloned()
            .unwrap_or_default();
        fields.insert(
            language.code.clone(),
            FieldValue {
                value_kind: "text",
                plain_text,
                rich_text: None,
                notes_html: String::new(),
                attachments: Vec::new(),
                passthrough_value: None,
                editor_flags: FieldEditorFlags::default(),
            },
        );
    }

    let mut format_metadata = BTreeMap::new();
    format_metadata.insert(
        "xlsx".to_string(),
        json!({
          "source_sheet": parsed.worksheet_name.clone(),
          "source_row_number": imported_row.source_row_number,
        }),
    );

    Ok(RowFile {
        row_id: row_id.to_string(),
        unit_type: "string",
        external_id: imported_row.external_id.clone(),
        guidance,
        lifecycle: active_lifecycle_state(),
        status: RowStatus {
            review_state: "unreviewed",
            reviewed_at: None,
            reviewed_by: None,
            flags: Vec::new(),
        },
        structure: RowStructure {
            source_file: parsed.source_file_name.clone(),
            container_path,
            order_key: order_key_for_position(index, total_rows)?,
            group_context: imported_row.context.clone(),
        },
        origin: RowOrigin {
            source_format: "xlsx",
            source_sheet: parsed.worksheet_name.clone(),
            source_row_number: imported_row.source_row_number,
        },
        format_state: FormatState {
            translatable: true,
            character_limit: None,
            tags: Vec::new(),
            source_state: None,
            custom_attributes: BTreeMap::new(),
        },
        placeholders: Vec::new(),
        variants: Vec::new(),
        fields,
        format_metadata,
    })
}

fn order_key_for_position(index: usize, total_rows: usize) -> Result<String, String> {
    if index >= total_rows {
        return Err("Could not assign an order key outside the row set.".to_string());
    }

    let position = u128::try_from(index)
        .map_err(|error| format!("Could not convert the row position to an order key: {error}"))?
        + 1;
    let value = position
        .checked_mul(ORDER_KEY_SPACING)
        .ok_or_else(|| "Could not allocate a sparse order key for this row.".to_string())?;

    Ok(format!("{value:032x}"))
}

fn classify_header_row(headers: &[String]) -> Result<Vec<ColumnBinding>, String> {
    if headers.is_empty() {
        return Err("The workbook is missing a header row.".to_string());
    }

    headers
        .iter()
        .enumerate()
        .map(|(index, header)| classify_header(header, index))
        .collect::<Result<Vec<_>, _>>()
}

fn classify_header(header: &str, column_index: usize) -> Result<ColumnBinding, String> {
    let code = normalize_language_code(header).ok_or_else(|| {
        format!(
            "Column {} must start with a valid ISO 639-1 two-letter language code.",
            column_index + 1
        )
    })?;
    let name = language_display_name(&code);
    Ok(ColumnBinding::Language { code, name })
}

fn normalize_language_code(header: &str) -> Option<String> {
    let normalized = header.trim().to_ascii_lowercase();
    if normalized.len() != 2 || !normalized.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        return None;
    }

    iso_639_1_language_name(&normalized).map(|_| normalized)
}

fn language_display_name(code: &str) -> String {
    iso_639_1_language_name(code).unwrap_or(code).to_string()
}

fn iso_639_1_language_name(code: &str) -> Option<&'static str> {
    ISO_639_1_LANGUAGE_OPTIONS
        .iter()
        .find_map(|(candidate, name)| (*candidate == code).then_some(*name))
}

fn row_is_empty(
    external_id: &Option<String>,
    description: &Option<String>,
    context: &Option<String>,
    comments: &[GuidanceComment],
    fields: &BTreeMap<String, String>,
) -> bool {
    external_id.is_none()
        && description.is_none()
        && context.is_none()
        && comments.is_empty()
        && fields.values().all(|value| value.is_empty())
}

fn unique_chapter_slug(chapters_root: &Path, base_slug: &str) -> String {
    let slug = if base_slug.trim().is_empty() {
        "untitled".to_string()
    } else {
        base_slug.trim().to_string()
    };

    if !chapters_root.join(&slug).exists() {
        return slug;
    }

    let mut index = 2usize;
    loop {
        let candidate = format!("{slug}-{index}");
        if !chapters_root.join(&candidate).exists() {
            return candidate;
        }
        index += 1;
    }
}

fn humanize_file_stem(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.trim())
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Imported workbook")
        .to_string()
}

fn slugify(value: &str) -> String {
    let slug = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

fn cell_to_trimmed_string(cell: &Data) -> String {
    let text = match cell {
        Data::Empty => String::new(),
        Data::Float(value) if value.fract().abs() < f64::EPSILON => format!("{value:.0}"),
        _ => cell.to_string(),
    };
    text.trim().to_string()
}

fn build_source_word_counts_from_import(parsed: &ParsedWorkbook) -> BTreeMap<String, usize> {
    let mut counts = parsed
        .languages
        .iter()
        .map(|language| (language.code.clone(), 0usize))
        .collect::<BTreeMap<_, _>>();

    for row in &parsed.rows {
        for language in &parsed.languages {
            let value = row
                .fields
                .get(&language.code)
                .map(String::as_str)
                .unwrap_or("");
            *counts.entry(language.code.clone()).or_default() += count_words(value);
        }
    }

    counts
}

fn count_words(value: &str) -> usize {
    value
        .split_whitespace()
        .filter(|segment| !segment.is_empty())
        .count()
}

fn read_project_title(project_json_path: &Path) -> Result<String, String> {
    let project_file: ProjectFile = read_json_file(project_json_path, "project.json")?;
    Ok(project_file.title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_header_row_accepts_iso_639_1_language_codes() {
        let bindings = classify_header_row(&["es".to_string(), "EN".to_string(), "vi".to_string()])
            .expect("valid ISO codes should be accepted");

        let codes = bindings
            .into_iter()
            .map(|binding| match binding {
                ColumnBinding::Language { code, .. } => code,
            })
            .collect::<Vec<_>>();

        assert_eq!(codes, vec!["es", "en", "vi"]);
    }

    #[test]
    fn classify_header_row_rejects_language_names() {
        let error = classify_header_row(&["Spanish".to_string(), "English".to_string()])
            .expect_err("language names should not pass XLSX import validation");

        assert!(error.contains("Column 1"));
        assert!(error.contains("ISO 639-1"));
    }

    #[test]
    fn classify_header_row_rejects_unknown_two_letter_codes() {
        let error = classify_header_row(&["es".to_string(), "zz".to_string()])
            .expect_err("unknown two-letter codes should not pass XLSX import validation");

        assert!(error.contains("Column 2"));
        assert!(error.contains("ISO 639-1"));
    }
}
