#!/usr/bin/env python3
"""Run the release gates required before Tauri bundles frontend assets."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def env_flag(name: str) -> bool:
    """Treat common CI-style truthy values as enabled feature flags."""
    return os.environ.get(name, "").lower() in {"1", "true", "yes"}


def main() -> int:
    # macOS packaged OCR can use the system Vision framework when Paddle ONNX
    # assets are absent. Other platforms still require bundled model files.
    if sys.platform == "darwin":
        run(["python3", "scripts/verify_ocr_models.py", "models", "--allow-macos-vision-fallback"])
    else:
        model_check = ["python3", "scripts/verify_ocr_models.py", "models", "--require-sha256"]
        if env_flag("SNAPTEXT_SKIP_OCR_SMOKE_TEST"):
            # Tauri invokes this script during CI packaging. Keep that path to
            # asset integrity checks and leave OCR quality smoke tests explicit.
            model_check.append("--skip-smoke-test")
        run(model_check)
    run(["python3", "scripts/build_frontend.py"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
