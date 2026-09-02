#!/usr/bin/env python3
"""Build SnapText desktop artifacts for the current platform.

This is the cross-platform packaging entrypoint. It prepares the React/Vite
frontend assets, runs the Tauri release build, and verifies the native artifacts
produced on the current operating system.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from verify_desktop_bundles import detect_platform, main as verify_desktop_bundles_main


ROOT = Path(__file__).resolve().parents[1]
TAURI_DIR = ROOT / "crates" / "snaptext-tauri"
LOCAL_CARGO_TAURI = ROOT / ".tools" / "bin" / "cargo-tauri"
UNSIGNED_LOCAL_CONFIG = '{"bundle":{"createUpdaterArtifacts":false}}'


def release_version_override(default: str) -> str:
    """Read the tag version injected by CI, falling back to package metadata."""
    return os.environ.get("SNAPTEXT_RELEASE_VERSION", "").strip() or default


def tauri_config_override(version: str | None, no_sign: bool) -> str | None:
    """Build the inline Tauri config used for CI version and signing overrides."""
    config: dict[str, object] = {}
    if version:
        config["version"] = version
    if no_sign:
        config["bundle"] = {"createUpdaterArtifacts": False}
    if not config:
        return None
    if not version and no_sign:
        return UNSIGNED_LOCAL_CONFIG
    return json.dumps(config, separators=(",", ":"))


def env_flag(name: str) -> bool:
    """Treat common CI-style truthy values as enabled feature flags."""
    return os.environ.get(name, "").lower() in {"1", "true", "yes"}


def run(cmd: list[str], cwd: Path = ROOT) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def cargo_tauri() -> str:
    if LOCAL_CARGO_TAURI.is_file():
        return str(LOCAL_CARGO_TAURI)
    resolved = shutil.which("cargo-tauri")
    if resolved is not None:
        return resolved
    raise SystemExit(
        "cargo-tauri is required for desktop packaging. "
        "Install it with: cargo install tauri-cli --root .tools --locked"
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build SnapText Tauri bundles for the current platform."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print packaging commands without executing them.",
    )
    parser.add_argument(
        "--skip-installers",
        action="store_true",
        help="Build the release binary without native installer bundles.",
    )
    parser.add_argument(
        "--bundles",
        help=(
            "Optional Tauri bundle target list for the current platform, such as "
            "'msi', 'nsis', 'deb', 'rpm', 'appimage', 'app', or 'dmg'."
        ),
    )
    parser.add_argument(
        "--no-sign",
        action="store_true",
        help="Pass --no-sign to cargo-tauri for unsigned local verification builds.",
    )
    return parser.parse_args(argv)


def packaging_commands(args: argparse.Namespace, tauri: str, current_platform: str) -> list[list[str]]:
    model_check = ["python3", "scripts/verify_ocr_models.py", "models", "--require-sha256"]
    if current_platform == "macos":
        model_check = [
            "python3",
            "scripts/verify_ocr_models.py",
            "models",
            "--allow-macos-vision-fallback",
        ]
    elif env_flag("SNAPTEXT_SKIP_OCR_SMOKE_TEST"):
        # CI packaging uses generated tiny OCR assets for bundling checks. The
        # smoke test is a model-quality gate and can be run separately.
        model_check.append("--skip-smoke-test")

    commands = [
        model_check,
        ["python3", "scripts/build_frontend.py"],
    ]
    release_version = release_version_override("")
    if args.skip_installers:
        commands.append([tauri, "build", "--no-bundle"])
        # A macOS release binary is not directly user-installable; keep the .app
        # bundle in the no-installer path and only skip disk image creation.
        if current_platform == "macos":
            app_cmd = [tauri, "build", "--bundles", "app"]
            config_override = tauri_config_override(release_version or None, args.no_sign)
            if config_override:
                # Local unsigned builds should not require the updater private key.
                app_cmd.extend(["--config", config_override])
            if args.no_sign:
                app_cmd.append("--no-sign")
            commands.append(app_cmd)
    elif args.bundles:
        build_cmd = [tauri, "build", "--bundles", args.bundles]
        config_override = tauri_config_override(release_version or None, args.no_sign)
        if config_override:
            build_cmd.extend(["--config", config_override])
        if args.no_sign:
            build_cmd.append("--no-sign")
        commands.append(build_cmd)
    else:
        build_cmd = [tauri, "build"]
        config_override = tauri_config_override(release_version or None, args.no_sign)
        if config_override:
            build_cmd.extend(["--config", config_override])
        if args.no_sign:
            build_cmd.append("--no-sign")
        commands.append(build_cmd)
    return commands


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    tauri = "cargo-tauri" if args.dry_run else cargo_tauri()
    current_platform = detect_platform()

    commands = packaging_commands(args, tauri, current_platform)
    if args.dry_run:
        for command in commands:
            print(" ".join(command))
    else:
        for command in commands:
            cwd = TAURI_DIR if command[0] == tauri else ROOT
            run(command, cwd=cwd)

    verify_args = ["--platform", "current"]
    if args.skip_installers:
        verify_args.append("--skip-installers")
    if args.dry_run:
        print("verify_desktop_bundles.py " + " ".join(verify_args))
        return 0
    verify_desktop_bundles_main(verify_args)

    print("Desktop packaging checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
