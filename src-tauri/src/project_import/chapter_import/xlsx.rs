use std::{collections::BTreeMap, io::Cursor};

use calamine::{open_workbook_auto_from_rs, Data, Reader};

use super::{
    humanize_file_stem,
    languages::{language_display_name, normalize_language_code},
    GuidanceComment, ImportXlsxInput, ImportedField, ImportedLanguage, ImportedRow, ParsedWorkbook,
};

#[derive(Clone, Debug)]
pub(super) enum ColumnBinding {
    Language { code: String, name: String },
}

pub(super) fn parse_xlsx_workbook(input: ImportXlsxInput) -> Result<ParsedWorkbook, String> {
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
      "Could not detect any language columns. Add supported language codes like 'es', 'en', 'vi', 'zh-Hans', or 'zh-Hant' to the first row."
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
        });
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

pub(super) fn classify_header_row(headers: &[String]) -> Result<Vec<ColumnBinding>, String> {
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
            "Column {} must start with a supported language code.",
            column_index + 1
        )
    })?;
    let name = language_display_name(&code);
    Ok(ColumnBinding::Language { code, name })
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
        },
        None => ImportedField {
            plain_text: value.to_string(),
            footnote: String::new(),
        },
    }
}
