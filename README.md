# SnapText

SnapText 是一个桌面端 OCR 翻译工具：截图、图片或划词后做 OCR，再把识别文本交给翻译 provider。项目使用 Rust workspace 承载核心逻辑，桌面壳是 Tauri 2，前端是 React + Vite。

目标平台：macOS、Windows、Linux。

## 目录结构

```text
crates/snaptext-core/      # OCR、翻译、截图、划词、配置、历史记录等核心逻辑
crates/snaptext-tauri/     # Tauri 桌面入口、窗口、托盘、热键和命令
ui/                        # React/Vite 前端
models/                    # OCR 模型目录，真实模型文件不提交
scripts/                   # 构建、模型安装、打包和发布检查脚本
docs/                      # 打包、QA、发布记录模板
```

## 环境准备

需要先准备：

- Rust toolchain，项目使用 Rust 2024 edition。
- Python 3。
- Bun，前端构建优先使用 Bun。
- Tauri CLI。仓库内已有本地入口时优先用 `.tools/bin/cargo-tauri`；没有时执行：

```bash
cargo install tauri-cli --root .tools --locked
```

前端依赖由构建脚本自动执行 `bun install --frozen-lockfile`，一般不需要手动进 `ui/` 安装。

## OCR 模型

SnapText 的 Paddle OCR 路径需要 `models/` 下有这四个文件：

```text
models/det.onnx
models/cls.onnx
models/rec.onnx
models/rec_dict.txt
```

真实模型文件不要提交到 Git。仓库只保留 `models/README.md` 和 `models/manifest.example.json`，本地开发或打包时再安装模型。

### 方式一：用 manifest 安装已有 ONNX 模型

如果已经有转换好的模型文件，并且能提供下载地址和 SHA-256，复制示例 manifest 后填入真实值：

```bash
cp models/manifest.example.json models/manifest.json
```

然后安装并校验：

```bash
python3 scripts/install_ocr_models.py --manifest models/manifest.json --model-dir models
```

脚本会下载 `det.onnx`、`cls.onnx`、`rec.onnx`、`rec_dict.txt`，校验 SHA-256，通过后写入 `models/SHA256SUMS`。如果目标目录已有模型文件，需要显式加 `--force`。

### 方式二：从 PaddleOCR 官方模型转换

如果本机要从官方 PaddleOCR 推理模型生成 ONNX，可以使用转换脚本。建议使用 Python 3.12 创建单独环境，不要用太新的 Python 大版本：

```bash
rm -rf .venv-paddle
/usr/local/bin/python3.12 -m venv .venv-paddle
source .venv-paddle/bin/activate
python -m pip install --upgrade pip
python -m pip install paddlepaddle paddleocr paddlex
paddlex --install paddle2onnx
python3 scripts/install_paddleocr_onnx_models.py --tier tiny --skip-smoke-test
```

`--tier tiny` 包体积最小；需要更高精度时可以改成 `small` 或 `medium`。模型细节见 `models/README.md`。

### 校验模型

打包前建议运行：

```bash
python3 scripts/verify_ocr_models.py --require-sha256 models
```

如果只是本地临时放入四个文件，还没有 `SHA256SUMS`，可以先生成：

```bash
python3 scripts/verify_ocr_models.py --write-sha256-manifest models
```

真实 OCR smoke test：

```bash
SNAPTEXT_OCR_MODEL_DIR=models cargo test -p snaptext-core --test ocr_smoke -- --ignored --nocapture
```

桌面应用设置页也有 `Validate models`，用于检查模型文件是否缺失、识别字典是否为空、ONNX session 是否能加载。桌面能力诊断会集中报告截图、划词、全局热键和 OCR 模型状态；遇到模型文件缺失时，设置页可复制稳定格式的诊断摘要用于 QA 或问题反馈。

macOS 运行时默认优先使用系统 Apple Vision OCR，以获得更稳定的真实截图识别效果。需要调试 Paddle/ONNX OCR pipeline 时，可以显式设置：

```bash
SNAPTEXT_OCR_ENGINE=paddle cargo run -p snaptext-tauri
```

配置加载、保存和 Tauri 更新命令会规范化用户输入边界：语言、热键、模型目录和翻译 provider 字段会在写入前修剪空白，已移除的 provider 会迁移到当前默认 provider，避免旧配置在桌面端运行时保留不可用状态。

图片入口会拒绝超过 25 MiB 的原始图片 payload，也会拒绝超过 2400 万像素的解码图片，避免异常截图或拖入图片占用过多内存。翻译请求同样有边界保护：单次最多 8 条、单条最多 12,000 字符、总计最多 24,000 字符。

## 本地开发

推荐直接启动 Tauri 开发模式，它会按 `tauri.conf.json` 启动前端开发服务：

```bash
cd crates/snaptext-tauri
../../.tools/bin/cargo-tauri dev
```

也可以从仓库根目录运行桌面包：

```bash
cargo run -p snaptext-tauri
```

如果只构建前端静态资源：

```bash
python3 scripts/build_frontend.py
```

默认线上服务地址是 `https://snaptext.uuidcx.com`。本地调试云端接口时可以使用：

```bash
VITE_SNAPTEXT_CLOUD_ENV=local cargo run -p snaptext-tauri
```

## 常用检查

日常改代码后常用这几条：

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --workspace
python3 scripts/test_build_frontend.py
python3 scripts/build_frontend.py
```

翻译 provider 的 mock HTTP 验收：

```bash
python3 scripts/verify_translator_providers.py
```

发布前静态检查：

```bash
python3 scripts/release_preflight.py
```

## 打包

当前平台打包走统一脚本：

```bash
python3 scripts/package_desktop.py --skip-installers
python3 scripts/package_desktop.py
```

`--skip-installers` 用于只验证 release binary；完整命令会按当前平台生成安装包。也可以指定当前平台的 Tauri bundle 类型：

```bash
python3 scripts/package_desktop.py --bundles app --no-sign
python3 scripts/package_desktop.py --bundles dmg --no-sign
python3 scripts/package_desktop.py --bundles msi
python3 scripts/package_desktop.py --bundles deb
```

macOS 也可以使用专用脚本：

```bash
python3 scripts/package_macos.py --skip-dmg
python3 scripts/package_macos.py
```

打包脚本会先检查 OCR 模型，再构建 `ui/dist`，最后执行 Tauri release build。Tauri 配置会把 `models/` 打进应用资源目录，所以打包前模型必须在位。

打包后校验当前平台产物：

```bash
python3 scripts/verify_desktop_bundles.py
```

只校验 release binary 和 macOS `.app`，不要求安装包：

```bash
python3 scripts/verify_desktop_bundles.py --skip-installers
```

三平台安装包都汇总后，可以校验完整产物集合：

```bash
python3 scripts/verify_desktop_bundles.py --platform all
```

## 发布产物

生成 release manifest 和校验和：

```bash
python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all --write dist
```

校验已有 manifest：

```bash
python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all
```

桌面 QA 和签名记录校验：

```bash
python3 scripts/verify_desktop_qa.py docs/desktop-qa-record.json
python3 scripts/verify_release_signing.py docs/release-signing-record.json
```

最终发布门：

```bash
python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)"
```

`--release-commit` 必须等于当前 checkout 的 `git rev-parse HEAD`。正式发布不要使用 dirty worktree；`--allow-dirty-worktree` 只用于本地进度汇总。

## 参考文档

- `models/README.md`：OCR 模型安装、转换、校验细节。
- `docs/release-packaging.md`：发布与打包的完整说明。
- `docs/desktop-qa-checklist.md`：三平台桌面 QA 检查项。
