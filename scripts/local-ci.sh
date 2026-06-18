#!/usr/bin/env bash
# Gnosis TMS — Local CI
#
# Mirrors the GitHub Actions quality-check workflow. Run this before opening
# or marking a PR ready for review to catch failures without a CI round-trip.
#
# Usage: ./scripts/local-ci.sh [--fast]
#   --fast  Skip Rust tests (~1 min); JS lint and unit tests still run.
#
# All checks invoke the npm scripts defined in package.json so the commands
# stay in sync with what CI runs.

set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 1

FAST=false
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=true ;;
    *) printf "Unknown argument: %s\nUsage: %s [--fast]\n" "$arg" "$0" >&2; exit 1 ;;
  esac
done

pass=0
fail=0

# ── Helpers ──────────────────────────────────────────────────────────

bold()  { printf "\033[1m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

run() {
  local label="$1"; shift
  printf "\n"; bold "── $label"
  if "$@"; then
    green "  ✓ $label"
    pass=$((pass + 1))
  else
    red "  ✗ $label"
    fail=$((fail + 1))
  fi
}

# ── Checks ───────────────────────────────────────────────────────────

printf "\n"; bold "=== Gnosis TMS Local CI ==="
[ "$FAST" = true ] && echo "  (--fast: cargo test skipped)"

printf "\n"; bold "[Rust]"
run "cargo fmt --check"   npm run format:rust:check
run "cargo clippy"        npm run lint:rust:strict

if [ "$FAST" = false ]; then
  run "cargo test" npm run test:rust
fi

printf "\n"; bold "[JavaScript]"
run "eslint"     npm run lint:js
run "npm test"   npm test

printf "\n"; bold "[Licenses]"
if command -v cargo-deny >/dev/null 2>&1; then
  run "cargo deny (licenses)" npm run check:licenses:rust
else
  echo "  - cargo deny (licenses) skipped: install with 'cargo install --locked cargo-deny' to run locally (CI always runs it)"
fi
run "npm licenses" npm run check:licenses:npm

# ── Summary ──────────────────────────────────────────────────────────

printf "\n"
if [ "$fail" -eq 0 ]; then
  green "✓ All $pass checks passed"
  exit 0
else
  red "✗ $fail of $((pass + fail)) checks failed"
  exit 1
fi
