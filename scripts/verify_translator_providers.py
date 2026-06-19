#!/usr/bin/env python3
"""Run HTTP mock integration tests for all SnapText translator providers.

The default release preflight keeps these tests out of `cargo test --workspace`
because some sandboxes forbid opening a local loopback listener. Release
validation on a normal developer machine should run this script so OpenAI
compatible, DeepL, Google, and local HTTP providers are verified end to end
against deterministic mock HTTP responses.
"""

from __future__ import annotations

import argparse
import socket
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TRANSLATOR_TEST_COMMAND = [
    "cargo",
    "test",
    "-p",
    "snaptext-core",
    "translate::tests::",
    "--",
    "--ignored",
    "--nocapture",
]


def check_loopback_listener_available() -> None:
    """Fail early with a useful message when the environment blocks TCP bind."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
    except OSError as err:
        raise SystemExit(
            "Loopback listener is not available in this environment, so "
            "translator provider mock HTTP tests cannot run here. Run this "
            f"script on a normal desktop/dev machine. Original error: {err}"
        ) from err


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run SnapText translator provider mock HTTP integration tests."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the cargo test command without checking loopback or executing tests.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.dry_run:
        print(" ".join(TRANSLATOR_TEST_COMMAND))
        return 0

    check_loopback_listener_available()
    subprocess.run(TRANSLATOR_TEST_COMMAND, cwd=ROOT, check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
