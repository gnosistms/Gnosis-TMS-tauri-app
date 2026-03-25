use super::{
  app_auth::{github_app_jwt, github_client, github_installation_access_token},
  types::{
    GithubAppInstallationInfo, GithubAppInstallationResponse, GithubOrganization,
    GithubOrganizationMember, GithubOrganizationMembership,
  },
};

#[tauri::command]
pub(crate) fn list_user_organizations(
  access_token: String,
) -> Result<Vec<GithubOrganization>, String> {
  let client = github_client()?;
  let organizations = client
    .get("https://api.github.com/user/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not list your GitHub organizations: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization list request: {error}"))?
    .json::<Vec<GithubOrganization>>()
    .map_err(|error| format!("Could not parse your GitHub organizations: {error}"))?;

  let memberships = client
    .get("https://api.github.com/user/memberships/orgs")
    .bearer_auth(&access_token)
    .header("Accept", "application/vnd.github+json")
    .query(&[("state", "active"), ("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not list your GitHub organization memberships: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization membership request: {error}"))?
    .json::<Vec<GithubOrganizationMembership>>()
    .map_err(|error| format!("Could not parse your GitHub organization memberships: {error}"))?;

  let mut seen = std::collections::HashSet::new();
  let mut org_logins = Vec::new();

  for organization in organizations {
    if seen.insert(organization.login.clone()) {
      org_logins.push(organization.login);
    }
  }

  for membership in memberships {
    if membership.state == "active" && seen.insert(membership.organization.login.clone()) {
      org_logins.push(membership.organization.login);
    }
  }

  org_logins
    .into_iter()
    .map(|organization_login| get_organization_details(&client, &access_token, &organization_login))
    .collect()
}

#[tauri::command]
pub(crate) fn inspect_github_app_installation(
  installation_id: i64,
) -> Result<GithubAppInstallationInfo, String> {
  let app_jwt = github_app_jwt()?;
  let client = github_client()?;
  let installation = client
    .get(format!(
      "https://api.github.com/app/installations/{installation_id}"
    ))
    .header("Accept", "application/vnd.github+json")
    .bearer_auth(app_jwt)
    .send()
    .map_err(|error| format!("Could not inspect the GitHub App installation: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the GitHub App installation request: {error}"))?
    .json::<GithubAppInstallationResponse>()
    .map_err(|error| format!("Could not parse the GitHub App installation: {error}"))?;

  Ok(GithubAppInstallationInfo {
    installation_id: installation.id,
    account_login: installation.account.login,
    account_type: installation.account.account_type,
    account_avatar_url: installation.account.avatar_url,
    account_html_url: installation.account.html_url,
  })
}

#[tauri::command]
pub(crate) fn list_organization_members_for_installation(
  installation_id: i64,
  org_login: String,
) -> Result<Vec<GithubOrganizationMember>, String> {
  let installation_token = github_installation_access_token(installation_id)?;
  let client = github_client()?;

  client
    .get(format!("https://api.github.com/orgs/{org_login}/members"))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(&installation_token)
    .query(&[("per_page", "100")])
    .send()
    .map_err(|error| format!("Could not list members for @{org_login}: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization members request for @{org_login}: {error}"))?
    .json::<Vec<GithubOrganizationMember>>()
    .map_err(|error| format!("Could not parse the members for @{org_login}: {error}"))
}

#[tauri::command]
pub(crate) fn update_organization_name_for_installation(
  installation_id: i64,
  org_login: String,
  name: String,
) -> Result<GithubOrganization, String> {
  let installation_token = github_installation_access_token(installation_id)?;
  let client = github_client()?;

  client
    .patch(format!("https://api.github.com/orgs/{org_login}"))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .bearer_auth(&installation_token)
    .json(&serde_json::json!({
      "name": name
    }))
    .send()
    .map_err(|error| format!("Could not rename @{org_login}: {error}"))?
    .error_for_status()
    .map_err(|error| format!("GitHub rejected the organization rename for @{org_login}: {error}"))?
    .json::<GithubOrganization>()
    .map_err(|error| format!("Could not parse the updated organization for @{org_login}: {error}"))
}

pub(crate) fn get_organization_details(
  client: &reqwest::blocking::Client,
  access_token: &str,
  org_login: &str,
) -> Result<GithubOrganization, String> {
  client
    .get(format!("https://api.github.com/orgs/{org_login}"))
    .bearer_auth(access_token)
    .header("Accept", "application/vnd.github+json")
    .send()
    .map_err(|error| {
      format!("Could not load details for GitHub organization @{org_login}: {error}")
    })?
    .error_for_status()
    .map_err(|error| {
      format!("GitHub rejected the organization lookup for @{org_login}: {error}")
    })?
    .json::<GithubOrganization>()
    .map_err(|error| {
      format!("Could not parse the details for GitHub organization @{org_login}: {error}")
    })
}
