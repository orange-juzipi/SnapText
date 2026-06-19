#!/usr/bin/env python3
"""Self-test React frontend asset build command wiring."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_build_frontend(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", "scripts/build_frontend.py", *args],
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


def main() -> int:
    dry_run = run_build_frontend("--dry-run")
    assert_success(dry_run)
    output = dry_run.stdout
    assert_contains(output, "bun install --frozen-lockfile")
    assert_contains(output, "bun run build")
    assert_contains(output, "ui/dist")
    assert_contains(output, "index.html")
    print("Frontend build command self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
