use std::path::Path;

const IMPORT_SAMPLE: &[u8] = include_bytes!("../../resources/gnosis-tms-import-sample.xlsx");

fn save_import_sample(output_path: &Path) -> Result<(), String> {
    if !output_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("xlsx"))
    {
        return Err("Choose a filename ending in .xlsx for the import sample.".to_string());
    }
    std::fs::write(output_path, IMPORT_SAMPLE).map_err(|_| {
        "Could not save the import sample. Choose a writable location and try again.".to_string()
    })
}

#[tauri::command]
pub(crate) async fn save_project_import_sample(output_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_import_sample(Path::new(&output_path)))
        .await
        .map_err(|_| "The import sample could not be saved. Please try again.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_the_bundled_workbook_and_reports_write_errors() {
        let directory =
            std::env::temp_dir().join(format!("gnosis-import-sample-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir(&directory).expect("temporary directory");
        let path = directory.join("sample.xlsx");
        save_import_sample(&path).expect("save workbook");
        assert_eq!(std::fs::read(&path).expect("read workbook"), IMPORT_SAMPLE);
        assert!(save_import_sample(&directory.join("sample.txt")).is_err());
        assert!(save_import_sample(&directory.join("missing/sample.xlsx")).is_err());
        std::fs::remove_dir_all(directory).expect("remove temporary directory");
    }
}
