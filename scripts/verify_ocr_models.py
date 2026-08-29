#!/usr/bin/env python3
"""Verify real OCR model assets and run the ignored OCR smoke test.

This is the release gate for the external PP-OCRv6 model files. The repository
does not commit those large assets, so this script deliberately fails when any
required file is absent instead of silently downgrading to a static check.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_DIR = ROOT / "models"
REQUIRED_MODEL_FILES = ("det.onnx", "cls.onnx", "rec.onnx", "rec_dict.txt")
CHECKSUM_FILE = "SHA256SUMS"
MANIFEST_FILE = "manifest.json"
# Keep reserved example domains from being mistaken for release assets.
PLACEHOLDER_TOKENS = (
    "example.com",
    "example.invalid",
    "replace-with",
    "placeholder",
    "/path/to/",
)


def run(cmd: list[str], env: dict[str, str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True, env=env)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify PP-OCRv6 model assets and run the OCR smoke test."
    )
    parser.add_argument(
        "model_dir",
        nargs="?",
        default=str(DEFAULT_MODEL_DIR),
        help="Directory containing det.onnx, cls.onnx, rec.onnx and rec_dict.txt.",
    )
    parser.add_argument(
        "--require-sha256",
        action="store_true",
        help=f"Fail unless {CHECKSUM_FILE} exists and matches all required model files.",
    )
    parser.add_argument(
        "--write-sha256-manifest",
        action="store_true",
        help=f"Write {CHECKSUM_FILE} for the current model files before verification.",
    )
    parser.add_argument(
        "--skip-smoke-test",
        action="store_true",
        help="Only validate files and checksums. Intended for verifier self-tests, not release gates.",
    )
    parser.add_argument(
        "--allow-macos-vision-fallback",
        action="store_true",
        help="On macOS, accept missing Paddle assets because the app can use the system Vision OCR fallback.",
    )
    args = parser.parse_args(argv[1:])
    args.model_dir = Path(args.model_dir).expanduser().resolve()
    return args


def validate_files(model_dir: Path) -> None:
    missing = [name for name in REQUIRED_MODEL_FILES if not (model_dir / name).is_file()]
    if missing:
        raise SystemExit(
            "Missing OCR model files in "
            f"{model_dir}: {', '.join(missing)}. "
            "Place the real PP-OCRv6 ONNX assets there before running this gate."
        )

    dict_path = model_dir / "rec_dict.txt"
    entries = [
        line
        for line in dict_path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    if not entries:
        raise SystemExit(f"Recognition dictionary is empty: {dict_path}")

    print(
        "OCR model assets found: "
        f"{', '.join(REQUIRED_MODEL_FILES)}; recognition entries: {len(entries)}"
    )


def has_required_model_files(model_dir: Path) -> bool:
    return all((model_dir / name).is_file() for name in REQUIRED_MODEL_FILES)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_checksum_manifest(model_dir: Path) -> None:
    checksum_path = model_dir / CHECKSUM_FILE
    lines = [
        f"{sha256_file(model_dir / name)}  {name}\n" for name in REQUIRED_MODEL_FILES
    ]
    checksum_path.write_text("".join(lines), encoding="utf-8")
    print(f"Wrote checksum manifest: {checksum_path}")


def read_checksum_manifest(path: Path) -> dict[str, str]:
    checksums: dict[str, str] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split(maxsplit=1)
        if len(parts) != 2:
            raise SystemExit(f"Malformed checksum line {line_number} in {path}")
        expected_hash, filename = parts[0].lower(), parts[1].strip()
        if len(expected_hash) != 64 or any(ch not in "0123456789abcdef" for ch in expected_hash):
            raise SystemExit(f"Invalid SHA-256 digest on line {line_number} in {path}")
        # Keep the manifest intentionally flat so packaged resource paths are deterministic.
        if Path(filename).name != filename or filename not in REQUIRED_MODEL_FILES:
            raise SystemExit(f"Unexpected checksum target on line {line_number} in {path}: {filename}")
        if filename in checksums:
            raise SystemExit(f"Duplicate checksum target in {path}: {filename}")
        checksums[filename] = expected_hash
    return checksums


def read_model_manifest(path: Path) -> dict[str, dict[str, str]]:
    if not path.is_file():
        raise SystemExit(
            f"Missing {path}. Generate it from the model download manifest that was used to install the assets."
        )
    with path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("schema_version") != 1:
        raise SystemExit(f"Unexpected schema_version in {path}")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise SystemExit(f"{path} must contain a files object")
    unknown_files = sorted(set(files) - set(REQUIRED_MODEL_FILES))
    if unknown_files:
        raise SystemExit(f"{path} contains unknown model files: {', '.join(unknown_files)}")
    return files


def is_placeholder_value(value: str) -> bool:
    lowered = value.lower()
    return lowered == "0" * 64 or any(token in lowered for token in PLACEHOLDER_TOKENS)


def verify_checksum_manifest(model_dir: Path, require_manifest: bool) -> dict[str, str]:
    checksum_path = model_dir / CHECKSUM_FILE
    if not checksum_path.is_file():
        if require_manifest:
            raise SystemExit(
                f"Missing {checksum_path}. Generate it with "
                "python3 scripts/verify_ocr_models.py --write-sha256-manifest [model_dir]"
            )
        print(f"No {CHECKSUM_FILE} found; skipping checksum verification.")
        return {}

    checksums = read_checksum_manifest(checksum_path)
    missing = [name for name in REQUIRED_MODEL_FILES if name not in checksums]
    if missing:
        raise SystemExit(
            f"{checksum_path} is missing required checksum entries: {', '.join(missing)}"
        )

    for name in REQUIRED_MODEL_FILES:
        actual_hash = sha256_file(model_dir / name)
        expected_hash = checksums[name]
        if actual_hash != expected_hash:
            raise SystemExit(
                f"SHA-256 mismatch for {model_dir / name}: "
                f"expected {expected_hash}, got {actual_hash}"
            )
    print(f"Checksum manifest verified: {checksum_path}")
    return checksums


def verify_model_manifest(model_dir: Path, expected_checksums: dict[str, str]) -> None:
    manifest_path = model_dir / MANIFEST_FILE
    files = read_model_manifest(manifest_path)
    for name in REQUIRED_MODEL_FILES:
        entry = files.get(name)
        if not isinstance(entry, dict):
            raise SystemExit(f"{manifest_path} is missing files.{name}")
        url = entry.get("url")
        digest = entry.get("sha256")
        if not isinstance(url, str) or not url.startswith(("https://", "file://")):
            raise SystemExit(f"{manifest_path} has an invalid files.{name}.url")
        if is_placeholder_value(url):
            raise SystemExit(f"{manifest_path} files.{name}.url still contains a placeholder value")
        if not isinstance(digest, str) or len(digest) != 64 or any(
            ch not in "0123456789abcdefABCDEF" for ch in digest
        ):
            raise SystemExit(f"{manifest_path} has an invalid files.{name}.sha256")
        if is_placeholder_value(digest):
            raise SystemExit(f"{manifest_path} files.{name}.sha256 still contains a placeholder value")
        if expected_checksums and digest.lower() != expected_checksums[name]:
            raise SystemExit(
                f"{manifest_path} files.{name}.sha256 does not match {CHECKSUM_FILE}: "
                f"expected {expected_checksums[name]}, got {digest.lower()}"
            )
    print(f"Model manifest verified: {manifest_path}")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    model_dir = args.model_dir
    if (
        args.allow_macos_vision_fallback
        and sys.platform == "darwin"
        and not has_required_model_files(model_dir)
    ):
        print(
            "Paddle OCR model files are missing, but macOS Vision OCR fallback is enabled "
            "for this build."
        )
        return 0

    validate_files(model_dir)
    if args.write_sha256_manifest:
        write_checksum_manifest(model_dir)
    checksums = verify_checksum_manifest(model_dir, require_manifest=args.require_sha256)
    if args.require_sha256:
        verify_model_manifest(model_dir, checksums)
    if args.skip_smoke_test:
        print("Skipping OCR smoke test by request.")
        print("OCR model file and checksum verification passed.")
        return 0

    env = os.environ.copy()
    env["SNAPTEXT_OCR_MODEL_DIR"] = str(model_dir)
    run(
        [
            "cargo",
            "test",
            "-p",
            "snaptext-core",
            "--test",
            "ocr_smoke",
            "--",
            "--ignored",
            "--nocapture",
        ],
        env,
    )
    print("OCR model verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
