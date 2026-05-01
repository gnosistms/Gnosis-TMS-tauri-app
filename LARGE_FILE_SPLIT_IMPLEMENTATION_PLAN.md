# Large File Split Implementation Plan

## Goal

Improve maintainability and readability by splitting the largest mixed-responsibility files into smaller modules, while preserving current behavior and keeping each change easy to review and revert.

## Constraints

- Preserve editor scrolling, row patching, and virtualization behavior.
- Prefer facade modules during migration so import churn stays small.
- Keep each phase independently testable and shippable.
- Do not combine behavior changes with file-splitting work unless the behavior change is required for the split.
- Move tests with the code only when it keeps the test target clear; otherwise leave tests in place until the module boundary is stable.

## Phase 1: Rust Glossary Storage Split

Target: `src-tauri/src/glossary_storage.rs`

Rationale: This file combines Tauri command handlers, repo setup, glossary CRUD, TMX parsing/export, Git helpers, term validation, path resolution, and tests.

Proposed modules:

- `src-tauri/src/glossary_storage/mod.rs`: public Tauri command functions and orchestration.
- `src-tauri/src/glossary_storage/model.rs`: stored structs, input structs, response structs.
- `src-tauri/src/glossary_storage/repo.rs`: glossary repo paths, Git init, local repo preparation, Git helpers.
- `src-tauri/src/glossary_storage/terms.rs`: term normalization, validation, upsert, delete, rollback.
- `src-tauri/src/glossary_storage/tmx.rs`: TMX parse, inspect, serialize, import-title helpers.
- `src-tauri/src/glossary_storage/json_io.rs`: JSON read/write helpers if still useful after the first split.

Implementation steps:

1. Create `src-tauri/src/glossary_storage/` and move the current file into `mod.rs`.
2. Extract TMX parsing/serialization first because it has the cleanest boundary.
3. Extract stored data models and request/response structs.
4. Extract repo/path/Git helpers.
5. Extract term validation and mutation helpers.
6. Keep command function names unchanged so Tauri registration does not change.

Verification:

- `cargo test`
- `cargo check`
- Manual smoke: create glossary, import TMX, edit term, export TMX, delete/restore glossary if available in the app.

## Phase 2: Chapter Import Split

Target: `src-tauri/src/project_import/chapter_import.rs`

Rationale: XLSX, TXT, DOCX parsing, GTMS writing, language lookup, and import orchestration are currently in one file. DOCX logic is large enough to stand alone.

Proposed modules:

- `src-tauri/src/project_import/chapter_import/mod.rs`: command orchestration and shared import flow.
- `src-tauri/src/project_import/chapter_import/model.rs`: parsed workbook, imported row/field, chapter/row output structs.
- `src-tauri/src/project_import/chapter_import/xlsx.rs`: XLSX parser and header classification.
- `src-tauri/src/project_import/chapter_import/txt.rs`: TXT parser and encoding helpers.
- `src-tauri/src/project_import/chapter_import/docx.rs`: DOCX archive/XML/footnote parsing.
- `src-tauri/src/project_import/chapter_import/write_gtms.rs`: chapter file and row file generation.
- `src-tauri/src/project_import/chapter_import/languages.rs`: ISO language names and code normalization.

Implementation steps:

1. Move the current file to `chapter_import/mod.rs`.
2. Extract language lookup first.
3. Extract TXT parser.
4. Extract XLSX parser.
5. Extract DOCX parser.
6. Extract GTMS writer after parser outputs are stable.

Verification:

- `cargo test`
- `cargo check`
- Import smoke tests for XLSX, TXT, and DOCX sample files.
- Confirm imported row counts, language names, footnotes, and generated row order keys match pre-split behavior.

## Phase 3: Project Search Split

Target: `src-tauri/src/project_search.rs`

Rationale: The file mixes command handlers, SQLite schema, repo discovery, refresh planning, indexing, query execution, scoring, snippets, and tests.

Proposed modules:

- `src-tauri/src/project_search/mod.rs`: public commands and orchestration.
- `src-tauri/src/project_search/model.rs`: request/response structs and internal document structs.
- `src-tauri/src/project_search/schema.rs`: DB open, schema creation, migrations, table clearing.
- `src-tauri/src/project_search/discovery.rs`: repo discovery and indexed repo state loading.
- `src-tauri/src/project_search/refresh.rs`: Git diff/status refresh planning.
- `src-tauri/src/project_search/indexer.rs`: chapter/row indexing and document insertion.
- `src-tauri/src/project_search/query.rs`: SQL search and result shaping.
- `src-tauri/src/project_search/scoring.rs`: token/ngram normalization and scoring.

