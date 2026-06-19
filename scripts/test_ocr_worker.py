#!/usr/bin/env python3
"""Self-tests for the SnapText OCR worker protocol."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "python" / "ocr_worker.py"


def run_worker(*args: str, fake: dict | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if fake is not None:
        env["SNAPTEXT_OCR_FAKE_OUTPUT"] = json.dumps(fake)
    return subprocess.run(
        [sys.executable, str(WORKER), *args],
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def test_check_fake_mode() -> None:
    proc = run_worker("--check", fake={"text": "hello"})
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["python_available"] is True
    assert payload["paddleocr_available"] is True
    assert payload["worker_ready"] is True


def test_predict_fake_mode() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        image = Path(tmp) / "sample.png"
        image.write_bytes(b"not a real image in fake mode")
        proc = run_worker(
            "--image",
            str(image),
            fake={"source_text": "hello\nworld", "lines": [{"text": "hello", "confidence": 0.9}]},
        )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["source_text"] == "hello\nworld"
    assert payload["text_lines"][0]["text"] == "hello"


def test_missing_image_fails() -> None:
    proc = run_worker("--image", "/definitely/missing.png", fake={"text": "ignored"})
    assert proc.returncode != 0
    assert "does not exist" in proc.stderr


def main() -> int:
    test_check_fake_mode()
    test_predict_fake_mode()
    test_missing_image_fails()
    print("OCR worker self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
