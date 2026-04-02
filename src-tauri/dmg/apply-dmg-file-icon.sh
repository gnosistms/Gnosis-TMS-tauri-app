#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $(basename "$0") <path-to-dmg> <path-to-png-icon>" >&2
  exit 1
fi

DMG_PATH="$1"
ICON_PATH="$2"

if [[ ! -f "$DMG_PATH" ]]; then
  echo "DMG file not found: $DMG_PATH" >&2
  exit 1
fi

if [[ ! -f "$ICON_PATH" ]]; then
  echo "Icon file not found: $ICON_PATH" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

TMP_ICON_PATH="$WORK_DIR/dmg-file-icon.png"
TMP_RESOURCE_PATH="$WORK_DIR/dmg-file-icon.rsrc"

cp "$ICON_PATH" "$TMP_ICON_PATH"
xcrun sips -i "$TMP_ICON_PATH" >/dev/null

xcrun DeRez -only icns "$TMP_ICON_PATH" > "$TMP_RESOURCE_PATH"

if [[ ! -s "$TMP_RESOURCE_PATH" ]]; then
  echo "Failed to generate icon resource data from: $ICON_PATH" >&2
  exit 1
fi

xcrun Rez -append "$TMP_RESOURCE_PATH" -o "$DMG_PATH"
xcrun SetFile -a C "$DMG_PATH"