Implementation steps:

1. Move the current file to `project_search/mod.rs`.
2. Extract scoring helpers and tests first.
3. Extract schema helpers.
4. Extract indexing code.
5. Extract refresh planning.
6. Extract query execution once model types are settled.

Verification:

- `cargo test`
- `cargo check`
- Refresh search index from the app.
- Search across multiple projects and confirm result ordering, snippets, pagination, and index status.

## Phase 4: Frontend Event System Split

Target: `src-ui/app/events.js`

Rationale: Global event registration currently contains unrelated systems: keyboard shortcuts, native drops, glossary tooltip behavior, glossary term variant dragging, and target language dragging.

Proposed modules:

- `src-ui/app/events.js`: facade that registers all event groups.
- `src-ui/app/events/keyboard-shortcuts.js`
- `src-ui/app/events/native-drops.js`
- `src-ui/app/events/glossary-tooltip.js`
- `src-ui/app/events/glossary-term-variant-drag.js`
- `src-ui/app/events/target-language-drag.js`

Implementation steps:

1. Extract pure keyboard shortcut helpers.
2. Extract native project/glossary drop handling.
3. Extract glossary tooltip state and handlers.
4. Extract glossary term variant drag state and handlers.
5. Extract target language drag state and handlers.
6. Keep `registerAppEvents(render)` as the only public entrypoint.

Verification:

- `npm run build`
- Existing browser tests if available.
- Manual smoke: sync shortcut, editor search shortcut, project import drop, glossary import drop, glossary tooltip, glossary term reorder, target language reorder.

## Phase 5: Inline Markup Split

Target: `src-ui/app/editor-inline-markup.js`

Rationale: The file is cohesive by domain but contains several independent layers: parsing, AST transforms, serialization, highlighting, search matching, glossary highlight parsing, ruby behavior, and selection toggling.

Proposed modules:

- `src-ui/app/editor-inline-markup.js`: compatibility facade that re-exports public functions.
- `src-ui/app/editor-inline-markup/parser.js`
- `src-ui/app/editor-inline-markup/serialize.js`
- `src-ui/app/editor-inline-markup/ranges.js`
- `src-ui/app/editor-inline-markup/highlights.js`
- `src-ui/app/editor-inline-markup/transforms.js`
- `src-ui/app/editor-inline-markup/ruby.js`

Implementation steps:

1. Extract parser and node helpers.
2. Extract serialization paths.
3. Extract range mapping helpers.
4. Extract highlight/search rendering helpers.
5. Extract style/ruby transforms.
6. Leave existing imports pointed at `editor-inline-markup.js` until all tests pass.

Verification:

- `npm run build`
- Relevant inline-markup tests if present.
- Manual smoke: bold/italic/underline, ruby insertion, glossary highlight rendering, search highlight rendering, selection toggling around nested tags.

## Phase 6: Optional Frontend Facade Narrowing

Targets:

- `src-ui/app/translate-flow.js`
- `src-ui/app/ai-settings-flow.js`
- `src-ui/app/editor-ai-assistant-flow.js`

Rationale: These are less urgent because they already delegate to smaller modules. Split only after the lower-risk backend and event/markup work is stable.

Suggested extractions:

- `editor-target-language-manager-flow.js` from `translate-flow.js`.
- `editor-preview-flow.js` from `translate-flow.js`.
- Provider secret management from `ai-settings-flow.js`.
- Assistant prompt/context construction from `editor-ai-assistant-flow.js`.

Verification:

- `npm run build`
- Browser editor smoke with focus preservation, preview mode, target language manager, AI assistant draft/apply flow.

## Rollout Strategy

Use one PR or commit per phase. Within each phase, prefer one mechanical move commit followed by any import cleanup commit. That keeps review focused and makes rollback straightforward.

Recommended order:

1. Glossary TMX extraction.
2. Chapter import DOCX/language extraction.
3. Project search scoring/schema extraction.
4. Event system extraction.
5. Inline markup extraction.
6. Optional facade narrowing.

## Definition of Done

- Public command/function names used by the app remain stable unless intentionally changed.
- Tests pass for the affected layer.
- Manual smoke checks cover the behavior represented by the moved code.
- No unrelated formatting churn.
- Each split leaves the old behavior discoverable through a small facade or clearly named module path.
