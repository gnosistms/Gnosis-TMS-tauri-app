//! "Changed after my last edit" editor filter: which rows of a chapter someone else
//! changed after the signed-in user's last edit, and what each row looked like before those
//! changes (the baseline the editor diffs against).
//!
//! Who made an edit is the commit author — every app commit is authored by the signed-in
//! user who started it, AI edits included. A commit is an edit of a row when the row's
//! content (text, footnote, image caption, image and timing in any language, plus the row
//! text style) differs from the row's previous version; editor flags (reviewed, please
//! check) and comments are not content. The commit that creates the row file (import,
//! insert, split) is an edit.
//!
//! Another person's edit counts when it is newer than my last edit by history order OR by
//! author date. Sync rebases, so neither alone is enough: an edit I never saw can land
//! before my rebased commit in history while being newer by the clock, and an offline
//! edit rebased on top of mine can be older by the clock.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::history::{author_login_from_email, parse_git_commit_message};
use super::images::{
    editor_field_image_from_stored, load_historical_blob_bytes, normalize_editor_field_image_value,
};
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorChangedAfterMyEditInput {
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    chapter_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadEditorChangedAfterMyEditResponse {
    chapter_id: String,
    rows: Vec<ChangedAfterMyEditRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangedAfterMyEditRow {
    row_id: String,
    baseline_commit_sha: String,
    /// True when the baseline is my last edit; false when I never edited the row and the
    /// baseline is the row as created.
    baseline_is_my_edit: bool,
    baseline_text_style: String,
    baseline_fields: BTreeMap<String, ChangedAfterMyEditBaselineField>,
    /// The other people's edits after the baseline, newest first.
    edits: Vec<ChangedAfterMyEditEdit>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangedAfterMyEditBaselineField {
    plain_text: String,
    footnote: String,
    image_caption: String,
    image: Option<EditorFieldImage>,
    /// Uploaded images can be deleted or rewritten in place after the baseline, so the
    /// baseline image travels as a data URL when it differs from the current one.
    image_data_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangedAfterMyEditEdit {
    commit_sha: String,
    author_name: String,
    author_login: String,
    committed_at: String,
    operation_type: Option<String>,
    ai_model: Option<String>,
}

pub(crate) fn load_gtms_editor_changed_after_my_edit_sync(
    app: &AppHandle,
    input: LoadEditorChangedAfterMyEditInput,
) -> Result<LoadEditorChangedAfterMyEditResponse, String> {
    let my_login = crate::broker_auth_storage::load_broker_auth_session_internal(app)?
        .map(|session| session.login.trim().to_ascii_lowercase())
        .filter(|login| !login.is_empty())
        .ok_or_else(|| {
            "Sign in with GitHub to see rows changed after your last edit.".to_string()
        })?;
    let repo_path = resolve_project_git_repo_path(
        app,
        input.installation_id,
        input.project_id.as_deref(),
        Some(&input.repo_name),
    )?;
    ensure_repo_exists(&repo_path, "The local project repo is not available yet.")?;
    ensure_valid_git_repo(&repo_path, "The local project repo is missing or invalid.")?;
    let chapter_path =
        find_chapter_path_by_id(app, &repo_path.join("chapters"), &input.chapter_id)?;
    let relative_rows_dir = repo_relative_path(&repo_path, &chapter_path.join("rows"))?;

    let rows = find_rows_changed_after_my_edit(&repo_path, &relative_rows_dir, &my_login)?;
    Ok(LoadEditorChangedAfterMyEditResponse {
        chapter_id: input.chapter_id,
        rows,
    })
}

/// The part of a row that counts as content. Missing and all-empty language fields are
/// the same content, so adding a language column is not an edit of every row.
#[derive(Clone, PartialEq)]
struct RowContent {
    text_style: String,
    srt: Option<StoredSrtTiming>,
    fields: BTreeMap<String, FieldContent>,
}

#[derive(Clone, PartialEq)]
struct FieldContent {
    plain_text: String,
    footnote: String,
    image_caption: String,
    image: Option<StoredFieldImage>,
    timing: Option<StoredSrtTiming>,
}

impl FieldContent {
    fn is_empty(&self) -> bool {
        self.plain_text.is_empty()
            && self.footnote.is_empty()
            && self.image_caption.is_empty()
            && self.image.is_none()
            && self.timing.is_none()
    }
}

impl RowContent {
    fn from_row_file(row: &StoredRowFile) -> Self {
        let fields = row
            .fields
            .iter()
            .map(|(code, field)| {
                (
                    code.clone(),
                    FieldContent {
                        plain_text: field.plain_text.clone(),
                        footnote: normalize_editor_footnote_value(&field.footnote),
                        image_caption: normalize_editor_image_caption_value(&field.image_caption),
                        image: normalize_editor_field_image_value(&field.image),
                        timing: field.timing,
                    },
                )
            })
            .filter(|(_, field)| !field.is_empty())
            .collect();
        Self {
            text_style: row_text_style(row),
            srt: row.format_metadata.srt,
            fields,
        }
    }
}

#[derive(Clone)]
struct RowCommit {
    commit_sha: String,
    author_name: String,
    author_login: String,
    author_date: String,
    operation_type: Option<String>,
    ai_model: Option<String>,
    /// None for the commit that created the row file.
    old_blob: Option<String>,
    new_blob: String,
}

const NULL_BLOB: &str = "0000000000000000000000000000000000000000";

/// Commits touching each row file of the chapter, newest first, from one `git log` pass.
fn load_row_commits_by_path(
    repo_path: &Path,
    relative_rows_dir: &str,
) -> Result<BTreeMap<String, Vec<RowCommit>>, String> {
    let output = git_output(
        repo_path,
        &[
            "log",
            "--no-merges",
            "--raw",
            "--no-abbrev",
            "--no-renames",
            "--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1f",
            "--",
            relative_rows_dir,
        ],
    )?;
    let mut commits_by_path: BTreeMap<String, Vec<RowCommit>> = BTreeMap::new();

    for record in output
        .split('\u{1e}')
        .filter(|record| !record.trim().is_empty())
    {
        let mut parts = record.splitn(6, '\u{1f}');
        let commit_sha = parts.next().unwrap_or_default().trim();
        if commit_sha.is_empty() {
            continue;
        }
        let author_name = parts.next().unwrap_or_default().trim();
        let author_email = parts.next().unwrap_or_default().trim();
        let author_date = parts.next().unwrap_or_default().trim();
        let (_, operation_type, _, ai_model) =
            parse_git_commit_message(parts.next().unwrap_or_default());
        let raw_lines = parts.next().unwrap_or_default();

        for line in raw_lines.lines().filter(|line| line.starts_with(':')) {
            // :<old mode> <new mode> <old blob> <new blob> <status>\t<path>
            let Some((meta, path)) = line.split_once('\t') else {
                continue;
            };
            let meta_parts = meta.split_whitespace().collect::<Vec<_>>();
            if meta_parts.len() < 5 || !path.ends_with(".json") {
                continue;
            }
            let (old_blob, new_blob, status) = (meta_parts[2], meta_parts[3], meta_parts[4]);
            if status.starts_with('D') || new_blob == NULL_BLOB {
                continue;
            }
            commits_by_path
                .entry(path.to_string())
                .or_default()
                .push(RowCommit {
                    commit_sha: commit_sha.to_string(),
                    author_name: author_name.to_string(),
                    author_login: author_login_from_email(author_email),
                    author_date: author_date.to_string(),
                    operation_type: operation_type.clone(),
                    ai_model: ai_model.clone(),
                    old_blob: (status != "A" && old_blob != NULL_BLOB)
                        .then(|| old_blob.to_string()),
                    new_blob: new_blob.to_string(),
                });
        }
    }

    Ok(commits_by_path)
}

/// Parsed row contents by blob id. An unparseable blob maps to None, which never equals
/// anything, so a commit touching it counts as an edit.
struct BlobContents {
    by_blob: HashMap<String, Option<RowContent>>,
}

impl BlobContents {
    fn new() -> Self {
        Self {
            by_blob: HashMap::new(),
        }
    }

    fn load(&mut self, repo_path: &Path, blobs: &BTreeSet<String>) -> Result<(), String> {
        let missing = blobs
            .iter()
            .filter(|blob| !self.by_blob.contains_key(*blob))
            .collect::<Vec<_>>();
        if missing.is_empty() {
            return Ok(());
        }
        let request = missing
            .iter()
            .map(|blob| format!("{blob}\n"))
            .collect::<String>();
        let output = git_output_with_stdin(repo_path, &["cat-file", "--batch"], &request)?;
        let mut cursor = 0usize;

        for blob in missing {
            let header_end = output[cursor..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|offset| cursor + offset)
                .ok_or_else(|| format!("Could not parse the git object header for '{blob}'."))?;
            let header = str::from_utf8(&output[cursor..header_end]).unwrap_or_default();
            cursor = header_end + 1;
            if header.ends_with(" missing") {
                self.by_blob.insert(blob.clone(), None);
                continue;
            }
            let size = header
                .split_whitespace()
                .nth(2)
                .and_then(|value| value.parse::<usize>().ok())
                .ok_or_else(|| format!("Could not parse the git object size for '{blob}'."))?;
            let body_end = cursor
                .checked_add(size)
                .filter(|end| *end <= output.len())
                .ok_or_else(|| format!("The git object output was truncated for '{blob}'."))?;
            let content = str::from_utf8(&output[cursor..body_end])
                .ok()
                .and_then(|text| serde_json::from_str::<StoredRowFile>(text).ok())
                .map(|row| RowContent::from_row_file(&row));
            cursor = body_end;
            if output.get(cursor) == Some(&b'\n') {
                cursor += 1;
            }
            self.by_blob.insert(blob.clone(), content);
        }

        Ok(())
    }

    fn get(&self, blob: &str) -> Option<&RowContent> {
        self.by_blob.get(blob).and_then(Option::as_ref)
    }

    /// Whether the commit changed the row's content. Blobs must already be loaded.
    fn commit_is_edit(&self, commit: &RowCommit) -> bool {
        let Some(old_blob) = commit.old_blob.as_deref() else {
            return true;
        };
        match (self.get(old_blob), self.get(&commit.new_blob)) {
            (Some(old), Some(new)) => old != new,
            _ => true,
        }
    }
}

fn commit_blobs(commit: &RowCommit) -> impl Iterator<Item = String> + '_ {
    commit
        .old_blob
        .iter()
        .cloned()
        .chain(std::iter::once(commit.new_blob.clone()))
}

/// Per-row walk state. The walk goes newest → oldest until it reaches my newest edit.
struct RowWalk {
    path: String,
    commits: Vec<RowCommit>,
    /// Index of the next commit whose classification is still unknown.
    cursor: usize,
    my_last_edit: Option<usize>,
    finished: bool,
}

pub(super) fn find_rows_changed_after_my_edit(
    repo_path: &Path,
    relative_rows_dir: &str,
    my_login: &str,
) -> Result<Vec<ChangedAfterMyEditRow>, String> {
    let my_login = my_login.trim().to_ascii_lowercase();
    let is_mine = |commit: &RowCommit| commit.author_login == my_login;
    let current_row_paths = fs::read_dir(repo_path.join(relative_rows_dir))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|entry| entry.file_name().to_str().map(ToOwned::to_owned))
                .filter(|name| name.ends_with(".json"))
                .map(|name| format!("{relative_rows_dir}/{name}"))
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let mut walks = load_row_commits_by_path(repo_path, relative_rows_dir)?
        .into_iter()
        .filter(|(path, commits)| current_row_paths.contains(path) && !commits.is_empty())
        .map(|(path, commits)| RowWalk {
            path,
            commits,
            cursor: 0,
            my_last_edit: None,
            finished: false,
        })
        .collect::<Vec<_>>();
    let mut blobs = BlobContents::new();

    // Rounds: each loads the blobs up to every unfinished row's next commit of mine, then
    // advances. A row stops at my first commit that is an edit; marker-only commits of
    // mine send it into another round. Usually one or two rounds.
    while walks.iter().any(|walk| !walk.finished) {
        let mut needed = BTreeSet::new();
        let mut batch_ends = Vec::with_capacity(walks.len());
        for walk in &walks {
            let end = if walk.finished {
                walk.cursor
            } else {
                walk.commits[walk.cursor..]
                    .iter()
                    .position(|commit| is_mine(commit))
                    .map(|offset| walk.cursor + offset + 1)
                    .unwrap_or(walk.commits.len())
            };
            // Rows with no commit of mine left need no blobs to finish: they are never
            // edited by me, and their creation commit is someone else's edit.
            let has_mine = end > walk.cursor && is_mine(&walk.commits[end - 1]);
            if has_mine {
                needed.extend(walk.commits[walk.cursor..end].iter().flat_map(commit_blobs));
            }
            batch_ends.push(end);
        }
        blobs.load(repo_path, &needed)?;

        for (walk, end) in walks.iter_mut().zip(batch_ends) {
            if walk.finished {
                continue;
            }
            let mine = end > walk.cursor && is_mine(&walk.commits[end - 1]);
            if mine && blobs.commit_is_edit(&walk.commits[end - 1]) {
                walk.my_last_edit = Some(end - 1);
                walk.finished = true;
            } else if !mine || end >= walk.commits.len() {
                walk.finished = true;
            }
            walk.cursor = end;
        }
    }

    // Classify the other people's commits that could count, and load the baselines.
    let mut needed = BTreeSet::new();
    for walk in &walks {
        match walk.my_last_edit {
            Some(index) => {
                let my_date = walk.commits[index].author_date.as_str();
                for (position, commit) in walk.commits.iter().enumerate() {
                    if !is_mine(commit)
                        && (position < index || commit.author_date.as_str() > my_date)
                    {
                        needed.extend(commit_blobs(commit));
                    }
                }
                needed.insert(walk.commits[index].new_blob.clone());
            }
            None => {
                needed.extend(
                    walk.commits
                        .iter()
                        .filter(|c| !is_mine(c))
                        .flat_map(commit_blobs),
                );
                if let Some(created) = walk.commits.last() {
                    needed.insert(created.new_blob.clone());
                }
            }
        }
    }
    blobs.load(repo_path, &needed)?;

    let mut rows = Vec::new();
    for walk in &walks {
        let (baseline_commit, baseline_is_my_edit, candidates): (
            &RowCommit,
            bool,
            Vec<&RowCommit>,
        ) = match walk.my_last_edit {
            Some(index) => {
                let mine = &walk.commits[index];
                let candidates = walk
                    .commits
                    .iter()
                    .enumerate()
                    .filter(|(position, commit)| {
                        !is_mine(commit)
                            && (*position < index
                                || commit.author_date.as_str() > mine.author_date.as_str())
                    })
                    .map(|(_, commit)| commit)
                    .collect();
                (mine, true, candidates)
            }
            None => {
                let Some(created) = walk.commits.last() else {
                    continue;
                };
                (
                    created,
                    false,
                    walk.commits.iter().filter(|c| !is_mine(c)).collect(),
                )
            }
        };
        let edits = candidates
            .into_iter()
            .filter(|commit| blobs.commit_is_edit(commit))
            .map(|commit| ChangedAfterMyEditEdit {
                commit_sha: commit.commit_sha.clone(),
                author_name: commit.author_name.clone(),
                author_login: commit.author_login.clone(),
                committed_at: commit.author_date.clone(),
                operation_type: commit.operation_type.clone(),
                ai_model: commit.ai_model.clone(),
            })
            .collect::<Vec<_>>();
        if edits.is_empty() {
            continue;
        }
        let Some(baseline) = blobs.get(&baseline_commit.new_blob) else {
            continue;
        };
        let current = walk
            .commits
            .first()
            .and_then(|newest| blobs.get(&newest.new_blob))
            .cloned()
            .or_else(|| read_current_row_content(repo_path, &walk.path));
        let row_id = Path::new(&walk.path)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default()
            .to_string();
        rows.push(ChangedAfterMyEditRow {
            row_id,
            baseline_commit_sha: baseline_commit.commit_sha.clone(),
            baseline_is_my_edit,
            baseline_text_style: baseline.text_style.clone(),
            baseline_fields: baseline_fields(
                repo_path,
                &baseline_commit.commit_sha,
                baseline,
                current.as_ref(),
            ),
            edits,
        });
    }

    Ok(rows)
}

fn read_current_row_content(repo_path: &Path, relative_path: &str) -> Option<RowContent> {
    let text = fs::read_to_string(repo_path.join(relative_path)).ok()?;
    let row = serde_json::from_str::<StoredRowFile>(&text).ok()?;
    Some(RowContent::from_row_file(&row))
}

fn baseline_fields(
    repo_path: &Path,
    baseline_commit_sha: &str,
    baseline: &RowContent,
    current: Option<&RowContent>,
) -> BTreeMap<String, ChangedAfterMyEditBaselineField> {
    baseline
        .fields
        .iter()
        .map(|(code, field)| {
            let current_image = current
                .and_then(|row| row.fields.get(code))
                .and_then(|field| field.image.as_ref());
            let image_data_url = field
                .image
                .as_ref()
                .filter(|image| Some(*image) != current_image && image.kind == "upload")
                .and_then(|image| image.path.as_deref())
                .and_then(|path| uploaded_image_data_url(repo_path, baseline_commit_sha, path));
            (
                code.clone(),
                ChangedAfterMyEditBaselineField {
                    plain_text: field.plain_text.clone(),
                    footnote: field.footnote.clone(),
                    image_caption: field.image_caption.clone(),
                    image: editor_field_image_from_stored(repo_path, &field.image),
                    image_data_url,
                },
            )
        })
        .collect()
}

fn uploaded_image_data_url(
    repo_path: &Path,
    commit_sha: &str,
    relative_path: &str,
) -> Option<String> {
    let mime = match Path::new(relative_path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("avif") => "image/avif",
        _ => return None,
    };
    let bytes = load_historical_blob_bytes(repo_path, commit_sha, relative_path).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use serde_json::json;

    use super::find_rows_changed_after_my_edit;

    const ROWS_DIR: &str = "chapters/ch-1/rows";

    struct TestRepo {
        path: PathBuf,
        next_day: u32,
    }

    impl TestRepo {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "gnosis-tms-changed-after-my-edit-{}",
                uuid::Uuid::now_v7()
            ));
            std::fs::create_dir_all(path.join(ROWS_DIR)).expect("create rows dir");
            run_git(&path, &["init", "--initial-branch", "main"]);
            Self { path, next_day: 1 }
        }

        fn write_row(&self, row_id: &str, row: serde_json::Value) {
            let mut value = json!({
                "row_id": row_id,
                "structure": { "order_key": "0001" },
                "status": { "review_state": "unreviewed" },
                "origin": { "source_row_number": 1 },
                "fields": {}
            });
            for (key, field) in row.as_object().expect("row object") {
                value[key] = field.clone();
            }
            std::fs::write(
                self.path.join(ROWS_DIR).join(format!("{row_id}.json")),
                format!(
                    "{}\n",
                    serde_json::to_string_pretty(&value).expect("row json")
                ),
            )
            .expect("write row");
        }

        /// Commits as `login`, one day after the previous commit unless `date` is given.
        fn commit_as(&mut self, login: &str, message: &str, date: Option<&str>) {
            let default_date = format!("2026-01-{:02}T12:00:00+00:00", self.next_day);
            self.next_day += 1;
            let date = date.unwrap_or(&default_date).to_string();
            run_git(&self.path, &["add", "."]);
            run_git(
                &self.path,
                &[
                    "-c",
                    &format!("user.name={login}"),
                    "-c",
                    &format!("user.email={login}@users.noreply.github.com"),
                    "commit",
                    "--allow-empty",
                    "-m",
                    message,
                    "--date",
                    &date,
                ],
            );
        }

        fn changed_row_ids(&self, my_login: &str) -> Vec<String> {
            find_rows_changed_after_my_edit(&self.path, ROWS_DIR, my_login)
                .expect("find changed rows")
                .into_iter()
                .map(|row| row.row_id)
                .collect()
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn run_git(repo_path: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .output()
            .unwrap_or_else(|error| panic!("failed to run git {}: {error}", args.join(" ")));
        assert!(
            output.status.success(),
            "git {} failed: {}{}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout),
        );
    }

    fn text(value: &str) -> serde_json::Value {
        json!({ "fields": { "es": { "plain_text": value } } })
    }

    fn reviewed_text(value: &str) -> serde_json::Value {
        json!({ "fields": { "es": { "plain_text": value, "editor_flags": { "reviewed": true } } } })
    }

    #[test]
    fn row_i_imported_and_nobody_else_touched_is_not_listed() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.commit_as("me", "Import chapter", None);

        assert!(repo.changed_row_ids("me").is_empty());
    }

    #[test]
    fn other_persons_text_edit_after_mine_is_listed_with_my_version_as_baseline() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.commit_as("me", "Import chapter", None);
        repo.write_row("row-a", text("dos"));
        repo.commit_as("other", "Update row", None);

        let rows = find_rows_changed_after_my_edit(&repo.path, ROWS_DIR, "me").expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].row_id, "row-a");
        assert!(rows[0].baseline_is_my_edit);
        assert_eq!(rows[0].baseline_fields["es"].plain_text, "uno");
        assert_eq!(rows[0].edits.len(), 1);
        assert_eq!(rows[0].edits[0].author_login, "other");
    }

    #[test]
    fn my_edit_after_the_other_persons_edit_clears_the_row() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.commit_as("me", "Import chapter", None);
        repo.write_row("row-a", text("dos"));
        repo.commit_as("other", "Update row", None);
        repo.write_row("row-a", text("tres"));
        repo.commit_as("me", "Update row", None);

        assert!(repo.changed_row_ids("me").is_empty());
    }

    #[test]
    fn my_marker_only_commit_is_not_an_edit() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.commit_as("me", "Import chapter", None);
        repo.write_row("row-a", text("dos"));
        repo.commit_as("other", "Update row", None);
        repo.write_row("row-a", reviewed_text("dos"));
        repo.commit_as("me", "Mark reviewed", None);

        let rows = find_rows_changed_after_my_edit(&repo.path, ROWS_DIR, "me").expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].baseline_fields["es"].plain_text, "uno");
    }

    #[test]
    fn other_persons_marker_or_comment_commit_is_not_an_edit() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.commit_as("me", "Import chapter", None);
        repo.write_row("row-a", reviewed_text("uno"));
        repo.commit_as("other", "Mark reviewed", None);
        let mut with_comment = reviewed_text("uno");
        with_comment["editor_comments_revision"] = json!(1);
        with_comment["editor_comments"] = json!([{
            "comment_id": "c1",
            "author_login": "other",
            "author_name": "other",
            "body": "¿Seguro?",
            "created_at": "2026-01-03T12:00:00Z"
        }]);
        repo.write_row("row-a", with_comment);
        repo.commit_as("other", "Add comment", None);

        assert!(repo.changed_row_ids("me").is_empty());
    }

    #[test]
    fn row_someone_else_imported_and_i_never_edited_is_listed_against_the_import() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.commit_as("other", "Import chapter", None);
        repo.write_row("row-a", reviewed_text("uno"));
        repo.commit_as("me", "Mark reviewed", None);

        let rows = find_rows_changed_after_my_edit(&repo.path, ROWS_DIR, "me").expect("rows");
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].baseline_is_my_edit);
        assert_eq!(rows[0].baseline_fields["es"].plain_text, "uno");
    }

    #[test]
    fn text_style_change_by_someone_else_is_an_edit() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.commit_as("me", "Import chapter", None);
        let mut heading = text("uno");
        heading["text_style"] = json!("heading1");
        repo.write_row("row-a", heading);
        repo.commit_as("other", "Update text style", None);

        let rows = find_rows_changed_after_my_edit(&repo.path, ROWS_DIR, "me").expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].baseline_text_style, "paragraph");
    }

    #[test]
    fn ai_edits_belong_to_whoever_started_them() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.write_row("row-b", text("uno"));
        repo.commit_as("me", "Import chapter", None);
        repo.write_row("row-a", text("dos"));
        repo.commit_as(
            "me",
            "AI translate row\n\nGTMS-Operation: ai-translation\nGTMS-AI-Model: test-model",
            None,
        );
        repo.write_row("row-b", text("dos"));
        repo.commit_as(
            "other",
            "AI translate row\n\nGTMS-Operation: ai-translation\nGTMS-AI-Model: test-model",
            None,
        );

        let rows = find_rows_changed_after_my_edit(&repo.path, ROWS_DIR, "me").expect("rows");
        assert_eq!(
            rows.iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            ["row-b"]
        );
        assert_eq!(rows[0].edits[0].ai_model.as_deref(), Some("test-model"));
    }

    #[test]
    fn edit_rebased_below_mine_but_newer_by_the_clock_is_listed() {
        let mut repo = TestRepo::new();
        repo.write_row(
            "row-a",
            json!({ "fields": {
            "es": { "plain_text": "uno" },
            "vi": { "plain_text": "một" }
        } }),
        );
        repo.commit_as("me", "Import chapter", Some("2026-01-01T12:00:00+00:00"));
        repo.write_row(
            "row-a",
            json!({ "fields": {
            "es": { "plain_text": "UNO" },
            "vi": { "plain_text": "một" }
        } }),
        );
        repo.commit_as("other", "Update row", Some("2026-01-05T12:00:00+00:00"));
        repo.write_row(
            "row-a",
            json!({ "fields": {
            "es": { "plain_text": "UNO" },
            "vi": { "plain_text": "MỘT" }
        } }),
        );
        repo.commit_as("me", "Update row", Some("2026-01-03T12:00:00+00:00"));

        let rows = find_rows_changed_after_my_edit(&repo.path, ROWS_DIR, "me").expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].baseline_fields["vi"].plain_text, "MỘT");
    }

    #[test]
    fn adding_an_empty_language_field_is_not_an_edit() {
        let mut repo = TestRepo::new();
        repo.write_row("row-a", text("uno"));
        repo.commit_as("me", "Import chapter", None);
        repo.write_row(
            "row-a",
            json!({ "fields": {
            "es": { "plain_text": "uno" },
            "vi": { "plain_text": "" }
        } }),
        );
        repo.commit_as("other", "Add language", None);

        assert!(repo.changed_row_ids("me").is_empty());
    }
}
