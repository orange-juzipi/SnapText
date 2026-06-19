#!/usr/bin/env python3
"""Self-test release manifest generation and verification."""

from __future__ import annotations

import json
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_manifest(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", "scripts/generate_release_manifest.py", *args],
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


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="snaptext-release-manifest-") as temp:
        root = Path(temp)
        artifact_root = root / "bundle"
        output_dir = root / "dist"
        (artifact_root / "dmg").mkdir(parents=True)
        (artifact_root / "msi").mkdir(parents=True)
        (artifact_root / "nsis").mkdir(parents=True)
        (artifact_root / "deb").mkdir(parents=True)
        (artifact_root / "rpm").mkdir(parents=True)
        (artifact_root / "appimage").mkdir(parents=True)
        (artifact_root / "dmg" / "SnapText_0.1.0_aarch64.dmg").write_bytes(b"fake dmg")
        (artifact_root / "msi" / "SnapText_0.1.0_x64.msi").write_bytes(b"fake msi")
        (artifact_root / "nsis" / "SnapText_0.1.0_x64.exe").write_bytes(b"fake nsis")
        (artifact_root / "deb" / "SnapText_0.1.0_amd64.deb").write_bytes(b"fake deb")
        (artifact_root / "rpm" / "SnapText-0.1.0-1.x86_64.rpm").write_bytes(b"fake rpm")
        (artifact_root / "appimage" / "SnapText_0.1.0_amd64.AppImage").write_bytes(
            b"fake appimage"
        )
        artifact_root_file = root / "artifact-root-file"
        artifact_root_file.write_text("not a directory", encoding="utf-8")

        manifest = output_dir / "release-manifest.json"
        checksums = output_dir / "SHA256SUMS"
        artifact_root_file_result = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root_file),
            "--manifest",
            str(output_dir / "artifact-root-file-manifest.json"),
            "--checksums",
            str(output_dir / "artifact-root-file-SHA256SUMS"),
            "--version",
            "0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_failure_contains(
            artifact_root_file_result,
            "Release artifact root must be a directory",
        )

        manifest_inside_artifacts = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(artifact_root / "release-manifest.json"),
            "--checksums",
            str(output_dir / "manifest-inside-SHA256SUMS"),
            "--version",
            "0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_failure_contains(
            manifest_inside_artifacts,
            "release manifest output must not be written inside artifact_root",
        )

        checksums_inside_artifacts = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(output_dir / "checksums-inside-manifest.json"),
            "--checksums",
            str(artifact_root / "SHA256SUMS"),
            "--version",
            "0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_failure_contains(
            checksums_inside_artifacts,
            "release checksums output must not be written inside artifact_root",
        )

        missing_commit = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(output_dir / "missing-commit-manifest.json"),
            "--checksums",
            str(output_dir / "missing-commit-SHA256SUMS"),
        )
        assert_failure_contains(
            missing_commit,
            "release manifest commit still contains a placeholder value",
        )

        invalid_write_version = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(output_dir / "invalid-version-manifest.json"),
            "--checksums",
            str(output_dir / "invalid-version-SHA256SUMS"),
            "--version",
            "release-one",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_failure_contains(
            invalid_write_version,
            "release manifest version must use semantic version format",
        )

        stale_artifact = artifact_root / "msi" / "SnapText_0.0.9_x64.msi"
        stale_artifact.write_bytes(b"stale msi")
        stale_artifact_result = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(output_dir / "stale-artifact-manifest.json"),
            "--checksums",
            str(output_dir / "stale-artifact-SHA256SUMS"),
            "--version",
            "0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_failure_contains(
            stale_artifact_result,
            "release artifact filename must match SnapText 0.1.0",
        )
        stale_artifact.unlink()

        wrong_extension = artifact_root / "dmg" / "SnapText_0.1.0_aarch64.zip"
        wrong_extension.write_bytes(b"wrong extension")
        wrong_extension_result = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(output_dir / "wrong-extension-manifest.json"),
            "--checksums",
            str(output_dir / "wrong-extension-SHA256SUMS"),
            "--version",
            "0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_failure_contains(
            wrong_extension_result,
            "Unexpected SnapText files in release artifact directories",
        )
        wrong_extension.unlink()

        empty_artifact = artifact_root / "appimage" / "SnapText_0.1.0_empty.AppImage"
        empty_artifact.write_bytes(b"")
        empty_artifact_result = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(output_dir / "empty-artifact-manifest.json"),
            "--checksums",
            str(output_dir / "empty-artifact-SHA256SUMS"),
            "--version",
            "0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_failure_contains(
            empty_artifact_result,
            "Release artifact files must not be empty",
        )
        empty_artifact.unlink()

        generated = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
            "--version",
            "0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_success(generated)
        if not manifest.is_file() or not checksums.is_file():
            raise SystemExit("release manifest self-test did not write outputs")

        verified = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
            "--require-platforms",
            "all",
            "--require-artifact-kinds",
            "all",
        )
        assert_success(verified)
        assert_success(
            run_manifest(
                "--manifest",
                str(manifest),
                "--checksums",
                str(checksums),
                "--require-platforms",
                "all",
                "--require-artifact-kinds",
                "all",
                "--expected-version",
                "0.1.0",
                "--expected-commit",
                "0123456789abcdef0123456789abcdef01234567",
            )
        )

        wrong_expected_version = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
            "--expected-version",
            "9.9.9",
        )
        assert_failure_contains(
            wrong_expected_version,
            "release manifest version must match expected version 9.9.9",
        )

        wrong_expected_commit = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
            "--expected-commit",
            "89abcdef",
        )
        assert_failure_contains(
            wrong_expected_commit,
            "release manifest commit must match expected commit 89abcdef",
        )

        missing_checksums = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(output_dir / "missing-SHA256SUMS"),
        )
        assert_failure_contains(missing_checksums, "Missing release checksums")

        manifest_payload = manifest.read_text(encoding="utf-8")
        manifest.write_text(
            manifest_payload.replace(
                '"commit": "0123456789abcdef0123456789abcdef01234567"',
                '"commit": "unknown"',
            ),
            encoding="utf-8",
        )
        unknown_commit = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(
            unknown_commit,
            "release manifest commit still contains a placeholder value",
        )
        manifest.write_text(manifest_payload, encoding="utf-8")

        manifest.write_text(
            manifest_payload.replace('"version": "0.1.0"', '"version": "release-one"'),
            encoding="utf-8",
        )
        invalid_version = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(
            invalid_version,
            "release manifest version must use semantic version format",
        )
        manifest.write_text(manifest_payload, encoding="utf-8")

        manifest_in_artifacts_path = artifact_root / "nested-release-manifest.json"
        manifest_in_artifacts_path.write_text(manifest_payload, encoding="utf-8")
        manifest_in_artifacts = run_manifest(
            "--manifest",
            str(manifest_in_artifacts_path),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(
            manifest_in_artifacts,
            "release manifest file must not be inside artifact_root",
        )

        checksums_in_artifacts_path = artifact_root / "nested-SHA256SUMS"
        checksums_in_artifacts_path.write_text(
            checksums.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        checksums_in_artifacts = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums_in_artifacts_path),
        )
        assert_failure_contains(
            checksums_in_artifacts,
            "release checksums file must not be inside artifact_root",
        )

        first_hash = manifest_payload.split('"sha256": "', 1)[1].split('"', 1)[0]
        manifest.write_text(
            manifest_payload.replace(first_hash, "z" * 64, 1),
            encoding="utf-8",
        )
        invalid_artifact_hash = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(
            invalid_artifact_hash,
            "release artifact has invalid sha256",
        )
        manifest.write_text(manifest_payload, encoding="utf-8")

        future_timestamp_payload = json.loads(manifest_payload)
        future_timestamp_payload["generated_at"] = (
            datetime.now(timezone.utc) + timedelta(days=1)
        ).isoformat()
        manifest.write_text(
            json.dumps(future_timestamp_payload, indent=2) + "\n",
            encoding="utf-8",
        )
        future_timestamp = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(
            future_timestamp,
            "release manifest generated_at cannot be in the future",
        )
        manifest.write_text(manifest_payload, encoding="utf-8")

        naive_timestamp_payload = json.loads(manifest_payload)
        naive_timestamp_payload["generated_at"] = "2026-06-18T12:00:00"
        manifest.write_text(
            json.dumps(naive_timestamp_payload, indent=2) + "\n",
            encoding="utf-8",
        )
        naive_timestamp = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(
            naive_timestamp,
            "release manifest generated_at must include timezone information",
        )
        manifest.write_text(manifest_payload, encoding="utf-8")

        platform_mismatch_payload = json.loads(manifest_payload)
        platform_mismatch_payload["artifacts"][0]["platform"] = "linux"
        manifest.write_text(
            json.dumps(platform_mismatch_payload, indent=2) + "\n",
            encoding="utf-8",
        )
        platform_mismatch = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(
            platform_mismatch,
            "release artifact platform does not match path",
        )
        manifest.write_text(manifest_payload, encoding="utf-8")

        filename_mismatch_payload = json.loads(manifest_payload)
        original_path = filename_mismatch_payload["artifacts"][0]["path"]
        stale_path = original_path.replace("0.1.0", "0.0.9", 1)
        filename_mismatch_payload["artifacts"][0]["path"] = stale_path
        (artifact_root / stale_path).parent.mkdir(parents=True, exist_ok=True)
        (artifact_root / original_path).replace(artifact_root / stale_path)
        manifest.write_text(
            json.dumps(filename_mismatch_payload, indent=2) + "\n",
            encoding="utf-8",
        )
        original_checksums = checksums.read_text(encoding="utf-8")
        checksums.write_text(
            original_checksums.replace(original_path, stale_path),
            encoding="utf-8",
        )
        filename_mismatch = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(
            filename_mismatch,
            "release artifact filename must match SnapText 0.1.0",
        )
        (artifact_root / stale_path).replace(artifact_root / original_path)
        manifest.write_text(manifest_payload, encoding="utf-8")
        checksums.write_text(original_checksums, encoding="utf-8")

        original_checksums = checksums.read_text(encoding="utf-8")
        checksums.write_text(
            original_checksums.replace("SnapText_0.1.0_x64.msi", "SnapText_extra.msi"),
            encoding="utf-8",
        )
        mismatched_checksums = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
        )
        assert_failure_contains(mismatched_checksums, "SHA256SUMS does not match release manifest")
        checksums.write_text(original_checksums, encoding="utf-8")

        (artifact_root / "msi" / "SnapText_0.1.0_x64.msi").write_bytes(b"tampered")
        tampered = run_manifest("--manifest", str(manifest), "--checksums", str(checksums))
        assert_failure_contains(tampered, "SHA-256 mismatch")

    with tempfile.TemporaryDirectory(prefix="snaptext-release-manifest-missing-") as temp:
        root = Path(temp)
        artifact_root = root / "bundle"
        output_dir = root / "dist"
        (artifact_root / "dmg").mkdir(parents=True)
        (artifact_root / "dmg" / "SnapText_0.1.0_aarch64.dmg").write_bytes(b"fake dmg")

        manifest = output_dir / "release-manifest.json"
        checksums = output_dir / "SHA256SUMS"
        generated = run_manifest(
            "--write",
            "--artifact-root",
            str(artifact_root),
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
            "--commit",
            "89abcdef",
        )
        assert_success(generated)
        missing_platforms = run_manifest(
            "--manifest",
            str(manifest),
            "--checksums",
            str(checksums),
            "--require-platforms",
            "all",
            "--require-artifact-kinds",
            "all",
        )
        assert_failure_contains(
            missing_platforms,
            "release manifest is missing required platform artifacts: linux, windows",
        )

        missing_kind_artifact_root = root / "bundle-missing-kind"
        (missing_kind_artifact_root / "dmg").mkdir(parents=True)
        (missing_kind_artifact_root / "msi").mkdir(parents=True)
        (missing_kind_artifact_root / "nsis").mkdir(parents=True)
        (missing_kind_artifact_root / "deb").mkdir(parents=True)
        (missing_kind_artifact_root / "rpm").mkdir(parents=True)
        (missing_kind_artifact_root / "appimage").mkdir(parents=True)
        (missing_kind_artifact_root / "dmg" / "SnapText_0.1.0_aarch64.dmg").write_bytes(b"dmg")
        (missing_kind_artifact_root / "msi" / "SnapText_0.1.0_x64.msi").write_bytes(b"msi")
        (missing_kind_artifact_root / "nsis" / "SnapText_0.1.0_x64.exe").write_bytes(b"nsis")
        (missing_kind_artifact_root / "deb" / "SnapText_0.1.0_amd64.deb").write_bytes(b"deb")
        (missing_kind_artifact_root / "rpm" / "SnapText-0.1.0-1.x86_64.rpm").write_bytes(b"rpm")
        manifest_missing_kind = run_manifest(
            "--write",
            "--artifact-root",
            str(missing_kind_artifact_root),
            "--manifest",
            str(output_dir / "missing-kind-manifest.json"),
            "--checksums",
            str(output_dir / "missing-kind-SHA256SUMS"),
            "--version",
            "0.1.0",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
        )
        assert_success(manifest_missing_kind)
        missing_kind = run_manifest(
            "--manifest",
            str(output_dir / "missing-kind-manifest.json"),
            "--checksums",
            str(output_dir / "missing-kind-SHA256SUMS"),
            "--require-platforms",
            "all",
            "--require-artifact-kinds",
            "all",
        )
        assert_failure_contains(
            missing_kind,
            "release manifest is missing required artifact kinds: appimage",
        )

    print("Release manifest self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
