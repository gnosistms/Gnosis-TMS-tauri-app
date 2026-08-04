use std::{collections::BTreeSet, path::Path, sync::OnceLock};

use quick_xml::{events::Event, Reader};
use uuid::Uuid;

use super::{
    validate_qa_regular_expression, QaListLanguageInfo, StoredLifecycle, StoredQaListFile,
    StoredQaListTermFile,
};

const ISO_LANGUAGE_OPTIONS_SOURCE: &str = include_str!("../../../src-ui/lib/language-options.js");

pub(super) struct ParsedTmxQaList {
    pub(super) title: String,
    pub(super) language: QaListLanguageInfo,
    pub(super) terms: Vec<StoredQaListTermFile>,
}

#[derive(Default)]
struct WorkingTmxUnit {
    term_id: Option<String>,
    current_language: Option<String>,
    current_note: String,
    current_prop: String,
    current_prop_type: Option<String>,
    current_segment: String,
    notes: Vec<String>,
    segments: Vec<(String, String)>,
    inside_note: bool,
    inside_prop: bool,
    inside_segment: bool,
    is_case_sensitive: bool,
    is_regular_expression: bool,
}

pub(super) fn parse_tmx_qa_list(file_name: &str, bytes: &[u8]) -> Result<ParsedTmxQaList, String> {
    if !String::from(file_name)
        .trim()
        .to_lowercase()
        .ends_with(".tmx")
    {
        return Err("TMX is the only supported QA list import format right now.".to_string());
    }

    let mut xml = String::from_utf8(bytes.to_vec())
        .map_err(|error| format!("The TMX file is not valid UTF-8: {error}"))?;
    if xml.starts_with('\u{feff}') {
        xml = xml.trim_start_matches('\u{feff}').to_string();
    }

    let mut reader = Reader::from_str(&xml);
    reader.trim_text(false);

    let mut buffer = Vec::new();
    let mut header_language_code = None::<String>;
    let mut units = Vec::<WorkingTmxUnit>::new();
    let mut current_unit = None::<WorkingTmxUnit>;

    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| format!("Could not parse the TMX file: {error}"))?
        {
            Event::Eof => break,
            Event::Start(event) => match event.name().as_ref() {
                b"header" | b"headers" if header_language_code.is_none() => {
                    header_language_code = read_tmx_attr(&reader, &event, b"srclang")?;
                }
                b"tu" => {
                    current_unit = Some(WorkingTmxUnit {
                        term_id: read_tmx_attr(&reader, &event, b"tuid")?,
                        ..WorkingTmxUnit::default()
                    });
                }
                b"tuv" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.current_language = read_tuv_language(&reader, &event)?;
                    }
                }
                b"prop" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_prop = true;
                        unit.current_prop_type = read_tmx_attr(&reader, &event, b"type")?;
                        unit.current_prop.clear();
                    }
                }
                b"note" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_note = true;
                        unit.current_note.clear();
                    }
                }
                b"seg" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_segment = true;
                        unit.current_segment.clear();
                    }
                }
                _ => {}
            },
            Event::Empty(event) => match event.name().as_ref() {
                b"header" | b"headers" if header_language_code.is_none() => {
                    header_language_code = read_tmx_attr(&reader, &event, b"srclang")?;
                }
                _ => {}
            },
            Event::Text(text) => {
                if let Some(unit) = current_unit.as_mut() {
                    let value = text
                        .unescape()
                        .map_err(|error| format!("Could not decode TMX text: {error}"))?
                        .into_owned();
                    if unit.inside_note {
                        unit.current_note.push_str(&value);
                    } else if unit.inside_prop {
                        unit.current_prop.push_str(&value);
                    } else if unit.inside_segment {
                        unit.current_segment.push_str(&value);
                    }
                }
            }
            Event::CData(text) => {
                if let Some(unit) = current_unit.as_mut() {
                    let value = String::from_utf8_lossy(text.as_ref()).into_owned();
                    if unit.inside_note {
                        unit.current_note.push_str(&value);
                    } else if unit.inside_prop {
                        unit.current_prop.push_str(&value);
                    } else if unit.inside_segment {
                        unit.current_segment.push_str(&value);
                    }
                }
            }
            Event::End(event) => match event.name().as_ref() {
                b"tuv" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.current_language = None;
                    }
                }
                b"note" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_note = false;
                        let note = clean_tmx_text(&unit.current_note);
                        if !note.is_empty() {
                            unit.notes.push(note);
                        }
                        unit.current_note.clear();
                    }
                }
                b"prop" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_prop = false;
                        let value = clean_tmx_text(&unit.current_prop);
                        match unit.current_prop_type.as_deref() {
                            Some("x-gnosis-qa-case-sensitive") => {
                                unit.is_case_sensitive = value.eq_ignore_ascii_case("true");
                            }
                            Some("x-gnosis-qa-regular-expression") => {
                                unit.is_regular_expression = value.eq_ignore_ascii_case("true");
                            }
                            _ => {}
                        }
                        unit.current_prop_type = None;
                        unit.current_prop.clear();
                    }
                }
                b"seg" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_segment = false;
                        let language = unit.current_language.clone().unwrap_or_default();
                        unit.segments.push((language, unit.current_segment.clone()));
                        unit.current_segment.clear();
                    }
                }
                b"tu" => {
                    if let Some(unit) = current_unit.take() {
                        units.push(unit);
                    }
                }
                _ => {}
            },
            _ => {}
        }
        buffer.clear();
    }

    let mut detected_language_codes = BTreeSet::<String>::new();
    if let Some(header_language_code) = header_language_code {
        let normalized = normalize_language_code(&header_language_code);
        if !normalized.is_empty() {
            detected_language_codes.insert(normalized);
        }
    }
    for language in units
        .iter()
        .flat_map(|unit| unit.segments.iter().map(|(language, _)| language))
    {
        let normalized = normalize_language_code(language);
        if !normalized.is_empty() {
            detected_language_codes.insert(normalized);
        }
    }
    if detected_language_codes.len() > 1 {
        return Err("QA list TMX import only supports single-language TMX files.".to_string());
    }

    let language_code = detected_language_codes
        .into_iter()
        .next()
        .ok_or_else(|| "The TMX file does not include a QA list language.".to_string())?;
    let language = language_info_for_code(&language_code);

    let terms = units
        .into_iter()
        .filter_map(|unit| {
            let is_regular_expression = unit.is_regular_expression;
            let text = unit
                .segments
                .into_iter()
                .find_map(|(segment_language, segment)| {
                    let segment_language_code = normalize_language_code(&segment_language);
                    if !segment_language_code.is_empty() && segment_language_code != language_code {
                        return None;
                    }
                    let normalized = if is_regular_expression {
                        segment
                    } else {
                        clean_tmx_text(&segment)
                    };
                    if normalized.is_empty() {
                        None
                    } else {
                        Some(normalized)
                    }
                })?;
            Some(StoredQaListTermFile {
                term_id: unit
                    .term_id
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| Uuid::now_v7().to_string()),
                text,
                notes: unit.notes.join("\n\n"),
                is_case_sensitive: unit.is_case_sensitive,
                is_regular_expression,
                lifecycle: StoredLifecycle {
                    state: "active".to_string(),
                },
            })
        })
        .collect::<Vec<_>>();

    if terms.is_empty() {
        return Err("The TMX file does not contain any QA terms.".to_string());
    }
    for term in &terms {
        if term.is_regular_expression {
            validate_qa_regular_expression(&term.text, term.is_case_sensitive)
                .map_err(|error| format!("QA term '{}': {error}", term.term_id))?;
        }
    }
    let mut term_ids = BTreeSet::new();
    if let Some(duplicate_id) = terms
        .iter()
        .map(|term| term.term_id.as_str())
        .find(|term_id| !term_ids.insert(*term_id))
    {
        return Err(format!(
            "The TMX file contains duplicate translation-unit id '{duplicate_id}'."
        ));
    }

    Ok(ParsedTmxQaList {
        title: title_from_file_name(file_name),
        language,
        terms,
    })
}

