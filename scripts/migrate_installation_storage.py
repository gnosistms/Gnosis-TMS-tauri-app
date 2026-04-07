#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


def default_app_data_dir() -> Path:
  if sys.platform == "darwin":
    return Path.home() / "Library" / "Application Support" / "com.gnosis.tms"
  if sys.platform.startswith("win"):
    return Path(os.environ.get("APPDATA", Path.home())) / "com.gnosis.tms"

  xdg_data_home = os.environ.get("XDG_DATA_HOME")
  if xdg_data_home:
    return Path(xdg_data_home) / "com.gnosis.tms"
  return Path.home() / ".local" / "share" / "com.gnosis.tms"


def move_category(app_data_dir: Path, legacy_category: str, next_category: str, dry_run: bool) -> None:
  legacy_root = app_data_dir / legacy_category
  if not legacy_root.exists():
    return

  for installation_dir in sorted(legacy_root.iterdir()):
    if not installation_dir.is_dir() or not installation_dir.name.startswith("installation-"):
      continue

    target_dir = app_data_dir / "installations" / installation_dir.name / next_category
    target_dir.parent.mkdir(parents=True, exist_ok=True)

    if target_dir.exists():
      raise RuntimeError(
        f"Refusing to overwrite existing directory '{target_dir}'. Move it aside and rerun.",
      )

    print(f"{installation_dir} -> {target_dir}")
    if not dry_run:
      shutil.move(str(installation_dir), str(target_dir))

  if not dry_run and legacy_root.exists() and not any(legacy_root.iterdir()):
    legacy_root.rmdir()


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Move Gnosis TMS local data into installations/installation-<id>/{projects,glossaries}.",
  )
  parser.add_argument(
    "--app-data-dir",
    type=Path,
    default=default_app_data_dir(),
    help="Path to the Gnosis TMS app data directory.",
  )
  parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Print the planned moves without changing anything.",
  )
  return parser.parse_args()


def main() -> int:
  args = parse_args()
  app_data_dir = args.app_data_dir.expanduser().resolve()
  if not app_data_dir.exists():
    print(f"App data directory does not exist: {app_data_dir}", file=sys.stderr)
    return 1

  move_category(app_data_dir, "project-repos", "projects", args.dry_run)
  move_category(app_data_dir, "glossary-repos", "glossaries", args.dry_run)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
