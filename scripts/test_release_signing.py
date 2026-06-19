#!/usr/bin/env python3
"""Self-test release signing record verification."""

from __future__ import annotations

import json
import subprocess
import tempfile
from datetime import date, timedelta
from pathlib import Path

from verify_release_signing import example_record


ROOT = Path(__file__).resolve().parents[1]
PASSING_EVIDENCE = {
    ("macos", "developer_id_signature"): "codesign verified Developer ID Application certificate fingerprint ABCD",
    ("macos", "notarization_accepted"): "notarytool submit returned Accepted request id 1234",
    ("macos", "stapled_ticket"): "xcrun stapler staple validated ticket for SnapText.dmg",
    ("macos", "gatekeeper_assessment"): "spctl assessment accepted source Developer ID for SnapText_0.1.0_aarch64.dmg",
    ("macos", "dmg_signature"): "codesign verification passed for SnapText_0.1.0_aarch64.dmg",
    ("windows", "authenticode_signature"): "signtool verify /pa returned Verified for SnapText_0.1.0_x64.msi and SnapText_0.1.0_x64.exe",
    ("windows", "timestamp"): "signtool timestamp uses RFC3161 timestamp server and verified countersignature",
    ("windows", "installer_signature"): "signtool verified .msi and .exe installer signatures for SnapText_0.1.0_x64.msi and SnapText_0.1.0_x64.exe",
    ("windows", "smart_screen_reputation_plan"): "SmartScreen reputation plan documented for signed installer rollout",
    ("linux", "sha256_checksums"): "SHA256SUMS sha256 verified for SnapText_0.1.0_amd64.deb, SnapText-0.1.0-1.x86_64.rpm, and SnapText_0.1.0_amd64.AppImage",
    ("linux", "deb_signature_or_repository_plan"): "deb repository signing plan records apt repository key",
    ("linux", "rpm_signature_or_repository_plan"): "rpm repository signing plan records yum repository key",
    ("linux", "appimage_checksum"): "AppImage sha256 checksum verified against SnapText_0.1.0_amd64.AppImage and SHA256SUMS",
}


