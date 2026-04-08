#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEFAULT_ICON_COMPOSER_BUNDLE="$SCRIPT_DIR/iconComposer.icon"
if [[ ! -d "$DEFAULT_ICON_COMPOSER_BUNDLE" ]]; then
  DEFAULT_ICON_COMPOSER_BUNDLE="$SCRIPT_DIR/mac icon.icon"
fi
ICON_COMPOSER_BUNDLE="${ICON_COMPOSER_BUNDLE:-$DEFAULT_ICON_COMPOSER_BUNDLE}"
DEFAULT_ICON_COMPOSER_EXPORT="$SCRIPT_DIR/iconComposerExports/iconComposer-iOS-Default-1024x1024@1x.png"
if [[ ! -f "$DEFAULT_ICON_COMPOSER_EXPORT" ]]; then
  DEFAULT_ICON_COMPOSER_EXPORT="$SCRIPT_DIR/mac icon-iOS-Default-1024x1024@1x.png"
fi
ICON_COMPOSER_EXPORT="${ICON_COMPOSER_EXPORT:-$DEFAULT_ICON_COMPOSER_EXPORT}"
SOURCE_ICON="${1:-$ICON_COMPOSER_EXPORT}"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

if [[ "$SOURCE_ICON" == *.icon ]]; then
  echo "Icon Composer .icon bundles cannot be consumed directly by Tauri." >&2
  echo "Export a flattened 1024x1024 PNG from Icon Composer first, then rerun this script." >&2
  exit 1
fi

if [[ "$SOURCE_ICON" == "$ICON_COMPOSER_EXPORT" && -d "$ICON_COMPOSER_BUNDLE" ]]; then
  latest_bundle_mtime=0
  while IFS= read -r -d '' bundle_file; do
    bundle_mtime="$(stat -f '%m' "$bundle_file")"
    if (( bundle_mtime > latest_bundle_mtime )); then
      latest_bundle_mtime="$bundle_mtime"
    fi
  done < <(find "$ICON_COMPOSER_BUNDLE" -type f -print0)

  export_mtime="$(stat -f '%m' "$ICON_COMPOSER_EXPORT")"
  if (( latest_bundle_mtime > export_mtime )); then
    echo "Icon Composer source is newer than the flattened export:" >&2
    echo "  source: $ICON_COMPOSER_BUNDLE" >&2
    echo "  export: $ICON_COMPOSER_EXPORT" >&2
    echo "Export a fresh flattened 1024x1024 PNG from Icon Composer before regenerating Tauri icons." >&2
    exit 1
  fi

  export_width="$(sips -g pixelWidth "$ICON_COMPOSER_EXPORT" | awk '/pixelWidth:/ { print $2 }')"
  export_height="$(sips -g pixelHeight "$ICON_COMPOSER_EXPORT" | awk '/pixelHeight:/ { print $2 }')"
  if [[ "$export_width" != "1024" || "$export_height" != "1024" ]]; then
    echo "Icon Composer export must be a flattened 1024x1024 PNG for the shared app icon source." >&2
    echo "Current export size: ${export_width}x${export_height}" >&2
    exit 1
  fi
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