pub(super) fn serialize_tmx_qa_list(
    qa_list: &StoredQaListFile,
    terms: &[StoredQaListTermFile],
) -> String {
    let language_code = escape_xml_attr(&qa_list.language.code);
    let body = terms
        .iter()
        .map(|term| {
            let notes = if term.notes.trim().is_empty() {
                String::new()
            } else {
                format!("      <note>{}</note>\n", escape_xml_text(&term.notes))
            };
            let case_sensitive = if term.is_case_sensitive {
                "      <prop type=\"x-gnosis-qa-case-sensitive\">true</prop>\n"
            } else {
                ""
            };
            let regular_expression = if term.is_regular_expression {
                "      <prop type=\"x-gnosis-qa-regular-expression\">true</prop>\n"
            } else {
                ""
            };
            format!(
                "    <tu tuid=\"{}\">\n{}{}{}      <tuv xml:lang=\"{}\"><seg>{}</seg></tuv>\n    </tu>",
                escape_xml_attr(&term.term_id),
                notes,
                case_sensitive,
                regular_expression,
                language_code,
                escape_xml_text(&term.text),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<tmx version=\"1.4\">\n  <header creationtool=\"Gnosis TMS\" creationtoolversion=\"1\" segtype=\"phrase\" o-tmf=\"GnosisTMS\" adminlang=\"en\" srclang=\"{}\" datatype=\"plaintext\"/>\n  <body>\n{}\n  </body>\n</tmx>\n",
        language_code, body
    )
}

fn read_tmx_attr(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
    attr_name: &[u8],
) -> Result<Option<String>, String> {
    for attr in event.attributes() {
        let attr = attr.map_err(|error| format!("Could not read a TMX attribute: {error}"))?;
        if attr.key.as_ref() == attr_name {
            let value = attr
                .decode_and_unescape_value(reader)
                .map_err(|error| format!("Could not decode a TMX attribute: {error}"))?
                .into_owned();
            return Ok(Some(value));
        }
    }
    Ok(None)
}

fn read_tuv_language(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
) -> Result<Option<String>, String> {
    match read_tmx_attr(reader, event, b"xml:lang")? {
        Some(value) => Ok(Some(value)),
        None => read_tmx_attr(reader, event, b"lang"),
    }
}

fn clean_tmx_text(value: &str) -> String {
    value
        .replace('\u{a0}', " ")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn title_from_file_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.replace(['_', '-'], " "))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Imported QA List".to_string())
}

fn normalize_language_code(value: &str) -> String {
    value
        .trim()
        .replace('_', "-")
        .split('-')
        .enumerate()
        .map(|(index, subtag)| {
            if index == 0 {
                return subtag.to_ascii_lowercase();
            }
            if subtag.len() == 4
                && subtag
                    .chars()
                    .all(|character| character.is_ascii_alphabetic())
            {
                let mut characters = subtag.chars();
                let first = characters
                    .next()
                    .map(|character| character.to_ascii_uppercase())
                    .unwrap_or_default();
                return format!("{first}{}", characters.as_str().to_ascii_lowercase());
            }
            if (subtag.len() == 2
                && subtag
                    .chars()
                    .all(|character| character.is_ascii_alphabetic()))
                || (subtag.len() == 3 && subtag.chars().all(|character| character.is_ascii_digit()))
            {
                return subtag.to_ascii_uppercase();
            }
            subtag.to_ascii_lowercase()
        })
        .collect::<Vec<_>>()
        .join("-")
}

fn language_info_for_code(code: &str) -> QaListLanguageInfo {
    let normalized = normalize_language_code(code);
    let name = language_name_map()
        .get(normalized.as_str())
        .cloned()
        .unwrap_or_else(|| normalized.clone());

    QaListLanguageInfo {
        code: normalized,
        name,
    }
}

fn language_name_map() -> &'static std::collections::BTreeMap<String, String> {
    static MAP: OnceLock<std::collections::BTreeMap<String, String>> = OnceLock::new();
    MAP.get_or_init(|| {
        let mut map = std::collections::BTreeMap::new();
        for line in ISO_LANGUAGE_OPTIONS_SOURCE.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with("[\"") {
                continue;
            }
            let parts = trimmed.split('"').collect::<Vec<_>>();
            if parts.len() >= 4 {
                let code = normalize_language_code(parts[1]);
                let name = parts[3].trim().to_string();
                if !code.is_empty() && !name.is_empty() {
                    map.insert(code, name);
                }
            }
        }
        map
    })
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_xml_attr(value: &str) -> String {
    escape_xml_text(value).replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::parse_tmx_qa_list;

    fn qa_tmx(first_id: &str, second_id: &str) -> String {
        format!(
            r#"<tmx version="1.4"><header srclang="en"/><body>
<tu tuid="{first_id}"><tuv xml:lang="en"><seg>First check</seg></tuv></tu>
<tu tuid="{second_id}"><tuv xml:lang="en"><seg>Second check</seg></tuv></tu>
</body></tmx>"#
        )
    }

    #[test]
    fn blank_tuids_receive_distinct_generated_term_ids() {
        let xml = qa_tmx("", "   ");
        let parsed = parse_tmx_qa_list("blank-ids.tmx", xml.as_bytes()).expect("parse TMX");

        assert_eq!(parsed.terms.len(), 2);
        assert!(!parsed.terms[0].term_id.is_empty());
        assert!(!parsed.terms[1].term_id.is_empty());
        assert_ne!(parsed.terms[0].term_id, parsed.terms[1].term_id);
    }

    #[test]
    fn duplicate_tuids_are_rejected_before_import() {
        let xml = qa_tmx("duplicate-id", "duplicate-id");
        let error = parse_tmx_qa_list("duplicate-ids.tmx", xml.as_bytes())
            .err()
            .expect("duplicate ids must fail");

        assert!(error.contains("duplicate translation-unit id 'duplicate-id'"));
    }

    #[test]
    fn preserves_traditional_chinese_script_subtag_and_name() {
        let xml = r#"<tmx version="1.4"><header srclang="zh-Hant"/><body>
<tu tuid="term-1"><tuv xml:lang="zh-Hant"><seg>第一項檢查</seg></tuv></tu>
</body></tmx>"#;
        let parsed = parse_tmx_qa_list("traditional-chinese.tmx", xml.as_bytes())
            .expect("parse Traditional Chinese QA TMX");

        assert_eq!(parsed.language.code, "zh-Hant");
        assert_eq!(parsed.language.name, "Chinese (Traditional)");
    }
}
