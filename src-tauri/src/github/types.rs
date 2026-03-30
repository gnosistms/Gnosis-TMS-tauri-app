use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubOrganization {
  pub(crate) login: String,
  pub(crate) name: Option<String>,
  pub(crate) description: Option<String>,
  pub(crate) created_at: Option<String>,
  pub(crate) avatar_url: Option<String>,
  pub(crate) html_url: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct GithubOrganizationMembership {
  pub(crate) state: String,
  pub(crate) organization: GithubOrganizationMembershipOrg,
}

#[derive(Deserialize)]
pub(crate) struct GithubOrganizationMembershipOrg {
  pub(crate) login: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BeginGithubAppInstallResponse {
  pub(crate) install_url: String,
  pub(crate) setup_url: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubAppInstallationInfo {
  pub(crate) installation_id: i64,
  pub(crate) account_login: String,
  pub(crate) account_name: Option<String>,
  pub(crate) account_type: String,
  pub(crate) account_avatar_url: Option<String>,
  pub(crate) account_html_url: Option<String>,
  pub(crate) description: Option<String>,
  pub(crate) membership_state: Option<String>,
  pub(crate) membership_role: Option<String>,
  pub(crate) can_delete: Option<bool>,
  pub(crate) can_manage_projects: Option<bool>,
  pub(crate) can_leave: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubRepository {
  pub(crate) id: i64,
  pub(crate) name: String,
  pub(crate) full_name: String,
  pub(crate) html_url: Option<String>,
  pub(crate) private: bool,
  pub(crate) description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubProjectRepo {
  pub(crate) id: String,
  pub(crate) repo_id: i64,
  pub(crate) name: String,
  pub(crate) title: String,
  pub(crate) status: String,
  pub(crate) full_name: String,
  pub(crate) html_url: Option<String>,
  pub(crate) private: bool,
  pub(crate) description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubOrganizationMember {
  pub(crate) login: String,
  pub(crate) avatar_url: Option<String>,
  pub(crate) html_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateGithubProjectRepoInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) repo_name: String,
  pub(crate) project_title: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameGithubProjectRepoInput {
  pub(crate) installation_id: i64,
  pub(crate) full_name: String,
  pub(crate) project_title: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteGithubProjectRepoInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) repo_name: String,
}
