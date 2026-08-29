#!/usr/bin/env python3
"""Install SnapText OCR model assets from a checked manifest.

The repository does not hard-code model URLs because release builds must pin the
exact PP-OCRv6 assets and checksums selected for distribution. Provide a JSON
manifest with URLs and SHA-256 digests, then this script downloads, verifies,
writes `models/SHA256SUMS`, and runs the real OCR model gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "models" / "manifest.json"
DEFAULT_MODEL_DIR = ROOT / "models"
REQUIRED_MODEL_FILES = ("det.onnx", "cls.onnx", "rec.onnx", "rec_dict.txt")
CHECKSUM_FILE = "SHA256SUMS"
# Keep reserved example domains from being mistaken for release assets.
PLACEHOLDER_TOKENS = (
    "example.com",
    "example.invalid",
    "replace-with",
    "placeholder",
    "/path/to/",
)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_placeholder_value(value: str) -> bool:
    lowered = value.lower()
    return lowered == "0" * 64 or any(token in lowered for token in PLACEHOLDER_TOKENS)


def read_manifest(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(
            f"Missing OCR model manifest: {path}. "
            "Copy models/manifest.example.json to models/manifest.json and fill in real URLs."
        )
    with path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    check(manifest.get("schema_version") == 1, "model manifest schema_version must be 1")
    files = manifest.get("files")
    check(isinstance(files, dict), "model manifest must contain a files object")
    unknown_files = sorted(set(files) - set(REQUIRED_MODEL_FILES))
    check(
        not unknown_files,
        "model manifest contains unknown files: " + ", ".join(unknown_files),
    )
    for name in REQUIRED_MODEL_FILES:
        entry = files.get(name)
        check(isinstance(entry, dict), f"model manifest is missing files.{name}")
        url = entry.get("url")
        digest = entry.get("sha256")
        check(isinstance(url, str) and url.startswith(("https://", "file://")), f"files.{name}.url must be https:// or file://")
        check(not is_placeholder_value(url), f"files.{name}.url still contains a placeholder value")
        check(
            isinstance(digest, str)
            and len(digest) == 64
            and all(ch in "0123456789abcdefABCDEF" for ch in digest),
            f"files.{name}.sha256 must be a SHA-256 hex digest",
        )
        check(not is_placeholder_value(digest), f"files.{name}.sha256 still contains a placeholder value")
    return manifest


def download_file(url: str, destination: Path) -> None:
    print(f"Downloading {url} -> {destination.name}", flush=True)
    with urllib.request.urlopen(url) as response, destination.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def write_checksum_manifest(model_dir: Path, manifest: dict) -> None:
    checksum_path = model_dir / CHECKSUM_FILE
    lines = [
        f"{manifest['files'][name]['sha256'].lower()}  {name}\n"
        for name in REQUIRED_MODEL_FILES
    ]
    checksum_path.write_text("".join(lines), encoding="utf-8")
    print(f"Wrote checksum manifest: {checksum_path}")


def write_installed_manifest(model_dir: Path, manifest: dict) -> None:
    manifest_path = model_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote installed model manifest: {manifest_path}")


def install_models(manifest: dict, model_dir: Path, force: bool) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    existing = [name for name in REQUIRED_MODEL_FILES if (model_dir / name).exists()]
    if existing and not force:
        raise SystemExit(
            "Refusing to overwrite existing OCR model files without --force: "
            + ", ".join(existing)
        )

    with tempfile.TemporaryDirectory(prefix="snaptext-models-") as temp:
        temp_dir = Path(temp)
        verified_files: list[tuple[str, Path]] = []
        for name in REQUIRED_MODEL_FILES:
            entry = manifest["files"][name]
            downloaded = temp_dir / name
            download_file(entry["url"], downloaded)
            actual_hash = sha256_file(downloaded)
            expected_hash = entry["sha256"].lower()
            if actual_hash != expected_hash:
                raise SystemExit(
                    f"SHA-256 mismatch for {name}: expected {expected_hash}, got {actual_hash}"
                )
            verified_files.append((name, downloaded))

        for name, downloaded in verified_files:
            shutil.move(str(downloaded), model_dir / name)
            print(f"Installed {model_dir / name}")

    write_checksum_manifest(model_dir, manifest)
    write_installed_manifest(model_dir, manifest)


def verify_models(model_dir: Path) -> None:
    subprocess.run(
        [
            "python3",
            "scripts/verify_ocr_models.py",
            "--require-sha256",
            str(model_dir),
        ],
        cwd=ROOT,
        check=True,
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install SnapText OCR model assets.")
    parser.add_argument(
        "--manifest",
        default=str(DEFAULT_MANIFEST),
        help="JSON manifest containing model URLs and SHA-256 digests.",
    )
    parser.add_argument(
        "--model-dir",
        default=str(DEFAULT_MODEL_DIR),
        help="Directory where det.onnx, cls.onnx, rec.onnx and rec_dict.txt will be installed.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing model files in the destination directory.",
    )
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="Install files and SHA256SUMS without running verify_ocr_models.py.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    manifest_path = Path(args.manifest).expanduser().resolve()
    model_dir = Path(args.model_dir).expanduser().resolve()
    manifest = read_manifest(manifest_path)
    install_models(manifest, model_dir, force=args.force)
    if not args.skip_verify:
        verify_models(model_dir)
    print("OCR model installation completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
