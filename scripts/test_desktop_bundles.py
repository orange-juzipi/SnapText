#!/usr/bin/env python3
"""Self-test desktop bundle artifact verification."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_bundles(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", "scripts/verify_desktop_bundles.py", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def assert_success(result: subprocess.CompletedProcess[str]) -> None:
    if result.returncode != 0:
        raise SystemExit(result.stdout)


def assert_failure_contains(result: subprocess.CompletedProcess[str], expected: str) -> None:
    if result.returncode == 0 or expected not in result.stdout:
        raise SystemExit(
            f"Expected failure containing {expected!r}, got rc={result.returncode}:\n{result.stdout}"
        )


def write_file(path: Path, content: bytes = b"artifact") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def create_all_platform_artifacts(release_dir: Path, bundle_dir: Path) -> None:
    write_file(release_dir / "snaptext-tauri", b"unix binary")
    write_file(release_dir / "snaptext-tauri.exe", b"windows binary")

    app_root = bundle_dir / "macos" / "SnapText.app" / "Contents"
    write_file(app_root / "MacOS" / "snaptext-tauri", b"app binary")
    write_file(app_root / "Info.plist", b"plist")
    write_file(bundle_dir / "dmg" / "SnapText_0.1.0_aarch64.dmg", b"dmg")

    write_file(bundle_dir / "msi" / "SnapText_0.1.0_x64.msi", b"msi")
    write_file(bundle_dir / "nsis" / "SnapText_0.1.0_x64.exe", b"nsis")
    write_file(bundle_dir / "deb" / "SnapText_0.1.0_amd64.deb", b"deb")
    write_file(bundle_dir / "rpm" / "SnapText-0.1.0-1.x86_64.rpm", b"rpm")
    write_file(bundle_dir / "appimage" / "SnapText_0.1.0_amd64.AppImage", b"appimage")


def create_installer_artifacts(bundle_dir: Path) -> None:
    write_file(bundle_dir / "dmg" / "SnapText_0.1.0_aarch64.dmg", b"dmg")
    write_file(bundle_dir / "msi" / "SnapText_0.1.0_x64.msi", b"msi")
    write_file(bundle_dir / "nsis" / "SnapText_0.1.0_x64.exe", b"nsis")
    write_file(bundle_dir / "deb" / "SnapText_0.1.0_amd64.deb", b"deb")
    write_file(bundle_dir / "rpm" / "SnapText-0.1.0-1.x86_64.rpm", b"rpm")
    write_file(bundle_dir / "appimage" / "SnapText_0.1.0_amd64.AppImage", b"appimage")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="snaptext-desktop-bundles-") as temp:
        root = Path(temp)
        release_dir = root / "release"
        bundle_dir = release_dir / "bundle"
        create_all_platform_artifacts(release_dir, bundle_dir)

        common_args = ["--release-dir", str(release_dir), "--bundle-dir", str(bundle_dir)]
        assert_success(run_bundles("--platform", "all", *common_args))
        assert_success(run_bundles("--platform", "macos", "--skip-installers", *common_args))

        (bundle_dir / "msi" / "SnapText_0.1.0_x64.msi").unlink()
        missing_windows_installer = run_bundles("--platform", "all", *common_args)
        assert_failure_contains(
            missing_windows_installer,
            "Missing bundle artifacts matching",
        )

    with tempfile.TemporaryDirectory(prefix="snaptext-desktop-bundles-all-only-") as temp:
        root = Path(temp)
        release_dir = root / "release"
        bundle_dir = release_dir / "bundle"
        create_installer_artifacts(bundle_dir)

        common_args = ["--release-dir", str(release_dir), "--bundle-dir", str(bundle_dir)]
        assert_success(run_bundles("--platform", "all", *common_args))

        (bundle_dir / "nsis" / "SnapText_0.1.0_x64.exe").unlink()
        missing_nsis = run_bundles("--platform", "all", *common_args)
        assert_failure_contains(
            missing_nsis,
            "Missing bundle artifacts matching",
        )
        write_file(bundle_dir / "nsis" / "SnapText_0.1.0_x64.exe", b"nsis")

        (bundle_dir / "deb" / "SnapText_0.1.0_amd64.deb").unlink()
        missing_deb = run_bundles("--platform", "all", *common_args)
        assert_failure_contains(
            missing_deb,
            "Missing bundle artifacts matching",
        )
        write_file(bundle_dir / "deb" / "SnapText_0.1.0_amd64.deb", b"deb")

        (bundle_dir / "rpm" / "SnapText-0.1.0-1.x86_64.rpm").unlink()
        missing_rpm = run_bundles("--platform", "all", *common_args)
        assert_failure_contains(
            missing_rpm,
            "Missing bundle artifacts matching",
        )
        write_file(bundle_dir / "rpm" / "SnapText-0.1.0-1.x86_64.rpm", b"rpm")

        (bundle_dir / "appimage" / "SnapText_0.1.0_amd64.AppImage").unlink()
        missing_appimage = run_bundles("--platform", "all", *common_args)
        assert_failure_contains(
            missing_appimage,
            "Missing bundle artifacts matching",
        )
        write_file(bundle_dir / "appimage" / "SnapText_0.1.0_amd64.AppImage", b"appimage")

        macos_without_app = run_bundles("--platform", "macos", "--skip-installers", *common_args)
        assert_failure_contains(macos_without_app, "Missing")

    with tempfile.TemporaryDirectory(prefix="snaptext-desktop-bundles-stale-") as temp:
        root = Path(temp)
        release_dir = root / "release"
        bundle_dir = release_dir / "bundle"
        create_installer_artifacts(bundle_dir)
        write_file(bundle_dir / "msi" / "SnapText_0.0.9_x64.msi", b"stale msi")

        stale_windows = run_bundles(
            "--platform",
            "all",
            "--release-dir",
            str(release_dir),
            "--bundle-dir",
            str(bundle_dir),
        )
        assert_failure_contains(
            stale_windows,
            "Unexpected SnapText bundle artifacts for this release",
        )

    with tempfile.TemporaryDirectory(prefix="snaptext-desktop-bundles-empty-") as temp:
        root = Path(temp)
        release_dir = root / "release"
        bundle_dir = release_dir / "bundle"
        create_installer_artifacts(bundle_dir)
        (bundle_dir / "appimage" / "SnapText_0.1.0_amd64.AppImage").write_bytes(b"")

        empty_linux_artifact = run_bundles(
            "--platform",
            "all",
            "--release-dir",
            str(release_dir),
            "--bundle-dir",
            str(bundle_dir),
        )
        assert_failure_contains(empty_linux_artifact, "Generated file is empty")

    print("Desktop bundle verifier self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
