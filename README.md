# SnapText

SnapText 是一个跨平台桌面 OCR 翻译工作台：截取屏幕区域、导入图片或读取当前选中文本，识别后交给翻译服务，并保留可查看的历史记录。项目使用 Rust workspace 承载核心逻辑，桌面壳基于 Tauri 2，界面基于 React + Vite。

> 当前项目仍在早期迭代。跨平台权限、OCR 模型和第三方翻译服务的行为请以实际环境验证为准。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE-MIT)

## 功能概览

- 截图框选后 OCR，并可直接翻译选区。
- 导入 PNG、JPEG 或 WebP 图片，选择区域进行 OCR 和翻译。
- 读取当前应用中的选中文本，使用全局快捷键快速翻译。
- 支持文本自动翻译、原文/译文复制、拼音、朗读和历史记录。
- 可在设置中切换翻译服务和目标语言，支持中文和 English 界面。

### 翻译服务

| 服务 | 适用场景 | 配置 |
| --- | --- | --- |
| SnapText Cloud | 开箱即用的官方服务 | 无需 API Key |
| OpenAI-compatible | 自建或兼容 OpenAI API 的服务（高级配置） | Base URL、模型和 API Key |
| DeepL | DeepL 翻译 API | API Key |
| Google | Google Cloud Translation | API Key |
| Local HTTP | 本地开发和 mock 验收 | 仅用于开发配置 |

## 支持平台

| 平台 | OCR 默认路径 | 使用前需要注意 |
| --- | --- | --- |
| macOS | 默认优先使用 Apple Vision；也可切换 Paddle/ONNX | 首次使用截图和划词功能时，按系统提示授予屏幕录制和辅助功能权限；语音输入仅 macOS 支持 |
| Windows | Paddle/ONNX | 需要准备 OCR 模型，并允许应用访问屏幕 |
| Linux | Paddle/ONNX | 需要准备 OCR 模型；Wayland、桌面门户和截图权限取决于发行版配置 |

## 快速开始

### 1. 准备环境

请先安装：

