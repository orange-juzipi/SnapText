#!/usr/bin/env python3
"""Build SnapText macOS Tauri artifacts.

The script keeps the release packaging steps repeatable:

1. Generate the static React/Vite frontend consumed by Tauri.
2. Verify the Tauri release binary can be built without bundling.
3. Build a `.app` bundle using the selected signing mode.
4. Optionally build a signed and notarized `.dmg` bundle.

DMG creation uses macOS `hdiutil`, which can fail inside sandboxed automation
even when the project configuration is valid. Use `--skip-dmg` for static CI or
restricted local environments, and run the full command on a real macOS host.
Use `--no-sign` only for local verification builds that must not be shipped.
Use `--ad-hoc-sign --skip-dmg` for distributable builds that users explicitly
allow through macOS Privacy & Security settings.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
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
AD_HOC_ARCHIVE = ROOT / "dist" / "macos" / "SnapText-macos-ad-hoc-signed.app.zip"


def release_version_override(default: str) -> str:
    """Read the tag version injected by CI, falling back to package metadata."""
    return os.environ.get("SNAPTEXT_RELEASE_VERSION", "").strip() or default


def run(cmd: list[str], cwd: Path = ROOT) -> None:
    """Run one packaging command and propagate its exit status."""
    print(f"$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def read_tauri_config() -> dict:
    """Load the product name and version from the canonical Tauri config."""
    with TAURI_CONF.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    config["version"] = release_version_override(config.get("version", "0.1.0"))
    return config


def verify_macos_artifacts(product_name: str, version: str, require_dmg: bool) -> None:
    """Verify the native macOS artifacts produced by Tauri."""
    verify_macos(
        product_name,
        version,
        require_installers=require_dmg,
        release_dir=ROOT / "target" / "release",
        bundle_dir=ROOT / "target" / "release" / "bundle",
    )


def cargo_tauri() -> str:
    """Resolve the repository-local Tauri CLI before falling back to PATH."""
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
    """Parse macOS packaging options."""
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
    signing_mode = parser.add_mutually_exclusive_group()
    signing_mode.add_argument(
        "--no-sign",
        action="store_true",
        help="Pass --no-sign to cargo-tauri for unsigned local verification builds.",
    )
    signing_mode.add_argument(
        "--ad-hoc-sign",
        action="store_true",
        help=(
            "Build without Developer ID credentials, then ad-hoc sign and archive "
            "the complete app bundle. Requires --skip-dmg."
        ),
    )
    return parser.parse_args(argv)


def require_macos_signing_environment() -> None:
    """Require all credentials needed for Developer ID signing and notarization."""
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
    """Build the ordered Tauri and frontend commands for this package mode."""
    # Local macOS bundle checks can use Vision fallback; release checks should
    # pass --require-sha256 to prove the bundled Paddle ONNX assets are present.
    model_check = ["python3", "scripts/verify_ocr_models.py", "models", "--allow-macos-vision-fallback"]
    if require_sha256:
        model_check = ["python3", "scripts/verify_ocr_models.py", "models", "--require-sha256"]

    app_build = [tauri, "build", "--bundles", "app"]
    dmg_build = [tauri, "build", "--bundles", "dmg"]
    release_version = release_version_override("")
    if no_sign:
        # Unsigned local builds should not require the updater private key.
        config = {"bundle": {"createUpdaterArtifacts": False}}
        if release_version:
            config["version"] = release_version
        app_build.extend(["--config", json.dumps(config, separators=(",", ":")), "--no-sign"])
        dmg_build.extend(["--config", json.dumps(config, separators=(",", ":")), "--no-sign"])
    elif release_version:
        config = json.dumps({"version": release_version}, separators=(",", ":"))
        app_build.extend(["--config", config])
        dmg_build.extend(["--config", config])

    commands = [
        model_check,
        ["python3", "scripts/build_frontend.py"],
        [tauri, "build", "--no-bundle"],
        app_build,
    ]
    if not skip_dmg:
        commands.append(dmg_build)
    return commands


def ad_hoc_sign_and_archive(product_name: str) -> None:
    """Ad-hoc sign the complete app, archive it, and verify the extracted ZIP."""
    app_bundle = ROOT / "target" / "release" / "bundle" / "macos" / f"{product_name}.app"
    if not app_bundle.is_dir():
        raise SystemExit(f"Missing macOS app bundle: {app_bundle.relative_to(ROOT)}")

    run(["codesign", "--force", "--deep", "--sign", "-", "--timestamp=none", str(app_bundle)])
    run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app_bundle)])
    run(["codesign", "--display", "--verbose=2", str(app_bundle)])

    AD_HOC_ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
    if AD_HOC_ARCHIVE.exists():
        AD_HOC_ARCHIVE.unlink()
    run(
        [
            "ditto",
            "-c",
            "-k",
            "--sequesterRsrc",
            "--keepParent",
            str(app_bundle),
            str(AD_HOC_ARCHIVE),
        ]
    )

    # Verify the distributed bytes rather than trusting only the pre-archive app.
    with tempfile.TemporaryDirectory(prefix="snaptext-ad-hoc-verify-") as temp_dir:
        extracted_dir = Path(temp_dir)
        run(["ditto", "-x", "-k", str(AD_HOC_ARCHIVE), str(extracted_dir)])
        run(
            [
                "codesign",
                "--verify",
                "--deep",
                "--strict",
                "--verbose=2",
                str(extracted_dir / f"{product_name}.app"),
            ]
        )

    print(f"Ad-hoc signed macOS archive: {AD_HOC_ARCHIVE.relative_to(ROOT)}")


def main(argv: list[str]) -> int:
    """Build and verify macOS artifacts for the requested signing mode."""
    args = parse_args(argv)
    if args.ad_hoc_sign and not args.skip_dmg:
        raise SystemExit("--ad-hoc-sign requires --skip-dmg because the DMG is not notarized.")

    tauri = "cargo-tauri" if args.dry_run else cargo_tauri()
    config = read_tauri_config()
    product_name = config.get("productName", "SnapText")
    version = config.get("version", "0.1.0")

    if not args.no_sign and not args.ad_hoc_sign and not args.dry_run:
        require_macos_signing_environment()

    commands = packaging_commands(
        tauri,
        skip_dmg=args.skip_dmg,
        require_sha256=args.require_sha256,
        no_sign=args.no_sign or args.ad_hoc_sign,
    )
    if args.dry_run:
        for command in commands:
            print(" ".join(command))
        print(f"verify_macos_artifacts {product_name} {version} require_dmg={not args.skip_dmg}")
        if args.ad_hoc_sign:
            print(
                "ad_hoc_sign_and_archive "
                f"target/release/bundle/macos/{product_name}.app "
                f"{AD_HOC_ARCHIVE.relative_to(ROOT)}"
            )
        return 0
    for command in commands:
        cwd = TAURI_DIR if command[0] == tauri else ROOT
        run(command, cwd=cwd)
    verify_macos_artifacts(product_name, version, require_dmg=not args.skip_dmg)
    if args.ad_hoc_sign:
        ad_hoc_sign_and_archive(product_name)

    print("macOS packaging checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
