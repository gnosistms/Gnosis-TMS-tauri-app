use std::{collections::BTreeSet, path::Path, sync::OnceLock};

use quick_xml::{events::Event, Reader};
use uuid::Uuid;

use super::{QaListLanguageInfo, StoredLifecycle, StoredQaListFile, StoredQaListTermFile};

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
    current_segment: String,
    notes: Vec<String>,
    segments: Vec<(String, String)>,
    inside_note: bool,
    inside_segment: bool,
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
                b"seg" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_segment = false;
                        let segment = clean_tmx_text(&unit.current_segment);
                        let language = unit.current_language.clone().unwrap_or_default();
                        unit.segments.push((language, segment));
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
            let text = unit
                .segments
                .into_iter()
                .find_map(|(segment_language, segment)| {
                    let segment_language_code = normalize_language_code(&segment_language);
                    if !segment_language_code.is_empty() && segment_language_code != language_code {
                        return None;
                    }
                    let trimmed = clean_tmx_text(&segment);
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed)
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
                lifecycle: StoredLifecycle {
                    state: "active".to_string(),
                },
            })
        })
        .collect::<Vec<_>>();

    if terms.is_empty() {
        return Err("The TMX file does not contain any QA terms.".to_string());
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
            format!(
                "    <tu tuid=\"{}\">\n{}      <tuv xml:lang=\"{}\"><seg>{}</seg></tuv>\n    </tu>",
                escape_xml_attr(&term.term_id),
                notes,
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
        .next()
        .unwrap_or_default()
        .to_lowercase()
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
            if !trimmed.starts_with("{ code:") {
                continue;
            }
            let code = extract_js_string_property(trimmed, "code");
            let name = extract_js_string_property(trimmed, "name");
            if let (Some(code), Some(name)) = (code, name) {
                map.insert(normalize_language_code(&code), name);
            }
        }
        map
    })
}

fn extract_js_string_property(line: &str, property: &str) -> Option<String> {
    let marker = format!("{property}: \"");
    let start = line.find(&marker)? + marker.len();
    let rest = &line[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
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
}
