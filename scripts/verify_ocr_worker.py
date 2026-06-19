#!/usr/bin/env python3
"""Verify the PaddleOCR worker environment for a desktop machine."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "python" / "ocr_worker.py"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", default=os.environ.get("SNAPTEXT_PYTHON", sys.executable))
    args = parser.parse_args()

    proc = subprocess.run(
        [args.python, str(WORKER), "--check"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        print(proc.stderr.strip() or proc.stdout.strip(), file=sys.stderr)
        return proc.returncode

    payload = json.loads(proc.stdout)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if payload.get("worker_ready"):
        return 0

    print(
        "PaddleOCR worker is not ready. Install the official dependency in the Python runtime, "
        "for example: pip install paddleocr paddlepaddle",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
