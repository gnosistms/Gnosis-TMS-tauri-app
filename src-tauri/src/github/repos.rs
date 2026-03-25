use base64::{engine::general_purpose::STANDARD, Engine as _};
use uuid::Uuid;

use crate::constants::{
  GNOSIS_TMS_REPO_STATUS_ACTIVE, GNOSIS_TMS_REPO_STATUS_DELETED,
  GNOSIS_TMS_REPO_STATUS_PROPERTY_NAME, GNOSIS_TMS_REPO_TYPE_GLOSSARY, GNOSIS_TMS_REPO_TYPE_PROJECT,
  GNOSIS_TMS_REPO_TYPE_PROPERTY_NAME,
};

use super::{
  app_auth::{github_client, github_installation_access_token},
  types::{
    CreateGithubProjectRepoInput, DeleteGithubProjectRepoInput, GithubCreateRepoFileRequest,
    GithubProjectRepo, GithubRepository, GithubRepositoryContentResponse,
    GithubRepositoryPropertyValue,
  },
};

#[derive(Clone, serde::Deserialize)]
struct GithubApiErrorResponse {
  message: Option<String>,
  errors: Option<Vec<serde_json::Value>>,
}

#[tauri::command]
pub(crate) async fn ensure_gnosis_repo_properties_schema(
  installation_id: i64,
  org_login: String,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
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
          },
          {
            "property_name": GNOSIS_TMS_REPO_STATUS_PROPERTY_NAME,
            "value_type": "single_select",
            "description": "Tracks whether a Gnosis TMS repository is active or soft deleted.",
            "allowed_values": [
              GNOSIS_TMS_REPO_STATUS_ACTIVE,
              GNOSIS_TMS_REPO_STATUS_DELETED
            ],
            "values_editable_by": "org_actors",
            "required": false
          }
        ]
      }))
      .send()
      .map_err(|error| format!("Could not create the Gnosis TMS repository property schema: {error}"))?
      .error_for_status()
      .map_err(|error| {
        if error.status() == Some(reqwest::StatusCode::FORBIDDEN) {
          "GitHub rejected the repository property schema update. The Gnosis TMS GitHub App needs the organization permission `Custom properties: Admin`.".to_string()
        } else {
          format!("GitHub rejected the repository property schema update: {error}")
        }
      })?;

    Ok(())
  })
  .await
  .map_err(|error| format!("Could not run the repository property schema task: {error}"))?
}

#[tauri::command]
pub(crate) async fn list_gnosis_projects_for_installation(
  installation_id: i64,
) -> Result<Vec<GithubProjectRepo>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let installation_token = github_installation_access_token(installation_id)?;
    let client = github_client()?;
    let repositories_response = client
      .get("https://api.github.com/installation/repositories")
      .header("Accept", "application/vnd.github+json")
      .header("X-GitHub-Api-Version", "2022-11-28")
      .bearer_auth(&installation_token)
      .query(&[("per_page", "100")])
      .send()
      .map_err(|error| format!("Could not list repositories for the GitHub App installation: {error}"))?
      .error_for_status()
      .map_err(|error| format!("GitHub rejected the installation repository request: {error}"))?;
    let repositories_body = repositories_response
      .text()
      .map_err(|error| format!("Could not read the installation repositories response: {error}"))?;
    let repositories = parse_installation_repositories_response(&repositories_body)
      .map_err(|error| format!("Could not parse the installation repositories: {error}"))?;

    let mut projects = Vec::new();

    for repository in repositories {
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
      let is_deleted = properties.iter().any(|property| {
        property.property_name == GNOSIS_TMS_REPO_STATUS_PROPERTY_NAME
          && property_value_matches(property.value.as_ref(), GNOSIS_TMS_REPO_STATUS_DELETED)
      });

      if is_project {
        projects.push(project_from_repository(
          &client,
          &installation_token,
          repository,
          if is_deleted {
            GNOSIS_TMS_REPO_STATUS_DELETED
          } else {
            GNOSIS_TMS_REPO_STATUS_ACTIVE
          },
        )?);
      }
    }

    Ok(projects)
  })
  .await
  .map_err(|error| format!("Could not run the project listing task: {error}"))?
}

