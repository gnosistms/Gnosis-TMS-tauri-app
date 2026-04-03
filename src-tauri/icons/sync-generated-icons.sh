#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_ICON="${1:-$SCRIPT_DIR/mac icon-iOS-Default-1024x1024@1x.png}"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

(
  cd "$REPO_ROOT"
  npx tauri icon "$SOURCE_ICON" --output "$TMP_DIR"
)

cp -R "$TMP_DIR"/. "$SCRIPT_DIR"/

echo "Synced generated app icons from:"
echo "  $SOURCE_ICON"
