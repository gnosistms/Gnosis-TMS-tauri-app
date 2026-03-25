use base64::{engine::general_purpose::STANDARD, Engine as _};
use uuid::Uuid;

use crate::constants::{
  GNOSIS_TMS_REPO_TYPE_GLOSSARY, GNOSIS_TMS_REPO_TYPE_PROJECT,
  GNOSIS_TMS_REPO_TYPE_PROPERTY_NAME,
};

use super::{
  app_auth::{github_client, github_installation_access_token},
  types::{
    CreateGithubProjectRepoInput, GithubCreateRepoFileRequest,
    GithubInstallationRepositoriesResponse, GithubProjectRepo, GithubRepository,
    GithubRepositoryPropertyValue,
  },
};

#[tauri::command]
pub(crate) fn ensure_gnosis_repo_properties_schema(
  installation_id: i64,
  org_login: String,
) -> Result<(), String> {
  let installation_token = github_installation_access_token(installation_id)?;
  let client = github_client()?;

  client
    .patch(format!("https://api.github.com/orgs/{org_login}/properties/schema"))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(&installation_token)
    .json(&serde_json::json!({
      "properties": [
        {
          "property_name": GNOSIS_TMS_REPO_TYPE_PROPERTY_NAME,
          "value_type": "single_select",
          "description": "Identifies the role of repositories created by Gnosis TMS.",
          "allowed_values": [
            GNOSIS_TMS_REPO_TYPE_PROJECT,
            GNOSIS_TMS_REPO_TYPE_GLOSSARY
          ],
          "values_editable_by": "org_actors",
          "required": false
        }
      ]
    }))
    .send()
    .map_err(|error| format!("Could not create the Gnosis TMS repository property schema: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the repository property schema update: {error}"))?;

  Ok(())
}

