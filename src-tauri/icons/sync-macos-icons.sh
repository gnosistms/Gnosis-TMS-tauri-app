#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_ICON="${1:-$SCRIPT_DIR/iconComposerExports/iconComposer-iOS-Default-1024x1024@1x.png}"
MACOS_DIR="$SCRIPT_DIR/macos"
PADDED_PNG="$MACOS_DIR/icon-macos-padded-1024.png"
PADDED_APP_PNG="$MACOS_DIR/icon.png"
TARGET_SIZE=1024
ART_SIZE=832

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

mkdir -p "$MACOS_DIR"

has_python_pillow() {
  python3 - <<'PY' >/dev/null 2>&1
from PIL import Image
PY
}

if has_python_pillow; then
python3 - <<'PY' "$SOURCE_ICON" "$PADDED_PNG" "$TARGET_SIZE" "$ART_SIZE"
from pathlib import Path
from PIL import Image
import sys

source_path = Path(sys.argv[1])
target_path = Path(sys.argv[2])
target_size = int(sys.argv[3])
art_size = int(sys.argv[4])

source = Image.open(source_path).convert("RGBA")
resized = source.resize((art_size, art_size), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
offset = ((target_size - art_size) // 2, (target_size - art_size) // 2)
canvas.alpha_composite(resized, offset)
canvas.save(target_path)
PY
elif [[ -f "$PADDED_PNG" ]]; then
  echo "Python Pillow is not installed; reusing committed padded macOS icon:"
  echo "  $PADDED_PNG"
else
  echo "Python Pillow is not installed and padded macOS icon is missing: $PADDED_PNG" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

(
  cd "$REPO_ROOT"
  npx tauri icon "$PADDED_PNG" --output "$TMP_DIR"
)

cp "$TMP_DIR/icon.icns" "$MACOS_DIR/icon.icns"
cp "$TMP_DIR/icon.png" "$PADDED_APP_PNG"

echo "Synced macOS-specific app icon from:"
echo "  $SOURCE_ICON"
echo "with padded source:"
echo "  $PADDED_PNG"
