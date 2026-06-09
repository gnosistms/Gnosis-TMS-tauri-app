use std::{collections::BTreeMap, io::Cursor};

use calamine::{open_workbook_auto_from_rs, Data, Reader};

use super::{
    humanize_file_stem,
    languages::{language_display_name, normalize_language_code},
    GuidanceComment, ImportXlsxInput, ImportedField, ImportedLanguage, ImportedRow, ParsedWorkbook,
};

#[derive(Clone, Debug)]
pub(super) enum ColumnBinding {
    Language {
        code: String,
        name: String,
        base_code: Option<String>,
    },
}

pub(super) fn parse_xlsx_workbook(input: ImportXlsxInput) -> Result<ParsedWorkbook, String> {
    if input.bytes.is_empty() {
        return Err("The selected workbook is empty.".to_string());
    }

    let mut workbook = open_workbook_auto_from_rs(Cursor::new(input.bytes))
        .map_err(|_| {
            "Could not open the workbook. Make sure the Google Sheet can be exported as XLSX and try again."
                .to_string()
        })?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "The workbook does not contain any worksheets. Add a sheet with language-code headers in the first row.".to_string())?;
    let range = workbook
        .worksheet_range_at(0)
        .ok_or_else(|| "The workbook does not contain any worksheets. Add a sheet with language-code headers in the first row.".to_string())?
        .map_err(|_| "Could not read the first worksheet.".to_string())?;
    let header_row = range
        .rows()
        .next()
        .ok_or_else(|| "The first worksheet is missing a header row. Add supported language codes to row 1, such as es, en, vi, zh-Hans, or zh-Hant.".to_string())?;

    let header_blob = trim_trailing_empty_headers(
        header_row
            .iter()
            .map(cell_to_trimmed_string)
            .collect::<Vec<_>>(),
    );
    let bindings = allocate_duplicate_language_columns(classify_header_row(&header_blob)?);
    let languages = bindings
        .iter()
        .map(|binding| match binding {
            ColumnBinding::Language {
                code,
                name,
                base_code,
            } => (code.clone(), name.clone(), base_code.clone()),
        })
        .collect::<Vec<_>>();

    if languages.is_empty() {
        return Err(
      "Could not detect any language columns in row 1. Add supported language codes such as es, en, vi, zh-Hans, or zh-Hant."
        .to_string(),
    );
    }

    let languages = languages
        .into_iter()
        .enumerate()
        .map(|(index, (code, name, base_code))| ImportedLanguage {
            code,
            name,
            role: if index == 0 { "source" } else { "target" },
            base_code,
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
                    fields.insert(code.clone(), split_xlsx_cell_text_and_footnote(&value));
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
            text_style: None,
            docx_metadata: None,
            html_metadata: None,
        });
    }

    if rows.is_empty() {
        return Err(
            "The workbook has valid language headers, but no importable text rows below row 1."
                .to_string(),
        );
    }

    Ok(ParsedWorkbook {
        installation_id: input.installation_id,
        repo_name: input.repo_name,
        project_id: input.project_id,
        file_title: humanize_file_stem(&input.file_name),
        worksheet_name: sheet_name,
        source_file_name: input.file_name,
        source_format: "xlsx",
        header_blob,
        languages,
        rows,
        import_summary: None,
    })
}

/// calamine pads every row (including the header) to the worksheet's used-range width, which can
/// include trailing empty-but-formatted columns — a common spreadsheet export artifact. Drop trailing
/// blank header cells so a stray wide range is not mistaken for a real column with a missing language
/// code. Interior blank headers are preserved so `classify_header_row` still rejects genuine gaps.
fn trim_trailing_empty_headers(mut headers: Vec<String>) -> Vec<String> {
    while headers
        .last()
        .map(|header| header.trim().is_empty())
        .unwrap_or(false)
    {
        headers.pop();
    }
    headers
}

pub(super) fn classify_header_row(headers: &[String]) -> Result<Vec<ColumnBinding>, String> {
    if headers.is_empty() {
        return Err("The first worksheet is missing a header row. Add supported language codes to row 1, such as es, en, vi, zh-Hans, or zh-Hant.".to_string());
    }

    headers
        .iter()
        .enumerate()
        .map(|(index, header)| classify_header(header, index))
        .collect::<Result<Vec<_>, _>>()
}

fn classify_header(header: &str, column_index: usize) -> Result<ColumnBinding, String> {
    if header.trim().is_empty() {
        return Err(format!(
            "Column {} in row 1 is blank. Every imported column must start with a supported language code.",
            column_index + 1
        ));
    }
    let code = normalize_language_code(header).ok_or_else(|| {
        format!(
            "Column {} in row 1 has unsupported language code \"{}\". Use supported codes such as es, en, vi, zh-Hans, or zh-Hant.",
            column_index + 1,
            header.trim(),
        )
    })?;
    let name = language_display_name(&code);
    Ok(ColumnBinding::Language {
        code,
        name,
        base_code: None,
    })
}

