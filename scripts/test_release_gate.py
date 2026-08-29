#!/usr/bin/env python3
"""Self-test final release gate command composition."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIRTY_SENTINEL = ROOT / ".snaptext-release-gate-dirty-self-test"
STUB_ENV = {**os.environ, "SNAPTEXT_RELEASE_GATE_TEST_STUB": "1"}


def run_gate(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", "scripts/release_gate.py", "--dry-run", *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def run_gate_real(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", "scripts/release_gate.py", *args],
        cwd=ROOT,
        env=STUB_ENV,
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


def assert_contains(output: str, expected: str) -> None:
    if expected not in output:
        raise SystemExit(f"Expected dry-run output to contain {expected!r}:\n{output}")


def assert_not_contains(output: str, unexpected: str) -> None:
    if unexpected in output:
        raise SystemExit(f"Did not expect dry-run output to contain {unexpected!r}:\n{output}")


def current_git_head() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=True,
    )
    return result.stdout.strip()


def run_with_temporary_dirty_worktree(*args: str) -> subprocess.CompletedProcess[str]:
    """Create an untracked sentinel so clean-worktree validation is deterministic."""
    DIRTY_SENTINEL.write_text("temporary release gate self-test sentinel\n", encoding="utf-8")
    try:
        return run_gate_real(*args)
    finally:
        DIRTY_SENTINEL.unlink(missing_ok=True)


def main() -> int:
    head = current_git_head()
    default = run_gate()
    assert_success(default)
    output = default.stdout
    assert_contains(output, "static_preflight (static): python3 scripts/release_preflight.py")
    assert_contains(
        output,
        "real_ocr_models (external): python3 scripts/verify_ocr_models.py --require-sha256 models",
    )
    assert_contains(
        output,
        "translator_providers (external): python3 scripts/verify_translator_providers.py",
    )
    assert_contains(
        output,
        "desktop_bundles (external): python3 scripts/verify_desktop_bundles.py --platform all",
    )
    assert_contains(
        output,
        "release_manifest (external): python3 scripts/generate_release_manifest.py "
        "--manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all "
        "--require-artifact-kinds all "
        f"--expected-version 0.1.0 --expected-commit {head}",
    )
    assert_contains(
        output,
        "desktop_qa (external): python3 scripts/verify_desktop_qa.py .release/desktop-qa-record.json "
        f"--expected-version 0.1.0 --expected-commit {head}",
    )
    assert_contains(
        output,
        "release_signing (external): python3 scripts/verify_release_signing.py "
        f".release/release-signing-record.json --expected-version 0.1.0 --expected-commit {head}",
    )

    skip_static = run_gate("--skip-static")
    assert_success(skip_static)
    assert_not_contains(skip_static.stdout, "static_preflight")
    assert_contains(skip_static.stdout, "real_ocr_models")

    customized = run_gate(
        "--model-dir",
        "tmp-models",
        "--bundle-platform",
        "linux",
        "--qa-record",
        "tmp/qa.json",
        "--release-manifest",
        "tmp/release-manifest.json",
        "--release-checksums",
        "tmp/SHA256SUMS",
        "--release-version",
        "1.2.3",
        "--release-commit",
        "0123456789abcdef0123456789abcdef01234567",
        "--signing-record",
        "tmp/signing.json",
    )
    assert_success(customized)
    custom_output = customized.stdout
    assert_contains(custom_output, "python3 scripts/verify_ocr_models.py --require-sha256 tmp-models")
    assert_contains(custom_output, "python3 scripts/verify_desktop_bundles.py --platform linux")
    assert_contains(
        custom_output,
        "python3 scripts/generate_release_manifest.py --manifest tmp/release-manifest.json "
        "--checksums tmp/SHA256SUMS --require-platforms all --require-artifact-kinds all "
        "--expected-version 1.2.3 "
        "--expected-commit 0123456789abcdef0123456789abcdef01234567",
    )
    assert_contains(
        custom_output,
        "python3 scripts/verify_desktop_qa.py tmp/qa.json --expected-version 1.2.3 "
        "--expected-commit 0123456789abcdef0123456789abcdef01234567",
    )
    assert_contains(
        custom_output,
        "python3 scripts/verify_release_signing.py tmp/signing.json --expected-version 1.2.3 "
        "--expected-commit 0123456789abcdef0123456789abcdef01234567",
    )

    missing_commit = run_gate_real("--skip-static", "--allow-missing-external")
    assert_failure_contains(missing_commit, "the following arguments are required: --release-commit")

    dirty_worktree = run_with_temporary_dirty_worktree(
        "--release-commit",
        head,
        "--skip-static",
        "--allow-missing-external",
    )
    assert_failure_contains(
        dirty_worktree,
        "release gate requires a clean git worktree",
    )

    formal_single_platform = run_gate_real(
        "--release-commit",
        head,
        "--bundle-platform",
        "linux",
        "--skip-static",
        "--allow-dirty-worktree",
    )
    assert_failure_contains(
        formal_single_platform,
        "release gate --bundle-platform must be all for a formal release",
    )

    summary_single_platform = run_gate_real(
        "--release-commit",
        head,
        "--bundle-platform",
        "linux",
        "--skip-static",
        "--allow-missing-external",
        "--allow-dirty-worktree",
    )
    assert_success(summary_single_platform)
    assert_contains(
        summary_single_platform.stdout,
        "desktop_bundles (external): python3 scripts/verify_desktop_bundles.py --platform linux",
    )
    assert_contains(
        summary_single_platform.stdout,
        "External gate details:",
    )
    assert_contains(
        summary_single_platform.stdout,
        "native desktop bundle artifacts are still missing:",
    )
    assert_contains(
        summary_single_platform.stdout,
        "stubbed desktop_bundles gate failure",
    )

    bad_version = run_gate_real(
        "--release-version",
        "release-one",
        "--release-commit",
        head,
        "--skip-static",
        "--allow-missing-external",
        "--allow-dirty-worktree",
    )
    assert_failure_contains(
        bad_version,
        "release gate --release-version must use semantic version format",
    )

    bad_commit = run_gate_real(
        "--release-commit",
        "not-a-sha",
        "--skip-static",
        "--allow-missing-external",
        "--allow-dirty-worktree",
    )
    assert_failure_contains(
        bad_commit,
        "release gate --release-commit must be a 7-40 character git SHA",
    )

    wrong_head = "0" * 40 if head != "0" * 40 else "1" * 40
    mismatched_head = run_gate_real(
        "--release-commit",
        wrong_head,
        "--skip-static",
        "--allow-missing-external",
        "--allow-dirty-worktree",
    )
    assert_failure_contains(
        mismatched_head,
        "release gate --release-commit must match current git HEAD",
    )

    mismatched_app_version = run_gate_real(
        "--release-version",
        "9.9.9",
        "--release-commit",
        head,
        "--skip-static",
        "--allow-missing-external",
        "--allow-dirty-worktree",
    )
    assert_failure_contains(
        mismatched_app_version,
        "release gate --release-version must match tauri.conf.json version 0.1.0",
    )

    print("Release gate self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
