use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::OnceLock,
};

use quick_xml::{events::Event, Reader};
use uuid::Uuid;

use super::{
    terms::{sanitize_target_term_values, sanitize_term_values},
    GlossaryLanguageInfo, StoredGlossaryFile, StoredGlossaryTermFile, StoredLifecycle,
};

const ISO_LANGUAGE_OPTIONS_SOURCE: &str = include_str!("../../../src-ui/lib/language-options.js");

pub(super) struct ParsedTmxGlossary {
    pub(super) title: String,
    pub(super) source_language: GlossaryLanguageInfo,
    pub(super) target_language: GlossaryLanguageInfo,
    pub(super) terms: Vec<StoredGlossaryTermFile>,
}

#[derive(Default)]
struct ParsedTmxUnit {
    term_id: Option<String>,
    entries_by_language: BTreeMap<String, Vec<String>>,
    note: String,
    footnote: String,
    untranslated: bool,
}

#[derive(Default)]
struct WorkingTmxUnit {
    term_id: Option<String>,
    entries_by_language: BTreeMap<String, Vec<String>>,
    note_fragments: Vec<String>,
    current_prop_type: Option<String>,
    current_prop: String,
    footnote: String,
    untranslated: bool,
    current_language: Option<String>,
    current_note: String,
    current_segment: String,
    inside_prop: bool,
    inside_note: bool,
    inside_segment: bool,
}

