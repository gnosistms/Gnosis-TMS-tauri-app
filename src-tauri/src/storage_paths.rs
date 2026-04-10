use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

pub(crate) fn installation_data_dir(
  app: &AppHandle,
  installation_id: i64,
) -> Result<PathBuf, String> {
  let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|error| format!("Could not resolve the app data directory: {error}"))?;
  Ok(
    app_data_dir
      .join("installations")
      .join(format!("installation-{installation_id}")),
  )
}

pub(crate) fn local_project_repo_root(
  app: &AppHandle,
  installation_id: i64,
) -> Result<PathBuf, String> {
  installation_data_root(app, installation_id, "projects", "project repo")
}

pub(crate) fn local_glossary_repo_root(
  app: &AppHandle,
  installation_id: i64,
) -> Result<PathBuf, String> {
  installation_data_root(app, installation_id, "glossaries", "glossary repo")
}

pub(crate) fn local_team_metadata_repo_path(
  app: &AppHandle,
  installation_id: i64,
) -> Result<PathBuf, String> {
  let installation_dir = installation_data_dir(app, installation_id)?;
  fs::create_dir_all(&installation_dir)
    .map_err(|error| format!("Could not create the local installation folder: {error}"))?;
  Ok(installation_dir.join("team-metadata"))
}

fn installation_data_root(
  app: &AppHandle,
  installation_id: i64,
  category: &str,
  label: &str,
) -> Result<PathBuf, String> {
  let root = installation_data_dir(app, installation_id)?.join(category);
  fs::create_dir_all(&root)
    .map_err(|error| format!("Could not create the local {label} folder: {error}"))?;
  Ok(root)
}
