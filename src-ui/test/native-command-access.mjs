import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Test-only inventory, derived from Rust rather than a second command allowlist.
// Ignore literals/comments before matching function bodies and call edges.
function codeOnly(source) {
  return source.replace(/r(#{0,16})"[\s\S]*?"\1|"(?:\\.|[^"\\])*"|'(?:\\(?:u\{[^}]*\}|.)|[^'\\\n])'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (text) => text.replace(/[^\n]/g, " "));
}

export function rustFunctions(source, file = "fixture.rs") {
  const code = codeOnly(source);
  const functions = [];
  for (const match of code.matchAll(/\bfn\s+([a-zA-Z_][a-zA-Z_0-9]*)\s*(?:<[^{};]*>)?\s*\(/g)) {
    const start = code.indexOf("{", match.index);
    if (start < 0 || code.slice(match.index, start).includes(";")) continue;
    let end = start + 1;
    let depth = 1;
    while (depth && end < code.length) {
      if (code[end] === "{") depth += 1;
      if (code[end] === "}") depth -= 1;
      end += 1;
    }
    const before = code.slice(0, match.index);
    const command = /#\[tauri::command(?:\([^\]]*\))?\]\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?$/.test(before);
    const body = code.slice(start + 1, end - 1);
    const calls = Array.from(body.matchAll(/(?<![.\w])([a-zA-Z_][a-zA-Z_0-9]*)\s*(?:::\s*<[^;{}]*>)?\s*\(/g), (call) => call[1]);
    // Domain traits also expose access checks as methods. Include these known
    // gate names without treating unrelated methods as free-function call edges.
    calls.push(...Array.from(body.matchAll(/\b(ensure_installation_allows_\w+|ensure_repo_allows_writes|ensure_local_commit_preconditions|require_command_access)\s*\(/g), (call) => call[1]));
    functions.push({ name: match[1], file, command, signature: code.slice(match.index, start), body, calls });
  }
  return functions;
}

export function classifyNativeAccess(functions) {
  const guarded = new Set(["require_command_access", "ensure_repo_allows_writes", "ensure_local_commit_preconditions"]);
  for (const fn of functions) {
    for (const call of fn.calls) {
      if (call.startsWith("ensure_installation_allows_")) guarded.add(call);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions) {
      // This void, best-effort cache updater absorbs access failures. Its source
      // contract is checked separately; a local editor read stays usable offline.
      if (fn.name === "refresh_cached_chapter_source_word_count") continue;
      if (!guarded.has(fn.name) && fn.calls.some((call) => guarded.has(call))) {
        guarded.add(fn.name);
        changed = true;
      }
    }
  }
  const commands = functions.filter((fn) => fn.command && guarded.has(fn.name));
  return {
    commands,
    native: commands.filter((fn) => !/\bsession_token\s*:/.test(fn.signature)),
    missing: commands.filter((fn) => !/\bsession_token\s*:/.test(fn.signature) && !fn.calls.includes("require_command_access")),
  };
}

function rustFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? rustFiles(path) : entry.name.endsWith(".rs") ? [path] : [];
  });
}

export function nativeAccessInventory() {
  const root = fileURLToPath(new URL("../../src-tauri/src/", import.meta.url));
  const retryPrefix = /const COMMAND_AUTH_RETRY_PREFIX: &str = "([^"]+)";/.exec(readFileSync(join(root, "installation_access.rs"), "utf8"))?.[1];
  if (!retryPrefix) throw new Error("Could not discover the native preflight authentication contract.");
  return { ...classifyNativeAccess(rustFiles(root).flatMap((file) => rustFunctions(readFileSync(file, "utf8"), file))), retryPrefix };
}
