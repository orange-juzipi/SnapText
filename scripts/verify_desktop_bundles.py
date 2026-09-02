#!/usr/bin/env python3
"""Verify SnapText desktop bundle artifacts after a Tauri build.

The script intentionally verifies artifacts instead of building them. Run it
after `cargo-tauri build` on the target OS so platform-specific tools can create
their native installers first.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAURI_CONF = ROOT / "crates" / "snaptext-tauri" / "tauri.conf.json"
RELEASE_DIR = ROOT / "target" / "release"
BUNDLE_DIR = RELEASE_DIR / "bundle"


def release_version_override(default: str) -> str:
    """Read the tag version injected by CI, falling back to package metadata."""
    return os.environ.get("SNAPTEXT_RELEASE_VERSION", "").strip() or default


def read_tauri_config() -> dict:
    """Load Tauri metadata and apply the CI tag version when present."""
    with TAURI_CONF.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    config["version"] = release_version_override(config.get("version", "0.1.0"))
    return config


def display_path(path: Path) -> str:
    """Return a readable path, relative to the repo when possible."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def require_nonempty_file(path: Path, hint: str) -> None:
    if not path.is_file():
        raise SystemExit(f"Missing {display_path(path)}. {hint}")
    if path.stat().st_size == 0:
        raise SystemExit(f"Generated file is empty: {display_path(path)}")


def require_dir(path: Path, hint: str) -> None:
    if not path.is_dir():
        raise SystemExit(f"Missing {display_path(path)}. {hint}")


def require_any_nonempty(bundle_dir: Path, patterns: list[str], hint: str) -> list[Path]:
    matches: list[Path] = []
    for pattern in patterns:
        matches.extend(sorted(bundle_dir.glob(pattern)))
    if not matches:
        raise SystemExit(f"Missing bundle artifacts matching {patterns}. {hint}")
    for path in matches:
        require_nonempty_file(path, hint)
    return matches


def reject_stale_snaptext_artifacts(bundle_dir: Path, directory: str, allowed_patterns: list[str]) -> None:
    artifact_dir = bundle_dir / directory
    if not artifact_dir.is_dir():
        return
    allowed: set[Path] = set()
    for pattern in allowed_patterns:
        allowed.update(path.resolve() for path in bundle_dir.glob(pattern))
    stale = [
        path
        for path in sorted(artifact_dir.iterdir())
        if path.is_file() and path.name.startswith("SnapText") and path.resolve() not in allowed
    ]
    if stale:
        raise SystemExit(
            "Unexpected SnapText bundle artifacts for this release: "
            + ", ".join(display_path(path) for path in stale)
        )


def verify_macos(
    product_name: str,
    version: str,
    require_installers: bool,
    release_dir: Path,
    bundle_dir: Path,
) -> None:
    binary = release_dir / "snaptext-tauri"
    app_bundle = bundle_dir / "macos" / f"{product_name}.app"
    app_executable = app_bundle / "Contents" / "MacOS" / "snaptext-tauri"
    app_info = app_bundle / "Contents" / "Info.plist"

    require_nonempty_file(binary, "Run cargo-tauri build on macOS first.")
    if require_installers:
        verify_macos_installers(product_name, version, bundle_dir)
    else:
        # Tauri's dmg bundler can remove the intermediate .app after creating
        # the disk image. Only require the app bundle in no-installer checks.
        require_dir(app_bundle, "The macOS .app bundle was not produced.")
        require_nonempty_file(app_executable, "The .app bundle is missing its main executable.")
        require_nonempty_file(app_info, "The .app bundle is missing Info.plist.")


def verify_macos_installers(product_name: str, version: str, bundle_dir: Path) -> None:
    dmg_patterns = [f"dmg/{product_name}_{version}_*.dmg"]
    updater_patterns = [f"macos/{product_name}*.tar.gz"]
    updater_signature_patterns = [f"macos/{product_name}*.tar.gz.sig"]
    reject_stale_snaptext_artifacts(bundle_dir, "dmg", dmg_patterns)
    reject_stale_snaptext_artifacts(
        bundle_dir,
        "macos",
        updater_patterns + updater_signature_patterns + [f"macos/{product_name}.app"],
    )
    require_any_nonempty(
        bundle_dir,
        dmg_patterns,
        "Run cargo-tauri build --bundles dmg on macOS.",
    )
    require_any_nonempty(
        bundle_dir,
        updater_patterns,
        "Enable createUpdaterArtifacts and run a signed macOS cargo-tauri build.",
    )
    require_any_nonempty(
        bundle_dir,
        updater_signature_patterns,
        "Set TAURI_SIGNING_PRIVATE_KEY so Tauri signs the macOS updater artifact.",
    )


def verify_windows(
    product_name: str,
    version: str,
    require_installers: bool,
    release_dir: Path,
    bundle_dir: Path,
) -> None:
    binary = release_dir / "snaptext-tauri.exe"
    require_nonempty_file(binary, "Run cargo-tauri build on Windows first.")

    if require_installers:
        verify_windows_installers(product_name, version, bundle_dir)


