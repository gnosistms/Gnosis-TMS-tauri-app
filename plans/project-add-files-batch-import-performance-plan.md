# Project Add Files Batch Import Performance Plan

## Goal

Make adding many files to a project substantially faster while preserving the current user-facing workflow and Git-backed project history guarantees.

The current multi-file Add files path processes each file as an independent local import transaction, with per-file byte transfer, parsing, row writes, Git staging, Git commit, optional default-glossary commit, optimistic state update, and then one final repo sync plus file-list refresh. The main performance target is to remove repeated per-file Git and UI/cache work.

## Current Bottlenecks

1. `importProjectFiles` loops through selected files serially and awaits each file import before starting the next.
2. Each file import runs a backend import command that stages `.gitattributes` and the whole `chapters` tree, then commits.
3. If a default glossary is configured, the frontend calls `update_gtms_chapter_glossary_links` after each import, which can create a second commit per file.
4. Browser-selected files are read in JS with `arrayBuffer()`, expanded with `Array.from(...)`, and sent through Tauri IPC as bytes.
5. After the batch, `refreshProjectFilesFromDisk` rereads chapter summaries from disk, including row files for source word counts.

## Review Notes

The plan is directionally correct, but the implementation needs to handle three details explicitly:

1. A single backend batch command should not blindly send all selected file bytes in one IPC payload. That could trade repeated IPC overhead for a larger memory spike. Prefer local file paths for upload-mode files, and keep byte payloads only for pasted text and resolved remote links.
2. Moving the loop into Rust removes the frontend's current ability to cancel before the next file unless the backend has a cancellation token and checks it between files.
3. Mixed success should be limited to parse/import validation failures for individual files. Filesystem, staging, or commit failures should abort the batch and clean up newly written chapter folders so the repo does not end in a dirty partial-import state.

## Phase 0: Safe Single-File Improvement

Before adding the full batch command, change the existing single-file import staging from the whole `chapters` tree to only the new chapter folder.

Current staging in `src-tauri/src/project_import/chapter_import/write_gtms.rs`:

```rust
git_output(&repo_path, &["add", ".gitattributes", "chapters"])?;
```

Target behavior:

```rust
let relative_chapter_path = repo_relative_path(&repo_path, &chapter_path)?;
git_output(&repo_path, &["add", ".gitattributes", &relative_chapter_path])?;
git_commit_as_signed_in_user_with_metadata(
    app,
    &repo_path,
    &format!("Import {}", parsed.source_file_name),
    &[&relative_chapter_path],
    import_commit_metadata(),
)?;
```

This is a low-risk performance win and proves the targeted-staging helper before the batch refactor.

## Phase 1: Backend Batch Import

Add a new Tauri command, likely `import_project_files_to_gtms`, beside the existing single-file import commands.

Initial input shape:

```ts
{
  batchId: string;
  installationId: number;
  projectId?: string;
  repoName: string;
  files: Array<{
    fileName: string;
    fileType: "xlsx" | "txt" | "docx" | "html";
    bytes?: number[];
    sourcePath?: string | null;
    sourceLanguageCode?: string;
    sourceUrl?: string;
  }>;
  defaultGlossary?: {
    glossaryId: string;
    repoName: string;
  } | null;
}
```

Response shape:

```ts
{
  imported: ImportXlsxResponse[];
  failedFiles: Array<{
    fileName: string;
    error: string;
  }>;
  failedFileNames: string[];
  canceled: boolean;
}
```

Implementation files:

1. Add the input/response structs in `src-tauri/src/project_import/chapter_import/mod.rs`.
2. Export the sync function and structs through `src-tauri/src/project_import.rs`.
3. Add the async Tauri command wrapper in `src-tauri/src/project_import.rs`.
4. Register `import_project_files_to_gtms` in the `tauri::generate_handler!` list in `src-tauri/src/lib.rs`.

Keep the existing single-file commands in place for compatibility and lower-risk rollout.

