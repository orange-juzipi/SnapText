#!/usr/bin/env python3
"""Run the final SnapText release gates.

`release_preflight.py` proves the repository-local static checks. This script
adds the gates that make a release claim defensible: real OCR models, translator
provider integration tests, desktop bundle artifacts, filled manual desktop QA
records, release artifact checksums, and release signing evidence.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TAURI_CONF = ROOT / "crates" / "snaptext-tauri" / "tauri.conf.json"
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
GIT_SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{7,40}$")


@dataclass(frozen=True)
class Gate:
    name: str
    command: list[str]
    external: bool
    description: str


def release_gates(args: argparse.Namespace) -> list[Gate]:
    gates = [
        Gate(
            name="static_preflight",
            command=["python3", "scripts/release_preflight.py"],
            external=False,
            description="Repository-local static checks, Rust tests, clippy, and build.",
        ),
        Gate(
            name="real_ocr_models",
            command=[
                "python3",
                "scripts/verify_ocr_models.py",
                "--require-sha256",
                args.model_dir,
            ],
            external=True,
            description="Real PP-OCRv6 assets, SHA-256 manifest, and OCR smoke test.",
        ),
        Gate(
            name="translator_providers",
            command=["python3", "scripts/verify_translator_providers.py"],
            external=True,
            description="Mock HTTP integration tests for all translator providers.",
        ),
        Gate(
            name="desktop_bundles",
            command=["python3", "scripts/verify_desktop_bundles.py", "--platform", args.bundle_platform],
            external=True,
            description="Native desktop bundle artifacts for the requested platform set.",
        ),
        Gate(
            name="release_manifest",
            command=[
                "python3",
                "scripts/generate_release_manifest.py",
                "--manifest",
                args.release_manifest,
                "--checksums",
                args.release_checksums,
                "--require-platforms",
                "all",
                "--require-artifact-kinds",
                "all",
                "--expected-version",
                args.release_version,
                "--expected-commit",
                args.release_commit,
            ],
            external=True,
            description="Release artifact manifest and SHA-256 checksums.",
        ),
        Gate(
            name="desktop_qa",
            command=[
                "python3",
                "scripts/verify_desktop_qa.py",
                args.qa_record,
                "--expected-version",
                args.release_version,
                "--expected-commit",
                args.release_commit,
            ],
            external=True,
            description="Filled macOS, Windows, and Linux manual QA record.",
        ),
        Gate(
            name="release_signing",
            command=[
                "python3",
                "scripts/verify_release_signing.py",
                args.signing_record,
                "--expected-version",
                args.release_version,
                "--expected-commit",
                args.release_commit,
            ],
            external=True,
            description="macOS notarization, Windows signing, and Linux checksum/signing evidence.",
        ),
    ]
    if args.skip_static:
        return [gate for gate in gates if gate.name != "static_preflight"]
    return gates


def run_gate(gate: Gate) -> tuple[bool, str]:
    print(f"\n==> {gate.name}: {gate.description}", flush=True)
    print(f"$ {' '.join(gate.command)}", flush=True)
    if os.environ.get("SNAPTEXT_RELEASE_GATE_TEST_STUB") == "1":
        # Keep the self-test deterministic without running heavyweight external
        # release checks such as bundle, signing, and real model validation.
        if gate.external:
            return False, f"stubbed {gate.name} gate failure"
        return True, "stubbed static gate pass"
    completed = subprocess.run(
        gate.command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    output = completed.stdout or ""
    if output:
        print(output, end="" if output.endswith("\n") else "\n")
    return completed.returncode == 0, output.strip().splitlines()[-1] if output.strip() else ""


def summarize_gate_tail(gate: Gate, tail: str) -> str:
    if tail:
        return tail
    return gate.description


def summarize_external_failure(gate: Gate, tail: str) -> str:
    if gate.name == "real_ocr_models":
        return (
            "real PP-OCRv6 model files, models/manifest.json, and models/SHA256SUMS "
            f"are still missing or invalid: {summarize_gate_tail(gate, tail)}"
        )
    if gate.name == "translator_providers":
        return (
            "translator provider mock HTTP tests must be run on a normal desktop/dev machine: "
            f"{summarize_gate_tail(gate, tail)}"
        )
    if gate.name == "desktop_bundles":
        return (
            "native desktop bundle artifacts are still missing: "
            f"{summarize_gate_tail(gate, tail)}"
        )
    if gate.name == "release_manifest":
        return (
            "release manifest and SHA-256 checksum outputs are still missing or invalid: "
            f"{summarize_gate_tail(gate, tail)}"
        )
    if gate.name == "desktop_qa":
        return (
            "filled desktop QA record is still missing or invalid: "
            f"{summarize_gate_tail(gate, tail)}"
        )
    if gate.name == "release_signing":
        return (
            "filled release signing record is still missing or invalid: "
            f"{summarize_gate_tail(gate, tail)}"
        )
    return summarize_gate_tail(gate, tail)


def current_git_head() -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if completed.returncode != 0:
        raise SystemExit("release gate could not resolve current git HEAD")
    return completed.stdout.strip()


def ensure_clean_worktree() -> None:
    completed = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if completed.returncode != 0:
        raise SystemExit("release gate could not inspect git worktree status")
    if completed.stdout.strip():
        raise SystemExit(
            "release gate requires a clean git worktree; commit or stash changes, "
            "or use --allow-dirty-worktree only for local progress summaries"
        )


def validate_release_identity(args: argparse.Namespace) -> None:
    if args.dry_run:
        return
    if not args.allow_missing_external and args.bundle_platform != "all":
        raise SystemExit(
            "release gate --bundle-platform must be all for a formal release; "
            "use --allow-missing-external only for local progress summaries"
        )
    if SEMVER_PATTERN.fullmatch(args.release_version) is None:
        raise SystemExit("release gate --release-version must use semantic version format")
    if GIT_SHA_PATTERN.fullmatch(args.release_commit) is None:
        raise SystemExit("release gate --release-commit must be a 7-40 character git SHA")
    head = current_git_head()
    if args.release_commit.lower() != head.lower():
        raise SystemExit(
            "release gate --release-commit must match current git HEAD "
            f"{head}"
        )
    if not args.allow_dirty_worktree:
        ensure_clean_worktree()
    with TAURI_CONF.open("r", encoding="utf-8") as handle:
        app_version = json.load(handle).get("version")
    if args.release_version != app_version:
        raise SystemExit(
            "release gate --release-version must match tauri.conf.json version "
            f"{app_version}"
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run SnapText final release gates.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the gates and commands that would run, then exit without executing them.",
    )
    parser.add_argument(
        "--allow-missing-external",
        action="store_true",
        help="Run all gates but exit 0 when only external release gates fail.",
    )
    parser.add_argument(
        "--allow-dirty-worktree",
        action="store_true",
        help="Allow a dirty git worktree. Intended only for local progress summaries.",
    )
    parser.add_argument(
        "--skip-static",
        action="store_true",
        help="Skip release_preflight.py when it has already been run in this session.",
    )
    parser.add_argument(
        "--model-dir",
        default="models",
        help="Model directory passed to verify_ocr_models.py.",
    )
    parser.add_argument(
        "--bundle-platform",
        choices=("current", "macos", "windows", "linux", "all"),
        default="all",
        help="Platform set passed to verify_desktop_bundles.py.",
    )
    parser.add_argument(
        "--qa-record",
        default=".release/desktop-qa-record.json",
        help="Filled manual desktop QA record.",
    )
    parser.add_argument(
        "--release-manifest",
        default="dist/release-manifest.json",
        help="Release artifact manifest generated from bundled installers.",
    )
    parser.add_argument(
        "--release-checksums",
        default="dist/SHA256SUMS",
        help="Release artifact SHA256SUMS generated from bundled installers.",
    )
    parser.add_argument(
        "--release-version",
        default="0.1.0",
        help="Expected release version shared by manifest, QA, and signing records.",
    )
    parser.add_argument(
        "--release-commit",
        default="unknown",
        required=not any(arg in argv for arg in ("--dry-run", "-h", "--help")),
        help="Expected release git SHA shared by manifest, QA, and signing records.",
    )
    parser.add_argument(
        "--signing-record",
        default=".release/release-signing-record.json",
        help="Filled release signing and notarization JSON record.",
    )
    return parser.parse_args(argv)


def fill_dry_run_release_commit(args: argparse.Namespace) -> None:
    if not args.dry_run or args.release_commit != "unknown":
        return
    # Dry-run output is often copied into release notes or runbooks. Prefer the
    # current checkout SHA so printed verifier commands mirror formal release use.
    try:
        args.release_commit = current_git_head()
    except SystemExit:
        args.release_commit = "unknown"


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    fill_dry_run_release_commit(args)
    validate_release_identity(args)
    gates = release_gates(args)
    if args.dry_run:
        for gate in gates:
            origin = "external" if gate.external else "static"
            print(f"{gate.name} ({origin}): {' '.join(gate.command)}")
        return 0

    failed: list[tuple[Gate, str]] = []
    for gate in gates:
        passed, tail = run_gate(gate)
        if passed:
            print(f"PASS {gate.name}")
        else:
            failed.append((gate, tail))
            suffix = f": {tail}" if tail else ""
            print(f"FAIL {gate.name}{suffix}")

    if not failed:
        print("\nAll release gates passed.")
        return 0

    print("\nRelease gates failed:")
    for gate, _tail in failed:
        origin = "external" if gate.external else "static"
        print(f"- {gate.name} ({origin}): {' '.join(gate.command)}")

    if args.allow_missing_external and all(gate.external for gate, _tail in failed):
        print(
            "\nOnly external gates failed. The release is not complete, but this "
            "summary mode exits successfully for local progress reporting."
        )
        print("\nExternal gate details:")
        for gate, tail in failed:
            print(f"- {gate.name}: {summarize_external_failure(gate, tail)}")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