def run_signing(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", "scripts/verify_release_signing.py", *args],
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
        "date": date.today().isoformat(),
        "signing_operator": "release operator",
    }
    for platform_name, platform in record["platforms"].items():
        for check_name, check_payload in platform["checks"].items():
            check_payload["result"] = "pass"
            check_payload["evidence"] = PASSING_EVIDENCE[(platform_name, check_name)]
    return record


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="snaptext-release-signing-") as temp:
        root = Path(temp)
        example_path = root / "release-signing-record.example.json"
        generated_example = run_signing("--write-example", "--example-output", str(example_path))
        assert_success(generated_example)
        loaded_example = json.loads(example_path.read_text(encoding="utf-8"))
        if loaded_example.get("schema_version") != 1:
            raise SystemExit("release signing example schema_version is not 1")

        valid_path = root / "release-signing-record.json"
        valid = passing_record()
        write_json(valid_path, valid)
        assert_success(run_signing(str(valid_path)))
        assert_success(
            run_signing(
                str(valid_path),
                "--expected-version",
                "0.1.0",
                "--expected-commit",
                "0123456789abcdef0123456789abcdef01234567",
            )
        )

        wrong_expected_path = root / "release-signing-wrong-expected.json"
        write_json(wrong_expected_path, passing_record())
        assert_failure_contains(
            run_signing(str(wrong_expected_path), "--expected-version", "9.9.9"),
            "release.version must match expected version 9.9.9",
        )
        assert_failure_contains(
            run_signing(str(wrong_expected_path), "--expected-commit", "89abcdef"),
            "release.commit must match expected commit 89abcdef",
        )

        placeholder_path = root / "release-signing-placeholder.json"
        placeholder = passing_record()
        placeholder["release"]["signing_operator"] = "replace-with-name"
        write_json(placeholder_path, placeholder)
        assert_failure_contains(
            run_signing(str(placeholder_path)),
            "release.signing_operator still contains a template placeholder",
        )

        bad_date_path = root / "release-signing-bad-date.json"
        bad_date = passing_record()
        bad_date["release"]["date"] = "2026/06/18"
        write_json(bad_date_path, bad_date)
        assert_failure_contains(
            run_signing(str(bad_date_path)),
            "release.date must use YYYY-MM-DD format",
        )

        future_date_path = root / "release-signing-future-date.json"
        future_date = passing_record()
        future_date["release"]["date"] = (date.today() + timedelta(days=1)).isoformat()
        write_json(future_date_path, future_date)
        assert_failure_contains(
            run_signing(str(future_date_path)),
            "release.date cannot be in the future",
        )

        bad_version_path = root / "release-signing-bad-version.json"
        bad_version = passing_record()
        bad_version["release"]["version"] = "release-one"
        write_json(bad_version_path, bad_version)
        assert_failure_contains(
            run_signing(str(bad_version_path)),
            "release.version must use semantic version format",
        )

        bad_commit_path = root / "release-signing-bad-commit.json"
        bad_commit = passing_record()
        bad_commit["release"]["commit"] = "test-commit"
        write_json(bad_commit_path, bad_commit)
        assert_failure_contains(
            run_signing(str(bad_commit_path)),
            "release.commit must be a 7-40 character git SHA",
        )

        evidence_placeholder_path = root / "release-signing-evidence-placeholder.json"
        evidence_placeholder = passing_record()
        evidence_placeholder["platforms"]["windows"]["checks"]["timestamp"][
            "evidence"
        ] = "replace with command output, certificate fingerprint, or artifact path"
        write_json(evidence_placeholder_path, evidence_placeholder)
        assert_failure_contains(
            run_signing(str(evidence_placeholder_path)),
            "windows.timestamp.evidence still contains a template placeholder",
        )

        short_evidence_path = root / "release-signing-short-evidence.json"
        short_evidence = passing_record()
        short_evidence["platforms"]["linux"]["checks"]["sha256_checksums"][
            "evidence"
        ] = "short"
        write_json(short_evidence_path, short_evidence)
        assert_failure_contains(
            run_signing(str(short_evidence_path)),
            "linux.sha256_checksums.evidence must include specific verification evidence",
        )

        missing_keyword_path = root / "release-signing-missing-keyword.json"
        missing_keyword = passing_record()
        missing_keyword["platforms"]["windows"]["checks"]["authenticode_signature"][
            "evidence"
        ] = "Windows installer signature passed in release notes"
        write_json(missing_keyword_path, missing_keyword)
        assert_failure_contains(
            run_signing(str(missing_keyword_path)),
            "windows.authenticode_signature.evidence must mention: signtool, Verified",
        )

        missing_artifact_ref_path = root / "release-signing-missing-artifact-ref.json"
        missing_artifact_ref = passing_record()
        missing_artifact_ref["platforms"]["windows"]["checks"]["installer_signature"][
            "evidence"
        ] = "signtool verified .msi and .exe installer signatures"
        write_json(missing_artifact_ref_path, missing_artifact_ref)
        assert_failure_contains(
            run_signing(str(missing_artifact_ref_path)),
            "windows.installer_signature.evidence must mention concrete artifacts for version 0.1.0",
        )

        partial_windows_artifacts_path = root / "release-signing-partial-windows-artifacts.json"
        partial_windows_artifacts = passing_record()
        partial_windows_artifacts["platforms"]["windows"]["checks"]["authenticode_signature"][
            "evidence"
        ] = "signtool verify /pa returned Verified for SnapText_0.1.0_x64.msi only"
        write_json(partial_windows_artifacts_path, partial_windows_artifacts)
        assert_failure_contains(
            run_signing(str(partial_windows_artifacts_path)),
            "windows.authenticode_signature.evidence must mention concrete artifacts for version 0.1.0",
        )

        partial_linux_artifacts_path = root / "release-signing-partial-linux-artifacts.json"
        partial_linux_artifacts = passing_record()
        partial_linux_artifacts["platforms"]["linux"]["checks"]["sha256_checksums"][
            "evidence"
        ] = "SHA256SUMS sha256 verified for SnapText_0.1.0_amd64.AppImage only"
        write_json(partial_linux_artifacts_path, partial_linux_artifacts)
        assert_failure_contains(
            run_signing(str(partial_linux_artifacts_path)),
            "linux.sha256_checksums.evidence must mention concrete artifacts for version 0.1.0",
        )

        blocked_path = root / "release-signing-blocked.json"
        blocked = passing_record()
        blocked["platforms"]["macos"]["checks"]["notarization_accepted"]["result"] = "blocked"
        write_json(blocked_path, blocked)
        assert_failure_contains(
            run_signing(str(blocked_path)),
            "macos.notarization_accepted is not passing: blocked",
        )

        missing_path = root / "release-signing-missing.json"
        missing = passing_record()
        del missing["platforms"]["windows"]["checks"]["timestamp"]
        write_json(missing_path, missing)
        assert_failure_contains(
            run_signing(str(missing_path)),
            "windows.checks is missing timestamp",
        )

        unknown_platform_path = root / "release-signing-unknown-platform.json"
        unknown_platform = passing_record()
        unknown_platform["platforms"]["android"] = {"checks": {}}
        write_json(unknown_platform_path, unknown_platform)
        assert_failure_contains(
            run_signing(str(unknown_platform_path)),
            "release signing record contains unknown platforms: android",
        )

        unknown_check_path = root / "release-signing-unknown-check.json"
        unknown_check = passing_record()
        unknown_check["platforms"]["windows"]["checks"]["unsigned_zip"] = {
            "result": "pass",
            "evidence": "self-test evidence",
        }
        write_json(unknown_check_path, unknown_check)
        assert_failure_contains(
            run_signing(str(unknown_check_path)),
            "windows.checks contains unknown checks: unsigned_zip",
        )

    print("Release signing verifier self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