Suggested Rust structs:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectFilesInput {
    batch_id: String,
    installation_id: i64,
    repo_name: String,
    project_id: Option<String>,
    files: Vec<ImportProjectFileInput>,
    default_glossary: Option<ImportProjectDefaultGlossaryInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectFileInput {
    file_name: String,
    file_type: String,
    bytes: Option<Vec<u8>>,
    source_path: Option<String>,
    source_language_code: Option<String>,
    source_url: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectDefaultGlossaryInput {
    glossary_id: String,
    repo_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectFilesResponse {
    imported: Vec<ImportXlsxResponse>,
    failed_files: Vec<ImportProjectFileFailure>,
    failed_file_names: Vec<String>,
    canceled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportProjectFileFailure {
    file_name: String,
    error: String,
}
```

## Phase 2: Refactor Import Internals

Split `import_parsed_workbook_to_gtms_sync` into smaller units:

1. Resolve and validate the project repo once.
2. Parse one file input into `ParsedWorkbook`.
3. Write one parsed workbook into a new chapter folder.
4. Return an `ImportXlsxResponse`-compatible result plus the touched chapter path.
5. Stage and commit separately.

Suggested helper boundaries:

```rust
struct ProjectImportRepoContext {
    repo_path: PathBuf,
    project_title: String,
    gitattributes_existed: bool,
}

struct WrittenImport {
    response: ImportXlsxResponse,
    relative_chapter_path: String,
    absolute_chapter_path: PathBuf,
}

fn prepare_project_import_repo(
    app: &AppHandle,
    installation_id: i64,
    project_id: Option<&str>,
    repo_name: &str,
) -> Result<ProjectImportRepoContext, String>;

fn parse_project_import_file(
    common: &ImportProjectFilesInput,
    file: ImportProjectFileInput,
) -> Result<ParsedWorkbook, String>;

fn write_parsed_workbook_chapter(
    context: &ProjectImportRepoContext,
    parsed: ParsedWorkbook,
    default_glossary: Option<&ImportProjectDefaultGlossaryInput>,
) -> Result<WrittenImport, String>;

fn commit_written_imports(
    app: &AppHandle,
    context: &ProjectImportRepoContext,
    written: &[WrittenImport],
) -> Result<(), String>;
```

The batch command should:

1. Resolve repo and validate cleanliness once.
2. Ensure `.gitattributes` once.
3. Parse each file first, collecting per-file parse failures.
4. If there are no parse successes, return failures without writing or committing.
5. Write each parsed workbook into a new chapter folder.
6. Apply default glossary links directly while writing each `chapter.json`.
7. Collect imported results and touched chapter paths.
8. Run one targeted `git add`.
9. Create one commit such as `Import 30 files`.

Failure semantics:

1. Parse failures are per-file failures. Continue importing other files.
2. Cancellation is checked between files before parsing and before writing.
3. Filesystem, staging, or commit failures abort the batch.
4. On abort after writing starts, remove all newly created chapter folders and remove `.gitattributes` only if this batch created it and the commit did not happen.
5. Do not run `git reset --hard` as cleanup. The repo should have been clean at the start, and cleanup should remove only paths created by this batch.

## Phase 3: Targeted Git Staging

Replace broad staging:

```rust
git add .gitattributes chapters
```

with targeted staging:

```rust
git add .gitattributes chapters/<new-slug-1> chapters/<new-slug-2>
```

Apply this to the single-file path too, so single imports also stop scanning the entire `chapters` tree.

Implementation detail: `git_output` currently takes `&[&str]`, which is awkward for a dynamic path list. Add a small helper near the import code:

```rust
fn git_add_paths(repo_path: &Path, paths: &[String]) -> Result<(), String> {
    let mut args = vec!["add"];
    for path in paths {
        args.push(path.as_str());
    }
    git_output(repo_path, &args)
}
```

Build the paths as:

```rust
let mut staged_paths = vec![".gitattributes".to_string()];
staged_paths.extend(written.iter().map(|entry| entry.relative_chapter_path.clone()));
git_add_paths(&context.repo_path, &staged_paths)?;
```

Pass the same relative paths to `git_commit_as_signed_in_user_with_metadata` so the commit command is also scoped.

## Phase 4: Inline Default Glossary Assignment

Avoid calling `update_gtms_chapter_glossary_links` after every imported file.

Update chapter creation so `build_chapter_file` can receive an optional linked glossary and write it directly into:

```json
{
  "settings": {
    "linked_glossaries": {
      "glossary": {
        "glossary_id": "...",
        "repo_name": "..."
      }
    }
  }
}
```

This turns up to 60 commits for 30 files into one batch commit.

Implementation detail: `ChapterSettings` already has `linked_glossaries: Option<ChapterLinkedGlossaries>`. Change `build_chapter_file` to accept a default glossary:

```rust
pub(super) fn build_chapter_file(
    parsed: &ParsedWorkbook,
    chapter_id: &Uuid,
    chapter_slug: &str,
    default_glossary: Option<&ImportProjectDefaultGlossaryInput>,
) -> ChapterFile
```

Then set:

```rust
settings: ChapterSettings {
    linked_glossaries: default_glossary.map(|glossary| ChapterLinkedGlossaries {
        glossary: Some(ChapterGlossaryLink {
            glossary_id: glossary.glossary_id.clone(),
            repo_name: glossary.repo_name.clone(),
        }),
    }),
    default_source_language: ...,
    default_target_language: ...,
}
```

The existing `update_gtms_chapter_glossary_links_sync` command should remain for user-initiated glossary changes after import.

## Phase 5: Frontend Batch Flow

Update `importProjectFiles` so the multi-file path calls the new batch command once.

Frontend responsibilities:

1. Normalize selected files.
2. Validate supported file types.
3. Ask once for source language if any TXT, DOCX, or HTML files are included.
4. Build backend file descriptors that prefer `sourcePath` and use `bytes` only when no path is available.
5. Include the default glossary link in the batch payload.
6. Apply successful imports to project state.
7. Show failed filenames from the backend response.

Do not build a single payload containing all selected files as `number[]` unless the native path route is unavailable. Upload mode should prefer a native picker that returns local paths. Keep byte payloads for pasted text and resolved remote links.

Suggested frontend helpers in `src-ui/app/project-import-flow.js`:

```js
function projectImportDefaultGlossaryLink(selectedTeam) {
  return glossaryLinkFromGlossary(defaultGlossaryForTeam(selectedTeam));
}

async function buildProjectImportBatchFiles(files, sourceLanguageCode) {
  // returns { batchFiles, failedFileNames }
}

async function importProjectFilesBatch(render, selectedTeam, targetProject, files, options) {
  const batchId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  // subscribe to progress, invoke backend, unsubscribe in finally
}
```

Batch payload file mapping:

1. Browser `File`: use bytes only as a fallback.
2. Tauri native picker path: send `sourcePath`.
3. Native drop path: send `sourcePath` instead of calling `read_local_dropped_file` first.
4. Pasted text: send `bytes`.
5. Resolved link: send `bytes`, `sourceUrl`, and optional `sourcePath`.

Keep the single-file path unchanged initially, or route it through the batch command after the batch path is proven.

Progress and cancellation:

1. Add a `batchId` to `state.projectImport`.
2. Listen for a Tauri event such as `project-import-batch-progress`.
3. Event payload: `{ batchId, current, total, fileName }`.
4. Update `uploadProgress` from events instead of from the frontend loop.
5. When the user clicks Cancel while a batch is importing, invoke `cancel_project_import_batch` with the current `batchId`.
6. The backend should check cancellation between files and return `canceled: true` with whatever imports finished before cancellation.

## Phase 6: Batch State Update

Replace per-file `applyImportedFileToProject(...)` calls with a batch equivalent:

```js
applyImportedFilesToProject(team, projectId, importedResults, linkedGlossary)
```

It should:

1. Cancel project queries once.
2. Upsert all imported chapters into query data.
3. Apply the project snapshot once.
4. Expand the target project once.
5. Persist project cache once.

This removes repeated cache serialization and repeated state/query updates during large imports.

Implementation detail: add a batch upsert helper in `src-ui/app/project-query.js` rather than calling `upsertProjectChapterInQueryData` repeatedly and applying state after every call.

Suggested shape:

```js
export function upsertProjectChaptersInQueryData(queryData, projectId, chapters) {
  return chapters.reduce(
    (nextData, chapter) => upsertProjectChapterInQueryData(nextData, projectId, chapter),
    queryData,
  );
}
```

Then `applyImportedFilesToProject` should call `applyProjectsQuerySnapshotToState` and `saveStoredProjectsForTeam` once.

## Phase 7: Preserve Post-Batch Sync

Keep the current high-level behavior for the first pass:

1. Finish local batch import.
2. Run one `reconcileProjectRepoSyncStates(...)`.
3. Run one `refreshProjectFilesFromDisk(...)`.
4. Complete the projects-page sync state.

This keeps correctness and remote-sync behavior stable while the local import path changes.

Later, consider letting remote sync continue in the background after local import succeeds, but do not combine that behavioral change with the first optimization pass.

Implementation detail: leave this part of `importProjectFiles` structurally the same after the local batch returns:

```js
if (importedResults.length > 0) {
  await waitForNextPaint();
  showProjectsStatus(render, "Syncing project repo...");
  await reconcileProjectRepoSyncStates(render, selectedTeam, [targetProject], {
    clearStatusOnComplete: false,
  });
  showProjectsStatus(render, "Refreshing file list...");
  await refreshProjectFilesFromDisk(render, selectedTeam, [targetProject]);
  await completeProjectsPageSync(render);
}
```

The batch command changes the local import phase only. It should not change when remote sync happens in the first pass.

## Phase 8: Reduce Final Refresh Cost

First pass: keep the final refresh for correctness.

Second pass: avoid or narrow `refreshProjectFilesFromDisk` when all imported chapter summaries are already known from the batch response.

Potential follow-up:

1. Persist source word counts into `chapter.json` during import.
2. Make chapter summary loading use stored counts when available.
3. Recompute counts only when row files change.

This addresses the project-size-dependent refresh cost.

## Phase 9: Local File Path Handling

Implement local path handling as part of the first batch command rollout if possible. Otherwise the batch command may improve Git behavior while making memory behavior worse for large DOCX/XLSX batches.

Options:

1. Use a Tauri-native file picker that returns local paths.
2. Pass local paths to Rust for selected local files.
3. Let Rust read file bytes directly.
4. Keep byte payloads for pasted text, remote links, and browser-only file objects.

If the batch command is implemented before native paths, keep a conservative file-count or total-byte threshold and fall back to the existing serial path for large payloads.

Preferred first-pass path:

1. Add `openLocalFilePathPicker` that uses Tauri dialog open when available.
2. Return path-backed file descriptors for upload mode.
3. Keep `openLocalFilePicker` as a browser fallback.
4. Make the backend command accept either `sourcePath` or `bytes`.
5. In Rust, `sourcePath` wins over `bytes`; validate it is a file and read it with `fs::read`.

Rust file byte resolver:

```rust
fn import_file_bytes(file: &ImportProjectFileInput) -> Result<Vec<u8>, String> {
    if let Some(path) = file.source_path.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        let metadata = fs::metadata(path)
            .map_err(|error| format!("Could not inspect '{}': {error}", path))?;
        if !metadata.is_file() {
            return Err(format!("'{}' is not a file.", path));
        }
        return fs::read(path).map_err(|error| format!("Could not read '{}': {error}", path));
    }

    file.bytes
        .clone()
        .filter(|bytes| !bytes.is_empty())
        .ok_or_else(|| "The file could not be read.".to_string())
}

```

## Backend Cancellation Store

Add a small store in `src-tauri/src/state.rs` so the one-call batch command can preserve the current Cancel behavior:

```rust
pub(crate) struct ProjectImportBatchCancelStore {
    pub(crate) canceled_batch_ids: Arc<Mutex<BTreeSet<String>>>,
}
```

Add commands:

```rust
#[tauri::command]
pub(crate) async fn cancel_project_import_batch(
    cancel_store: tauri::State<'_, ProjectImportBatchCancelStore>,
    batch_id: String,
) -> Result<(), String>;
```

The batch command should:

1. Remove stale cancellation state for the `batchId` at start.
2. Check `canceled_batch_ids` before starting each file.
3. Return `canceled: true` if cancellation was requested.
4. Remove the `batchId` from the store before returning.

This preserves the current behavior where Cancel stops before the next file, not necessarily in the middle of parsing the current file.

## Tests

Frontend tests:

1. Multi-file import calls `import_project_files_to_gtms` once instead of one import command per file.
2. Source-language selection still appears once for TXT, DOCX, and HTML batches.
3. Unsupported files are reported without sending them to the backend.
4. Backend `failedFiles` are merged with frontend unsupported files for the upload error modal.
5. Batch import applies successful results to project state once.
6. Default glossary is included in the batch payload and no per-file `update_gtms_chapter_glossary_links` command is called.
7. Post-batch sync and refresh still run once.
8. Progress updates come from `project-import-batch-progress` events.
9. Cancel invokes `cancel_project_import_batch` and handles a `canceled: true` response.
10. Single-file import behavior remains unchanged until explicitly migrated.

Backend tests:

1. Batch import creates multiple chapters successfully.
2. Batch import creates one commit for multiple files.
3. Batch import stages only touched chapter folders plus `.gitattributes`.
4. Default glossary is written into each new `chapter.json` without a separate glossary update command.
5. Mixed success and failure returns imported results plus failed filenames.
6. Existing single-file import behavior remains compatible.
7. Two files with the same title get unique slugs.
8. Cancel before file N imports only files before N and returns `canceled: true`.
9. Parse failure before writing creates no chapter folder for that failed file.
10. Filesystem/write failure after writing starts removes created chapter folders and leaves the repo clean.
11. `sourcePath` inputs are read by Rust and rejected when the path is not a file.

## Measurement

Before and after implementation, measure importing roughly 30 files:

1. Total local import time.
2. Number of Tauri invokes.
3. Number of Git commits.
4. Time spent in `git add`.
5. Time spent in final refresh.
6. Time until the modal closes or shows completion.

Expected first-pass improvement should come primarily from reducing 30 to 60 commits down to one commit and avoiding repeated full `git add chapters` scans.
