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

    let header_cells = header_row
        .iter()
        .map(cell_to_trimmed_string)
        .collect::<Vec<_>>();

    // calamine pads every row to the worksheet's used-range width, so the header row can pick up
    // trailing empty columns when the used range is wider than the real data (a common spreadsheet
    // export artifact). Only ignore a trailing column when it is WHOLLY empty — a blank header AND no
    // data in any row. A trailing column that has data but a blank/invalid header is kept so
    // validation refuses the file, rather than silently dropping a column the user meant to import.
    let mut column_has_data = vec![false; header_cells.len()];
    for row in range.rows().skip(1) {
        for (column_index, present) in column_has_data.iter_mut().enumerate() {
            if !*present
                && row
                    .get(column_index)
                    .map(|cell| !cell_to_trimmed_string(cell).is_empty())
                    .unwrap_or(false)
            {
                *present = true;
            }
        }
    }
    let effective_width = effective_header_width(&header_cells, &column_has_data);
    let header_blob = header_cells[..effective_width].to_vec();
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
/// Number of leading columns to validate/import: drop only the contiguous trailing columns that are
/// WHOLLY empty (blank header AND no data in any row) — calamine's used-range padding. A trailing
/// column with data but a blank header is retained so `classify_header_row` rejects it instead of the
/// importer silently discarding a column the user intended to import. Interior blank-header columns
/// are likewise retained (and rejected), since a gap between populated columns signals a real mistake.
fn effective_header_width(header_cells: &[String], column_has_data: &[bool]) -> usize {
    let mut width = header_cells.len();
    while width > 0 {
        let column_index = width - 1;
        let header_blank = header_cells[column_index].trim().is_empty();
        let has_data = column_has_data.get(column_index).copied().unwrap_or(false);
        if !header_blank || has_data {
            break;
        }
        width -= 1;
    }
    width
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
        allocate_duplicate_language_columns, classify_header_row, effective_header_width,
        ColumnBinding,
    };

    fn headers(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn effective_header_width_drops_only_wholly_empty_trailing_columns() {
        // Trailing column with a blank header AND no data (calamine used-range padding) is dropped.
        assert_eq!(
            effective_header_width(
                &headers(&["es", "en", "ja", ""]),
                &[true, true, true, false]
            ),
            3,
        );
        // Several trailing wholly-empty columns are all dropped.
        assert_eq!(
            effective_header_width(
                &headers(&["es", "en", "ja", "", ""]),
                &[true, true, true, false, false],
            ),
            3,
        );
        // Nothing to drop when the last column is real.
        assert_eq!(
            effective_header_width(&headers(&["es", "en", "ja"]), &[true, true, true]),
            3,
        );
        // An interior blank header is not trailing, so it is retained (and later rejected).
        assert_eq!(
            effective_header_width(&headers(&["es", "", "ja"]), &[true, false, true]),
            3,
        );
        assert_eq!(
            effective_header_width(&headers(&["", "", ""]), &[false, false, false]),
            0,
        );
    }

    #[test]
    fn effective_header_width_keeps_trailing_column_that_has_data() {
        // A trailing column with a blank header BUT data must NOT be dropped — it has to reach
        // validation so the file is refused rather than silently losing the column.
        assert_eq!(
            effective_header_width(&headers(&["es", "en", "ja", ""]), &[true, true, true, true]),
            4,
        );
    }

    #[test]
    fn wholly_empty_trailing_column_imports_without_error() {
        // Regression: a stray empty trailing column must not be mistaken for a blank language header
        // (the "Column 4 in row 1 is blank" false positive on otherwise-valid 3-column sheets).
        let cells = headers(&["es", "en", "ja", ""]);
        let width = effective_header_width(&cells, &[true, true, true, false]);
        let bindings =
            classify_header_row(&cells[..width]).expect("padded headers should classify");
        assert_eq!(bindings.len(), 3);
    }

    #[test]
    fn trailing_column_with_data_but_blank_header_is_refused() {
        // Data under a blank header must be refused, not silently dropped.
        let cells = headers(&["es", "en", "ja", ""]);
        let width = effective_header_width(&cells, &[true, true, true, true]);
        let error = classify_header_row(&cells[..width])
            .expect_err("a column with data but no header must be rejected");
        assert!(error.contains("Column 4 in row 1 is blank"));
    }

    #[test]
    fn interior_blank_header_still_errors() {
        let cells = headers(&["es", "", "ja"]);
        let width = effective_header_width(&cells, &[true, false, true]);
        let error = classify_header_row(&cells[..width])
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