#[tauri::command]
pub(crate) async fn create_gnosis_project_repo(
  input: CreateGithubProjectRepoInput,
) -> Result<GithubProjectRepo, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let installation_token = github_installation_access_token(input.installation_id)?;
    let client = github_client()?;

    ensure_schema_with_client(&client, &installation_token, &input.org_login)?;

    let repository_response = client
      .post(format!("https://api.github.com/orgs/{}/repos", input.org_login))
      .header("Accept", "application/vnd.github+json")
      .header("X-GitHub-Api-Version", "2022-11-28")
      .bearer_auth(&installation_token)
      .json(&serde_json::json!({
        "name": input.repo_name,
        "private": true
      }))
      .send()
      .map_err(|error| format!("Could not create the GitHub repository: {error}"))?;
    let repository_status = repository_response.status();
    let repository_body = repository_response
      .text()
      .map_err(|error| format!("Could not read the new GitHub repository response: {error}"))?;

    if !repository_status.is_success() {
      return Err(format_github_repository_creation_error(
        repository_status,
        &repository_body,
      ));
    }

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
          },
          {
            "property_name": GNOSIS_TMS_REPO_STATUS_PROPERTY_NAME,
            "value": GNOSIS_TMS_REPO_STATUS_ACTIVE
          }
        ]
      }))
      .send()
      .map_err(|error| format!("Could not mark the repository as a Gnosis TMS project: {error}"))?
      .error_for_status()
      .map_err(|error| {
        if error.status() == Some(reqwest::StatusCode::FORBIDDEN) {
          "GitHub rejected the Gnosis TMS project property update. The Gnosis TMS GitHub App needs the repository permission `Custom properties: Read and write`, and the installation may need to be updated after you save that permission.".to_string()
        } else {
          format!("GitHub rejected the Gnosis TMS project property update: {error}")
        }
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

    Ok(project_from_repository(
      &client,
      &installation_token,
      repository,
      GNOSIS_TMS_REPO_STATUS_ACTIVE,
    )?)
  })
  .await
  .map_err(|error| format!("Could not run the project creation task: {error}"))?
}

#[tauri::command]
pub(crate) async fn mark_gnosis_project_repo_deleted(
  input: DeleteGithubProjectRepoInput,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let installation_token = github_installation_access_token(input.installation_id)?;
    let client = github_client()?;

    client
      .patch(format!(
        "https://api.github.com/repos/{}/{}/properties/values",
        input.org_login, input.repo_name
      ))
      .header("Accept", "application/vnd.github+json")
      .header("X-GitHub-Api-Version", "2022-11-28")
      .bearer_auth(&installation_token)
      .json(&serde_json::json!({
        "properties": [
          {
            "property_name": GNOSIS_TMS_REPO_STATUS_PROPERTY_NAME,
            "value": GNOSIS_TMS_REPO_STATUS_DELETED
          }
        ]
      }))
      .send()
      .map_err(|error| format!("Could not mark the project repository as deleted: {error}"))?
      .error_for_status()
      .map_err(|error| format!("GitHub rejected the project deletion marker update: {error}"))?;

    Ok(())
  })
  .await
  .map_err(|error| format!("Could not run the project deletion task: {error}"))?
}

#[tauri::command]
pub(crate) async fn permanently_delete_gnosis_project_repo(
  input: DeleteGithubProjectRepoInput,
) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let installation_token = github_installation_access_token(input.installation_id)?;
    let client = github_client()?;

    client
      .delete(format!(
        "https://api.github.com/repos/{}/{}",
        input.org_login, input.repo_name
      ))
      .header("Accept", "application/vnd.github+json")
      .header("X-GitHub-Api-Version", "2022-11-28")
      .bearer_auth(&installation_token)
      .send()
      .map_err(|error| format!("Could not permanently delete the project repository: {error}"))?
      .error_for_status()
      .map_err(|error| format!("GitHub rejected the permanent project deletion request: {error}"))?;

    Ok(())
  })
  .await
  .map_err(|error| format!("Could not run the permanent project deletion task: {error}"))?
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
        },
        {
          "property_name": GNOSIS_TMS_REPO_STATUS_PROPERTY_NAME,
          "value_type": "single_select",
          "description": "Tracks whether a Gnosis TMS repository is active or soft deleted.",
          "allowed_values": [
            GNOSIS_TMS_REPO_STATUS_ACTIVE,
            GNOSIS_TMS_REPO_STATUS_DELETED
          ],
          "values_editable_by": "org_actors",
          "required": false
        }
      ]
    }))
    .send()
    .map_err(|error| format!("Could not prepare the Gnosis TMS repository property schema: {error}"))?
    .error_for_status()
    .map_err(|error| {
      if error.status() == Some(reqwest::StatusCode::FORBIDDEN) {
        "GitHub rejected the repository property schema update. The Gnosis TMS GitHub App needs the organization permission `Custom properties: Admin`.".to_string()
      } else {
        format!("GitHub rejected the repository property schema update: {error}")
      }
    })?;

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

