#!/usr/bin/env python3
"""Verify SnapText release signing and notarization evidence."""

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
DEFAULT_RECORD = RELEASE_DIR / "release-signing-record.json"
EXAMPLE_RECORD = RELEASE_DIR / "release-signing-record.example.json"
VALID_RESULTS = {"pass", "fail", "blocked", "not_applicable"}
PLACEHOLDER_PREFIXES = ("replace-with-", "replace with ")
MIN_EVIDENCE_LENGTH = 12
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
GIT_SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{7,40}$")
PLATFORM_CHECKS = {
    "macos": (
        "developer_id_signature",
        "notarization_accepted",
        "stapled_ticket",
        "gatekeeper_assessment",
        "dmg_signature",
    ),
    "windows": (
        "authenticode_signature",
        "timestamp",
        "installer_signature",
        "smart_screen_reputation_plan",
    ),
    "linux": (
        "sha256_checksums",
        "deb_signature_or_repository_plan",
        "rpm_signature_or_repository_plan",
        "appimage_checksum",
    ),
}
EVIDENCE_KEYWORDS = {
    "macos": {
        "developer_id_signature": ("codesign", "Developer ID"),
        "notarization_accepted": ("notarytool", "Accepted"),
        "stapled_ticket": ("stapler", "staple"),
        "gatekeeper_assessment": ("spctl", "accepted"),
        "dmg_signature": ("codesign", ".dmg"),
    },
    "windows": {
        "authenticode_signature": ("signtool", "Verified"),
        "timestamp": ("timestamp", "RFC3161"),
        "installer_signature": ("signtool", ".msi", ".exe"),
        "smart_screen_reputation_plan": ("SmartScreen", "reputation"),
    },
    "linux": {
        "sha256_checksums": ("SHA256SUMS", "sha256"),
        "deb_signature_or_repository_plan": ("deb", "repository"),
        "rpm_signature_or_repository_plan": ("rpm", "repository"),
        "appimage_checksum": ("AppImage", "sha256"),
    },
}


def example_record() -> dict:
    return {
        "schema_version": 1,
        "release": {
            "version": "0.1.0",
            "commit": "replace-with-git-sha",
            "date": "YYYY-MM-DD",
            "signing_operator": "replace-with-name",
        },
        "platforms": {
            platform_name: {
                "checks": {
                    check_name: {
                        "result": "blocked",
                        "evidence": "replace with command output, certificate fingerprint, or artifact path",
                    }
                    for check_name in checks
                },
            }
            for platform_name, checks in PLATFORM_CHECKS.items()
        },
    }


def write_example(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(example_record(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote release signing example record: {path}")


def read_record(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(
            f"Missing release signing record: {path}. "
            "Generate a template with: python3 scripts/verify_release_signing.py --write-example"
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
) -> str:
    release = record.get("release")
    check(isinstance(release, dict), "release signing record is missing release metadata")
    validate_semver("release.version", release.get("version"))
    version = validate_filled_text("release.version", release.get("version"))
    validate_git_sha("release.commit", release.get("commit"))
    validate_filled_text("release.signing_operator", release.get("signing_operator"))
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
    return version


def expected_artifact_token_groups(version: str) -> dict[tuple[str, str], tuple[tuple[str, ...], ...]]:
    linux_deb = f"SnapText_{version}_amd64.deb"
    linux_rpm = f"SnapText-{version}-1.x86_64.rpm"
    linux_appimage = f"SnapText_{version}_amd64.AppImage"
    return {
        ("macos", "dmg_signature"): ((f"SnapText_{version}_aarch64.dmg", "SnapText.dmg"),),
        ("windows", "authenticode_signature"): (
            (f"SnapText_{version}_x64.msi",),
            (f"SnapText_{version}_x64.exe",),
        ),
        ("windows", "installer_signature"): (
            (f"SnapText_{version}_x64.msi",),
            (f"SnapText_{version}_x64.exe",),
        ),
        ("linux", "sha256_checksums"): (
            ("SHA256SUMS",),
            (linux_deb,),
            (linux_rpm,),
            (linux_appimage,),
        ),
        ("linux", "appimage_checksum"): (
            ("SHA256SUMS",),
            (linux_appimage,),
        ),
    }


def validate_evidence_keywords(platform_name: str, check_name: str, evidence_text: str) -> None:
    required_keywords = EVIDENCE_KEYWORDS[platform_name][check_name]
    missing = [
        keyword
        for keyword in required_keywords
        if keyword.lower() not in evidence_text.lower()
    ]
    check(
        not missing,
        f"{platform_name}.{check_name}.evidence must mention: {', '.join(missing)}",
    )


def validate_artifact_version_reference(
    platform_name: str,
    check_name: str,
    evidence_text: str,
    version: str,
) -> None:
    token_groups = expected_artifact_token_groups(version).get((platform_name, check_name))
    if token_groups is None:
        return
    lowered = evidence_text.lower()
    missing_groups = [
        " or ".join(group)
        for group in token_groups
        if not any(token.lower() in lowered for token in group)
    ]
    if missing_groups:
        raise SystemExit(
            f"{platform_name}.{check_name}.evidence must mention concrete artifacts for version {version}: "
            + ", ".join(missing_groups)
        )


def validate_check(platform_name: str, check_name: str, payload: object, version: str) -> None:
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
    check(result == "pass", f"{platform_name}.{check_name} is not passing: {result}")
    validate_evidence_keywords(platform_name, check_name, evidence_text)
    validate_artifact_version_reference(platform_name, check_name, evidence_text, version)


def validate_record(
    record: dict,
    expected_version: str | None = None,
    expected_commit: str | None = None,
) -> None:
    check(record.get("schema_version") == 1, "release signing record schema_version must be 1")
    version = validate_release_metadata(record, expected_version, expected_commit)
    platforms = record.get("platforms")
    check(isinstance(platforms, dict), "release signing record is missing platforms")
    unknown_platforms = sorted(set(platforms) - set(PLATFORM_CHECKS))
    check(
        not unknown_platforms,
        "release signing record contains unknown platforms: " + ", ".join(unknown_platforms),
    )
    for platform_name, required_checks in PLATFORM_CHECKS.items():
        platform_payload = platforms.get(platform_name)
        check(isinstance(platform_payload, dict), f"release signing record is missing {platform_name}")
        checks = platform_payload.get("checks")
        check(isinstance(checks, dict), f"{platform_name}.checks must be an object")
        unknown_checks = sorted(set(checks) - set(required_checks))
        check(
            not unknown_checks,
            f"{platform_name}.checks contains unknown checks: {', '.join(unknown_checks)}",
        )
        for check_name in required_checks:
            check(check_name in checks, f"{platform_name}.checks is missing {check_name}")
            validate_check(platform_name, check_name, checks[check_name], version)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify SnapText release signing record.")
    parser.add_argument(
        "record",
        nargs="?",
        default=str(DEFAULT_RECORD),
        help="Path to the filled release signing JSON record.",
    )
    parser.add_argument(
        "--write-example",
        action="store_true",
        help="Write .release/release-signing-record.example.json and exit.",
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
    print(f"Release signing record passed: {record_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
