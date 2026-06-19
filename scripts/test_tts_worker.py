#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "python" / "tts_worker.py"


def run_worker(*args: str, fake: dict | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if fake is not None:
        env["SNAPTEXT_TTS_FAKE_OUTPUT"] = json.dumps(fake)
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
    proc = run_worker("--check", "--model", "test-model", fake={})
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["python_available"] is True
    assert payload["coqui_available"] is True
    assert payload["worker_ready"] is True


def test_synthesize_requires_text() -> None:
    proc = run_worker("--model", "test-model", "--out", "tmp.wav", fake={})
    assert proc.returncode != 0
    assert "--text is required" in proc.stderr


def test_synthesize_fake_mode_writes_audio() -> None:
    with tempfile.TemporaryDirectory() as tempdir:
        out_path = Path(tempdir) / "speech.wav"
        proc = run_worker(
            "--text",
            "hello",
            "--lang",
            "en",
            "--model",
            "test-model",
            "--out",
            str(out_path),
            fake={},
        )
        assert proc.returncode == 0, proc.stderr
        payload = json.loads(proc.stdout)
        assert payload["audio_path"] == str(out_path)
        assert payload["provider"] == "coqui"
        assert out_path.is_file()
        assert out_path.stat().st_size > 0


def main() -> int:
    test_check_fake_mode()
    test_synthesize_requires_text()
    test_synthesize_fake_mode_writes_audio()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
