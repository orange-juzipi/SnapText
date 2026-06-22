# SnapText 发布与打包说明

## 静态检查

GitHub Actions 已配置 macOS、Windows、Linux 三平台基础检查矩阵，覆盖格式检查、React/Vite 前端构建、Python helper 脚本语法检查、Rust 单测、clippy 和 workspace build。

发布前先在本地运行基础门禁：

```bash
python3 scripts/release_preflight.py
python3 scripts/verify_translator_providers.py
python3 scripts/build_frontend.py
```

React/Vite 前端位于 `ui/`，静态构建产物输出到 `ui/dist`，Tauri 的 `frontendDist` 指向该目录。

## OCR 模型

真实 OCR 模型可以通过 manifest 安装，也可以用 PaddleOCR ONNX 转换脚本生成：

```bash
python3 scripts/install_ocr_models.py --manifest models/manifest.json --model-dir models
python3 scripts/verify_ocr_models.py --require-sha256 models
```

正式发布必须通过 `python3 scripts/verify_ocr_models.py --require-sha256 models`。该命令校验 `manifest.json`、`SHA256SUMS`、模型文件哈希和 OCR smoke test。

## 桌面打包

当前平台通用打包入口：

```bash
python3 scripts/package_desktop.py --skip-installers
python3 scripts/package_desktop.py
```

macOS 本地打包入口：

```bash
python3 scripts/package_macos.py --skip-dmg --no-sign
python3 scripts/package_macos.py --require-sha256
```

`--no-sign` 仅用于本地验证构建，不得作为正式安装包分发。正式 macOS 打包默认要求 `APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 和 `TAURI_SIGNING_PRIVATE_KEY`，以保证 `.app`、DMG 和 Tauri updater 产物使用稳定签名身份。稳定的 bundle identifier 与签名身份是 macOS Accessibility、Screen Recording 等 TCC 权限在升级后尽量保留的前提。

完成 Tauri 打包后校验产物：

```bash
python3 scripts/verify_desktop_bundles.py
python3 scripts/verify_desktop_bundles.py --platform all
```

`--platform all` 只验证汇总安装包产物，要求 `dist/` 下已经收集 macOS、Windows 和 Linux 三个平台的发布安装包。macOS 产物除 DMG 外，还必须包含 Tauri updater 使用的 `.tar.gz` 和 `.tar.gz.sig`。发布前不要在 `dist/` 中混入其他版本或未知命名的 `SnapText` 安装包，否则产物校验会拒绝该目录。

## 发布 Manifest

三平台产物汇总后生成并校验 release manifest：

```bash
python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all --write dist
python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all
```

`--require-artifact-kinds all` 要求 release manifest 同时覆盖当前版本必须交付的安装包类型。

## QA 与签名

桌面端实机 QA 记录使用结构化 JSON：

```bash
python3 scripts/verify_desktop_qa.py docs/desktop-qa-record.json
```

签名、公证和校验和证据也使用结构化 JSON：

```bash
python3 scripts/verify_release_signing.py docs/release-signing-record.json
```

签名证据至少应包含 macOS `codesign`、`notarytool`、`spctl` 和 staple 结果，Windows `signtool` 与时间戳验证结果，Linux `SHA256SUMS`、deb/rpm 仓库签名计划和 `AppImage` sha256 记录。

## 最终发布门

正式发布使用最终门禁：

```bash
python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)"
```

`--release-commit` 必须等于当前 checkout 的 `git rev-parse HEAD`。`--allow-dirty-worktree` 只用于本地进度汇总；正式发布默认要求 `git status --porcelain` 为空。