#[tauri::command]
pub(crate) fn list_gnosis_projects_for_installation(
  installation_id: i64,
) -> Result<Vec<GithubProjectRepo>, String> {
  let installation_token = github_installation_access_token(installation_id)?;
  let client = github_client()?;
  let repositories = client
    .get("https://api.github.com/installation/repositories")
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(&installation_token)
    .query(&[("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not list repositories for the GitHub App installation: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the installation repository request: {error}"))?
    .json::<GithubInstallationRepositoriesResponse>()
    .map_err(|error| format!("Could not parse the installation repositories: {error}"))?;

  let mut projects = Vec::new();

  for repository in repositories.repositories {
    let properties = client
      .get(format!(
        "https://api.github.com/repos/{}/properties/values",
        repository.full_name
      ))
      .header("Accept", "application/vnd.github+json")
      .header("X-GitHub-Api-Version", "2022-11-28")
      .bearer_auth(&installation_token)
      .send()
      .map_err(|error| {
        format!(
          "Could not load repository properties for {}: {error}",
          repository.full_name
        )
      })?
      .error_for_status()
      .map_err(|error| {
        format!(
          "GitHub rejected the repository property lookup for {}: {error}",
          repository.full_name
        )
      })?
      .json::<Vec<GithubRepositoryPropertyValue>>()
      .map_err(|error| {
        format!(
          "Could not parse repository properties for {}: {error}",
          repository.full_name
        )
      })?;

    let is_project = properties.iter().any(|property| {
      property.property_name == GNOSIS_TMS_REPO_TYPE_PROPERTY_NAME
        && property_value_matches(property.value.as_ref(), GNOSIS_TMS_REPO_TYPE_PROJECT)
    });

    if is_project {
      projects.push(project_from_repository(repository));
    }
  }

  Ok(projects)
}

#[tauri::command]
pub(crate) fn create_gnosis_project_repo(
  input: CreateGithubProjectRepoInput,
) -> Result<GithubProjectRepo, String> {
  let installation_token = github_installation_access_token(input.installation_id)?;
  let client = github_client()?;

  ensure_schema_with_client(&client, &installation_token, &input.org_login)?;

  let repository = client
    .post(format!("https://api.github.com/orgs/{}/repos", input.org_login))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(&installation_token)
    .json(&serde_json::json!({
      "name": input.repo_name,
      "private": true
    }))
    .send()
    .map_err(|error| format!("Could not create the GitHub repository: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the repository creation request: {error}"))?;
  let repository_body = repository
    .text()
    .map_err(|error| format!("Could not read the new GitHub repository response: {error}"))?;
  let repository = parse_repository_response(&repository_body)
    .map_err(|error| format!("Could not parse the new GitHub repository: {error}"))?;

  client
    .patch(format!(
      "https://api.github.com/repos/{}/{}/properties/values",
      input.org_login, repository.name
    ))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(&installation_token)
    .json(&serde_json::json!({
      "properties": [
        {
          "property_name": GNOSIS_TMS_REPO_TYPE_PROPERTY_NAME,
          "value": GNOSIS_TMS_REPO_TYPE_PROJECT
        }
      ]
    }))
    .send()
    .map_err(|error| format!("Could not mark the repository as a Gnosis TMS project: {error}"))?
    .error_for_status()
    .map_err(|error| {
      format!("GitHub rejected the Gnosis TMS project property update: {error}")
    })?;

  let project_id = Uuid::now_v7();
  let project_json = serde_json::to_string_pretty(&serde_json::json!({
    "project_id": project_id,
    "title": input.project_title,
    "chapter_order": []
  }))
  .map_err(|error| format!("Could not serialize the initial project.json: {error}"))?;

  create_repository_file(
    &client,
    &installation_token,
    &repository.full_name,
    "project.json",
    "Initialize project metadata",
    &project_json,
  )?;

  create_repository_file(
    &client,
    &installation_token,
    &repository.full_name,
    ".gitattributes",
    "Initialize Git attributes",
    "*.json text eol=lf\nassets/** binary\n",
  )?;

  Ok(project_from_repository(repository))
}

fn ensure_schema_with_client(
  client: &reqwest::blocking::Client,
  installation_token: &str,
  org_login: &str,
) -> Result<(), String> {
  client
    .patch(format!("https://api.github.com/orgs/{org_login}/properties/schema"))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(installation_token)
    .json(&serde_json::json!({
      "properties": [
        {
          "property_name": GNOSIS_TMS_REPO_TYPE_PROPERTY_NAME,
          "value_type": "single_select",
          "description": "Identifies the role of repositories created by Gnosis TMS.",
          "allowed_values": [
            GNOSIS_TMS_REPO_TYPE_PROJECT,
            GNOSIS_TMS_REPO_TYPE_GLOSSARY
          ],
          "values_editable_by": "org_actors",
          "required": false
        }
      ]
    }))
    .send()
    .map_err(|error| format!("Could not prepare the Gnosis TMS repository property schema: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the repository property schema update: {error}"))?;

  Ok(())
}

fn create_repository_file(
  client: &reqwest::blocking::Client,
  installation_token: &str,
  full_name: &str,
  path: &str,
  message: &str,
  contents: &str,
) -> Result<(), String> {
  client
    .put(format!(
      "https://api.github.com/repos/{full_name}/contents/{path}"
    ))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(installation_token)
    .json(&GithubCreateRepoFileRequest {
      message,
      content: STANDARD.encode(contents),
    })
    .send()
    .map_err(|error| format!("Could not create {path} in {full_name}: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the initial file write for {path} in {full_name}: {error}"))?;

  Ok(())
}

fn property_value_matches(value: Option<&serde_json::Value>, expected: &str) -> bool {
  match value {
    Some(serde_json::Value::String(string_value)) => string_value == expected,
    Some(serde_json::Value::Array(values)) => {
      values.iter().any(|item| item.as_str() == Some(expected))
    }
    _ => false,
  }
}

fn project_from_repository(repository: GithubRepository) -> GithubProjectRepo {
  GithubProjectRepo {
    id: repository.id,
    name: repository.name,
    full_name: repository.full_name,
    html_url: repository.html_url,
    private: repository.private,
    description: repository.description,
  }
}

fn parse_repository_response(body: &str) -> Result<GithubRepository, String> {
  let value = serde_json::from_str::<serde_json::Value>(body)
    .map_err(|error| format!("invalid JSON response body: {error}"))?;

  let id = value
    .get("id")
    .and_then(|item| item.as_i64())
    .ok_or_else(|| "missing repository id".to_string())?;
  let name = value
    .get("name")
    .and_then(|item| item.as_str())
    .ok_or_else(|| "missing repository name".to_string())?
    .to_string();
  let full_name = value
    .get("full_name")
    .and_then(|item| item.as_str())
    .map(|value| value.to_string())
    .unwrap_or_else(|| name.clone());
  let html_url = value
    .get("html_url")
    .and_then(|item| item.as_str())
    .map(|value| value.to_string());
  let private = value
    .get("private")
    .and_then(|item| item.as_bool())
    .unwrap_or(true);
  let description = value
    .get("description")
    .and_then(|item| item.as_str())
    .map(|value| value.to_string());

  Ok(GithubRepository {
    id,
    name,
    full_name,
    html_url,
    private,
    description,
  })
}
