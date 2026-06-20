#!/usr/bin/env python3
"""Self-test desktop QA record verification."""

from __future__ import annotations

import json
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path

from verify_desktop_qa import example_record


ROOT = Path(__file__).resolve().parents[1]
CHECK_EVIDENCE = {
    "package_build": "package_desktop.py completed cargo-tauri build for this platform",
    "bundle_verification": "verify_desktop_bundles.py confirmed bundle installer artifact",
    "app_launch": "launch app from installer and main window opened",
    "model_validation": "verify_ocr_models.py passed and Validate models found SHA256SUMS",
    "translator_provider_validation": (
        "verify_translator_providers.py passed OpenAI-compatible DeepL Google local HTTP"
    ),
    "screenshot_translation": "screenshot OCR translate flow returned result text",
    "selection_translation": "selection translate hotkey returned result text",
    "image_translation": "image drag paste paths both returned translated text",
    "global_hotkeys": "hotkey shortcut register succeeded after settings save",
    "overlay_window": "overlay drag selection box worked on display",
    "result_window": "result copy pin actions worked in result window",
    "history": "history record created and clear removed records",
    "settings_persistence": "settings save persisted after restart",
    "screen_recording_permission": "Screen Recording permission prompt and allowed state verified",
    "accessibility_permission": "Accessibility permission prompt and allowed state verified",
    "dmg_install": "dmg install launch path verified",
    "ui_automation_selection": "UI Automation selection worked in Notepad",
    "privilege_boundary": "privilege admin elevated window behavior documented",
    "installer_install": "installer install uninstall launch cycle verified",
    "x11_session": "X11 overlay selection hotkey flow verified",
    "wayland_session": "Wayland overlay selection hotkey flow verified",
    "selection_tools": "wl-clipboard xclip xsel missing and installed behavior verified",
}