- Rust toolchain 1.98 或更高版本（项目使用 Rust 2024 edition）。
- [Bun](https://bun.sh/)，用于安装和构建前端。
- Python 3；如果要从 PaddleOCR 转换模型，建议使用 Python 3.12。
- 当前平台的 Tauri/WebKit 系统依赖。Linux 依赖可参考 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

确认 Rust 版本：

```bash
rustc --version
```

### 2. 初始化仓库

在仓库根目录运行：

```bash
make init
```

该命令会安装锁定的前端依赖、预取 Rust 依赖，并把匹配当前 workspace 的 Tauri CLI 安装到 `.tools/`。Rust、Python 和 Bun 需要提前安装。

### 3. 准备 OCR 模型

Windows 和 Linux 打包或运行 Paddle OCR 前，需要在 `models/` 放置以下文件：

```text
models/det.onnx
models/cls.onnx
models/rec.onnx
models/rec_dict.txt
```

仓库不提交真实模型。最小的 manifest 安装流程如下，真实 URL 和 SHA-256 需要由维护者按发布版本填写：

```bash
cp models/manifest.example.json models/manifest.json
python3 scripts/install_ocr_models.py --manifest models/manifest.json --model-dir models
python3 scripts/verify_ocr_models.py --require-sha256 models
```

模型转换、版本选择、上游许可证、校验和以及 OCR smoke test 见 [`models/README.md`](models/README.md)。macOS 使用 Vision OCR 时可以不放模型，但发布包仍应按发布文档完成模型门禁。

### 4. 启动开发模式

```bash
make dev
```

`make dev` 会启动 Tauri 调试进程和 Vite 开发服务器。默认的 SnapText Cloud 地址是 `https://snaptext.uuidcx.com`。需要调试本地云端服务时，可临时使用：

```bash
SNAPTEXT_CLOUD_ENV=local make dev
```

该变量只在开发运行时覆盖 translator，不会写入 `config.yaml`，设置页也不会展示本地调试入口；生产构建不会读取这个本地覆盖变量。

## 隐私与数据流

- 截图、图片解码、OCR、配置和历史记录默认在本机处理或保存。
- 选择 OpenAI-compatible、DeepL、Google 或 SnapText Cloud 后，识别文本会按所选 provider 的接口发送到对应服务。
- SnapText Cloud 还会注册设备 ID、公钥、应用版本、操作系统和系统版本，用于设备认证和请求签名。
- API key 和云端设备私钥只保存在用户应用数据目录。当前版本不会额外使用系统密钥链加密 API key；不要把密钥、设备私钥、用户历史或未脱敏日志提交到仓库。

## 开发与验证

Rust、前端和 Python 辅助脚本的常用检查：

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --workspace
python3 scripts/test_build_frontend.py
python3 scripts/build_frontend.py
```

前端也可以单独构建：

```bash
cd ui
bun install --frozen-lockfile
bun run build
```

翻译 provider 的 mock HTTP 验收：

```bash
python3 scripts/verify_translator_providers.py
```

当前平台桌面产物校验：

```bash
python3 scripts/verify_desktop_bundles.py
```

发布前静态检查会串联上述门禁：

```bash
python3 scripts/release_preflight.py
```

## 打包与发布

### 本地打包

生成当前平台的发布包并校验产物：

```bash
make package
```

默认产物如下：

- macOS：`dist/macos/SnapText-macos-ad-hoc-signed.app.zip`。这是完整 `.app` 的 ad-hoc 签名 ZIP，未经 Apple 公证，首次启动可能需要在“系统设置 → 隐私与安全性”中手动放行。
- Windows：Tauri NSIS 安装包（`.exe`）。
- Linux：本地运行 `make package` 时生成 deb 安装包。

打包脚本会先校验模型，再构建 `ui/dist`，最后执行 Tauri release build。正式发布前不要把 `target/`、`ui/dist/`、`dist/` 或真实模型文件提交到 Git。

### 维护者发布门禁

README 是公开的发布入口；GitHub Actions 已配置 macOS、Windows、Linux 三平台基础检查矩阵。需要单独验证当前平台时，也可以直接调用 `python3 scripts/package_desktop.py`。

常用发布顺序如下：

```bash
python3 scripts/release_preflight.py
python3 scripts/verify_translator_providers.py
python3 scripts/verify_desktop_bundles.py --platform all
```

`--platform all` 只验证汇总安装包产物，要求 `dist/` 已经收集 macOS、Windows 和 Linux 的安装包。发布前不要在 `dist/` 中混入其他版本或未知命名的 `SnapText` 安装包。

三平台产物汇总到 `dist/` 后，生成并复核 release manifest：

```bash
python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all --write dist
python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all
```

实机 QA 和签名记录属于本地发布证据，不提交到 Git。首次使用时生成模板到被忽略的 `.release/` 目录，再复制为实际记录并填写：

```bash
python3 scripts/verify_desktop_qa.py --write-example
python3 scripts/verify_release_signing.py --write-example
cp .release/desktop-qa-record.example.json .release/desktop-qa-record.json
cp .release/release-signing-record.example.json .release/release-signing-record.json
```

QA 记录需要覆盖 `screen_recording_permission`、`ui_automation_selection` 和 `wayland_session` 等平台检查项；签名证据至少应记录 macOS `codesign`、`notarytool`、`spctl`，Windows `signtool`，以及 Linux `SHA256SUMS` 和 `AppImage` 校验结果。填写完成后运行：

```bash
python3 scripts/verify_desktop_qa.py .release/desktop-qa-record.json
python3 scripts/verify_release_signing.py .release/release-signing-record.json
python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)"
```

`--release-commit` 必须等于当前 checkout 的 `git rev-parse HEAD`。`--allow-dirty-worktree` 只用于本地进度汇总；正式发布默认要求工作区干净。发布改动提交并推送到 `main` 后，直接运行 `./release.sh v0.1.3` 即可创建并推送版本 tag；GitHub Actions 会在 tag 构建时自动把版本注入 Tauri、Cargo 和 UI 的打包流程，无需额外运行版本脚本。包含新版 workflow 的 tag 若需重跑，流程会先替换旧的 SnapText 安装包资产。已经创建的旧 tag 若不包含这套修复，建议发布新的修正版 tag，避免修改不可变的历史 tag。

## 运行时边界

这些限制用于避免异常输入占用过多资源，也会在发布前由测试覆盖：

- 配置加载、保存和 Tauri 更新命令会规范化用户输入边界：语言、热键、模型目录和翻译 provider 字段会在写入前修剪空白，并迁移已移除的 provider。
- 图片入口会拒绝超过 25 MiB 的原始图片 payload，也会拒绝超过 2400 万像素的解码图片。
- 翻译请求同样有边界保护：单次最多 8 条、单条最多 12,000 字符、总计最多 24,000 字符。

## 项目结构

```text
crates/snaptext-core/      # OCR、翻译、截图、划词、配置和历史记录等核心逻辑
crates/snaptext-tauri/     # Tauri 桌面入口、窗口、托盘、热键和命令
ui/                        # React/Vite 前端源码
models/                    # OCR 模型目录；真实模型文件不提交
scripts/                   # 构建、模型安装、打包和发布检查脚本
.release/                  # 本地发布证据（已忽略，不提交）
```

发布检查项和记录格式由 `scripts/verify_desktop_qa.py --write-example`、`scripts/verify_release_signing.py --write-example` 生成，避免把内部 QA、证书和工件路径公开到仓库。真实 QA/签名记录、构建产物、API key 和模型文件均不应提交。

## 贡献与许可证

- 贡献前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)，其中包含开发约定、测试要求和 Pull Request 检查项。
- Bug 和功能建议请使用仓库中的 GitHub issue 模板；提交日志或配置片段前请先脱敏。
- SnapText 仅使用 [`LICENSE-MIT`](LICENSE-MIT) 许可证发布。