fn project_from_repository(
  client: &reqwest::blocking::Client,
  installation_token: &str,
  repository: GithubRepository,
  status: &str,
) -> Result<GithubProjectRepo, String> {
  let title = load_project_title(client, installation_token, &repository.full_name)
    .unwrap_or_else(|_| repository.name.clone());

  Ok(GithubProjectRepo {
    id: repository.id,
    name: repository.name,
    title,
    status: status.to_string(),
    full_name: repository.full_name,
    html_url: repository.html_url,
    private: repository.private,
    description: repository.description,
  })
}

fn load_project_title(
  client: &reqwest::blocking::Client,
  installation_token: &str,
  full_name: &str,
) -> Result<String, String> {
  let response = client
    .get(format!(
      "https://api.github.com/repos/{full_name}/contents/project.json"
    ))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(installation_token)
    .send()
    .map_err(|error| format!("Could not load project.json from {full_name}: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the project.json lookup for {full_name}: {error}"))?;

  let content = response
    .json::<GithubRepositoryContentResponse>()
    .map_err(|error| format!("Could not parse project.json metadata for {full_name}: {error}"))?;

  if content.encoding != "base64" {
    return Err(format!(
      "Unexpected project.json encoding for {full_name}: {}",
      content.encoding
    ));
  }

  let decoded = STANDARD
    .decode(content.content.replace('\n', ""))
    .map_err(|error| format!("Could not decode project.json for {full_name}: {error}"))?;
  let text = String::from_utf8(decoded)
    .map_err(|error| format!("Could not read project.json as UTF-8 for {full_name}: {error}"))?;
  let value = serde_json::from_str::<serde_json::Value>(&text)
    .map_err(|error| format!("Could not parse project.json for {full_name}: {error}"))?;

  value
    .get("title")
    .and_then(|item| item.as_str())
    .map(|title| title.to_string())
    .filter(|title| !title.trim().is_empty())
    .ok_or_else(|| format!("project.json in {full_name} is missing a valid title"))
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

fn parse_installation_repositories_response(body: &str) -> Result<Vec<GithubRepository>, String> {
  let value = serde_json::from_str::<serde_json::Value>(body)
    .map_err(|error| format!("invalid JSON response body: {error}"))?;

  let repositories = value
    .get("repositories")
    .and_then(|item| item.as_array())
    .ok_or_else(|| "missing repositories array".to_string())?;

  repositories
    .iter()
    .cloned()
    .map(|repository| parse_repository_value(&repository))
    .collect()
}

fn parse_repository_value(value: &serde_json::Value) -> Result<GithubRepository, String> {
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

fn format_github_repository_creation_error(
  status: reqwest::StatusCode,
  body: &str,
) -> String {
  let parsed = serde_json::from_str::<GithubApiErrorResponse>(body).ok();
  let message = parsed
    .as_ref()
    .and_then(|payload| payload.message.as_deref())
    .unwrap_or("GitHub rejected the repository creation request.")
    .to_string();

  let details = parsed
    .clone()
    .and_then(|payload| payload.errors)
    .filter(|errors| !errors.is_empty())
    .map(|errors| {
      errors
        .into_iter()
        .map(|error| match error {
          serde_json::Value::String(string) => string,
          other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join("; ")
    });

  match details {
    Some(details) => format!("{message} ({details})"),
    None if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY => {
      format!("{message} The repository name may already exist in this organization or may be invalid.")
    }
    None => format!("{message} (HTTP {status})"),
  }
}
