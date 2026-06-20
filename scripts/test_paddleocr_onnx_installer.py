#!/usr/bin/env python3
"""Self-test PaddleOCR-to-ONNX installer helpers without network access."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from install_paddleocr_onnx_models import (
    MODEL_TIERS,
    REQUIRED_MODEL_FILES,
    describe_source,
    find_paddle_model_dir,
    find_recognition_dict,
    sha256_file,
    write_checksum_manifest,
    write_model_manifest,
)


ROOT = Path(__file__).resolve().parents[1]


def run_dry_run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "python3",
            "scripts/install_paddleocr_onnx_models.py",
            "--dry-run",
            *args,
        ],
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


def write_fake_installed_models(model_dir: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    model_dir.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED_MODEL_FILES:
        payload = f"fake paddleocr onnx installer payload for {name}\n"
        if name == "rec_dict.txt":
            payload = "a\nb\nc\n"
        path = model_dir / name
        path.write_text(payload, encoding="utf-8")
        hashes[name] = sha256_file(path)
    return hashes


def main() -> int:
    dry_run = run_dry_run("--tier", "tiny")
    assert_success(dry_run)
    assert_contains(dry_run.stdout, MODEL_TIERS["tiny"]["det"])
    assert_contains(dry_run.stdout, "Would extract")
    assert_contains(dry_run.stdout, "paddlex")

    custom = run_dry_run(
        "--tier",
        "small",
        "--det-url",
        "https://mirror.invalid/custom-det.tar",
        "--rec-url",
        "https://mirror.invalid/custom-rec.tar",
        "--cls-url",
        "https://mirror.invalid/custom-cls.tar",
    )
    assert_success(custom)
    assert_contains(custom.stdout, "https://mirror.invalid/custom-det.tar")
    assert_contains(custom.stdout, "https://mirror.invalid/custom-rec.tar")
    assert_contains(custom.stdout, "https://mirror.invalid/custom-cls.tar")

    with tempfile.TemporaryDirectory(prefix="snaptext-paddleonnx-test-") as temp:
        root = Path(temp)
        paddle_model = root / "archive" / "nested"
        paddle_model.mkdir(parents=True)
        (paddle_model / "inference.pdmodel").write_text("model\n", encoding="utf-8")
        (paddle_model / "inference.pdiparams").write_text("params\n", encoding="utf-8")
        assert find_paddle_model_dir(root) == paddle_model

        rec_archive = root / "rec"
        rec_archive.mkdir()
        dict_path = rec_archive / "ppocr_keys_v1.txt"
        dict_path.write_text("你\n好\nA\n", encoding="utf-8")
        (rec_archive / "README.txt").write_text("not a dictionary\n", encoding="utf-8")
        assert find_recognition_dict(rec_archive) == dict_path
        assert describe_source(str(dict_path)).startswith("file://")

        model_dir = root / "models"
        hashes = write_fake_installed_models(model_dir)
        write_checksum_manifest(model_dir)
        checksum = (model_dir / "SHA256SUMS").read_text(encoding="utf-8")
        for name, digest in hashes.items():
            assert_contains(checksum, f"{digest}  {name}")

        source_urls = dict(MODEL_TIERS["tiny"])
        file_sources = {name: (model_dir / name).resolve().as_uri() for name in REQUIRED_MODEL_FILES}
        write_model_manifest(model_dir, "tiny", source_urls, file_sources)
        manifest = json.loads((model_dir / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["tier"] == "tiny"
        for name, digest in hashes.items():
            assert manifest["files"][name]["sha256"] == digest
            assert manifest["files"][name]["url"].startswith("file://")

    print("PaddleOCR ONNX installer self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
