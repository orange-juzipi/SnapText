#!/usr/bin/env python3
"""Self-test OCR model asset verification without real ONNX models."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from verify_ocr_models import REQUIRED_MODEL_FILES, sha256_file


ROOT = Path(__file__).resolve().parents[1]


def run_verify(model_dir: Path, *extra_args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "python3",
            "scripts/verify_ocr_models.py",
            str(model_dir),
            "--skip-smoke-test",
            *extra_args,
        ],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def assert_success(result: subprocess.CompletedProcess[str]) -> None:
    if result.returncode != 0:
        raise SystemExit(result.stdout)


def assert_failure_contains(result: subprocess.CompletedProcess[str], expected: str) -> None:
    if result.returncode == 0 or expected not in result.stdout:
        raise SystemExit(
            f"Expected failure containing {expected!r}, got rc={result.returncode}:\n{result.stdout}"
        )


def write_fake_models(model_dir: Path) -> dict[str, str]:
    model_dir.mkdir(parents=True, exist_ok=True)
    hashes: dict[str, str] = {}
    for name in REQUIRED_MODEL_FILES:
        payload = f"fake verifier payload for {name}\n"
        if name == "rec_dict.txt":
            payload = "a\nb\nc\n"
        path = model_dir / name
        path.write_text(payload, encoding="utf-8")
        hashes[name] = sha256_file(path)
    return hashes


def write_checksum_manifest(model_dir: Path, hashes: dict[str, str]) -> None:
    lines = [f"{hashes[name]}  {name}\n" for name in REQUIRED_MODEL_FILES]
    (model_dir / "SHA256SUMS").write_text("".join(lines), encoding="utf-8")


def write_model_manifest(model_dir: Path, hashes: dict[str, str]) -> None:
    manifest = {
        "schema_version": 1,
        "files": {
            name: {
                "url": f"https://download.snaptext.invalid/ppocrv6/{name}",
                "sha256": hashes[name],
            }
            for name in REQUIRED_MODEL_FILES
        },
    }
    (model_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="snaptext-ocr-models-") as temp:
        root = Path(temp)
        missing_dir = root / "missing"
        missing_dir.mkdir()
        missing = run_verify(missing_dir)
        assert_failure_contains(missing, "Missing OCR model files")

        empty_dict_dir = root / "empty-dict"
        write_fake_models(empty_dict_dir)
        (empty_dict_dir / "rec_dict.txt").write_text("", encoding="utf-8")
        empty_dict = run_verify(empty_dict_dir)
        assert_failure_contains(empty_dict, "Recognition dictionary is empty")

        whitespace_dict_dir = root / "whitespace-dict"
        write_fake_models(whitespace_dict_dir)
        (whitespace_dict_dir / "rec_dict.txt").write_text("a\n\u3000\n", encoding="utf-8")
        whitespace_dict = run_verify(whitespace_dict_dir)
        assert_success(whitespace_dict)
        if "recognition entries: 2" not in whitespace_dict.stdout:
            raise SystemExit(
                "Expected verifier to preserve whitespace dictionary tokens:\n"
                + whitespace_dict.stdout
            )

        model_dir = root / "models"
        hashes = write_fake_models(model_dir)
        no_manifest = run_verify(model_dir, "--require-sha256")
        assert_failure_contains(no_manifest, "Missing")

        write_manifest_result = run_verify(model_dir, "--write-sha256-manifest", "--require-sha256")
        assert_failure_contains(write_manifest_result, "Missing")
        write_model_manifest(model_dir, hashes)
        write_manifest_result = run_verify(model_dir, "--write-sha256-manifest", "--require-sha256")
        assert_success(write_manifest_result)
        checksum_text = (model_dir / "SHA256SUMS").read_text(encoding="utf-8")
        for name, digest in hashes.items():
            expected_line = f"{digest}  {name}"
            if expected_line not in checksum_text:
                raise SystemExit(f"SHA256SUMS is missing {expected_line}")

        (model_dir / "det.onnx").write_text("tampered\n", encoding="utf-8")
        mismatch = run_verify(model_dir, "--require-sha256")
        assert_failure_contains(mismatch, "SHA-256 mismatch for")

        bad_manifest_dir = root / "bad-manifest"
        bad_hashes = write_fake_models(bad_manifest_dir)
        write_checksum_manifest(bad_manifest_dir, bad_hashes)
        write_model_manifest(bad_manifest_dir, bad_hashes)
        checksum_path = bad_manifest_dir / "SHA256SUMS"
        checksum_path.write_text(
            checksum_path.read_text(encoding="utf-8") + f"{'0' * 64}  ../escape.onnx\n",
            encoding="utf-8",
        )
        bad_target = run_verify(bad_manifest_dir, "--require-sha256")
        assert_failure_contains(bad_target, "Unexpected checksum target")

        bad_model_manifest_dir = root / "bad-model-manifest"
        bad_model_hashes = write_fake_models(bad_model_manifest_dir)
        write_checksum_manifest(bad_model_manifest_dir, bad_model_hashes)
        write_model_manifest(bad_model_manifest_dir, bad_model_hashes)
        model_manifest_path = bad_model_manifest_dir / "manifest.json"
        payload = json.loads(model_manifest_path.read_text(encoding="utf-8"))
        del payload["files"]["rec.onnx"]
        model_manifest_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        bad_model_manifest = run_verify(bad_model_manifest_dir, "--require-sha256")
        assert_failure_contains(bad_model_manifest, "is missing files.rec.onnx")

        placeholder_model_manifest_dir = root / "placeholder-model-manifest"
        placeholder_hashes = write_fake_models(placeholder_model_manifest_dir)
        write_checksum_manifest(placeholder_model_manifest_dir, placeholder_hashes)
        write_model_manifest(placeholder_model_manifest_dir, placeholder_hashes)
        placeholder_manifest_path = placeholder_model_manifest_dir / "manifest.json"
        placeholder_payload = json.loads(placeholder_manifest_path.read_text(encoding="utf-8"))
        placeholder_payload["files"]["det.onnx"]["url"] = "https://example.com/det.onnx"
        placeholder_manifest_path.write_text(json.dumps(placeholder_payload, indent=2) + "\n", encoding="utf-8")
        placeholder_manifest = run_verify(placeholder_model_manifest_dir, "--require-sha256")
        assert_failure_contains(
            placeholder_manifest,
            "files.det.onnx.url still contains a placeholder value",
        )

        mismatched_model_manifest_dir = root / "mismatched-model-manifest"
        mismatched_hashes = write_fake_models(mismatched_model_manifest_dir)
        write_checksum_manifest(mismatched_model_manifest_dir, mismatched_hashes)
        write_model_manifest(mismatched_model_manifest_dir, mismatched_hashes)
        mismatched_manifest_path = mismatched_model_manifest_dir / "manifest.json"
        mismatched_payload = json.loads(mismatched_manifest_path.read_text(encoding="utf-8"))
        mismatched_payload["files"]["cls.onnx"]["sha256"] = "f" * 64
        mismatched_manifest_path.write_text(json.dumps(mismatched_payload, indent=2) + "\n", encoding="utf-8")
        mismatched_manifest = run_verify(mismatched_model_manifest_dir, "--require-sha256")
        assert_failure_contains(
            mismatched_manifest,
            "files.cls.onnx.sha256 does not match SHA256SUMS",
        )

    print("OCR model verifier self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
