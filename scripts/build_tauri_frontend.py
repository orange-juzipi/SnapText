#!/usr/bin/env python3
"""Run the release gates required before Tauri bundles frontend assets."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def main() -> int:
    # macOS packaged OCR can use the system Vision framework when Paddle ONNX
    # assets are absent. Other platforms still require bundled model files.
    if sys.platform == "darwin":
        run(["python3", "scripts/verify_ocr_models.py", "models", "--allow-macos-vision-fallback"])
    else:
        run(["python3", "scripts/verify_ocr_models.py", "models", "--require-sha256"])
    run(["python3", "scripts/build_frontend.py"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
