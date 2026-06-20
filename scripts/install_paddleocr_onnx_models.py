#!/usr/bin/env python3
"""Download official PaddleOCR inference models and install SnapText ONNX assets.

This script is the practical bridge between PaddleOCR's official model archives
and SnapText's bundled Rust OCR runtime. It downloads Paddle inference archives,
converts each model with PaddleX/Paddle2ONNX, copies the resulting ONNX files
into `models/`, extracts the recognition dictionary, and writes release
manifests used by the existing package gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_DIR = ROOT / "models"
REQUIRED_MODEL_FILES = ("det.onnx", "cls.onnx", "rec.onnx", "rec_dict.txt")
CHECKSUM_FILE = "SHA256SUMS"
MANIFEST_FILE = "manifest.json"
OFFICIAL_BASE = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0"
MODEL_TIERS = {
    "tiny": {
        "det": f"{OFFICIAL_BASE}/PP-OCRv6_tiny_det_infer.tar",
        "rec": f"{OFFICIAL_BASE}/PP-OCRv6_tiny_rec_infer.tar",
        "cls": f"{OFFICIAL_BASE}/PP-LCNet_x0_25_textline_ori_infer.tar",
    },
    "small": {
        "det": f"{OFFICIAL_BASE}/PP-OCRv6_small_det_infer.tar",
        "rec": f"{OFFICIAL_BASE}/PP-OCRv6_small_rec_infer.tar",
        "cls": f"{OFFICIAL_BASE}/PP-LCNet_x0_25_textline_ori_infer.tar",
    },
    "medium": {
        "det": f"{OFFICIAL_BASE}/PP-OCRv6_medium_det_infer.tar",
        "rec": f"{OFFICIAL_BASE}/PP-OCRv6_medium_rec_infer.tar",
        "cls": f"{OFFICIAL_BASE}/PP-LCNet_x0_25_textline_ori_infer.tar",
    },
}
ARCHIVE_NAMES = {
    "det": "det.tar",
    "rec": "rec.tar",
    "cls": "cls.tar",
}
OUTPUT_MODEL_NAMES = {
    "det": "det.onnx",
    "rec": "rec.onnx",
    "cls": "cls.onnx",
}
DICT_NAME_HINTS = ("dict", "keys", "char", "label")
TEXT_FILE_EXCLUSIONS = ("readme", "license", "notice")


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def run(cmd: list[str], cwd: Path = ROOT, dry_run: bool = False) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    if dry_run:
        return
    try:
        result = subprocess.run(cmd, cwd=cwd)
    except FileNotFoundError as err:
        raise SystemExit(
            f"Required command not found: {cmd[0]}. "
            "Create the PaddleOCR conversion environment first, for example: "
            "python3.12 -m venv .venv-paddle && source .venv-paddle/bin/activate && "
            "python -m pip install paddlepaddle paddleocr paddlex && paddlex --install paddle2onnx"
        ) from err
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_uri(path: Path) -> str:
    return path.resolve().as_uri()


def is_url_or_file_uri(value: str) -> bool:
    parsed = urllib.parse.urlparse(value)
    return parsed.scheme in {"http", "https", "file"}


def describe_source(value: str) -> str:
    if is_url_or_file_uri(value):
        return value
    return file_uri(Path(value).expanduser())


def copy_or_download_file(source: str, destination: Path, dry_run: bool) -> None:
    """Accept both network URLs and local archive paths for offline packaging."""
    if not is_url_or_file_uri(source):
        path = Path(source).expanduser().resolve()
        check(path.is_file(), f"Local model archive does not exist: {path}")
        print(f"Copying {path} -> {destination}", flush=True)
        if dry_run:
            return
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        return

    print(f"Downloading {source} -> {destination}", flush=True)
    if dry_run:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(source) as response, destination.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    except urllib.error.URLError as err:
        raise SystemExit(
            f"Failed to fetch {source}: {err.reason}. "
            "If this machine cannot access the network, download the archive manually "
            "and pass its local path to --det-url/--rec-url/--cls-url."
        ) from err


def safe_extract_tar(archive: Path, destination: Path, dry_run: bool) -> None:
    print(f"Extracting {archive} -> {destination}", flush=True)
    if dry_run:
        return
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as tar:
        root = destination.resolve()
        for member in tar.getmembers():
            member_path = (destination / member.name).resolve()
            if not str(member_path).startswith(str(root) + os.sep) and member_path != root:
                raise SystemExit(f"Unsafe path in archive {archive}: {member.name}")
        tar.extractall(destination)


def find_paddle_model_dir(root: Path) -> Path:
    candidates: list[Path] = []
    for pdmodel in root.rglob("*.pdmodel"):
        model_dir = pdmodel.parent
        if any(model_dir.glob("*.pdiparams")) or any(model_dir.glob("*.pdparams")):
            candidates.append(model_dir)
    # PaddleOCR 3.x official inference archives may ship inference.json
    # together with inference.pdiparams instead of the older .pdmodel file.
    for json_model in root.rglob("*.json"):
        model_dir = json_model.parent
        if any(model_dir.glob("*.pdiparams")) or any(model_dir.glob("*.pdparams")):
            candidates.append(model_dir)
    if not candidates:
        raise SystemExit(
            f"Could not find a Paddle inference model under {root}. "
            "Expected files such as inference.pdmodel or inference.json with inference.pdiparams."
        )
    candidates = sorted(set(candidates), key=lambda path: (len(path.parts), str(path)))
    return candidates[0]


def find_onnx_file(output_dir: Path, model_kind: str) -> Path:
    candidates = sorted(output_dir.rglob("*.onnx"), key=lambda path: (-path.stat().st_size, str(path)))
    if not candidates:
        raise SystemExit(f"Paddle2ONNX did not produce a .onnx file for {model_kind} in {output_dir}")
    if len(candidates) > 1:
        print(
            f"Multiple ONNX files found for {model_kind}; using largest: {candidates[0]}",
            flush=True,
        )
    return candidates[0]


def convert_model(
    paddlex: str,
    paddle_model_dir: Path,
    onnx_output_dir: Path,
    opset_version: str,
    dry_run: bool,
) -> None:
    onnx_output_dir.mkdir(parents=True, exist_ok=True)
    run(
        [
            paddlex,
            "--paddle2onnx",
            "--paddle_model_dir",
            str(paddle_model_dir),
            "--onnx_model_dir",
            str(onnx_output_dir),
            "--opset_version",
            opset_version,
        ],
        dry_run=dry_run,
    )


def looks_like_dictionary_file(path: Path) -> bool:
    name = path.name.lower()
    if any(token in name for token in TEXT_FILE_EXCLUSIONS):
        return False
    return path.suffix.lower() in {".txt", ".dict", ".list"} and any(
        hint in name for hint in DICT_NAME_HINTS
    )


def find_recognition_dict(rec_extract_dir: Path) -> Path | None:
    candidates = [path for path in rec_extract_dir.rglob("*") if path.is_file() and looks_like_dictionary_file(path)]
    scored: list[tuple[int, int, str, Path]] = []
    for path in candidates:
        try:
            lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        except UnicodeDecodeError:
            continue
        if not lines:
            continue
        score = 0
        lower = path.name.lower()
        if lower in {"rec_dict.txt", "ppocr_keys_v1.txt"}:
            score += 100
        if "dict" in lower:
            score += 20
        if "keys" in lower:
            score += 10
        scored.append((score, len(lines), str(path), path))
    if not scored:
        return None
    scored.sort(reverse=True)
    return scored[0][3]


def parse_yaml_scalar(value: str) -> str:
    quoted = value.strip(" ")
    if len(quoted) >= 2 and quoted[0] == "'" and quoted[-1] == "'":
        return quoted[1:-1].replace("''", "'")
    if len(quoted) >= 2 and quoted[0] == '"' and quoted[-1] == '"':
        return json.loads(quoted)
    return value


def extract_character_dict_from_inference_yml(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    for index, line in enumerate(lines):
        if line.strip() != "character_dict:":
            continue
        base_indent = len(line) - len(line.lstrip(" "))
        characters: list[str] = []
        for item in lines[index + 1 :]:
            stripped = item.lstrip(" ")
            if not stripped.strip():
                continue
            indent = len(item) - len(item.lstrip(" "))
            if stripped.startswith("- "):
                characters.append(parse_yaml_scalar(stripped[2:]))
                continue
            if indent <= base_indent:
                break
        if characters:
            return characters
    return []


def write_recognition_dict_from_metadata(rec_extract_dir: Path, destination: Path, dry_run: bool) -> str | None:
    for inference_yml in sorted(rec_extract_dir.rglob("inference.yml")):
        characters = extract_character_dict_from_inference_yml(inference_yml)
        if not characters:
            continue
        if " " not in characters:
            # PaddleX CTCLabelDecode defaults use_space_char=True, appending
            # ASCII space after the embedded character_dict for PP-OCRv6.
            characters.append(" ")
        print(
            f"Using recognition dictionary embedded in metadata: {inference_yml}",
            flush=True,
        )
        if not dry_run:
            # Do not trim entries here: PaddleOCR dictionaries can contain
            # whitespace characters such as the ideographic space U+3000.
            destination.write_text("\n".join(characters) + "\n", encoding="utf-8")
        return file_uri(inference_yml)
    return None


def install_recognition_dict(
    rec_extract_dir: Path,
    destination: Path,
    rec_dict: str | None,
    dry_run: bool,
) -> str:
    if rec_dict:
        if is_url_or_file_uri(rec_dict):
            copy_or_download_file(rec_dict, destination, dry_run=dry_run)
            return rec_dict
        source = Path(rec_dict).expanduser().resolve()
        check(source.is_file(), f"Recognition dictionary does not exist: {source}")
        print(f"Copying recognition dictionary {source} -> {destination}", flush=True)
        if not dry_run:
            shutil.copy2(source, destination)
        return file_uri(source)

    source = find_recognition_dict(rec_extract_dir)
    if source is not None:
        print(f"Using recognition dictionary from archive: {source}", flush=True)
        if not dry_run:
            shutil.copy2(source, destination)
        return file_uri(source)

    metadata_source = write_recognition_dict_from_metadata(rec_extract_dir, destination, dry_run)
    if metadata_source is None:
        raise SystemExit(
            "Could not find a recognition dictionary in the recognition model archive. "
            "Pass --rec-dict /path/to/dict.txt or --rec-dict https://... explicitly."
        )
    return metadata_source


def write_checksum_manifest(model_dir: Path) -> None:
    lines = [f"{sha256_file(model_dir / name)}  {name}\n" for name in REQUIRED_MODEL_FILES]
    (model_dir / CHECKSUM_FILE).write_text("".join(lines), encoding="utf-8")
    print(f"Wrote checksum manifest: {model_dir / CHECKSUM_FILE}")


def write_model_manifest(
    model_dir: Path,
    tier: str,
    source_urls: dict[str, str],
    file_sources: dict[str, str],
) -> None:
    manifest = {
        "schema_version": 1,
        "name": f"PP-OCRv6 {tier} ONNX assets for SnapText",
        "source_note": "Generated from official PaddleOCR inference archives with PaddleX/Paddle2ONNX.",
        "tier": tier,
        "source_urls": source_urls,
        "files": {
            name: {
                "url": file_sources[name],
                "sha256": sha256_file(model_dir / name),
            }
            for name in REQUIRED_MODEL_FILES
        },
    }
    (model_dir / MANIFEST_FILE).write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote installed model manifest: {model_dir / MANIFEST_FILE}")


def verify_models(model_dir: Path, skip_smoke_test: bool) -> None:
    command = ["python3", "scripts/verify_ocr_models.py", str(model_dir), "--require-sha256"]
    if skip_smoke_test:
        command.append("--skip-smoke-test")
    run(command)


def ensure_can_overwrite(model_dir: Path, force: bool) -> None:
    existing = [name for name in REQUIRED_MODEL_FILES if (model_dir / name).exists()]
    if existing and not force:
        raise SystemExit(
            "Refusing to overwrite existing OCR model files without --force: "
            + ", ".join(existing)
        )


def build_urls(args: argparse.Namespace) -> dict[str, str]:
    urls = dict(MODEL_TIERS[args.tier])
    if args.det_url:
        urls["det"] = args.det_url
    if args.rec_url:
        urls["rec"] = args.rec_url
    if args.cls_url:
        urls["cls"] = args.cls_url
    return urls


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download PaddleOCR models, convert them to ONNX, and install SnapText OCR assets."
    )
    parser.add_argument("--tier", choices=sorted(MODEL_TIERS), default="tiny", help="Official PP-OCRv6 model tier.")
    parser.add_argument("--model-dir", default=str(DEFAULT_MODEL_DIR), help="Destination model directory.")
    parser.add_argument("--work-dir", help="Working directory for downloads, extraction, and ONNX output.")
    parser.add_argument("--paddlex", default="paddlex", help="PaddleX executable used for Paddle2ONNX conversion.")
    parser.add_argument("--opset-version", default="7", help="ONNX opset version passed to Paddle2ONNX.")
    parser.add_argument("--det-url", help="Override the detection model archive URL or local .tar path.")
    parser.add_argument("--rec-url", help="Override the recognition model archive URL or local .tar path.")
    parser.add_argument("--cls-url", help="Override the orientation classifier model archive URL or local .tar path.")
    parser.add_argument("--rec-dict", help="Recognition dictionary file path or URL if the archive does not include one.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files in the destination model directory.")
    parser.add_argument("--skip-verify", action="store_true", help="Install assets without running verify_ocr_models.py.")
    parser.add_argument("--skip-smoke-test", action="store_true", help="Run file/checksum validation but skip the OCR smoke test.")
    parser.add_argument("--dry-run", action="store_true", help="Print the download and conversion plan without writing files.")
    parser.add_argument("--keep-work-dir", action="store_true", help="Keep the temporary working directory after success.")
    return parser.parse_args(argv)


def install(args: argparse.Namespace, work_dir: Path) -> None:
    if not args.dry_run and sys.version_info >= (3, 13):
        raise SystemExit(
            "PaddleOCR/PaddlePaddle conversion dependencies are not expected to work on "
            f"Python {sys.version_info.major}.{sys.version_info.minor}. "
            "Recreate the venv with Python 3.12 or 3.11, for example: "
            "rm -rf .venv-paddle && /usr/local/bin/python3.12 -m venv .venv-paddle"
        )
    model_dir = Path(args.model_dir).expanduser().resolve()
    urls = build_urls(args)
    print(f"Installing PP-OCRv6 {args.tier} ONNX models into {model_dir}", flush=True)
    for kind in ("det", "rec", "cls"):
        print(f"{kind}: {describe_source(urls[kind])}", flush=True)

    if args.dry_run:
        for kind in ("det", "rec", "cls"):
            archive = work_dir / "downloads" / ARCHIVE_NAMES[kind]
            copy_or_download_file(urls[kind], archive, dry_run=True)
            print(f"Would extract {archive} and convert it with {args.paddlex}", flush=True)
        return

    ensure_can_overwrite(model_dir, force=args.force)
    model_dir.mkdir(parents=True, exist_ok=True)
    downloads_dir = work_dir / "downloads"
    extracted_dir = work_dir / "extracted"
    onnx_dir = work_dir / "onnx"
    staging_dir = work_dir / "staging"
    staging_dir.mkdir(parents=True, exist_ok=True)

    source_files: dict[str, str] = {}
    for kind in ("det", "rec", "cls"):
        archive = downloads_dir / ARCHIVE_NAMES[kind]
        extract_to = extracted_dir / kind
        onnx_output = onnx_dir / kind
        copy_or_download_file(urls[kind], archive, dry_run=False)
        safe_extract_tar(archive, extract_to, dry_run=False)
        paddle_model_dir = find_paddle_model_dir(extract_to)
        convert_model(args.paddlex, paddle_model_dir, onnx_output, args.opset_version, dry_run=False)
        generated = find_onnx_file(onnx_output, kind)
        output_name = OUTPUT_MODEL_NAMES[kind]
        shutil.copy2(generated, staging_dir / output_name)
        source_files[output_name] = file_uri(generated)
        print(f"Prepared {output_name}: {generated}", flush=True)

    source_files["rec_dict.txt"] = install_recognition_dict(
        extracted_dir / "rec",
        staging_dir / "rec_dict.txt",
        args.rec_dict,
        dry_run=False,
    )

    for name in REQUIRED_MODEL_FILES:
        shutil.copy2(staging_dir / name, model_dir / name)
        print(f"Installed {model_dir / name}", flush=True)

    write_checksum_manifest(model_dir)
    write_model_manifest(model_dir, args.tier, urls, source_files)
    if not args.skip_verify:
        verify_models(model_dir, skip_smoke_test=args.skip_smoke_test)
    print("PaddleOCR ONNX model installation completed.")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.work_dir:
        work_dir = Path(args.work_dir).expanduser().resolve()
        work_dir.mkdir(parents=True, exist_ok=True)
        install(args, work_dir)
        if not args.keep_work_dir and args.dry_run:
            return 0
    else:
        with tempfile.TemporaryDirectory(prefix="snaptext-paddleocr-") as temp:
            work_dir = Path(temp)
            install(args, work_dir)
            if args.keep_work_dir:
                kept = ROOT / ".snaptext-paddleocr-work"
                if kept.exists():
                    shutil.rmtree(kept)
                shutil.copytree(work_dir, kept)
                print(f"Kept working directory at {kept}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