def run_qa(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", "scripts/verify_desktop_qa.py", *args],
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


def passing_record() -> dict:
    record = example_record()
    record["release"] = {
        "version": "0.1.0",
        "commit": "0123456789abcdef0123456789abcdef01234567",
        "tester": "qa tester",
        "date": date.today().isoformat(),
    }
    for platform in record["platforms"].values():
        platform["os_version"] = "test os"
        platform["architecture"] = "test arch"
        for check_name, check_payload in platform["checks"].items():
            check_payload["result"] = "pass"
            check_payload["evidence"] = CHECK_EVIDENCE[check_name]
    return record


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="snaptext-desktop-qa-") as temp:
        root = Path(temp)
        example_path = root / "desktop-qa-record.example.json"
        generated_example = run_qa("--write-example", "--example-output", str(example_path))
        assert_success(generated_example)

        # Also verify the explicit output path can be validated after conversion
        # to a filled pass record.
        loaded_example = json.loads(example_path.read_text(encoding="utf-8"))
        if loaded_example.get("schema_version") != 1:
            raise SystemExit("desktop QA example schema_version is not 1")

        valid_path = root / "desktop-qa-record.json"
        valid = passing_record()
        write_json(valid_path, valid)
        assert_success(run_qa(str(valid_path)))
        assert_success(
            run_qa(
                str(valid_path),
                "--expected-version",
                "0.1.0",
                "--expected-commit",
                "0123456789abcdef0123456789abcdef01234567",
            )
        )

        wrong_expected_path = root / "desktop-qa-wrong-expected.json"
        write_json(wrong_expected_path, passing_record())
        assert_failure_contains(
            run_qa(str(wrong_expected_path), "--expected-version", "9.9.9"),
            "release.version must match expected version 9.9.9",
        )
        assert_failure_contains(
            run_qa(str(wrong_expected_path), "--expected-commit", "89abcdef"),
            "release.commit must match expected commit 89abcdef",
        )

        placeholder_path = root / "desktop-qa-placeholder.json"
        placeholder = passing_record()
        placeholder["release"]["tester"] = "replace-with-name"
        write_json(placeholder_path, placeholder)
        assert_failure_contains(
            run_qa(str(placeholder_path)),
            "release.tester still contains a template placeholder",
        )

        bad_date_path = root / "desktop-qa-bad-date.json"
        bad_date = passing_record()
        bad_date["release"]["date"] = "06/18/2026"
        write_json(bad_date_path, bad_date)
        assert_failure_contains(
            run_qa(str(bad_date_path)),
            "release.date must use YYYY-MM-DD format",
        )

        future_date_path = root / "desktop-qa-future-date.json"
        future_date = passing_record()
        future_date["release"]["date"] = (date.today() + timedelta(days=1)).isoformat()
        write_json(future_date_path, future_date)
        assert_failure_contains(
            run_qa(str(future_date_path)),
            "release.date cannot be in the future",
        )

        bad_version_path = root / "desktop-qa-bad-version.json"
        bad_version = passing_record()
        bad_version["release"]["version"] = "release-one"
        write_json(bad_version_path, bad_version)
        assert_failure_contains(
            run_qa(str(bad_version_path)),
            "release.version must use semantic version format",
        )

        bad_commit_path = root / "desktop-qa-bad-commit.json"
        bad_commit = passing_record()
        bad_commit["release"]["commit"] = "test-commit"
        write_json(bad_commit_path, bad_commit)
        assert_failure_contains(
            run_qa(str(bad_commit_path)),
            "release.commit must be a 7-40 character git SHA",
        )

        platform_placeholder_path = root / "desktop-qa-platform-placeholder.json"
        platform_placeholder = passing_record()
        platform_placeholder["platforms"]["linux"]["os_version"] = "replace-with-os-version"
        write_json(platform_placeholder_path, platform_placeholder)
        assert_failure_contains(
            run_qa(str(platform_placeholder_path)),
            "linux.os_version still contains a template placeholder",
        )

        evidence_placeholder_path = root / "desktop-qa-evidence-placeholder.json"
        evidence_placeholder = passing_record()
        evidence_placeholder["platforms"]["macos"]["checks"]["app_launch"][
            "evidence"
        ] = "replace with command output, screenshot name, or notes"
        write_json(evidence_placeholder_path, evidence_placeholder)
        assert_failure_contains(
            run_qa(str(evidence_placeholder_path)),
            "macos.app_launch.evidence still contains a template placeholder",
        )

        short_evidence_path = root / "desktop-qa-short-evidence.json"
        short_evidence = passing_record()
        short_evidence["platforms"]["linux"]["checks"]["history"]["evidence"] = "short"
        write_json(short_evidence_path, short_evidence)
        assert_failure_contains(
            run_qa(str(short_evidence_path)),
            "linux.history.evidence must include specific verification evidence",
        )

        missing_keyword_path = root / "desktop-qa-missing-keyword.json"
        missing_keyword = passing_record()
        missing_keyword["platforms"]["windows"]["checks"]["package_build"][
            "evidence"
        ] = "desktop package was produced successfully"
        write_json(missing_keyword_path, missing_keyword)
        assert_failure_contains(
            run_qa(str(missing_keyword_path)),
            "windows.package_build.evidence must mention: package_desktop.py, cargo-tauri, build",
        )

        blocked_path = root / "desktop-qa-blocked.json"
        blocked = passing_record()
        blocked["platforms"]["macos"]["checks"]["screenshot_translation"]["result"] = "blocked"
        write_json(blocked_path, blocked)
        assert_failure_contains(
            run_qa(str(blocked_path)),
            "macos.screenshot_translation is not passing: blocked",
        )

        missing_path = root / "desktop-qa-missing.json"
        missing = passing_record()
        del missing["platforms"]["linux"]["checks"]["wayland_session"]
        write_json(missing_path, missing)
        assert_failure_contains(
            run_qa(str(missing_path)),
            "linux.checks is missing wayland_session",
        )

        unknown_platform_path = root / "desktop-qa-unknown-platform.json"
        unknown_platform = passing_record()
        unknown_platform["platforms"]["android"] = {
            "os_version": "test os",
            "architecture": "test arch",
            "checks": {},
        }
        write_json(unknown_platform_path, unknown_platform)
        assert_failure_contains(
            run_qa(str(unknown_platform_path)),
            "desktop QA record contains unknown platforms: android",
        )

        unknown_check_path = root / "desktop-qa-unknown-check.json"
        unknown_check = passing_record()
        unknown_check["platforms"]["macos"]["checks"]["screen_hover_translation"] = {
            "result": "pass",
            "evidence": "self-test evidence for unknown check",
        }
        write_json(unknown_check_path, unknown_check)
        assert_failure_contains(
            run_qa(str(unknown_check_path)),
            "macos.checks contains unknown checks: screen_hover_translation",
        )

    print("Desktop QA verifier self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
