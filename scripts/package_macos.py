#!/usr/bin/env python3
"""Build SnapText macOS Tauri artifacts.

The script keeps the release packaging steps repeatable:

1. Generate the static React/Vite frontend consumed by Tauri.
2. Verify the Tauri release binary can be built without bundling.
3. Build a signed `.app` bundle by default.
4. Optionally build a signed and notarized `.dmg` bundle.

DMG creation uses macOS `hdiutil`, which can fail inside sandboxed automation
even when the project configuration is valid. Use `--skip-dmg` for static CI or
restricted local environments, and run the full command on a real macOS host.
Use `--no-sign` only for local verification builds that must not be shipped.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from verify_desktop_bundles import verify_macos


ROOT = Path(__file__).resolve().parents[1]
TAURI_DIR = ROOT / "crates" / "snaptext-tauri"
TAURI_CONF = TAURI_DIR / "tauri.conf.json"
LOCAL_CARGO_TAURI = ROOT / ".tools" / "bin" / "cargo-tauri"
MACOS_SIGNING_ENV = (
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "TAURI_SIGNING_PRIVATE_KEY",
)
UNSIGNED_LOCAL_CONFIG = '{"bundle":{"createUpdaterArtifacts":false}}'


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
    parser.add_argument(
        "--require-sha256",
        action="store_true",
        help="Require real OCR model checksums instead of using the macOS Vision fallback gate.",
    )
    parser.add_argument(
        "--no-sign",
        action="store_true",
        help="Pass --no-sign to cargo-tauri for unsigned local verification builds.",
    )
    return parser.parse_args(argv)


def require_macos_signing_environment() -> None:
    missing = [name for name in MACOS_SIGNING_ENV if not os.environ.get(name)]
    if missing:
        raise SystemExit(
            "Signed macOS packaging requires these environment variables: "
            + ", ".join(missing)
            + ". Use --no-sign only for local verification builds that will not be shipped."
        )


def packaging_commands(
    tauri: str,
    skip_dmg: bool,
    require_sha256: bool,
    no_sign: bool,
) -> list[list[str]]:
    # Local macOS bundle checks can use Vision fallback; release checks should
    # pass --require-sha256 to prove the bundled Paddle ONNX assets are present.
    model_check = ["python3", "scripts/verify_ocr_models.py", "models", "--allow-macos-vision-fallback"]
    if require_sha256:
        model_check = ["python3", "scripts/verify_ocr_models.py", "models", "--require-sha256"]

    app_build = [tauri, "build", "--bundles", "app"]
    dmg_build = [tauri, "build", "--bundles", "dmg"]
    if no_sign:
        # Unsigned local builds should not require the updater private key.
        app_build.extend(["--config", UNSIGNED_LOCAL_CONFIG, "--no-sign"])
        dmg_build.extend(["--config", UNSIGNED_LOCAL_CONFIG, "--no-sign"])

    commands = [
        model_check,
        ["python3", "scripts/build_frontend.py"],
        [tauri, "build", "--no-bundle"],
        app_build,
    ]
    if not skip_dmg:
        commands.append(dmg_build)
    return commands


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    tauri = "cargo-tauri" if args.dry_run else cargo_tauri()
    config = read_tauri_config()
    product_name = config.get("productName", "SnapText")
    version = config.get("version", "0.1.0")

    if not args.no_sign and not args.dry_run:
        require_macos_signing_environment()

    commands = packaging_commands(
        tauri,
        skip_dmg=args.skip_dmg,
        require_sha256=args.require_sha256,
        no_sign=args.no_sign,
    )
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
