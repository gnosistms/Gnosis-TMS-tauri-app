#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$SCRIPT_DIR/sync-generated-icons.sh"
bash "$SCRIPT_DIR/sync-macos-icons.sh"

cp "$SCRIPT_DIR/macos/icon.icns" "$SCRIPT_DIR/icon.icns"
cp "$SCRIPT_DIR/macos/icon.png" "$SCRIPT_DIR/icon.png"
