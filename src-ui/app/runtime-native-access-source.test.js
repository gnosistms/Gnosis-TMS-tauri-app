import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyNativeAccess, nativeAccessInventory, rustFunctions } from "../test/native-command-access.mjs";

const inventory = nativeAccessInventory();

test("all tokenless access-gated native commands expose a recoverable entry check", () => {
  assert.deepEqual(inventory.missing.map((fn) => `${fn.file}: ${fn.name}`), [],
    "Use require_command_access before the action, or pass a top-level session_token for existing API recovery.");
  const names = new Set(inventory.native.map((fn) => fn.name));
  for (const action of ["merge_gtms_editor_rows", "save_gtms_editor_row_comment", "update_gtms_editor_row_field_flag", "upsert_gtms_glossary_term", "upsert_gtms_qa_list_term", "import_project_files_to_gtms", "rename_gtms_chapter", "apply_gtms_editor_ai_review_result"]) {
    assert.ok(names.has(action), `the source audit must discover ${action}`);
  }
  for (const fn of inventory.native) {
    // The shared gate must be the first statement in the worker, before writes.
    assert.match(fn.body, /spawn_blocking\s*\(\s*move\s*\|\|\s*\{\s*crate::installation_access::require_command_access\(/, fn.name);
    const prefix = fn.body.slice(0, fn.body.indexOf("spawn_blocking"))
      .replace(/\blet\s+\w+\s*=\s*[\w.]+\.clone\(\)\s*;/g, "")
      .replace(/(?:let\s+\w+\s*=\s*)?tauri::async_runtime::$/, "").trim();
    assert.equal(prefix, "", `${fn.name} must not start work before its access preflight`);
    assert.match(fn.body, /require_command_access\(\s*&\w+,\s*[\w.]+,\s*ensure_installation_allows_\w+\s*,?\s*\)\s*\?/, fn.name);
  }
  // Opening an editor is a local read. Its optional cache backfill absorbs write
  // failures and must never acquire a blocking online command-entry gate.
  const reader = readFileSync(new URL("../../src-tauri/src/project_import/chapter_editor/shared.rs", import.meta.url), "utf8");
  const backfill = rustFunctions(reader).find((fn) => fn.name === "refresh_cached_chapter_source_word_count");
  assert.ok(backfill);
  assert.doesNotMatch(backfill.signature, /->\s*Result/);
  assert.match(backfill.body, /if\s+let\s+Err\(error\)\s*=\s*persist_chapter_source_word_count/);
});

test("the audit detects new commands and helper-mediated access failures", () => {
  const source = `
    fn write_helper() -> Result<(), String> { ensure_repo_allows_writes(app, repo)?; mutate() }
    #[tauri::command]
    pub async fn future_native_action(input: Input) -> Result<(), String> { write_helper() }
    #[tauri::command]
    pub async fn future_domain_action(input: Input) -> Result<(), String> { domain.ensure_installation_allows_writes(app, id)?; mutate() }
    #[tauri::command]
    pub async fn future_api_action(session_token: String) -> Result<(), String> { write_helper() }
    #[tauri::command]
    pub async fn future_checked_action(input: Input) -> Result<(), String> {
      spawn_blocking(move || { require_command_access(app, id, verify)?; write_helper() }).await
    }
    // fn comment_only() { ensure_repo_allows_writes(app, repo) }
    fn local_read() { let text = r#"{ ensure_repo_allows_writes(app, repo) }"#; }
  `;
  const result = classifyNativeAccess(rustFunctions(source));
  assert.deepEqual(result.missing.map((fn) => fn.name), ["future_native_action", "future_domain_action"]);
  assert.deepEqual(result.native.map((fn) => fn.name), ["future_native_action", "future_domain_action", "future_checked_action"]);
});
