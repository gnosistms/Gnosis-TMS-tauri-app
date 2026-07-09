use std::collections::BTreeMap;

use super::{
    humanize_file_stem,
    languages::{language_display_name, normalize_language_code},
    ImportTxtInput, ImportedField, ImportedLanguage, ImportedRow, ParsedWorkbook,
};

// Cap the number of imported rows, matching the DOCX importer's DOCX_MAX_IMPORTED_ROWS.
// Without this, the only ceiling is the 25 MB raw-byte guard, so a dense text file (one
// short token per line) could yield millions of rows and exhaust memory / create a
// matching flood of row files.
const MAX_TXT_IMPORTED_ROWS: usize = 20_000;

pub(super) fn parse_txt_file(input: ImportTxtInput) -> Result<ParsedWorkbook, String> {
    if input.bytes.is_empty() {
        return Err("The selected file is empty.".to_string());
    }

    let code = normalize_language_code(&input.source_language_code)
        .ok_or_else(|| "Select a supported source language.".to_string())?;
    let name = language_display_name(&code);
    let decoded = decode_text_file(&input.bytes)?;
    let mut rows = Vec::new();

    for (line_index, line) in decoded.lines().enumerate() {
        let plain_text = line.trim().to_string();
        if plain_text.is_empty() {
            continue;
        }

        if rows.len() >= MAX_TXT_IMPORTED_ROWS {
            return Err("The selected text file contains too many rows to import.".to_string());
        }

        let mut fields = BTreeMap::new();
        fields.insert(
            code.clone(),
            ImportedField {
                plain_text,
                footnote: String::new(),
                image_caption: String::new(),
                image: None,
            },
        );
        rows.push(ImportedRow {
            external_id: None,
            description: None,
            context: None,
            comments: Vec::new(),
            source_row_number: line_index + 1,
            fields,
            text_style: None,
            docx_metadata: None,
            html_metadata: None,
        });
    }

    if rows.is_empty() {
        return Err("The selected text file does not contain any non-blank lines.".to_string());
    }

    Ok(ParsedWorkbook {
        installation_id: input.installation_id,
        repo_name: input.repo_name,
        project_id: input.project_id,
        file_title: humanize_file_stem(&input.file_name),
        worksheet_name: "Plain text".to_string(),
        source_file_name: input.file_name,
        source_format: "txt",
        header_blob: Vec::new(),
        languages: vec![ImportedLanguage {
            code,
            name,
            role: "source",
            base_code: None,
        }],
        rows,
        import_summary: None,
    })
}

pub(super) fn decode_text_file(bytes: &[u8]) -> Result<String, String> {
    const ENCODING_ERROR: &str =
        "The text file encoding is not supported. Save it as UTF-8 or UTF-16 and try again.";

    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return std::str::from_utf8(&bytes[3..])
            .map(|value| value.to_string())
            .map_err(|_| ENCODING_ERROR.to_string());
    }

    if bytes.starts_with(&[0xFF, 0xFE]) {
        return decode_utf16_bytes(&bytes[2..], true).map_err(|_| ENCODING_ERROR.to_string());
    }

    if bytes.starts_with(&[0xFE, 0xFF]) {
        return decode_utf16_bytes(&bytes[2..], false).map_err(|_| ENCODING_ERROR.to_string());
    }

    std::str::from_utf8(bytes)
        .map(|value| value.to_string())
        .map_err(|_| ENCODING_ERROR.to_string())
}

fn decode_utf16_bytes(bytes: &[u8], little_endian: bool) -> Result<String, ()> {
    if !bytes.len().is_multiple_of(2) {
        return Err(());
    }

    let units = bytes.chunks_exact(2).map(|chunk| {
        if little_endian {
            u16::from_le_bytes([chunk[0], chunk[1]])
        } else {
            u16::from_be_bytes([chunk[0], chunk[1]])
        }
    });

    std::char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .map_err(|_| ())
}
