use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BeginGithubAppInstallResponse {
  pub(crate) install_url: String,
  pub(crate) setup_url: String,
}

#[derive(Serialize, Deserialize, Clone)]
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
  pub(crate) can_manage_members: Option<bool>,
  pub(crate) can_manage_projects: Option<bool>,
  pub(crate) can_leave: Option<bool>,
  pub(crate) permissions: Option<BTreeMap<String, String>>,
  pub(crate) app_approval_url: Option<String>,
  pub(crate) app_request_url: Option<String>,
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
  pub(crate) node_id: Option<String>,
  pub(crate) name: String,
  pub(crate) title: String,
  pub(crate) status: String,
  pub(crate) full_name: String,
  pub(crate) html_url: Option<String>,
  pub(crate) private: bool,
  pub(crate) description: Option<String>,
  pub(crate) default_branch_name: Option<String>,
  pub(crate) default_branch_head_oid: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubGlossaryRepo {
  pub(crate) repo_id: i64,
  pub(crate) node_id: Option<String>,
  pub(crate) name: String,
  pub(crate) full_name: String,
  pub(crate) html_url: Option<String>,
  pub(crate) private: bool,
  pub(crate) description: Option<String>,
  pub(crate) default_branch_name: Option<String>,
  pub(crate) default_branch_head_oid: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamMetadataRecordListInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubProjectMetadataRecord {
  pub(crate) id: String,
  pub(crate) kind: String,
  pub(crate) title: String,
  pub(crate) repo_name: String,
  pub(crate) previous_repo_names: Vec<String>,
  pub(crate) github_repo_id: Option<i64>,
  pub(crate) github_node_id: Option<String>,
  pub(crate) full_name: Option<String>,
  pub(crate) default_branch: String,
  pub(crate) lifecycle_state: String,
  pub(crate) remote_state: String,
  pub(crate) record_state: String,
  pub(crate) created_at: Option<String>,
  pub(crate) updated_at: Option<String>,
  pub(crate) deleted_at: Option<String>,
  pub(crate) created_by: Option<String>,
  pub(crate) updated_by: Option<String>,
  pub(crate) deleted_by: Option<String>,
  pub(crate) chapter_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubGlossaryMetadataRecord {
  pub(crate) id: String,
  pub(crate) kind: String,
  pub(crate) title: String,
  pub(crate) repo_name: String,
  pub(crate) previous_repo_names: Vec<String>,
  pub(crate) github_repo_id: Option<i64>,
  pub(crate) github_node_id: Option<String>,
  pub(crate) full_name: Option<String>,
  pub(crate) default_branch: String,
  pub(crate) lifecycle_state: String,
  pub(crate) remote_state: String,
  pub(crate) record_state: String,
  pub(crate) created_at: Option<String>,
  pub(crate) updated_at: Option<String>,
  pub(crate) deleted_at: Option<String>,
  pub(crate) created_by: Option<String>,
  pub(crate) updated_by: Option<String>,
  pub(crate) deleted_by: Option<String>,
  pub(crate) source_language: Option<TeamMetadataLanguageInput>,
  pub(crate) target_language: Option<TeamMetadataLanguageInput>,
  pub(crate) term_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubTeamMetadataRepo {
  pub(crate) repo_id: i64,
  pub(crate) name: String,
  pub(crate) full_name: String,
  pub(crate) html_url: Option<String>,
  pub(crate) schema_version: u32,
  pub(crate) team_id: String,
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) created_at: Option<String>,
  pub(crate) updated_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubOrganizationMember {
  pub(crate) login: String,
  pub(crate) avatar_url: Option<String>,
  pub(crate) html_url: Option<String>,
  pub(crate) role: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubUserSearchResult {
  pub(crate) id: i64,
  pub(crate) login: String,
  pub(crate) name: Option<String>,
  pub(crate) avatar_url: Option<String>,
  pub(crate) html_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubOrganizationInvitation {
  pub(crate) id: i64,
  pub(crate) login: Option<String>,
  pub(crate) email: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateGithubProjectRepoInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) repo_name: String,
  pub(crate) project_title: String,
  pub(crate) project_id: Option<String>,
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateGithubGlossaryRepoInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) repo_name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteGithubGlossaryRepoInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) repo_name: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamMetadataLanguageInput {
  pub(crate) code: String,
  pub(crate) name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertGithubProjectMetadataRecordInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) project_id: String,
  pub(crate) title: String,
  pub(crate) repo_name: String,
  pub(crate) previous_repo_names: Option<Vec<String>>,
  pub(crate) github_repo_id: Option<i64>,
  pub(crate) github_node_id: Option<String>,
  pub(crate) full_name: Option<String>,
  pub(crate) default_branch: Option<String>,
  pub(crate) lifecycle_state: Option<String>,
  pub(crate) remote_state: Option<String>,
  pub(crate) record_state: Option<String>,
  pub(crate) chapter_count: Option<usize>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteGithubProjectMetadataRecordInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) project_id: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpsertGithubGlossaryMetadataRecordInput {
  pub(crate) installation_id: i64,
  pub(crate) org_login: String,
  pub(crate) glossary_id: String,
  pub(crate) title: String,
  pub(crate) repo_name: String,
  pub(crate) previous_repo_names: Option<Vec<String>>,
  pub(crate) github_repo_id: Option<i64>,
  pub(crate) github_node_id: Option<String>,
  pub(crate) full_name: Option<String>,
  pub(crate) default_branch: Option<String>,
  pub(crate) lifecycle_state: Option<String>,
  pub(crate) remote_state: Option<String>,
  pub(crate) record_state: Option<String>,
  pub(crate) source_language: Option<TeamMetadataLanguageInput>,
  pub(crate) target_language: Option<TeamMetadataLanguageInput>,
  pub(crate) term_count: Option<usize>,
}
