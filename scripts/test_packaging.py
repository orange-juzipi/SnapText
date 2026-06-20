#!/usr/bin/env python3
"""Self-test desktop packaging command wiring without invoking Tauri."""

from __future__ import annotations

import sys
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_script(script: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", f"scripts/{script}", "--dry-run", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def assert_success(result: subprocess.CompletedProcess[str]) -> None:
    if result.returncode != 0:
        raise SystemExit(result.stdout)


def assert_contains(output: str, expected: str) -> None:
    if expected not in output:
        raise SystemExit(f"Expected dry-run output to contain {expected!r}:\n{output}")


def assert_not_contains(output: str, unexpected: str) -> None:
    if unexpected in output:
        raise SystemExit(f"Did not expect dry-run output to contain {unexpected!r}:\n{output}")


def main() -> int:
    desktop_model_check = "python3 scripts/verify_ocr_models.py models --require-sha256"
    if sys.platform == "darwin":
        desktop_model_check = (
            "python3 scripts/verify_ocr_models.py models --allow-macos-vision-fallback"
        )

    desktop_skip = run_script("package_desktop.py", "--skip-installers", "--no-sign")
    assert_success(desktop_skip)
    assert_contains(desktop_skip.stdout, desktop_model_check)
    assert_contains(desktop_skip.stdout, "python3 scripts/build_frontend.py")
    assert_contains(desktop_skip.stdout, "cargo-tauri build --no-bundle")
    assert_contains(desktop_skip.stdout, "verify_desktop_bundles.py --platform current --skip-installers")

    desktop_bundle = run_script("package_desktop.py", "--bundles", "msi", "--no-sign")
    assert_success(desktop_bundle)
    assert_contains(desktop_bundle.stdout, "cargo-tauri build --bundles msi --no-sign")
    assert_contains(desktop_bundle.stdout, "verify_desktop_bundles.py --platform current")

    macos_skip = run_script("package_macos.py", "--skip-dmg")
    assert_success(macos_skip)
    assert_contains(
        macos_skip.stdout,
        "python3 scripts/verify_ocr_models.py models --allow-macos-vision-fallback",
    )
    assert_contains(macos_skip.stdout, "python3 scripts/build_frontend.py")
    assert_contains(macos_skip.stdout, "cargo-tauri build --no-bundle")
    assert_contains(macos_skip.stdout, "cargo-tauri build --bundles app --no-sign")
    assert_not_contains(macos_skip.stdout, "cargo-tauri build --bundles dmg --no-sign")
    assert_contains(macos_skip.stdout, "verify_macos_artifacts SnapText 0.1.0 require_dmg=False")

    macos_full = run_script("package_macos.py")
    assert_success(macos_full)
    assert_contains(macos_full.stdout, "cargo-tauri build --bundles dmg --no-sign")
    assert_contains(macos_full.stdout, "verify_macos_artifacts SnapText 0.1.0 require_dmg=True")

    print("Packaging command self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
