#!/usr/bin/env python3
"""Self-test the manifest-driven OCR model installer without real ONNX files."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from install_ocr_models import REQUIRED_MODEL_FILES, sha256_file


ROOT = Path(__file__).resolve().parents[1]


def write_fixture_files(source_dir: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for name in REQUIRED_MODEL_FILES:
        payload = f"fake SnapText model payload for {name}\n".encode("utf-8")
        path = source_dir / name
        path.write_bytes(payload)
        hashes[name] = sha256_file(path)
    return hashes


def write_manifest(manifest_path: Path, source_dir: Path, hashes: dict[str, str]) -> None:
    manifest = {
        "schema_version": 1,
        "files": {
            name: {
                "url": (source_dir / name).resolve().as_uri(),
                "sha256": hashes[name],
            }
            for name in REQUIRED_MODEL_FILES
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def write_placeholder_url_manifest(manifest_path: Path, source_dir: Path, hashes: dict[str, str]) -> None:
    write_manifest(manifest_path, source_dir, hashes)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"]["det.onnx"]["url"] = "https://example.invalid/snaptext/det.onnx"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def write_placeholder_hash_manifest(manifest_path: Path, source_dir: Path, hashes: dict[str, str]) -> None:
    write_manifest(manifest_path, source_dir, hashes)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"]["cls.onnx"]["sha256"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def write_extra_file_manifest(manifest_path: Path, source_dir: Path, hashes: dict[str, str]) -> None:
    write_manifest(manifest_path, source_dir, hashes)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"]["extra.onnx"] = {
        "url": (source_dir / "det.onnx").resolve().as_uri(),
        "sha256": hashes["det.onnx"],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def write_mismatch_last_manifest(manifest_path: Path, source_dir: Path, hashes: dict[str, str]) -> None:
    write_manifest(manifest_path, source_dir, hashes)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["files"]["rec_dict.txt"]["sha256"] = "f" * 64
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def run_installer(manifest: Path, model_dir: Path, *extra_args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "python3",
            "scripts/install_ocr_models.py",
            "--manifest",
            str(manifest),
            "--model-dir",
            str(model_dir),
            "--skip-verify",
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


def verify_installed_files(model_dir: Path, hashes: dict[str, str]) -> None:
    checksum_path = model_dir / "SHA256SUMS"
    if not checksum_path.is_file():
        raise SystemExit("Installer did not write SHA256SUMS")
    installed_manifest_path = model_dir / "manifest.json"
    if not installed_manifest_path.is_file():
        raise SystemExit("Installer did not write manifest.json")
    installed_manifest = json.loads(installed_manifest_path.read_text(encoding="utf-8"))
    checksum_text = checksum_path.read_text(encoding="utf-8")
    for name in REQUIRED_MODEL_FILES:
        path = model_dir / name
        if not path.is_file():
            raise SystemExit(f"Installer did not write {name}")
        if sha256_file(path) != hashes[name]:
            raise SystemExit(f"Installed hash mismatch for {name}")
        expected_line = f"{hashes[name]}  {name}"
        if expected_line not in checksum_text:
            raise SystemExit(f"SHA256SUMS is missing {expected_line}")
        if installed_manifest["files"][name]["sha256"] != hashes[name]:
            raise SystemExit(f"manifest.json is missing installed hash for {name}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="snaptext-install-test-") as temp:
        root = Path(temp)
        source_dir = root / "source"
        model_dir = root / "models"
        source_dir.mkdir()
        hashes = write_fixture_files(source_dir)
        manifest = root / "manifest.json"
        write_manifest(manifest, source_dir, hashes)

        first = run_installer(manifest, model_dir)
        assert_success(first)
        verify_installed_files(model_dir, hashes)

        refused = run_installer(manifest, model_dir)
        assert_failure_contains(refused, "Refusing to overwrite existing OCR model files")

        bad_hashes = dict(hashes)
        bad_hashes["det.onnx"] = "1" * 64
        bad_manifest = root / "bad-manifest.json"
        bad_model_dir = root / "bad-models"
        write_manifest(bad_manifest, source_dir, bad_hashes)
        mismatch = run_installer(bad_manifest, bad_model_dir)
        assert_failure_contains(mismatch, "SHA-256 mismatch for det.onnx")

        placeholder_url_manifest = root / "placeholder-url-manifest.json"
        placeholder_url_model_dir = root / "placeholder-url-models"
        write_placeholder_url_manifest(placeholder_url_manifest, source_dir, hashes)
        placeholder_url = run_installer(placeholder_url_manifest, placeholder_url_model_dir)
        assert_failure_contains(
            placeholder_url,
            "files.det.onnx.url still contains a placeholder value",
        )

        placeholder_hash_manifest = root / "placeholder-hash-manifest.json"
        placeholder_hash_model_dir = root / "placeholder-hash-models"
        write_placeholder_hash_manifest(placeholder_hash_manifest, source_dir, hashes)
        placeholder_hash = run_installer(placeholder_hash_manifest, placeholder_hash_model_dir)
        assert_failure_contains(
            placeholder_hash,
            "files.cls.onnx.sha256 still contains a placeholder value",
        )

        extra_file_manifest = root / "extra-file-manifest.json"
        extra_file_model_dir = root / "extra-file-models"
        write_extra_file_manifest(extra_file_manifest, source_dir, hashes)
        extra_file = run_installer(extra_file_manifest, extra_file_model_dir)
        assert_failure_contains(
            extra_file,
            "model manifest contains unknown files: extra.onnx",
        )

        mismatch_last_manifest = root / "mismatch-last-manifest.json"
        mismatch_last_model_dir = root / "mismatch-last-models"
        write_mismatch_last_manifest(mismatch_last_manifest, source_dir, hashes)
        mismatch_last = run_installer(mismatch_last_manifest, mismatch_last_model_dir)
        assert_failure_contains(
            mismatch_last,
            "SHA-256 mismatch for rec_dict.txt",
        )
        for name in REQUIRED_MODEL_FILES:
            if (mismatch_last_model_dir / name).exists():
                raise SystemExit(
                    f"Installer wrote {name} even though the manifest failed validation"
                )

    print("OCR model installer self-test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
