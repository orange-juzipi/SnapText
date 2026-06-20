#!/usr/bin/env python3
"""Run local release preflight checks for SnapText.

This script intentionally stays dependency-free so it can run on any developer
machine with Python 3 and Cargo installed. It checks the static release gates
that are verifiable in this repository:

- cargo fmt / test / clippy / build
- React/Vite frontend build
- Python helper script syntax checks
- frontend asset build wiring
- Tauri bundle icon and config wiring
- model directory documentation and placeholders
- real-model verification script wiring
- translator provider mock verification script wiring

It does not claim to replace platform-specific signing, notarization, or
hardware-backed desktop validation. Translator provider mock HTTP tests are
kept in a separate explicit script because some sandboxes block loopback TCP
listeners.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str]) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=ROOT, check=True)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def check_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def check_nonempty_file(path: Path, message: str) -> None:
    check(path.is_file(), message)
    check(path.stat().st_size > 0, f"{path.relative_to(ROOT)} is empty")


def main() -> int:
    # Keep the command order aligned with the repository README so the output is
    # easy to compare with the documented local validation steps.
    run(
        [
            "python3",
            "-m",
            "py_compile",
            "scripts/build_frontend.py",
            "scripts/build_tauri_frontend.py",
            "scripts/generate_release_manifest.py",
            "scripts/install_ocr_models.py",
            "scripts/install_paddleocr_onnx_models.py",
            "scripts/package_desktop.py",
            "scripts/package_macos.py",
            "scripts/release_gate.py",
            "scripts/release_preflight.py",
            "scripts/test_build_frontend.py",
            "scripts/test_desktop_bundles.py",
            "scripts/test_desktop_qa.py",
            "scripts/test_release_manifest.py",
            "scripts/test_install_ocr_models.py",
            "scripts/test_ocr_models.py",
            "scripts/test_paddleocr_onnx_installer.py",
            "scripts/test_packaging.py",
            "scripts/test_release_gate.py",
            "scripts/test_release_signing.py",
            "scripts/test_translator_providers.py",
            "scripts/verify_desktop_bundles.py",
            "scripts/verify_desktop_qa.py",
            "scripts/verify_release_signing.py",
            "scripts/verify_translator_providers.py",
            "scripts/verify_ocr_models.py",
        ]
    )
    run(["cargo", "fmt", "--all", "--", "--check"])
    run(["python3", "scripts/test_build_frontend.py"])
    run(["python3", "scripts/test_install_ocr_models.py"])
    run(["python3", "scripts/test_ocr_models.py"])
    run(["python3", "scripts/test_paddleocr_onnx_installer.py"])
    run(["python3", "scripts/test_desktop_bundles.py"])
    run(["python3", "scripts/test_release_manifest.py"])
    run(["python3", "scripts/test_release_gate.py"])
    run(["python3", "scripts/test_desktop_qa.py"])
    run(["python3", "scripts/test_release_signing.py"])
    run(["python3", "scripts/test_translator_providers.py"])
    run(["python3", "scripts/test_packaging.py"])
    run(["python3", "scripts/build_frontend.py", "--dry-run"])
    run(["cargo", "test", "--workspace"])
    run(["cargo", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"])
    run(["cargo", "build", "--workspace"])

    tauri_conf = check_json(ROOT / "crates/snaptext-tauri/tauri.conf.json")
    build = tauri_conf.get("build", {})
    app = tauri_conf.get("app", {})
    workspace_manifest = read_text(ROOT / "Cargo.toml")
    check(
        "crates/snaptext-frontend" not in workspace_manifest,
        "Cargo workspace still includes the removed Leptos frontend crate",
    )
    check(
        not (ROOT / "crates/snaptext-frontend").exists(),
        "crates/snaptext-frontend should be removed after the React migration",
    )
    check(not (ROOT / "ui/pkg").exists(), "ui/pkg should be removed after the React migration")
    check(
        build.get("frontendDist") == "../../ui/dist",
        "Tauri frontendDist must point at the React dist directory",
    )
    check(
        build.get("devUrl") == "http://127.0.0.1:1420",
        "Tauri devUrl must point at the Vite dev server",
    )
    check(
        build.get("beforeDevCommand") == "cd ../ui && bun run dev",
        "Tauri beforeDevCommand must start the Vite dev server from the Tauri CLI command cwd",
    )
    check(
        build.get("beforeBuildCommand") == "cd ../.. && python3 scripts/build_tauri_frontend.py",
        "Tauri beforeBuildCommand must run the model gate and React frontend build from the repository root",
    )
    check(
        app.get("withGlobalTauri") is True,
        "Tauri must expose the global API for desktop frontend assets",
    )

    index_html = read_text(ROOT / "ui/index.html")
    check(
        'src="/src/main.tsx"' in index_html,
        "ui/index.html is not wired to the React frontend entrypoint",
    )
    build_frontend_script = ROOT / "scripts/build_frontend.py"
    check(
        build_frontend_script.is_file(),
        "scripts/build_frontend.py is required to generate ui/dist",
    )
    build_frontend_text = read_text(build_frontend_script)
    for expected in (
        '"install", "--frozen-lockfile"',
        '"run", "build"',
        "ui/dist",
        "--dry-run",
    ):
        check(
            expected in build_frontend_text,
            f"scripts/build_frontend.py is missing frontend build support for {expected}",
        )
    build_tauri_frontend_script = ROOT / "scripts/build_tauri_frontend.py"
    check(
        build_tauri_frontend_script.is_file(),
        "scripts/build_tauri_frontend.py is required to gate Tauri release builds",
    )
    build_tauri_frontend_text = read_text(build_tauri_frontend_script)
    for expected in (
        "scripts/verify_ocr_models.py",
        "--require-sha256",
        "scripts/build_frontend.py",
    ):
        check(
            expected in build_tauri_frontend_text,
            f"scripts/build_tauri_frontend.py is missing release build gate support for {expected}",
        )
    test_build_frontend_script = ROOT / "scripts/test_build_frontend.py"
    check(
        test_build_frontend_script.is_file(),
        "scripts/test_build_frontend.py is required to self-test frontend build command wiring",
    )
    test_build_frontend_text = read_text(test_build_frontend_script)
    for expected in (
        "bun install --frozen-lockfile",
        "bun run build",
        "ui/dist",
    ):
        check(
            expected in test_build_frontend_text,
            f"scripts/test_build_frontend.py is missing frontend build coverage for {expected}",
        )
    package_macos_script = ROOT / "scripts/package_macos.py"
    package_desktop_script = ROOT / "scripts/package_desktop.py"
    check(
        package_desktop_script.is_file(),
        "scripts/package_desktop.py is required for repeatable cross-platform packaging",
    )
    package_desktop_text = read_text(package_desktop_script)
    for expected in (
        "scripts/verify_ocr_models.py",
        "--require-sha256",
        "scripts/build_frontend.py",
        "cargo-tauri",
        "--bundles",
        "--skip-installers",
        "--dry-run",
        "verify_desktop_bundles_main",
    ):
        check(
            expected in package_desktop_text,
            f"scripts/package_desktop.py is missing packaging support for {expected}",
        )
    check(
        package_macos_script.is_file(),
        "scripts/package_macos.py is required for repeatable macOS packaging",
    )
    package_macos_text = read_text(package_macos_script)
    for expected in (
        "scripts/verify_ocr_models.py",
        "--require-sha256",
        "verify_macos_artifacts",
        "verify_macos",
        "require_dmg",
        "--dry-run",
    ):
        check(
            expected in package_macos_text,
            f"scripts/package_macos.py is missing artifact verification for {expected}",
        )
    test_packaging_script = ROOT / "scripts/test_packaging.py"
    check(
        test_packaging_script.is_file(),
        "scripts/test_packaging.py is required to self-test packaging command wiring",
    )
    test_packaging_text = read_text(test_packaging_script)
    for expected in (
        "package_desktop.py",
        "package_macos.py",
        "cargo-tauri build --bundles msi --no-sign",
        "cargo-tauri build --bundles dmg --no-sign",
        "verify_desktop_bundles.py --platform current",
    ):
        check(
            expected in test_packaging_text,
            f"scripts/test_packaging.py is missing packaging command coverage for {expected}",
        )
    verify_desktop_bundles_script = ROOT / "scripts/verify_desktop_bundles.py"
    check(
        verify_desktop_bundles_script.is_file(),
        "scripts/verify_desktop_bundles.py is required for cross-platform bundle artifact gates",
    )
    verify_desktop_bundles_text = read_text(verify_desktop_bundles_script)
    for expected in (
        "verify_macos",
        "verify_windows",
        "verify_linux",
        "verify_all_platform_installers",
        "reject_stale_snaptext_artifacts",
        "Unexpected SnapText bundle artifacts for this release",
        ".msi",
        ".AppImage",
        "--skip-installers",
        "--release-dir",
        "--bundle-dir",
    ):
        check(
            expected in verify_desktop_bundles_text,
            f"scripts/verify_desktop_bundles.py is missing artifact verification for {expected}",
        )
    test_desktop_bundles_script = ROOT / "scripts/test_desktop_bundles.py"
    check(
        test_desktop_bundles_script.is_file(),
        "scripts/test_desktop_bundles.py is required to self-test desktop bundle gates",
    )
    test_desktop_bundles_text = read_text(test_desktop_bundles_script)
    for expected in (
        "SnapText.app",
        "SnapText_0.1.0_x64.msi",
        "SnapText_0.1.0_amd64.AppImage",
        "snaptext-desktop-bundles-all-only-",
        "snaptext-desktop-bundles-stale-",
        "macos_without_app",
        "SnapText_0.0.9_x64.msi",
        "Unexpected SnapText bundle artifacts for this release",
        "Missing bundle artifacts matching",
        "Generated file is empty",
    ):
        check(
            expected in test_desktop_bundles_text,
            f"scripts/test_desktop_bundles.py is missing bundle verifier coverage for {expected}",
        )
    check(
        "--platform all` 只验证汇总安装包产物" in read_text(ROOT / "docs/release-packaging.md"),
        "release docs must state that --platform all verifies aggregated installers only",
    )
    generate_release_manifest_script = ROOT / "scripts/generate_release_manifest.py"
    check(
        generate_release_manifest_script.is_file(),
        "scripts/generate_release_manifest.py is required for release artifact manifests",
    )
    generate_release_manifest_text = read_text(generate_release_manifest_script)
    for expected in (
        "release-manifest.json",
        "SHA256SUMS",
        "ARTIFACT_PATTERNS",
        "verify_manifest_metadata(manifest",
        "release artifact platform does not match path",
        "release artifact filename must match",
        "Release artifact root must be a directory",
        "generated_at must include timezone information",
        "generated_at cannot be in the future",
        "must not be written inside artifact_root",
        "must not be inside artifact_root",
        "--write",
    ):
        check(
            expected in generate_release_manifest_text,
            f"scripts/generate_release_manifest.py is missing release manifest support for {expected}",
        )
    test_release_manifest_script = ROOT / "scripts/test_release_manifest.py"
    check(
        test_release_manifest_script.is_file(),
        "scripts/test_release_manifest.py is required to self-test release manifests",
    )
    test_release_manifest_text = read_text(test_release_manifest_script)
    for expected in (
        "fake dmg",
        "fake msi",
        "missing-commit-manifest.json",
        "invalid-version-manifest.json",
        "release artifact has invalid sha256",
        "release artifact platform does not match path",
        "release artifact filename must match SnapText 0.1.0",
        "release manifest generated_at cannot be in the future",
        "release manifest generated_at must include timezone information",
        "artifact-root-file",
        "manifest_inside_artifacts",
        "checksums_in_artifacts",
        "tampered",
        "SHA-256 mismatch",
    ):
        check(
            expected in test_release_manifest_text,
            f"scripts/test_release_manifest.py is missing release manifest test coverage for {expected}",
        )
    verify_desktop_qa_script = ROOT / "scripts/verify_desktop_qa.py"
    check(
        verify_desktop_qa_script.is_file(),
        "scripts/verify_desktop_qa.py is required for manual desktop QA gates",
    )
    verify_desktop_qa_text = read_text(verify_desktop_qa_script)
    for expected in (
        "screen_recording_permission",
        "ui_automation_selection",
        "wayland_session",
        "desktop_capability_diagnostics",
        "CAPABILITY_DIAGNOSTIC_NAMES",
        "validate_desktop_capability_diagnostics",
        "screenshot_translation",
        "image_translation",
        "MIN_EVIDENCE_LENGTH",
        "specific verification evidence",
        "cannot be in the future",
        "contains unknown platforms",
        "contains unknown checks",
        "--write-example",
    ):
        check(
            expected in verify_desktop_qa_text,
            f"scripts/verify_desktop_qa.py is missing desktop QA coverage for {expected}",
        )
    test_desktop_qa_script = ROOT / "scripts/test_desktop_qa.py"
    check(
        test_desktop_qa_script.is_file(),
        "scripts/test_desktop_qa.py is required to self-test desktop QA records",
    )
    test_desktop_qa_text = read_text(test_desktop_qa_script)
    for expected in (
        "screenshot_translation",
        "wayland_session",
        "desktop_capability_diagnostics",
        "not passing: blocked",
        "is missing wayland_session",
        "is missing desktop_capability_diagnostics",
        "desktop-qa-incomplete-diagnostics.json",
        "desktop-qa-malformed-diagnostics.json",
        "desktop-qa-short-evidence.json",
        "desktop-qa-future-date.json",
        "desktop-qa-unknown-platform.json",
        "desktop-qa-unknown-check.json",
        "linux.history.evidence must include specific verification evidence",
    ):
        check(
            expected in test_desktop_qa_text,
            f"scripts/test_desktop_qa.py is missing desktop QA test coverage for {expected}",
        )
    verify_release_signing_script = ROOT / "scripts/verify_release_signing.py"
    check(
        verify_release_signing_script.is_file(),
        "scripts/verify_release_signing.py is required for release signing gates",
    )
    verify_release_signing_text = read_text(verify_release_signing_script)
    for expected in (
        "notarization_accepted",
        "authenticode_signature",
        "sha256_checksums",
        "EVIDENCE_KEYWORDS",
        "validate_evidence_keywords",
        "MIN_EVIDENCE_LENGTH",
        "specific verification evidence",
        "cannot be in the future",
        "contains unknown platforms",
        "contains unknown checks",
        "--write-example",
    ):
        check(
            expected in verify_release_signing_text,
            f"scripts/verify_release_signing.py is missing signing coverage for {expected}",
        )
    test_release_signing_script = ROOT / "scripts/test_release_signing.py"
    check(
        test_release_signing_script.is_file(),
        "scripts/test_release_signing.py is required to self-test release signing records",
    )
    test_release_signing_text = read_text(test_release_signing_script)
    for expected in (
        "notarization_accepted",
        "timestamp",
        "not passing: blocked",
        "is missing timestamp",
        "release-signing-missing-keyword.json",
        "windows.authenticode_signature.evidence must mention: signtool, Verified",
        "release-signing-short-evidence.json",
        "release-signing-future-date.json",
        "release-signing-unknown-platform.json",
        "release-signing-unknown-check.json",
        "linux.sha256_checksums.evidence must include specific verification evidence",
    ):
        check(
            expected in test_release_signing_text,
            f"scripts/test_release_signing.py is missing signing test coverage for {expected}",
        )
    verify_ocr_models_script = ROOT / "scripts/verify_ocr_models.py"
    install_ocr_models_script = ROOT / "scripts/install_ocr_models.py"
    install_paddleocr_onnx_script = ROOT / "scripts/install_paddleocr_onnx_models.py"
    check(
        install_ocr_models_script.is_file(),
        "scripts/install_ocr_models.py is required for reproducible OCR model installation",
    )
    install_ocr_models_text = read_text(install_ocr_models_script)
    for expected in (
        "manifest.json",
        "det.onnx",
        "sha256",
        "model manifest contains unknown files",
        "PLACEHOLDER_TOKENS",
        "still contains a placeholder value",
        "urllib.request",
        "scripts/verify_ocr_models.py",
    ):
        check(
            expected in install_ocr_models_text,
            f"scripts/install_ocr_models.py is missing model install support for {expected}",
        )
    check(
        install_paddleocr_onnx_script.is_file(),
        "scripts/install_paddleocr_onnx_models.py is required for official PaddleOCR model installation",
    )
    install_paddleocr_onnx_text = read_text(install_paddleocr_onnx_script)
    for expected in (
        "PP-OCRv6_tiny_det_infer.tar",
        "PP-OCRv6_tiny_rec_infer.tar",
        "PP-LCNet_x0_25_textline_ori_infer.tar",
        "--paddle2onnx",
        "rec_dict.txt",
        "SHA256SUMS",
        "manifest.json",
    ):
        check(
            expected in install_paddleocr_onnx_text,
            f"scripts/install_paddleocr_onnx_models.py is missing PaddleOCR install support for {expected}",
        )
    test_install_ocr_models_script = ROOT / "scripts/test_install_ocr_models.py"
    check(
        test_install_ocr_models_script.is_file(),
        "scripts/test_install_ocr_models.py is required to self-test model installation",
    )
    test_install_ocr_models_text = read_text(test_install_ocr_models_script)
    for expected in (
        "as_uri",
        "--skip-verify",
        "SHA-256 mismatch",
        "Refusing to overwrite",
        "placeholder-url-manifest.json",
        "placeholder-hash-manifest.json",
        "extra-file-manifest.json",
        "mismatch-last-manifest.json",
        "files.det.onnx.url still contains a placeholder value",
        "files.cls.onnx.sha256 still contains a placeholder value",
        "model manifest contains unknown files: extra.onnx",
        "Installer wrote {name} even though the manifest failed validation",
    ):
        check(
            expected in test_install_ocr_models_text,
            f"scripts/test_install_ocr_models.py is missing installer test coverage for {expected}",
        )
    test_paddleocr_onnx_script = ROOT / "scripts/test_paddleocr_onnx_installer.py"
    check(
        test_paddleocr_onnx_script.is_file(),
        "scripts/test_paddleocr_onnx_installer.py is required to self-test the PaddleOCR ONNX installer",
    )
    test_paddleocr_onnx_text = read_text(test_paddleocr_onnx_script)
    for expected in (
        "--dry-run",
        "find_paddle_model_dir",
        "find_recognition_dict",
        "write_model_manifest",
        "PaddleOCR ONNX installer self-test passed",
    ):
        check(
            expected in test_paddleocr_onnx_text,
            f"scripts/test_paddleocr_onnx_installer.py is missing installer coverage for {expected}",
        )
    check(
        verify_ocr_models_script.is_file(),
        "scripts/verify_ocr_models.py is required for the real OCR model gate",
    )
    verify_ocr_models_text = read_text(verify_ocr_models_script)
    for expected in ("SHA256SUMS", "--require-sha256", "--write-sha256-manifest", "--skip-smoke-test"):
        check(
            expected in verify_ocr_models_text,
            f"scripts/verify_ocr_models.py is missing model checksum support: {expected}",
        )
    test_ocr_models_script = ROOT / "scripts/test_ocr_models.py"
    check(
        test_ocr_models_script.is_file(),
        "scripts/test_ocr_models.py is required to self-test OCR model verification",
    )
    test_ocr_models_text = read_text(test_ocr_models_script)
    for expected in (
        "Missing OCR model files",
        "Recognition dictionary is empty",
        "SHA-256 mismatch for",
        "Unexpected checksum target",
    ):
        check(
            expected in test_ocr_models_text,
            f"scripts/test_ocr_models.py is missing OCR verifier coverage for {expected}",
        )
    verify_translators_script = ROOT / "scripts/verify_translator_providers.py"
    check(
        verify_translators_script.is_file(),
        "scripts/verify_translator_providers.py is required for translator provider mock HTTP gates",
    )
    verify_translators_text = read_text(verify_translators_script)
    for expected in (
        "check_loopback_listener_available",
        "translate::tests::",
        "--ignored",
        "--dry-run",
    ):
        check(
            expected in verify_translators_text,
            f"scripts/verify_translator_providers.py is missing translator gate support for {expected}",
        )
    test_translators_script = ROOT / "scripts/test_translator_providers.py"
    check(
        test_translators_script.is_file(),
        "scripts/test_translator_providers.py is required to self-test translator provider gate wiring",
    )
    test_translators_text = read_text(test_translators_script)
    for expected in ("--dry-run", "translate::tests::", "--ignored", "--nocapture"):
        check(
            expected in test_translators_text,
            f"scripts/test_translator_providers.py is missing translator test coverage for {expected}",
        )
    release_gate_script = ROOT / "scripts/release_gate.py"
    check(
        release_gate_script.is_file(),
        "scripts/release_gate.py is required for the final release gate",
    )
    release_gate_text = read_text(release_gate_script)
    for expected in (
        "scripts/release_preflight.py",
        "scripts/verify_ocr_models.py",
        "scripts/verify_translator_providers.py",
        "scripts/verify_desktop_bundles.py",
        "scripts/generate_release_manifest.py",
        "scripts/verify_desktop_qa.py",
        "scripts/verify_release_signing.py",
        "--release-commit",
        "fill_dry_run_release_commit",
        "validate_release_identity",
        "current_git_head",
        "--release-commit must match current git HEAD",
        "ensure_clean_worktree",
        "--allow-dirty-worktree",
        "release gate requires a clean git worktree",
        "tauri.conf.json",
        "--release-version must match tauri.conf.json version",
        "--allow-missing-external",
        "--dry-run",
    ):
        check(
            expected in release_gate_text,
            f"scripts/release_gate.py is missing final gate coverage for {expected}",
        )
    test_release_gate_script = ROOT / "scripts/test_release_gate.py"
    check(
        test_release_gate_script.is_file(),
        "scripts/test_release_gate.py is required to self-test final release gate command composition",
    )
    test_release_gate_text = read_text(test_release_gate_script)
    for expected in (
        "--dry-run",
        "run_gate_real",
        "the following arguments are required: --release-commit",
        "release gate --release-version must use semantic version format",
        "release gate --release-commit must be a 7-40 character git SHA",
        "release gate --release-commit must match current git HEAD",
        "release gate requires a clean git worktree",
        "release gate --release-version must match tauri.conf.json version 0.1.0",
        "static_preflight",
        "real_ocr_models",
        "release_manifest",
        "--require-platforms all",
    ):
        check(
            expected in test_release_gate_text,
            f"scripts/test_release_gate.py is missing release gate coverage for {expected}",
        )
    check_nonempty_file(
        ROOT / "ui/dist/index.html",
        "ui/dist/index.html is missing; run python3 scripts/build_frontend.py",
    )

    bundle = tauri_conf.get("bundle", {})
    icons = bundle.get("icon", [])
    check(
        icons == ["icons/icon.png", "icons/icon.icns", "icons/icon.ico"],
        "Tauri bundle icons are not wired to the expected trio",
    )
    check(bundle.get("active") is True, "Tauri bundle is not enabled")
    check(bundle.get("targets") == "all", "Tauri bundle targets are not set to all")

    for icon_name in ("icon.png", "icon.icns", "icon.ico", "icon.svg"):
        icon_path = ROOT / "crates/snaptext-tauri/icons" / icon_name
        check(icon_path.is_file(), f"Missing application icon: {icon_path}")

    models_dir = ROOT / "models"
    expected_model_files = ["det.onnx", "cls.onnx", "rec.onnx", "rec_dict.txt"]
    check(
        bundle.get("resources") == {
            "../../models": "models",
            "../../python/ocr_worker.py": "python/ocr_worker.py",
        },
        "Tauri bundle.resources does not declare the expected OCR model and worker mappings",
    )
    check(
        (ROOT / "python/ocr_worker.py").is_file(),
        "python/ocr_worker.py is required so packaged apps can run OCR outside the repo checkout",
    )

    missing_models = [
        name for name in expected_model_files if not (models_dir / name).is_file()
    ]
    if missing_models:
        print(
            "Model files are still missing, so the OCR smoke test remains a manual "
            f"step: {', '.join(missing_models)}"
        )
    else:
        print("Model files are present; OCR smoke test can be run explicitly.")

    models_readme = read_text(ROOT / "models/README.md")
    model_manifest = check_json(ROOT / "models/manifest.example.json")
    manifest_files = model_manifest.get("files", {})
    for model_name in expected_model_files:
        check(
            model_name in manifest_files,
            f"models/manifest.example.json is missing {model_name}",
        )
    check(
        "SNAPTEXT_OCR_MODEL_DIR=models" in models_readme,
        "models/README.md is missing the smoke test command",
    )
    check(
        "python3 scripts/verify_ocr_models.py" in models_readme,
        "models/README.md is missing the model verification command",
    )
    check(
        "--require-sha256" in models_readme and "SHA256SUMS" in models_readme,
        "models/README.md is missing the model checksum release gate",
    )
    check(
        "python3 scripts/install_ocr_models.py" in models_readme,
        "models/README.md is missing the model install command",
    )
    check(
        "只允许这四个固定文件名" in models_readme,
        "models/README.md is missing strict OCR manifest file set guidance",
    )
    check(
        "只有四个文件全部校验通过后才会安装到模型目录" in models_readme,
        "models/README.md is missing all-or-nothing OCR model install guidance",
    )

    readme = read_text(ROOT / "README.md")
    check(
        "python3 scripts/build_frontend.py" in readme,
        "README.md is missing the frontend build command",
    )
    check(
        "../../.tools/bin/cargo-tauri dev" in readme and "cargo run -p snaptext-tauri" in readme,
        "README.md is missing desktop development startup commands",
    )
    check(
        "python3 scripts/install_ocr_models.py" in readme,
        "README.md is missing the OCR model install command",
    )
    check(
        "python3 scripts/package_desktop.py" in readme,
        "README.md is missing the desktop packaging command",
    )
    check(
        "python3 scripts/verify_translator_providers.py" in readme,
        "README.md is missing the translator provider verification command",
    )
    check(
        "python3 scripts/verify_desktop_bundles.py" in readme,
        "README.md is missing the desktop bundle verification command",
    )
    check(
        "python3 scripts/generate_release_manifest.py" in readme,
        "README.md is missing the release manifest command",
    )
    check(
        "--require-artifact-kinds all" in readme,
        "README.md is missing the release manifest artifact-kind requirement",
    )
    check(
        "python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all"
        in readme,
        "README.md is missing the complete release manifest verification command",
    )
    check(
        "python3 scripts/verify_desktop_qa.py" in readme,
        "README.md is missing the desktop QA verification command",
    )
    check(
        "python3 scripts/verify_release_signing.py" in readme,
        "README.md is missing the release signing verification command",
    )
    check(
        "桌面能力诊断会集中报告截图、划词、全局热键和 OCR 模型状态" in readme
        and "模型文件缺失" in readme
        and "可复制稳定格式的诊断摘要" in readme,
        "README.md is missing desktop capability diagnostics for OCR models",
    )
    check(
        'python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)"' in readme,
        "README.md is missing the final release gate command with --release-commit",
    )
    check(
        "`--release-commit` 必须等于当前 checkout 的 `git rev-parse HEAD`" in readme,
        "README.md is missing the release commit HEAD identity rule",
    )
    check(
        "`--allow-dirty-worktree` 只用于本地进度汇总" in readme,
        "README.md is missing the dirty worktree summary-only rule",
    )
    check(
        "配置加载、保存和 Tauri 更新命令会规范化用户输入边界" in readme,
        "README.md is missing config normalization behavior",
    )
    check(
        "超过 25 MiB 的原始图片 payload" in readme and "超过 2400 万像素" in readme,
        "README.md is missing large image guard behavior",
    )
    check(
        "单次最多 8 条、单条最多 12,000 字符、总计最多 24,000 字符" in readme,
        "README.md is missing translation request size limits",
    )

    goal_plan = read_text(ROOT / "goal/snaptext-desktop-plan.md")
    check(
        "桌面能力诊断现在会集中报告截图、划词、全局热键和 OCR 模型状态" in goal_plan
        and "ONNX session 不可加载" in goal_plan
        and "[capability] status - action" in goal_plan,
        "goal/snaptext-desktop-plan.md is missing desktop capability diagnostics progress",
    )

    tauri_lib = read_text(ROOT / "crates/snaptext-tauri/src/lib.rs")
    for expected in (
        "fn desktop_capabilities(state: &AppState)",
        'capability: String::from("ocr_worker")',
        "ocr_worker_capability_status(state)",
        "ocr_worker_capability_action(state)",
        "check_ocr_worker_inner(state)",
    ):
        check(
            expected in tauri_lib,
            f"snaptext-tauri desktop capabilities are missing OCR model diagnostics: {expected}",
        )
    core_config = read_text(ROOT / "crates/snaptext-core/src/config.rs")
    for expected in (
        "snaptext_cloud_production_endpoint",
        "snaptext_cloud_local_endpoint",
        "https://snaptext.uuidcx.com",
        "http://127.0.0.1:8080",
    ):
        check(expected in core_config, f"snaptext-core config is missing SnapText source endpoint: {expected}")
    check(
        "SNAPTEXT_CLOUD_ENDPOINT" not in core_config,
        "snaptext-core should not read client SnapText endpoint environment variables",
    )

    frontend_lib = read_text(ROOT / "ui/src/lib/format.ts") + read_text(
        ROOT / "ui/src/routes/settings.tsx"
    )
    for expected in (
        "copyDiagnostics",
        "formatCapabilitiesForClipboard",
        "[${item.capability.trim()}] ${item.status.trim()} - ${singleLineText(item.action)}",
    ):
        check(
            expected in frontend_lib,
            f"React frontend is missing copyable desktop diagnostics support: {expected}",
        )
    snaptext_cloud_client = read_text(ROOT / "ui/src/lib/snaptext-cloud.ts")
    settings_page = read_text(ROOT / "ui/src/routes/settings.tsx")
    client_snaptext_source = settings_page + snaptext_cloud_client
    for expected in (
        "VITE_SNAPTEXT_CLOUD_ENV",
        "clientSnapTextCloudEndpoint",
        'production: "https://snaptext.uuidcx.com"',
        'local: "http://127.0.0.1:8080"',
        'option value="snaptext_cloud"',
        "SnapText 官方源",
    ):
        check(expected in client_snaptext_source, f"settings page is missing SnapText source controls: {expected}")
    for unexpected in (
        "运行环境",
        "线上地址",
        "本地调试",
        "内置地址",
        "snaptextCloudEnvironment",
    ):
        check(unexpected not in settings_page, f"settings page should not expose SnapText endpoint UI: {unexpected}")
    check(
        "SnapText Cloud endpoint" not in settings_page,
        "settings page should not expose editable SnapText Cloud endpoint input",
    )
    frontend_api = read_text(ROOT / "ui/src/lib/api.ts")
    for expected in (
        '"get_history"',
        '"clear_history"',
        '"get_config"',
        '"get_overlay_screenshot"',
        '"clear_overlay_screenshot"',
        '"screenshot_full"',
        '"screenshot_region"',
        '"start_screenshot_overlay"',
        '"update_config"',
        '"get_desktop_capabilities"',
        '"validate_ocr_models"',
        '"check_ocr_worker"',
        '"translate_image_base64"',
        '"translate_screenshot_base64"',
        '"translate_screenshot_region"',
        '"ocr_image_region"',
        '"ocr_screenshot_region"',
        '"translate_overlay_selection"',
        '"close_overlay"',
        '"pin_result_window"',
        '"unpin_result_window"',
        '"translate_current_selection"',
        '"translate_text"',
        '"translate_selection"',
        '"retranslate_result_text"',
    ):
        check(expected in frontend_api, f"React Tauri API wrapper is missing command {expected}")
    frontend_queries = read_text(ROOT / "ui/src/lib/queries.ts")
    for expected in (
        "useConfigQuery",
        "useHistoryQuery",
        "useDesktopCapabilitiesQuery",
        "useValidateModelsMutation",
        "useCheckOcrWorkerMutation",
        "useUpdateConfigMutation",
        "useTranslateTextMutation",
        "useTranslateImageMutation",
        "useClearHistoryMutation",
        "usePinResultMutation",
        "useRetranslateMutation",
    ):
        check(expected in frontend_queries, f"React query layer is missing {expected}")
    for component_file in (
        "button.tsx",
        "input.tsx",
        "textarea.tsx",
        "select.tsx",
        "tabs.tsx",
        "dialog.tsx",
        "tooltip.tsx",
        "switch.tsx",
        "checkbox.tsx",
        "badge.tsx",
        "card.tsx",
        "dropdown-menu.tsx",
        "toast.tsx",
    ):
        check(
            (ROOT / "ui/src/components/ui" / component_file).is_file(),
            f"React UI component primitive is missing: {component_file}",
        )
    tauri_main = read_text(ROOT / "crates/snaptext-tauri/src/main.rs")
    for expected in (
        "start_dev_frontend_if_needed",
        'Command::new("bun")',
        '"run"',
        '"dev"',
        "DEV_SERVER_ADDR",
        "127.0.0.1:1420",
    ):
        check(
            expected in tauri_main,
            f"snaptext-tauri cargo run fallback is missing React dev server support: {expected}",
        )

    release_docs = read_text(ROOT / "docs/release-packaging.md")
    check(
        "GitHub Actions 已配置 macOS、Windows、Linux 三平台基础检查矩阵"
        in release_docs,
        "release docs are missing CI coverage note",
    )
    check(
        "python3 scripts/verify_translator_providers.py" in release_docs,
        "release docs are missing translator provider verification command",
    )
    check(
        "python3 scripts/package_desktop.py" in release_docs,
        "release docs are missing desktop packaging command",
    )
    check(
        "python3 scripts/verify_desktop_bundles.py" in release_docs,
        "release docs are missing desktop bundle verification command",
    )
    check(
        "混入其他版本或未知命名的 `SnapText` 安装包" in release_docs,
        "release docs are missing stale bundle artifact rejection note",
    )
    check(
        "python3 scripts/generate_release_manifest.py" in release_docs,
        "release docs are missing release manifest command",
    )
    check(
        "--require-artifact-kinds all" in release_docs,
        "release docs are missing the release manifest artifact-kind requirement",
    )
    check(
        "python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all"
        in release_docs,
        "release docs are missing the complete release manifest verification command",
    )
    check(
        "python3 scripts/verify_desktop_qa.py" in release_docs,
        "release docs are missing desktop QA verification command",
    )
    check(
        "python3 scripts/verify_release_signing.py" in release_docs,
        "release docs are missing release signing verification command",
    )
    check(
        "codesign" in release_docs
        and "notarytool" in release_docs
        and "spctl" in release_docs
        and "signtool" in release_docs
        and "SHA256SUMS" in release_docs
        and "AppImage" in release_docs,
        "release docs are missing signing evidence keyword requirements",
    )
    release_signing_example = check_json(ROOT / "docs/release-signing-record.example.json")
    for platform_name in ("macos", "windows", "linux"):
        check(
            platform_name in release_signing_example.get("platforms", {}),
            f"release signing example is missing {platform_name}",
        )
    check(
        'python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)"' in release_docs,
        "release docs are missing final release gate command with --release-commit",
    )
    check(
        "`--release-commit` 必须等于当前 checkout 的 `git rev-parse HEAD`" in release_docs,
        "release docs are missing the release commit HEAD identity rule",
    )
    check(
        "`--allow-dirty-worktree` 只用于本地进度汇总" in release_docs,
        "release docs are missing the dirty worktree summary-only rule",
    )
    check(
        "python3 scripts/install_ocr_models.py" in release_docs,
        "release docs are missing OCR model install command",
    )
    check(
        "React/Vite" in release_docs and "ui/dist" in release_docs and "ui/pkg" not in release_docs,
        "release docs must describe the React/Vite ui/dist frontend build, not the old ui/pkg build",
    )
    check(
        "WASM 前端" not in release_docs and "wasm-bindgen" not in release_docs,
        "release docs still contain stale WASM frontend build guidance",
    )
    desktop_qa_checklist = read_text(ROOT / "docs/desktop-qa-checklist.md")
    for expected in (
        "screen_recording_permission",
        "desktop_capability_diagnostics",
        "[global_hotkey]",
        "[ocr_worker]",
        "ui_automation_selection",
        "wayland_session",
        "python3 scripts/verify_desktop_qa.py docs/desktop-qa-record.json",
    ):
        check(
            expected in desktop_qa_checklist,
            f"desktop QA checklist is missing required coverage: {expected}",
        )
    check_json(ROOT / "docs/desktop-qa-record.example.json")
    check(
        "python3 scripts/verify_ocr_models.py --require-sha256 models" in release_docs,
        "release docs are missing the required model checksum verification command",
    )

    ci_workflow = read_text(ROOT / ".github/workflows/ci.yml")
    for os_name in ("ubuntu-latest", "macos-latest", "windows-latest"):
        check(os_name in ci_workflow, f"CI workflow is missing {os_name}")
    check(
        "Run Python self-tests" in ci_workflow,
        "CI workflow is missing the Python self-test execution step",
    )
    check(
        "oven-sh/setup-bun@v2" in ci_workflow,
        "CI workflow must install Bun before building the React frontend",
    )
    check(
        "Build React frontend" in ci_workflow and "python scripts/build_frontend.py" in ci_workflow,
        "CI workflow is missing the React frontend build step",
    )
    for script_name in (
        "scripts/build_frontend.py",
        "scripts/generate_release_manifest.py",
        "scripts/install_ocr_models.py",
        "scripts/package_desktop.py",
        "scripts/package_macos.py",
        "scripts/release_gate.py",
        "scripts/release_preflight.py",
        "scripts/test_build_frontend.py",
        "scripts/test_desktop_bundles.py",
        "scripts/test_desktop_qa.py",
        "scripts/test_install_ocr_models.py",
        "scripts/test_ocr_models.py",
        "scripts/test_packaging.py",
        "scripts/test_release_gate.py",
        "scripts/test_release_manifest.py",
        "scripts/test_release_signing.py",
        "scripts/test_translator_providers.py",
        "scripts/verify_desktop_bundles.py",
        "scripts/verify_desktop_qa.py",
        "scripts/verify_release_signing.py",
        "scripts/verify_translator_providers.py",
        "scripts/verify_ocr_models.py",
    ):
        check(
            script_name in ci_workflow,
            f"CI workflow Python helper check is missing {script_name}",
        )
    for self_test_command in (
        "python scripts/test_build_frontend.py",
        "python scripts/test_install_ocr_models.py",
        "python scripts/test_ocr_models.py",
        "python scripts/test_packaging.py",
        "python scripts/test_desktop_bundles.py",
        "python scripts/test_release_gate.py",
        "python scripts/test_release_manifest.py",
        "python scripts/test_desktop_qa.py",
        "python scripts/test_release_signing.py",
        "python scripts/test_translator_providers.py",
    ):
        check(
            self_test_command in ci_workflow,
            f"CI workflow Python self-test step is missing {self_test_command}",
        )
    for command in (
        "cargo fmt --all -- --check",
        "python scripts/test_build_frontend.py",
        "python scripts/build_frontend.py",
        "cargo test --workspace",
        "cargo clippy --workspace --all-targets -- -D warnings",
        "cargo build --workspace",
    ):
        check(command in ci_workflow, f"CI workflow is missing command: {command}")

    gitignore = read_text(ROOT / ".gitignore")
    for pattern in ("**/__pycache__/", "*.py[cod]"):
        check(pattern in gitignore, f".gitignore is missing generated Python cache pattern: {pattern}")

    print("Release preflight checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
