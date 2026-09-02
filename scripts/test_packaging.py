#!/usr/bin/env python3
"""Self-test desktop packaging command wiring without invoking Tauri."""

from __future__ import annotations

import os
import sys
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_script(script: str, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    child_env = os.environ.copy()
    if env:
        child_env.update(env)
    return subprocess.run(
        ["python3", f"scripts/{script}", "--dry-run", *args],
        cwd=ROOT,
        env=child_env,
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
    assert_contains(desktop_bundle.stdout, "cargo-tauri build --bundles msi")
    assert_contains(desktop_bundle.stdout, "--config {\"bundle\":{\"createUpdaterArtifacts\":false}} --no-sign")
    assert_contains(desktop_bundle.stdout, "verify_desktop_bundles.py --platform current")

    skip_smoke_env = {"SNAPTEXT_SKIP_OCR_SMOKE_TEST": "1"}
    desktop_skip_smoke = run_script("package_desktop.py", "--bundles", "deb", env=skip_smoke_env)
    assert_success(desktop_skip_smoke)
    if sys.platform != "darwin":
        assert_contains(desktop_skip_smoke.stdout, "--skip-smoke-test")

    macos_skip = run_script("package_macos.py", "--skip-dmg")
    assert_success(macos_skip)
    assert_contains(
        macos_skip.stdout,
        "python3 scripts/verify_ocr_models.py models --allow-macos-vision-fallback",
    )
    assert_contains(macos_skip.stdout, "python3 scripts/build_frontend.py")
    assert_contains(macos_skip.stdout, "cargo-tauri build --no-bundle")
    assert_contains(macos_skip.stdout, "cargo-tauri build --bundles app")
    assert_not_contains(macos_skip.stdout, "cargo-tauri build --bundles app --no-sign")
    assert_not_contains(macos_skip.stdout, "cargo-tauri build --bundles dmg")
    assert_contains(macos_skip.stdout, "verify_macos_artifacts SnapText 0.1.2 require_dmg=False")

    macos_full = run_script("package_macos.py")
    assert_success(macos_full)
    assert_contains(macos_full.stdout, "cargo-tauri build --bundles dmg")
    assert_not_contains(macos_full.stdout, "cargo-tauri build --bundles dmg --no-sign")
    assert_contains(macos_full.stdout, "verify_macos_artifacts SnapText 0.1.2 require_dmg=True")

    macos_unsigned = run_script("package_macos.py", "--skip-dmg", "--no-sign")
    assert_success(macos_unsigned)
    assert_contains(macos_unsigned.stdout, "cargo-tauri build --bundles app")
    assert_contains(macos_unsigned.stdout, "--config {\"bundle\":{\"createUpdaterArtifacts\":false}} --no-sign")

    macos_ad_hoc = run_script("package_macos.py", "--skip-dmg", "--ad-hoc-sign")
    assert_success(macos_ad_hoc)
    assert_contains(macos_ad_hoc.stdout, "cargo-tauri build --bundles app")
    assert_contains(
        macos_ad_hoc.stdout,
        "--config {\"bundle\":{\"createUpdaterArtifacts\":false}} --no-sign",
    )
    assert_contains(
        macos_ad_hoc.stdout,
        "ad_hoc_sign_and_archive target/release/bundle/macos/SnapText.app ",
    )

    macos_ad_hoc_dmg = run_script("package_macos.py", "--ad-hoc-sign")
    if macos_ad_hoc_dmg.returncode == 0:
        raise SystemExit("Expected ad-hoc signing without --skip-dmg to fail")
    assert_contains(macos_ad_hoc_dmg.stdout, "--ad-hoc-sign requires --skip-dmg")

    macos_release_models = run_script("package_macos.py", "--skip-dmg", "--require-sha256")
    assert_success(macos_release_models)
    assert_contains(
        macos_release_models.stdout,
        "python3 scripts/verify_ocr_models.py models --require-sha256",
    )
    assert_contains(macos_release_models.stdout, "verify_macos_artifacts SnapText 0.1.2 require_dmg=False")

    # Tag builds must override stale checkout metadata so Tauri installer names
    # use the release tag (for example, v0.1.2 -> SnapText_0.1.2_x64-setup.exe).
    tagged_windows = run_script(
        "package_desktop.py",
        "--bundles",
        "nsis",
        "--no-sign",
        env={"SNAPTEXT_RELEASE_VERSION": "0.1.2"},
    )
    assert_success(tagged_windows)
    assert_contains(
        tagged_windows.stdout,
        'cargo-tauri build --bundles nsis --config {"version":"0.1.2","bundle":{"createUpdaterArtifacts":false}} --no-sign',
    )

    tagged_macos = run_script(
        "package_macos.py",
        "--skip-dmg",
        "--no-sign",
        env={"SNAPTEXT_RELEASE_VERSION": "0.1.2"},
    )
    assert_success(tagged_macos)
    assert_contains(tagged_macos.stdout, "verify_macos_artifacts SnapText 0.1.2 require_dmg=False")
    assert_contains(
        tagged_macos.stdout,
        'cargo-tauri build --bundles app --config {"bundle":{"createUpdaterArtifacts":false},"version":"0.1.2"} --no-sign',
    )

    print("Packaging command self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
