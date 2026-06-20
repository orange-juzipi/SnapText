#!/usr/bin/env python3
"""Build SnapText macOS Tauri artifacts.

The script keeps the release packaging steps repeatable:

1. Generate the static React/Vite frontend consumed by Tauri.
2. Verify the Tauri release binary can be built without bundling.
3. Build an unsigned `.app` bundle.
4. Optionally build an unsigned `.dmg` bundle.

DMG creation uses macOS `hdiutil`, which can fail inside sandboxed automation
even when the project configuration is valid. Use `--skip-dmg` for static CI or
restricted local environments, and run the full command on a real macOS host.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from verify_desktop_bundles import verify_macos


ROOT = Path(__file__).resolve().parents[1]
TAURI_DIR = ROOT / "crates" / "snaptext-tauri"
TAURI_CONF = TAURI_DIR / "tauri.conf.json"
LOCAL_CARGO_TAURI = ROOT / ".tools" / "bin" / "cargo-tauri"


def run(cmd: list[str], cwd: Path = ROOT) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def read_tauri_config() -> dict:
    with TAURI_CONF.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def verify_macos_artifacts(product_name: str, version: str, require_dmg: bool) -> None:
    verify_macos(
        product_name,
        version,
        require_installers=require_dmg,
        release_dir=ROOT / "target" / "release",
        bundle_dir=ROOT / "target" / "release" / "bundle",
    )


def cargo_tauri() -> str:
    if LOCAL_CARGO_TAURI.is_file():
        return str(LOCAL_CARGO_TAURI)
    resolved = shutil.which("cargo-tauri")
    if resolved is not None:
        return resolved
    raise SystemExit(
        "cargo-tauri is required for macOS packaging. "
        "Install it with: cargo install tauri-cli --root .tools --locked"
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build SnapText macOS Tauri bundles.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print packaging commands without executing them.",
    )
    parser.add_argument(
        "--skip-dmg",
        action="store_true",
        help="Build the release binary and .app bundle, but skip DMG creation.",
    )
    return parser.parse_args(argv)


def packaging_commands(tauri: str, skip_dmg: bool) -> list[list[str]]:
    commands = [
        ["python3", "scripts/verify_ocr_models.py", "models", "--allow-macos-vision-fallback"],
        ["python3", "scripts/build_frontend.py"],
        [tauri, "build", "--no-bundle"],
        [tauri, "build", "--bundles", "app", "--no-sign"],
    ]
    if not skip_dmg:
        commands.append([tauri, "build", "--bundles", "dmg", "--no-sign"])
    return commands


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    tauri = "cargo-tauri" if args.dry_run else cargo_tauri()
    config = read_tauri_config()
    product_name = config.get("productName", "SnapText")
    version = config.get("version", "0.1.0")

    commands = packaging_commands(tauri, skip_dmg=args.skip_dmg)
    if args.dry_run:
        for command in commands:
            print(" ".join(command))
        print(f"verify_macos_artifacts {product_name} {version} require_dmg={not args.skip_dmg}")
        return 0
    for command in commands:
        cwd = TAURI_DIR if command[0] == tauri else ROOT
        run(command, cwd=cwd)
    verify_macos_artifacts(product_name, version, require_dmg=not args.skip_dmg)

    print("macOS packaging checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