fn allocate_duplicate_language_columns(bindings: Vec<ColumnBinding>) -> Vec<ColumnBinding> {
    let mut totals = BTreeMap::<String, usize>::new();
    for binding in bindings.iter() {
        match binding {
            ColumnBinding::Language { code, .. } => {
                *totals.entry(code.clone()).or_default() += 1;
            }
        }
    }

    let mut seen = BTreeMap::<String, usize>::new();
    bindings
        .into_iter()
        .map(|binding| match binding {
            ColumnBinding::Language { code, name, .. } => {
                let total = totals.get(&code).copied().unwrap_or(0);
                if total <= 1 {
                    return ColumnBinding::Language {
                        code,
                        name,
                        base_code: None,
                    };
                }

                let entry = seen.entry(code.clone()).or_default();
                *entry += 1;
                let index = *entry;
                let unique_code = if index == 1 {
                    code.clone()
                } else {
                    format!("{code}-x-{index}")
                };
                let base_name = language_display_name(&code);
                ColumnBinding::Language {
                    code: unique_code,
                    name: format!("{base_name} {index}"),
                    base_code: Some(code),
                }
            }
        })
        .collect()
}

fn row_is_empty(
    external_id: &Option<String>,
    description: &Option<String>,
    context: &Option<String>,
    comments: &[GuidanceComment],
    fields: &BTreeMap<String, ImportedField>,
) -> bool {
    external_id.is_none()
        && description.is_none()
        && context.is_none()
        && comments.is_empty()
        && fields
            .values()
            .all(|value| value.plain_text.is_empty() && value.footnote.is_empty())
}

fn cell_to_trimmed_string(cell: &Data) -> String {
    let text = match cell {
        Data::Empty => String::new(),
        Data::Float(value) if value.fract().abs() < f64::EPSILON => format!("{value:.0}"),
        _ => cell.to_string(),
    };
    text.trim().to_string()
}

pub(super) fn split_xlsx_cell_text_and_footnote(value: &str) -> ImportedField {
    match value.split_once("***") {
        Some((plain_text, footnote)) => ImportedField {
            plain_text: plain_text.trim().to_string(),
            footnote: footnote.trim().to_string(),
            image_caption: String::new(),
            image: None,
        },
        None => ImportedField {
            plain_text: value.to_string(),
            footnote: String::new(),
            image_caption: String::new(),
            image: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        allocate_duplicate_language_columns, classify_header_row, trim_trailing_empty_headers,
        ColumnBinding,
    };

    fn headers(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn trim_trailing_empty_headers_drops_padding_but_keeps_interior_gaps() {
        // Trailing blank/whitespace columns (calamine range padding) are dropped.
        assert_eq!(
            trim_trailing_empty_headers(headers(&["es", "en", "ja", ""])),
            headers(&["es", "en", "ja"]),
        );
        assert_eq!(
            trim_trailing_empty_headers(headers(&["es", "en", "  ", ""])),
            headers(&["es", "en"]),
        );
        // An interior blank is a genuine gap and must be preserved for validation.
        assert_eq!(
            trim_trailing_empty_headers(headers(&["es", "", "ja"])),
            headers(&["es", "", "ja"]),
        );
        assert!(trim_trailing_empty_headers(headers(&["", ""])).is_empty());
    }

    #[test]
    fn trailing_empty_header_column_does_not_error() {
        // Regression: a stray empty trailing column must not be mistaken for a blank language header
        // (the "Column 4 in row 1 is blank" false positive on otherwise-valid 3-column sheets).
        let bindings = classify_header_row(&trim_trailing_empty_headers(headers(&[
            "es", "en", "ja", "",
        ])))
        .expect("trailing-padded headers should classify");
        assert_eq!(bindings.len(), 3);
    }

    #[test]
    fn interior_blank_header_still_errors() {
        let error = classify_header_row(&trim_trailing_empty_headers(headers(&["es", "", "ja"])))
            .expect_err("an interior blank header must still be rejected");
        assert!(error.contains("Column 2 in row 1 is blank"));
    }

    #[test]
    fn allocate_duplicate_language_columns_uses_unique_codes_and_numbered_names() {
        let bindings = allocate_duplicate_language_columns(
            classify_header_row(&[
                "zh-Hans".to_string(),
                "en".to_string(),
                "zh-Hans".to_string(),
            ])
            .expect("headers should classify"),
        );

        let languages = bindings
            .into_iter()
            .map(|binding| match binding {
                ColumnBinding::Language {
                    code,
                    name,
                    base_code,
                } => (code, name, base_code),
            })
            .collect::<Vec<_>>();

        assert_eq!(
            languages,
            vec![
                (
                    "zh-Hans".to_string(),
                    "Chinese (Simplified) 1".to_string(),
                    Some("zh-Hans".to_string()),
                ),
                ("en".to_string(), "English".to_string(), None),
                (
                    "zh-Hans-x-2".to_string(),
                    "Chinese (Simplified) 2".to_string(),
                    Some("zh-Hans".to_string()),
                ),
            ],
        );
    }
}
