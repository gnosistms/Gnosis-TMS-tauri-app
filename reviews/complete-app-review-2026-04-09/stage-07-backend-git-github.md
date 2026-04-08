# Stage 7 Review: Tauri Backend Commands, Git/History Logic, and GitHub Integration

## Findings

### P1. Project repo sync exposes the Git transport token in the `git` process arguments

- `git_output()` adds the authentication header directly on the `git` command line via `-c http.extraHeader=...` in [project_repo_sync.rs:375](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs#L375) through [project_repo_sync.rs:379](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs#L379).
- That header value is built from the raw installation token in [project_repo_sync.rs:413](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs#L413) through [project_repo_sync.rs:415](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs#L415), and the same path is used for clone/pull/push in [project_repo_sync.rs:327](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs#L327) through [project_repo_sync.rs:336](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs#L336) and [project_repo_sync.rs:352](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs#L352) through [project_repo_sync.rs:366](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs#L366).

Impact:
- The token becomes visible in process listings and can also leak into diagnostics or crash reports that capture argv.
- That turns a local sync operation into a credential-exposure surface for a token that can write to project repos.

Recommendation:
- Stop passing the credential on the command line.
- Feed the token through a safer channel such as a short-lived credential helper / `GIT_ASKPASS` path, or another mechanism that keeps the secret out of argv.

### P2. Loading editor history scales linearly with git processes because it shells out once per commit

- History loading first collects every commit for the row file in [chapter_editor.rs:693](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L693) through [chapter_editor.rs:694](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L694).
- It then loops those commits and calls `load_historical_row_field_value()` for each one in [chapter_editor.rs:698](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L698) through [chapter_editor.rs:705](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L705).
- `load_historical_row_field_value()` runs `git show <sha>:<path>` and deserializes the full row file every time in [chapter_editor.rs:1184](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L1184) through [chapter_editor.rs:1203](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L1203).

Impact:
- The cost of opening history grows with the number of row revisions, even when the UI only needs one language field from each snapshot.
- Heavily edited rows will become progressively slower to inspect, and the new marker/history features increase exactly that revision count.

Recommendation:
- Replace the per-commit `git show` loop with a batched history reader.
- At minimum, batch object reads; ideally, load one git stream and extract only the requested field instead of reparsing the full row JSON for every revision.

### P2. Project file listing reparses every row in every chapter on each local-files refresh

- `list_local_gtms_project_files_sync()` calls `load_project_chapter_summaries()` for every cloned repo in [chapter_editor.rs:428](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L428) through [chapter_editor.rs:450](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L450).
- `load_project_chapter_summaries()` then loads all row files for every chapter via `load_editor_rows()` in [chapter_editor.rs:870](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L870) through [chapter_editor.rs:927](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L927).
- `load_editor_rows()` deserializes every row JSON file in [chapter_editor.rs:848](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L848) through [chapter_editor.rs:867](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L867), after which `build_source_word_counts_from_stored_rows()` iterates those rows again in [chapter_editor.rs:1278](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L1278) through [chapter_editor.rs:1298](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L1298).

Impact:
- Projects-page refresh cost is proportional to the total number of row files across the repo set, not just the number of chapter summaries being displayed.
- Large projects will make routine listing/refresh work increasingly I/O-heavy, even when no editor content needs to be opened.

Recommendation:
- Move source word counts and other summary metadata onto chapter-level cached data, updating that summary only when rows change.
- Keep `list_local_gtms_project_files_sync()` on chapter summaries instead of full row scans.

## Residual Risk

- The GTMS chapter/row JSON schema is duplicated between import-time writer structs in [chapter_import.rs:150](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_import.rs#L150) through [chapter_import.rs:265](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_import.rs#L265) and editor-time reader structs in [chapter_editor.rs:249](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L249) through [chapter_editor.rs:358](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_import/chapter_editor.rs#L358). That duplication is manageable today, but every new row-field feature now has to stay in sync across two separate schema definitions and two separate serialization paths.
