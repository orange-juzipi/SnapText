#!/usr/bin/env python3
"""Generate and verify SnapText release artifact manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "dist"
DEFAULT_MANIFEST = DEFAULT_OUTPUT_DIR / "release-manifest.json"
DEFAULT_CHECKSUMS = DEFAULT_OUTPUT_DIR / "SHA256SUMS"
DEFAULT_ARTIFACT_ROOT = ROOT / "target" / "release" / "bundle"
ARTIFACT_PATTERNS = (
    "dmg/*.dmg",
    "msi/*.msi",
    "nsis/*.exe",
    "deb/*.deb",
    "rpm/*.rpm",
    "appimage/*.AppImage",
)
ARTIFACT_DIRECTORIES = tuple(pattern.split("/", 1)[0] for pattern in ARTIFACT_PATTERNS)
PLATFORM_CHOICES = ("macos", "windows", "linux")
ARTIFACT_KIND_CHOICES = ("dmg", "msi", "nsis", "deb", "rpm", "appimage")
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
GIT_SHA_PATTERN = re.compile(r"^[0-9a-fA-F]{7,40}$")


def artifact_platform(path: Path) -> str | None:
    """Map a Tauri bundle artifact path to the desktop platform it proves."""
    suffix = path.suffix.lower()
    parent = path.parent.name.lower()
    if suffix == ".dmg" or parent == "dmg":
        return "macos"
    if suffix in {".msi", ".exe"} or parent in {"msi", "nsis"}:
        return "windows"
    if suffix in {".deb", ".rpm", ".appimage"} or parent in {"deb", "rpm", "appimage"}:
        return "linux"
    return None


def artifact_kind(path: Path) -> str | None:
    parent = path.parent.name.lower()
    return parent if parent in ARTIFACT_KIND_CHOICES else None


def validate_artifact_filename(rel_path: str, product: str, version: str) -> None:
    path = Path(rel_path)
    parent = path.parent.name.lower()
    name = path.name
    product_slug = re.escape(product)
    version_slug = re.escape(version)
    package_patterns = {
        "dmg": rf"^{product_slug}_{version_slug}_.+\.dmg$",
        "msi": rf"^{product_slug}_{version_slug}_.+\.msi$",
        "nsis": rf"^{product_slug}_{version_slug}_.+\.exe$",
        "deb": rf"^{product_slug}_{version_slug}_.+\.deb$",
        "rpm": rf"^{product_slug}-{version_slug}-.+\.rpm$",
        "appimage": rf"^{product_slug}_{version_slug}_.+\.AppImage$",
    }
    pattern = package_patterns.get(parent)
    if pattern is None or re.fullmatch(pattern, name) is None:
        raise SystemExit(
            f"release artifact filename must match {product} {version}: {rel_path}"
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_artifacts(artifact_root: Path) -> list[Path]:
    if not artifact_root.is_dir():
        raise SystemExit(f"Release artifact root must be a directory: {artifact_root}")
    artifacts: list[Path] = []
    for pattern in ARTIFACT_PATTERNS:
        artifacts.extend(sorted(artifact_root.glob(pattern)))
    artifacts = [path for path in artifacts if path.is_file()]
    empty_artifacts = [path for path in artifacts if path.stat().st_size == 0]
    if empty_artifacts:
        raise SystemExit(
            "Release artifact files must not be empty: "
            + ", ".join(path.relative_to(artifact_root).as_posix() for path in empty_artifacts)
        )
    reject_uncollected_snaptext_artifacts(artifact_root, artifacts)
    return artifacts


def reject_uncollected_snaptext_artifacts(artifact_root: Path, artifacts: list[Path]) -> None:
    """Reject SnapText-looking files that the manifest glob rules would ignore."""
    collected = {path.resolve() for path in artifacts}
    unexpected: list[Path] = []
    for directory in ARTIFACT_DIRECTORIES:
        artifact_dir = artifact_root / directory
        if not artifact_dir.is_dir():
            continue
        unexpected.extend(
            path
            for path in sorted(artifact_dir.iterdir())
            if path.is_file()
            and path.name.startswith("SnapText")
            and path.resolve() not in collected
        )
    if unexpected:
        raise SystemExit(
            "Unexpected SnapText files in release artifact directories: "
            + ", ".join(path.relative_to(artifact_root).as_posix() for path in unexpected)
        )


def artifact_entry(path: Path, artifact_root: Path) -> dict:
    return {
        "path": path.relative_to(artifact_root).as_posix(),
        "platform": artifact_platform(path),
        "size": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def build_manifest(artifact_root: Path, version: str, commit: str) -> dict:
    artifacts = collect_artifacts(artifact_root)
    if not artifacts:
        raise SystemExit(f"No release artifacts found in {artifact_root}")
    manifest = {
        "schema_version": 1,
        "product": "SnapText",
        "version": version,
        "commit": commit,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "artifact_root": artifact_root.relative_to(ROOT).as_posix()
        if artifact_root.is_relative_to(ROOT)
        else str(artifact_root),
        "artifacts": [artifact_entry(path, artifact_root) for path in artifacts],
    }
    # Reject placeholder metadata before writing files that could be mistaken for release output.
    verify_manifest_metadata(manifest, expected_version=None, expected_commit=None)
    for path in artifacts:
        validate_artifact_filename(path.relative_to(artifact_root).as_posix(), "SnapText", version)
    return manifest


def write_manifest(manifest: dict, output_path: Path, checksums_path: Path) -> None:
    artifact_root = artifact_root_from_manifest(manifest)
    for path, label in ((output_path, "release manifest"), (checksums_path, "release checksums")):
        if is_relative_to(path, artifact_root):
            raise SystemExit(
                f"{label} output must not be written inside artifact_root: {path}"
            )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    checksums_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    checksum_lines = [
        f"{artifact['sha256']}  {artifact['path']}\n"
        for artifact in manifest["artifacts"]
    ]
    checksums_path.write_text("".join(checksum_lines), encoding="utf-8")
    print(f"Wrote release manifest: {output_path}")
    print(f"Wrote release checksums: {checksums_path}")


def read_manifest(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(
            f"Missing release manifest: {path}. "
            "Generate it with: python3 scripts/generate_release_manifest.py --write"
        )
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def read_checksums(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise SystemExit(
            f"Missing release checksums: {path}. "
            "Generate it with: python3 scripts/generate_release_manifest.py --write"
        )

    checksums: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2:
            raise SystemExit(f"Invalid SHA256SUMS line {line_number}: {raw_line}")
        expected_hash, rel_path = parts
        if len(expected_hash) != 64 or any(char not in "0123456789abcdefABCDEF" for char in expected_hash):
            raise SystemExit(f"Invalid SHA-256 in SHA256SUMS line {line_number}: {expected_hash}")
        if Path(rel_path).is_absolute() or ".." in Path(rel_path).parts:
            raise SystemExit(f"SHA256SUMS path must stay under artifact_root: {rel_path}")
        if rel_path in checksums:
            raise SystemExit(f"Duplicate SHA256SUMS entry: {rel_path}")
        checksums[rel_path] = expected_hash.lower()
    if not checksums:
        raise SystemExit("SHA256SUMS must contain at least one artifact checksum")
    return checksums


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def artifact_root_from_manifest(manifest: dict) -> Path:
    artifact_root_value = manifest.get("artifact_root")
    if not isinstance(artifact_root_value, str) or not artifact_root_value.strip():
        raise SystemExit("release manifest artifact_root is required")
    artifact_root = Path(artifact_root_value)
    if not artifact_root.is_absolute():
        artifact_root = ROOT / artifact_root
    return artifact_root


def normalize_platforms(values: list[str]) -> set[str]:
    required: set[str] = set()
    for value in values:
        if value == "all":
            required.update(PLATFORM_CHOICES)
        else:
            required.add(value)
    return required


def normalize_artifact_kinds(values: list[str]) -> set[str]:
    required: set[str] = set()
    for value in values:
        if value == "all":
            required.update(ARTIFACT_KIND_CHOICES)
        else:
            required.add(value)
    return required


def require_filled_text(field_name: str, value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SystemExit(f"release manifest {field_name} is required")
    stripped = value.strip()
    lowered = stripped.lower()
    if lowered in {"unknown", "replace-with-git-sha", "replace-with-version"}:
        raise SystemExit(f"release manifest {field_name} still contains a placeholder value")
    if lowered.startswith("replace-with-") or lowered.startswith("replace with "):
        raise SystemExit(f"release manifest {field_name} still contains a placeholder value")
    return stripped


def verify_manifest_metadata(
    manifest: dict,
    expected_version: str | None,
    expected_commit: str | None,
) -> None:
    if manifest.get("product") != "SnapText":
        raise SystemExit("release manifest product must be SnapText")

    version = require_filled_text("version", manifest.get("version"))
    if not SEMVER_PATTERN.fullmatch(version):
        raise SystemExit("release manifest version must use semantic version format")
    if expected_version is not None and version != expected_version:
        raise SystemExit(f"release manifest version must match expected version {expected_version}")

    commit = require_filled_text("commit", manifest.get("commit"))
    if not GIT_SHA_PATTERN.fullmatch(commit):
        raise SystemExit("release manifest commit must be a 7-40 character git SHA")
    if expected_commit is not None and commit != expected_commit:
        raise SystemExit(f"release manifest commit must match expected commit {expected_commit}")

    generated_at = require_filled_text("generated_at", manifest.get("generated_at"))
    try:
        parsed_generated_at = datetime.fromisoformat(generated_at)
    except ValueError as err:
        raise SystemExit("release manifest generated_at must be an ISO-8601 timestamp") from err
    if parsed_generated_at.tzinfo is None:
        raise SystemExit("release manifest generated_at must include timezone information")
    if parsed_generated_at > datetime.now(timezone.utc):
        raise SystemExit("release manifest generated_at cannot be in the future")


def verify_manifest(
    manifest_path: Path,
    checksums_path: Path,
    required_platforms: set[str],
    required_artifact_kinds: set[str],
    expected_version: str | None,
    expected_commit: str | None,
) -> None:
    manifest = read_manifest(manifest_path)
    checksums = read_checksums(checksums_path)
    if manifest.get("schema_version") != 1:
        raise SystemExit("release manifest schema_version must be 1")
    verify_manifest_metadata(manifest, expected_version, expected_commit)
    product = require_filled_text("product", manifest.get("product"))
    version = require_filled_text("version", manifest.get("version"))
    artifact_root = artifact_root_from_manifest(manifest)
    if is_relative_to(manifest_path, artifact_root):
        raise SystemExit("release manifest file must not be inside artifact_root")
    if is_relative_to(checksums_path, artifact_root):
        raise SystemExit("release checksums file must not be inside artifact_root")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise SystemExit("release manifest must contain at least one artifact")

    present_platforms: set[str] = set()
    present_artifact_kinds: set[str] = set()
    manifest_checksums: dict[str, str] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise SystemExit("release manifest artifact entries must be objects")
        rel_path = artifact.get("path")
        platform = artifact.get("platform")
        expected_size = artifact.get("size")
        expected_hash = artifact.get("sha256")
        if not isinstance(rel_path, str) or not rel_path.strip():
            raise SystemExit("release manifest artifact.path is required")
        if Path(rel_path).is_absolute() or ".." in Path(rel_path).parts:
            raise SystemExit(f"release artifact path must stay under artifact_root: {rel_path}")
        if platform not in PLATFORM_CHOICES:
            raise SystemExit(f"release artifact has invalid platform: {rel_path}")
        inferred_platform = artifact_platform(Path(rel_path))
        if inferred_platform != platform:
            raise SystemExit(
                f"release artifact platform does not match path: {rel_path} "
                f"declares {platform}, inferred {inferred_platform}"
            )
        validate_artifact_filename(rel_path, product, version)
        present_platforms.add(platform)
        kind = artifact_kind(Path(rel_path))
        if kind is None:
            raise SystemExit(f"release artifact has invalid bundle kind: {rel_path}")
        present_artifact_kinds.add(kind)
        if not isinstance(expected_size, int) or expected_size <= 0:
            raise SystemExit(f"release artifact has invalid size: {rel_path}")
        if (
            not isinstance(expected_hash, str)
            or len(expected_hash) != 64
            or any(char not in "0123456789abcdefABCDEF" for char in expected_hash)
        ):
            raise SystemExit(f"release artifact has invalid sha256: {rel_path}")
        expected_hash = expected_hash.lower()
        if rel_path in manifest_checksums:
            raise SystemExit(f"release manifest has duplicate artifact path: {rel_path}")
        manifest_checksums[rel_path] = expected_hash

        path = artifact_root / rel_path
        if not path.is_file():
            raise SystemExit(f"Missing release artifact: {path}")
        actual_size = path.stat().st_size
        if actual_size != expected_size:
            raise SystemExit(
                f"Size mismatch for {path}: expected {expected_size}, got {actual_size}"
            )
        actual_hash = sha256_file(path)
        if actual_hash != expected_hash:
            raise SystemExit(
                f"SHA-256 mismatch for {path}: expected {expected_hash}, got {actual_hash}"
            )
    if checksums != manifest_checksums:
        missing = sorted(set(manifest_checksums) - set(checksums))
        extra = sorted(set(checksums) - set(manifest_checksums))
        mismatched = sorted(
            path
            for path in set(checksums) & set(manifest_checksums)
            if checksums[path] != manifest_checksums[path]
        )
        details: list[str] = []
        if missing:
            details.append("missing " + ", ".join(missing))
        if extra:
            details.append("extra " + ", ".join(extra))
        if mismatched:
            details.append("mismatched " + ", ".join(mismatched))
        raise SystemExit("SHA256SUMS does not match release manifest: " + "; ".join(details))
    missing_platforms = sorted(required_platforms - present_platforms)
    if missing_platforms:
        raise SystemExit(
            "release manifest is missing required platform artifacts: "
            + ", ".join(missing_platforms)
        )
    missing_artifact_kinds = sorted(required_artifact_kinds - present_artifact_kinds)
    if missing_artifact_kinds:
        raise SystemExit(
            "release manifest is missing required artifact kinds: "
            + ", ".join(missing_artifact_kinds)
        )
    print(f"Release manifest verified: {manifest_path}")
    print(f"Release checksums verified: {checksums_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate or verify SnapText release manifest.")
    parser.add_argument(
        "--artifact-root",
        default=str(DEFAULT_ARTIFACT_ROOT),
        help="Directory containing platform bundle artifacts.",
    )
    parser.add_argument(
        "--manifest",
        default=str(DEFAULT_MANIFEST),
        help="Path to write or verify the release manifest JSON.",
    )
    parser.add_argument(
        "--checksums",
        default=str(DEFAULT_CHECKSUMS),
        help="Path to write or verify SHA256SUMS.",
    )
    parser.add_argument("--version", default="0.1.0", help="Release version.")
    parser.add_argument("--commit", default="unknown", help="Release commit SHA.")
    parser.add_argument(
        "--write",
        action="store_true",
        help="Generate the manifest and SHA256SUMS from artifact-root.",
    )
    parser.add_argument(
        "--require-platforms",
        nargs="*",
        choices=(*PLATFORM_CHOICES, "all"),
        default=[],
        help="When verifying, require artifacts for these platforms. Use 'all' for release gates.",
    )
    parser.add_argument(
        "--require-artifact-kinds",
        nargs="*",
        choices=(*ARTIFACT_KIND_CHOICES, "all"),
        default=[],
        help="When verifying, require specific bundle artifact kinds. Use 'all' for release gates.",
    )
    parser.add_argument(
        "--expected-version",
        help="When verifying, require manifest.version to match this version.",
    )
    parser.add_argument(
        "--expected-commit",
        help="When verifying, require manifest.commit to match this git SHA.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if args.write:
        artifact_root = Path(args.artifact_root).expanduser().resolve()
        manifest = build_manifest(artifact_root, args.version, args.commit)
        write_manifest(manifest, manifest_path, Path(args.checksums).expanduser().resolve())
    else:
        verify_manifest(
            manifest_path,
            Path(args.checksums).expanduser().resolve(),
            normalize_platforms(args.require_platforms),
            normalize_artifact_kinds(args.require_artifact_kinds),
            args.expected_version,
            args.expected_commit,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