pub(super) fn parse_tmx_glossary(
    file_name: &str,
    bytes: &[u8],
) -> Result<ParsedTmxGlossary, String> {
    if !String::from(file_name)
        .trim()
        .to_lowercase()
        .ends_with(".tmx")
    {
        return Err("TMX is the only supported glossary import format right now.".to_string());
    }

    let mut xml = String::from_utf8(bytes.to_vec())
        .map_err(|error| format!("The TMX file is not valid UTF-8: {error}"))?;
    if xml.starts_with('\u{feff}') {
        xml = xml.trim_start_matches('\u{feff}').to_string();
    }

    let mut reader = Reader::from_str(&xml);
    reader.trim_text(false);

    let mut buffer = Vec::new();
    let mut source_language_code = None::<String>;
    let mut units = Vec::<ParsedTmxUnit>::new();
    let mut current_unit = None::<WorkingTmxUnit>;

    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| format!("Could not parse the TMX file: {error}"))?
        {
            Event::Eof => break,
            Event::Start(event) => match event.name().as_ref() {
                b"header" | b"headers" => {
                    if source_language_code.is_none() {
                        source_language_code = read_tmx_language_attr(&reader, &event, b"srclang")?;
                    }
                }
                b"tu" => {
                    current_unit = Some(WorkingTmxUnit {
                        term_id: read_tmx_language_attr(&reader, &event, b"tuid")?,
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
                        unit.current_prop_type = read_tmx_language_attr(&reader, &event, b"type")?;
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
                b"header" | b"headers" => {
                    if source_language_code.is_none() {
                        source_language_code = read_tmx_language_attr(&reader, &event, b"srclang")?;
                    }
                }
                b"note" => {}
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
                b"prop" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_prop = false;
                        let value = clean_tmx_text(&unit.current_prop);
                        match unit.current_prop_type.as_deref() {
                            Some("x-gnosis-footnote") => {
                                unit.footnote = value;
                            }
                            Some("x-gnosis-untranslated") => {
                                unit.untranslated = value.eq_ignore_ascii_case("true");
                            }
                            _ => {}
                        }
                        unit.current_prop_type = None;
                        unit.current_prop.clear();
                    }
                }
                b"note" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_note = false;
                        let note = clean_tmx_text(&unit.current_note);
                        if !note.is_empty() {
                            unit.note_fragments.push(note);
                        }
                        unit.current_note.clear();
                    }
                }
                b"seg" => {
                    if let Some(unit) = current_unit.as_mut() {
                        unit.inside_segment = false;
                        let segment = clean_tmx_text(&unit.current_segment);
                        if let Some(language) = unit.current_language.clone() {
                            unit.entries_by_language
                                .entry(language)
                                .or_default()
                                .push(segment);
                        }
                        unit.current_segment.clear();
                    }
                }
                b"tu" => {
                    if let Some(unit) = current_unit.take() {
                        units.push(ParsedTmxUnit {
                            term_id: unit
                                .term_id
                                .map(|value| value.trim().to_string())
                                .filter(|value| !value.is_empty()),
                            entries_by_language: unit.entries_by_language,
                            note: unit.note_fragments.join("\n\n"),
                            footnote: unit.footnote,
                            untranslated: unit.untranslated,
                        });
                    }
                }
                _ => {}
            },
            _ => {}
        }

        buffer.clear();
    }

    let source_language_code = normalize_tmx_language_code(
        source_language_code
            .ok_or_else(|| "The TMX file is missing srclang in the header.".to_string())?
            .as_str(),
    );
    if source_language_code.is_empty() {
        return Err("The TMX file source language is empty or invalid.".to_string());
    }

    let mut target_language_codes = BTreeSet::new();
    for unit in &units {
        for language_code in unit.entries_by_language.keys() {
            if language_code != &source_language_code {
                target_language_codes.insert(language_code.clone());
            }
        }
    }

    let target_language_code = if target_language_codes.len() == 1 {
        target_language_codes.into_iter().next().unwrap_or_default()
    } else if target_language_codes.is_empty() {
        return Err("The TMX file does not contain any target-language segments.".to_string());
    } else {
        return Err(format!(
      "The TMX file contains multiple target languages ({}). Import supports exactly one target language per glossary.",
      target_language_codes.into_iter().collect::<Vec<_>>().join(", "),
    ));
    };

    if target_language_code == source_language_code {
        return Err(
            "The TMX file source and target languages resolve to the same code.".to_string(),
        );
    }

    let mut terms = Vec::new();
    for unit in units {
        let source_values = unit
            .entries_by_language
            .get(&source_language_code)
            .cloned()
            .unwrap_or_default();
        let source_terms = sanitize_term_values(&source_values);
        if source_terms.is_empty() {
            continue;
        }

        let target_values = unit
            .entries_by_language
            .get(&target_language_code)
            .cloned()
            .unwrap_or_default();
        let target_terms = if target_values.is_empty() {
            vec![String::new()]
        } else {
            sanitize_target_term_values(&target_values)
        };

        terms.push(StoredGlossaryTermFile {
            term_id: unit.term_id.unwrap_or_else(|| Uuid::now_v7().to_string()),
            source_terms,
            target_terms,
            notes_to_translators: clean_tmx_text(&unit.note),
            footnote: clean_tmx_text(&unit.footnote),
            untranslated: unit.untranslated,
            lifecycle: StoredLifecycle {
                state: "active".to_string(),
            },
        });
    }

    if terms.is_empty() {
        return Err("The TMX file did not contain any importable translation units.".to_string());
    }

    let title = title_from_import_file_name(file_name);
    let source_language_name = language_name_for_iso_code(&source_language_code)
        .unwrap_or_else(|| source_language_code.to_uppercase());
    let target_language_name = language_name_for_iso_code(&target_language_code)
        .unwrap_or_else(|| target_language_code.to_uppercase());

    Ok(ParsedTmxGlossary {
        title,
        source_language: GlossaryLanguageInfo {
            code: source_language_code,
            name: source_language_name,
        },
        target_language: GlossaryLanguageInfo {
            code: target_language_code,
            name: target_language_name,
        },
        terms,
    })
}

