# Review & Reflection: Husky, Clippy, and ESLint Adoption
_Branch: `sample_pre_commit_push_clippy-eslint` — 2026-06-06_

## What was built

Two-tier husky hooks adapted from `vt_analytics`, incorporating Clippy, ESLint, and
gitleaks. Files created or modified:

| File | Purpose |
|---|---|
| `.husky/pre-commit` | Tier 1: gitleaks staged scan (fast, <5s) |
| `.husky/pre-push` | Tier 2: clippy + fmt + ESLint delta + gitleaks push-delta |
| `eslint.config.js` | ESLint 9 flat config for vanilla JS source and tests |
| `package.json` | Added `lint:rust:strict`, `format:rust:check`, `lint:js`, `lint:js:fix`, `prepare` scripts |
| `devDependencies` | husky, eslint, @eslint/js, globals |

---

## Baseline measurements (run on 2026-06-06)

### Rust

| Check | Result |
|---|---|
| `cargo fmt --check` | **7 files** need formatting |
| `cargo clippy --all-targets` (no -D) | **54 warnings** |
| `cargo clippy --all-targets -- -D warnings` | **Fails** (all 54 become errors) |

Files needing `cargo fmt`:
- `src/ai/mod.rs`
- `src/ai_secret_storage.rs`
- `src/broker.rs` (2 hunks)
- `src/broker_auth_storage.rs`
- `src/project_import.rs`
- `src/team_metadata_local.rs`

The 7-file fmt failure (up from 2 in the Batch 1 review) reflects the recent mirror
glossary/QA commits. None of the warnings appear to be logic errors; the two
"unsigned subtraction never < 0" warnings noted in the Batch 1 review remain and
should be investigated before auto-fixing.

### JavaScript

| Check | Result |
|---|---|
| `npm run lint:js` (full tree) | **60 problems: 2 errors, 58 warnings** |
| `eslint` on a clean branch (delta mode) | **Passes** (no changed JS files) |

The 2 errors are `prefer-const` violations that `--fix` can resolve automatically:
- `src-ui/app/<editor file>:872`
- `src-ui/app/error-display.js:686`

The 58 warnings are almost entirely `no-unused-vars`. Many of these overlap with what
`knip` (already wired as `audit:unused`) catches at the export level. ESLint covers
_local_ variable scope that knip misses.

---

## Posture decisions

### Rust: strict mode wired, baseline cleanup required

The pre-push hook runs `cargo clippy -- -D warnings` unconditionally when Rust files
change. This means the hook **red-lights on any Rust push** until the baseline is
cleaned.

**Why strict over delta**: Clippy compiles the whole crate; there is no practical
per-file delta. The alternatives were (A) grandfather existing warnings and only fail
on regressions (requires a baseline snapshot file and `--baseline` tooling that
doesn't exist out of the box) or (B) run with `-W` only (allow warnings through). Both
weaken the gate. Strict mode with an explicit cleanup task is the honest posture.

**Cleanup path** (prerequisite before merging this hook to main):
1. `cargo fmt --manifest-path src-tauri/Cargo.toml --all` — formats the 7 files
2. `cargo clippy --fix --manifest-path src-tauri/Cargo.toml --all-targets` — applies
   the ~43 auto-fixable warnings
3. Manually review ~11 remaining warnings, particularly the two unsigned subtraction
   warnings in `project_search/scoring.rs`
4. Add `[workspace.lints.clippy]` to `src-tauri/Cargo.toml` if targeted overrides
   are needed (one existing `#[allow(clippy::too_many_arguments)]` in indexer.rs is
   already present; leave it)

### ESLint: delta mode, full tree clean before expanding scope

The pre-push hook passes only changed JS files to ESLint. Pre-existing violations
in untouched files do not block pushes. This lets adoption happen incrementally
without a big-bang cleanup sprint.

**Two clean-up actions that should happen before merging to main:**
1. Fix the 2 `prefer-const` errors — both are one-line `let` → `const` changes, or
   run `npm run lint:js:fix` to auto-apply
2. Decide the `no-unused-vars` posture: either accept 58 warnings (noise), or promote
   them to errors and run a cleanup pass (these are dead code, safe to remove)

The `no-undef` rule was intentionally **left out** of the config for now. The app
imports Tauri's `__TAURI__` runtime and several browser APIs that are not in the
`globals.browser` set. A false-positive storm from `no-undef` on a first run would
undermine confidence in the tooling. Re-evaluate once the full globals list is
confirmed clean.

---

## What was dropped from vt_analytics

| Dropped | Reason |
|---|---|
| Angular anti-pattern grep | This repo is vanilla JS — rule doesn't apply |
| API spec lint | No `requirements/api-spec.yaml` in this repo |
| `vt-pre-commit.sh` VT.IDD validation | Hook references vt_analytics-specific paths |
| Curator mark_stage_* ownership gate | Curator pattern doesn't exist here |
| Rust version consistency check | No `rust-toolchain.toml`; no cross-file version drift risk |
| Git LFS replay | No LFS objects in this repo; the `exit 2` would block every push |
| `cargo-deny check` | No `deny.toml` config exists yet; running without config is a no-op error |

---

## What was not implemented (candidates for future phases)

### Gnosis TMS-specific grep guards (pre-commit)

These would be fast grep checks enforcing the Constitution Standards:

- **Standard I (state bypass)**: Detect `state\.(projects|glossaries|qaLists)\s*=` in
  non-query module files. Catches direct writes that bypass TanStack Query.
- **Standard III (module ownership)**: Detect query cache writes (`queryClient.set`,
  `queryCache.set`) in `*-flow.js` files.
- **Standard V (IPC blocking)**: Detect `.await` / blocking system calls in Tauri
  command handlers that are expected to return immediately.

These were left out of this sample because grep-based architecture guards have a high
false-positive risk on a first pass. Tuning them requires running against the full
codebase and verifying zero false positives before wiring into a blocking hook.

### `cargo-deny`

`cargo-deny` is installed (`cargo deny --version`) but there is no `deny.toml` config.
Creating one would allow the pre-push hook to check for disallowed licenses, banned
crates, and duplicate crate versions. Low friction to add; should happen before the
Rust hook is considered complete.

### ESLint rule expansion

Candidates for a second pass once the baseline is clean:
- `no-undef` — once the full browser/Tauri globals list is confirmed
- `no-console` — warn on `console.log` in non-test files (telemetry sends should use
  the telemetry module, not console)
- `no-throw-literal` — aligns with the Constitution's error handling patterns

---

## Best approach recommendation

**Do not merge this branch as-is.** The hooks on this branch would block all Rust
pushes immediately. The right sequencing is:

1. **Rust cleanup first** (standalone PR): `cargo fmt` + `cargo clippy --fix` + manual
   review of ~11 remaining warnings. Creates a clean baseline.
2. **ESLint error cleanup** (can land alongside or separately): fix 2 `prefer-const`
   errors; decide the `no-unused-vars` promotion.
3. **Merge this hooks branch** once steps 1–2 are done. From that point forward,
   every push is gated by Clippy strict + ESLint delta + gitleaks.
4. **Add Gnosis-specific grep guards** (separate PR): write and tune the Standard I/III/V
   checks against a clean baseline.

The two-tier design (pre-commit = fast/cheap, pre-push = compile/lint) is the correct
shape for this repository. The patterns ported from vt_analytics — stdin buffering,
gitleaks push-delta, changed-file detection, graceful degradation when tools are
absent — all transfer cleanly.