def verify_windows_installers(product_name: str, version: str, bundle_dir: Path) -> None:
    msi_patterns = [f"msi/{product_name}_{version}_*.msi"]
    nsis_patterns = [f"nsis/{product_name}_{version}_*.exe"]
    reject_stale_snaptext_artifacts(bundle_dir, "msi", msi_patterns)
    reject_stale_snaptext_artifacts(bundle_dir, "nsis", nsis_patterns)
    require_any_nonempty(
        bundle_dir,
        msi_patterns + nsis_patterns,
        "Run cargo-tauri build on Windows with MSI or NSIS bundle targets.",
    )


def verify_linux(
    product_name: str,
    version: str,
    require_installers: bool,
    release_dir: Path,
    bundle_dir: Path,
) -> None:
    binary = release_dir / "snaptext-tauri"
    require_nonempty_file(binary, "Run cargo-tauri build on Linux first.")

    if require_installers:
        verify_linux_installers(product_name, version, bundle_dir)


def verify_linux_installers(product_name: str, version: str, bundle_dir: Path) -> None:
    deb_patterns = [f"deb/{product_name}_{version}_*.deb"]
    rpm_patterns = [f"rpm/{product_name}-{version}-*.rpm"]
    appimage_patterns = [f"appimage/{product_name}_{version}_*.AppImage"]
    reject_stale_snaptext_artifacts(bundle_dir, "deb", deb_patterns)
    reject_stale_snaptext_artifacts(bundle_dir, "rpm", rpm_patterns)
    reject_stale_snaptext_artifacts(bundle_dir, "appimage", appimage_patterns)
    require_any_nonempty(
        bundle_dir,
        deb_patterns + rpm_patterns + appimage_patterns,
        "Run cargo-tauri build on Linux with deb, rpm, or AppImage bundle targets.",
    )


def verify_all_platform_installers(product_name: str, version: str, bundle_dir: Path) -> None:
    verify_macos_installers(product_name, version, bundle_dir)
    windows_patterns = {
        "Windows MSI": [f"msi/{product_name}_{version}_*.msi"],
        "Windows NSIS": [f"nsis/{product_name}_{version}_*.exe"],
    }
    linux_patterns = {
        "Linux deb": [f"deb/{product_name}_{version}_*.deb"],
        "Linux rpm": [f"rpm/{product_name}-{version}-*.rpm"],
        "Linux AppImage": [f"appimage/{product_name}_{version}_*.AppImage"],
    }
    for directory, patterns in (
        ("msi", windows_patterns["Windows MSI"]),
        ("nsis", windows_patterns["Windows NSIS"]),
        ("deb", linux_patterns["Linux deb"]),
        ("rpm", linux_patterns["Linux rpm"]),
        ("appimage", linux_patterns["Linux AppImage"]),
    ):
        reject_stale_snaptext_artifacts(bundle_dir, directory, patterns)
    for label, patterns in {**windows_patterns, **linux_patterns}.items():
        require_any_nonempty(
            bundle_dir,
            patterns,
            f"Run cargo-tauri build to produce the required {label} release artifact.",
        )


def detect_platform() -> str:
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system == "windows":
        return "windows"
    if system == "linux":
        return "linux"
    raise SystemExit(f"Unsupported desktop platform: {platform.system()}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify Tauri desktop bundle artifacts for SnapText."
    )
    parser.add_argument(
        "--platform",
        choices=("current", "macos", "windows", "linux", "all"),
        default="current",
        help="Platform artifact set to verify. Use 'current' after a local platform build.",
    )
    parser.add_argument(
        "--skip-installers",
        action="store_true",
        help="Only verify release binaries and app bundle directories, not installer files.",
    )
    parser.add_argument(
        "--release-dir",
        default=str(RELEASE_DIR),
        help="Directory containing platform release binaries.",
    )
    parser.add_argument(
        "--bundle-dir",
        default=str(BUNDLE_DIR),
        help="Directory containing Tauri bundle artifacts.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config = read_tauri_config()
    product_name = config.get("productName", "SnapText")
    version = config.get("version", "0.1.0")
    require_installers = not args.skip_installers
    release_dir = Path(args.release_dir).expanduser().resolve()
    bundle_dir = Path(args.bundle_dir).expanduser().resolve()

    if args.platform == "all":
        verify_all_platform_installers(product_name, version, bundle_dir)
        platforms = ["macos", "windows", "linux"]
    else:
        platforms = [detect_platform()] if args.platform == "current" else [args.platform]
        for target in platforms:
            if target == "macos":
                verify_macos(product_name, version, require_installers, release_dir, bundle_dir)
            elif target == "windows":
                verify_windows(product_name, version, require_installers, release_dir, bundle_dir)
            elif target == "linux":
                verify_linux(product_name, version, require_installers, release_dir, bundle_dir)

    print(f"Desktop bundle checks passed for: {', '.join(platforms)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
