#!/usr/bin/env python3
"""Self-test translator provider verification command wiring."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_translators(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", "scripts/verify_translator_providers.py", *args],
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
        raise SystemExit(f"Expected output to contain {expected!r}:\n{output}")


def main() -> int:
    dry_run = run_translators("--dry-run")
    assert_success(dry_run)
    output = dry_run.stdout.strip()
    assert_contains(output, "cargo test -p snaptext-core translate::tests::")
    assert_contains(output, "--ignored")
    assert_contains(output, "--nocapture")

    print("Translator provider verifier self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
