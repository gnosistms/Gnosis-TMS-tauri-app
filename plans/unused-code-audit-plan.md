# Unused Code Audit Plan

## Goal
Identify unused code and produce a reviewed removal list before deleting anything.

This is an audit plan, not a deletion plan. The first deliverable is a report of removal candidates, grouped by confidence and risk.

## Output Report
Create:

`plans/unused-code-audit-report.md`

For each candidate, use this format:

```md
## Candidate
- File:
- Symbol / selector / module:
- Type: Rust | JS | CSS | Asset | Dependency | Test helper
- Evidence:
- Search result:
- Risk: Low | Medium | High
- Recommendation: Remove | Keep | Needs review
- Notes:
```

## Rust Audit
Run:

```bash
cd /Users/hans/Desktop/GnosisTMS/src-tauri
cargo check
cargo clippy --all-targets --all-features
```

Collect:
- unused imports
- unused private functions
- unused private structs/enums
- dead code warnings
- unreachable code warnings

Verify each candidate with:

```bash
rg "symbol_name" /Users/hans/Desktop/GnosisTMS/src-tauri/src
```

Classification:
- Low risk: private function or import only referenced by its own definition.
- Medium risk: test-only helper, feature-gated code, serialization-only type.
- High risk: Tauri command, deserialized struct field, public API, provider response shape.

Do not remove high-risk items without manual confirmation.

## JavaScript Module Audit
Use `knip` as an inventory tool, not an authority.

Run:

```bash
cd /Users/hans/Desktop/GnosisTMS
npx knip
```

If output is noisy, create a temporary audit config:

```json
{
  "entry": [
    "src-ui/main.js",
    "src-ui/index.html",
    "src-ui/app/**/*.test.js",
    "src-ui/screens/**/*.test.js"
  ],
  "project": ["src-ui/**/*.js"]
}
```

Collect:
- unused files
- unused exports
- unused dependencies

For every JS candidate, verify with:

```bash
rg "exportName|functionName|action-name|data-attribute" /Users/hans/Desktop/GnosisTMS/src-ui
rg "candidate-name" /Users/hans/Desktop/GnosisTMS
```

Classification:
- Low risk: unexported helper with no references.
- Medium risk: exported helper only referenced by tests or old feature paths.
- High risk: action handler, `data-action`, `invoke` command name, render function, local-storage key, persistent schema field.

## JavaScript Action/String Audit
Because many app behaviors are string-routed, run specific searches:

```bash
rg "data-action|action:" src-ui
rg "case \"|case '" src-ui/app/actions src-ui/app/action-dispatcher.js
rg "invoke\\(\"|invoke\\('" src-ui src-tauri/src
rg "addEventListener|dataset\\.|data-" src-ui
```

Build a list of:
- action strings emitted but not handled
- action handlers that are never emitted
- Tauri commands invoked from JS but not defined
- Tauri commands defined but not invoked
- data attributes read but never rendered
- data attributes rendered but never read

These can uncover unused code that general tools miss.

## CSS Selector Audit
Do not auto-delete CSS based on a tool alone.

First inventory selectors:

```bash
rg "^\\.[a-zA-Z0-9_-]+|class=|className|classList|dataset" src-ui/styles src-ui
```

Then manually search each candidate class name:

```bash
rg "class-name" src-ui
```

Classification:
- Low risk: selector has no references and is not a generic state class.
- Medium risk: selector used only in old modal/page variants.
- High risk: selectors built dynamically, shared utility classes, state classes such as `is-*`, `has-*`, `*-active`, `*-disabled`.

Avoid deleting CSS related to:
- editor rows
- virtualization
- modals
- focus/dirty/conflict states
- generated class names
- responsive/mobile rules

## Asset Audit
List assets:

```bash
rg --files src-ui/assets
```

Check each non-font, non-provider-logo asset with:

```bash
rg "asset-file-name|import.*asset" src-ui
```

For fonts, do not remove during the first pass unless there is clear evidence they are not imported by CSS.

Classification:
- Low risk: old preview-only images no longer referenced.
- Medium risk: provider icons, logos, download page assets.
- High risk: font files, app icons, Tauri bundle assets.

## Dependency Audit
Run:

```bash
npm ls --depth=0
npx knip --dependencies
```

For Rust:

```bash
cargo machete
```

If `cargo machete` is not installed, treat it as optional inventory.

Verify dependency candidates manually:
- search imports/usages
- check build scripts
- check Tauri config
- check tests
- check generated/export code

Do not remove dependencies based on a single tool result.

## Candidate Report Structure
The final report should group candidates by confidence:

```md
# Unused Code Audit Report

## Safe To Remove
Low-risk items with strong evidence.

## Probably Remove
Medium-risk items needing one focused check.

## Keep / False Positive
Tool findings that are actually used dynamically.

## Needs Product Decision
Code for planned features, provider support, old compatibility, or migration paths.
```

For each `Safe To Remove` item, include exact removal scope.

Example:

```md
## Safe To Remove

### Unused import in src-tauri/src/foo.rs
- Remove: `use crate::bar::Baz;`
- Evidence: `cargo clippy` unused import warning.
- Search: only found in import line.
- Risk: Low.
```

## Verification After Removal
After removing a batch, run:

```bash
npm test
npm run build
cd src-tauri && cargo test
```

For UI/CSS removals, also run the app and inspect:
- start/login
- teams
- members
- projects
- glossaries
- editor
- modals
- offline banner
- AI assistant sidebar

For editor-related removals, explicitly verify:
- scrolling remains smooth
- no blank gaps
- focused row stays focused
- row height changes reconcile
- image rows still resize correctly

## Recommended First Pass Scope
Start with:
1. Rust unused imports/private dead code from `cargo clippy`.
2. JS unused exports from `knip`, but only low-risk helpers.
3. Tauri command mismatch audit.
4. Action string mismatch audit.

Defer:
- CSS deletion
- font deletion
- editor virtualization cleanup
- provider compatibility code
- persistent schema fields
- migration/backward compatibility code