pub(super) fn serialize_tmx_glossary(
    glossary: &StoredGlossaryFile,
    terms: &[StoredGlossaryTermFile],
) -> String {
    let source_code = glossary.languages.source.code.trim();
    let target_code = glossary.languages.target.code.trim();
    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str("<tmx version=\"1.4\">\n");
    xml.push_str("  <header creationtool=\"Gnosis TMS\" creationtoolversion=\"");
    xml.push_str(&escape_xml_attr(env!("CARGO_PKG_VERSION")));
    xml.push_str("\" segtype=\"phrase\" o-tmf=\"Gnosis TMS\" adminlang=\"en\" srclang=\"");
    xml.push_str(&escape_xml_attr(source_code));
    xml.push_str("\" datatype=\"plaintext\">\n");
    xml.push_str("    <prop type=\"x-gnosis-glossary-title\">");
    xml.push_str(&escape_xml_text(&glossary.title));
    xml.push_str("</prop>\n");
    xml.push_str("  </header>\n");
    xml.push_str("  <body>\n");

    for term in terms {
        xml.push_str("    <tu tuid=\"");
        xml.push_str(&escape_xml_attr(&term.term_id));
        xml.push_str("\">\n");
        let notes = clean_tmx_text(&term.notes_to_translators);
        if !notes.is_empty() {
            xml.push_str("      <note>");
            xml.push_str(&escape_xml_text(&notes));
            xml.push_str("</note>\n");
        }
        let footnote = clean_tmx_text(&term.footnote);
        if !footnote.is_empty() {
            xml.push_str("      <prop type=\"x-gnosis-footnote\">");
            xml.push_str(&escape_xml_text(&footnote));
            xml.push_str("</prop>\n");
        }
        if term.untranslated {
            xml.push_str("      <prop type=\"x-gnosis-untranslated\">true</prop>\n");
        }
        for source_term in &term.source_terms {
            write_tmx_tuv(&mut xml, source_code, source_term);
        }
        for target_term in &term.target_terms {
            write_tmx_tuv(&mut xml, target_code, target_term);
        }
        xml.push_str("    </tu>\n");
    }

    xml.push_str("  </body>\n");
    xml.push_str("</tmx>\n");
    xml
}

fn write_tmx_tuv(xml: &mut String, language_code: &str, segment: &str) {
    xml.push_str("      <tuv xml:lang=\"");
    xml.push_str(&escape_xml_attr(language_code));
    xml.push_str("\"><seg>");
    xml.push_str(&escape_xml_text(segment));
    xml.push_str("</seg></tuv>\n");
}

fn escape_xml_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn escape_xml_attr(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn title_from_import_file_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Imported glossary")
        .to_string()
}

fn clean_tmx_text(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_tmx_language_code(value: &str) -> String {
    value
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase()
}

fn read_tmx_language_attr(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
    attribute_name: &[u8],
) -> Result<Option<String>, String> {
    for attribute in event.attributes().with_checks(false) {
        let attribute =
            attribute.map_err(|error| format!("Could not read a TMX attribute: {error}"))?;
        if attribute.key.as_ref() != attribute_name {
            continue;
        }

        let value = attribute
            .decode_and_unescape_value(reader)
            .map_err(|error| format!("Could not decode a TMX attribute: {error}"))?
            .into_owned();
        return Ok(Some(value));
    }

    Ok(None)
}

fn read_tuv_language(
    reader: &Reader<&[u8]>,
    event: &quick_xml::events::BytesStart<'_>,
) -> Result<Option<String>, String> {
    for attribute in event.attributes().with_checks(false) {
        let attribute =
            attribute.map_err(|error| format!("Could not read a TMX attribute: {error}"))?;
        let key = attribute.key.as_ref();
        if key != b"xml:lang" && key != b"lang" {
            continue;
        }

        let value = attribute
            .decode_and_unescape_value(reader)
            .map_err(|error| format!("Could not decode a TMX language value: {error}"))?
            .into_owned();
        let normalized = normalize_tmx_language_code(&value);
        if normalized.is_empty() {
            return Ok(None);
        }
        return Ok(Some(normalized));
    }

    Ok(None)
}

fn language_name_for_iso_code(code: &str) -> Option<String> {
    static ISO_LANGUAGE_NAMES: OnceLock<BTreeMap<String, String>> = OnceLock::new();

    ISO_LANGUAGE_NAMES
        .get_or_init(|| {
            let mut names = BTreeMap::new();
            for line in ISO_LANGUAGE_OPTIONS_SOURCE.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with("[\"") {
                    continue;
                }
                let parts = trimmed.split('"').collect::<Vec<_>>();
                if parts.len() < 4 {
                    continue;
                }
                let iso_code = parts[1].trim().to_lowercase();
                let iso_name = parts[3].trim().to_string();
                if !iso_code.is_empty() && !iso_name.is_empty() {
                    names.insert(iso_code, iso_name);
                }
            }
            names
        })
        .get(&code.trim().to_lowercase())
        .cloned()
}
