#!/usr/bin/env python3
"""Build the React/Vite frontend assets consumed by Tauri.

The Tauri config points `frontendDist` at `ui/dist`. This script runs the
project-local Bun/Vite build and verifies the production assets are present.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_DIR = ROOT / "ui"
DIST_DIR = UI_DIR / "dist"
DIST_ARTIFACTS = [
    "index.html",
]


def run(cmd: list[str], cwd: Path = ROOT) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def require_nonempty_file(path: Path, hint: str) -> None:
    if not path.is_file():
        raise SystemExit(f"Missing {path.relative_to(ROOT)}. {hint}")
    if path.stat().st_size == 0:
        raise SystemExit(f"Generated file is empty: {path.relative_to(ROOT)}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build SnapText React frontend assets.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print frontend build commands and expected artifacts without executing them.",
    )
    return parser.parse_args(argv)


def resolve_bun() -> str:
    bun = shutil.which("bun")
    if bun is None:
        raise SystemExit("bun is required to build the React frontend. Install bun first.")
    return bun


def bun_install_command(bun: str) -> list[str]:
    return [bun, "install", "--frozen-lockfile"]


def bun_build_command(bun: str) -> list[str]:
    return [bun, "run", "build"]


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    bun = "bun" if args.dry_run else resolve_bun()

    if args.dry_run:
        print(" ".join(bun_install_command(bun)))
        print(" ".join(bun_build_command(bun)))
        print("Expected frontend dist artifacts in ui/dist: " + ", ".join(DIST_ARTIFACTS))
        return 0

    run(bun_install_command(bun), cwd=UI_DIR)
    run(bun_build_command(bun), cwd=UI_DIR)
    for artifact in DIST_ARTIFACTS:
        require_nonempty_file(
            DIST_DIR / artifact,
            "Vite did not produce the expected frontend dist output.",
        )
    print(f"Frontend assets generated in {DIST_DIR.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
