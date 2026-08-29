#!/usr/bin/env python3
"""Verify the manual desktop QA record for SnapText.

The release flow has checks that cannot be automated from a headless sandbox:
OS permissions, global hotkeys, real desktop selection, overlay behavior, and
installer launch checks. This script makes those manual checks auditable by
validating a structured JSON record.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
# Keep release evidence outside the public source tree. The directory is
# ignored, while --write-example still provides an on-demand template.
RELEASE_DIR = ROOT / ".release"
DEFAULT_RECORD = RELEASE_DIR / "desktop-qa-record.json"
EXAMPLE_RECORD = RELEASE_DIR / "desktop-qa-record.example.json"
PLATFORMS = ("macos", "windows", "linux")
COMMON_CHECKS = (
    "package_build",
    "bundle_verification",
    "app_launch",
    "model_validation",
    "translator_provider_validation",
    "screenshot_translation",
    "selection_translation",
    "image_translation",
    "global_hotkeys",
    "overlay_window",
    "result_window",
    "history",
    "settings_persistence",
)
PLATFORM_CHECKS = {
    "macos": (
        "screen_recording_permission",
        "accessibility_permission",
        "dmg_install",
    ),
    "windows": (
        "ui_automation_selection",
        "privilege_boundary",
        "installer_install",
    ),
    "linux": (
        "x11_session",
        "wayland_session",
        "selection_tools",
        "installer_install",
    ),
}
VALID_RESULTS = {"pass", "fail", "blocked", "not_applicable"}
PLACEHOLDER_PREFIXES = ("replace-with-", "replace with ")
MIN_EVIDENCE_LENGTH = 12
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
GIT_SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{7,40}$")
EVIDENCE_KEYWORDS = {
    "package_build": ("package_desktop.py", "cargo-tauri", "build"),
    "bundle_verification": ("verify_desktop_bundles.py", "bundle", "installer"),
    "app_launch": ("launch", "app", "window"),
    "model_validation": ("verify_ocr_models.py", "Validate models", "SHA256SUMS"),
    "translator_provider_validation": (
        "verify_translator_providers.py",
        "OpenAI-compatible",
        "DeepL",
        "Google",
        "local HTTP",
    ),
    "screenshot_translation": ("screenshot", "OCR", "translate"),
    "selection_translation": ("selection", "translate", "hotkey"),
    "image_translation": ("image", "drag", "paste"),
    "global_hotkeys": ("hotkey", "shortcut", "register"),
    "overlay_window": ("overlay", "drag", "selection"),
    "result_window": ("result", "copy", "pin"),
    "history": ("history", "clear", "record"),
    "settings_persistence": ("settings", "save", "restart"),
    "screen_recording_permission": ("Screen Recording", "permission"),
    "accessibility_permission": ("Accessibility", "permission"),
    "dmg_install": ("dmg", "install", "launch"),
    "ui_automation_selection": ("UI Automation", "selection"),
    "privilege_boundary": ("privilege", "admin", "elevated"),
    "installer_install": ("installer", "install", "uninstall"),
    "x11_session": ("X11", "overlay", "selection"),
    "wayland_session": ("Wayland", "overlay", "selection"),
    "selection_tools": ("wl-clipboard", "xclip", "xsel"),
}


def required_checks(platform_name: str) -> tuple[str, ...]:
    return COMMON_CHECKS + PLATFORM_CHECKS[platform_name]


def example_record() -> dict:
    return {
        "schema_version": 1,
        "release": {
            "version": "0.1.0",
            "commit": "replace-with-git-sha",
            "tester": "replace-with-name",
            "date": "YYYY-MM-DD",
        },
        "platforms": {
            platform_name: {
                "os_version": "replace-with-os-version",
                "architecture": "replace-with-architecture",
                "checks": {
                    check_name: {
                        "result": "blocked",
                        "evidence": "replace with command output, screenshot name, or notes",
                    }
                    for check_name in required_checks(platform_name)
                },
            }
            for platform_name in PLATFORMS
        },
    }


def write_example(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(example_record(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote desktop QA example record: {path}")


def read_record(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(
            f"Missing desktop QA record: {path}. "
            "Generate a template with: python3 scripts/verify_desktop_qa.py --write-example"
        )
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def validate_filled_text(field_name: str, value: object) -> str:
    check(isinstance(value, str) and value.strip(), f"{field_name} is required")
    stripped = value.strip()
    lowered = stripped.lower()
    check(
        not lowered.startswith(PLACEHOLDER_PREFIXES) and stripped != "YYYY-MM-DD",
        f"{field_name} still contains a template placeholder",
    )
    return stripped


def validate_iso_date(field_name: str, value: object) -> None:
    date_value = validate_filled_text(field_name, value)
    try:
        parsed = datetime.strptime(date_value, "%Y-%m-%d").date()
    except ValueError as err:
        raise SystemExit(f"{field_name} must use YYYY-MM-DD format") from err
    if parsed > datetime.now().date():
        raise SystemExit(f"{field_name} cannot be in the future")


def validate_semver(field_name: str, value: object) -> None:
    version = validate_filled_text(field_name, value)
    check(
        SEMVER_PATTERN.fullmatch(version) is not None,
        f"{field_name} must use semantic version format",
    )


def validate_git_sha(field_name: str, value: object) -> None:
    commit = validate_filled_text(field_name, value)
    check(
        GIT_SHA_PATTERN.fullmatch(commit) is not None,
        f"{field_name} must be a 7-40 character git SHA",
    )


def validate_release_metadata(
    record: dict,
    expected_version: str | None,
    expected_commit: str | None,
) -> None:
    release = record.get("release")
    check(isinstance(release, dict), "desktop QA record is missing release metadata")
    validate_semver("release.version", release.get("version"))
    validate_git_sha("release.commit", release.get("commit"))
    validate_filled_text("release.tester", release.get("tester"))
    validate_iso_date("release.date", release.get("date"))
    if expected_version is not None:
        check(
            release.get("version") == expected_version,
            f"release.version must match expected version {expected_version}",
        )
    if expected_commit is not None:
        check(
            release.get("commit") == expected_commit,
            f"release.commit must match expected commit {expected_commit}",
        )


def validate_evidence_keywords(platform_name: str, check_name: str, evidence_text: str) -> None:
    required_keywords = EVIDENCE_KEYWORDS.get(check_name)
    if required_keywords is None:
        return
    missing = [
        keyword
        for keyword in required_keywords
        if keyword.lower() not in evidence_text.lower()
    ]
    check(
        not missing,
        f"{platform_name}.{check_name}.evidence must mention: {', '.join(missing)}",
    )


def validate_check(platform_name: str, check_name: str, payload: object) -> None:
    check(isinstance(payload, dict), f"{platform_name}.{check_name} must be an object")
    result = payload.get("result")
    evidence = payload.get("evidence")
    check(
        result in VALID_RESULTS,
        f"{platform_name}.{check_name}.result must be one of {sorted(VALID_RESULTS)}",
    )
    evidence_text = validate_filled_text(f"{platform_name}.{check_name}.evidence", evidence)
    check(
        len(evidence_text) >= MIN_EVIDENCE_LENGTH,
        f"{platform_name}.{check_name}.evidence must include specific verification evidence",
    )
    check(
        result == "pass",
        f"{platform_name}.{check_name} is not passing: {result}",
    )
    validate_evidence_keywords(platform_name, check_name, evidence_text)


def validate_platform(platform_name: str, payload: object) -> None:
    check(isinstance(payload, dict), f"{platform_name} platform record must be an object")
    for field in ("os_version", "architecture"):
        validate_filled_text(f"{platform_name}.{field}", payload.get(field))

    checks = payload.get("checks")
    check(isinstance(checks, dict), f"{platform_name}.checks must be an object")
    required = set(required_checks(platform_name))
    unknown_checks = sorted(set(checks) - required)
    check(
        not unknown_checks,
        f"{platform_name}.checks contains unknown checks: {', '.join(unknown_checks)}",
    )
    for check_name in required_checks(platform_name):
        check(check_name in checks, f"{platform_name}.checks is missing {check_name}")
        validate_check(platform_name, check_name, checks[check_name])


def validate_record(
    record: dict,
    expected_version: str | None = None,
    expected_commit: str | None = None,
) -> None:
    check(record.get("schema_version") == 1, "desktop QA record schema_version must be 1")
    validate_release_metadata(record, expected_version, expected_commit)
    platforms = record.get("platforms")
    check(isinstance(platforms, dict), "desktop QA record is missing platforms")
    unknown_platforms = sorted(set(platforms) - set(PLATFORMS))
    check(
        not unknown_platforms,
        "desktop QA record contains unknown platforms: " + ", ".join(unknown_platforms),
    )
    for platform_name in PLATFORMS:
        check(platform_name in platforms, f"desktop QA record is missing {platform_name}")
        validate_platform(platform_name, platforms[platform_name])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify SnapText desktop QA record.")
    parser.add_argument(
        "record",
        nargs="?",
        default=str(DEFAULT_RECORD),
        help="Path to the filled desktop QA JSON record.",
    )
    parser.add_argument(
        "--write-example",
        action="store_true",
        help="Write .release/desktop-qa-record.example.json and exit.",
    )
    parser.add_argument(
        "--example-output",
        default=str(EXAMPLE_RECORD),
        help="Path to write when using --write-example.",
    )
    parser.add_argument(
        "--expected-version",
        help="Require release.version to match this version.",
    )
    parser.add_argument(
        "--expected-commit",
        help="Require release.commit to match this git SHA.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.write_example:
        write_example(Path(args.example_output).expanduser().resolve())
        return 0

    record_path = Path(args.record).expanduser().resolve()
    validate_record(read_record(record_path), args.expected_version, args.expected_commit)
    print(f"Desktop QA record passed: {record_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
