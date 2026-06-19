# SnapText

SnapText 是一款基于 PP-OCRv6 multilingual 的桌面端 OCR 翻译软件，目标平台为 macOS、Windows 和 Linux。

当前仓库已按 `goal/snaptext-desktop-plan.md` 推进实现，已完成可在本机验证的 M0/M1 基础能力，并推进了 M2/M3/M4/M5/M6 的核心代码路径：

- Rust workspace 已建立。
- GitHub Actions CI 已加入 macOS、Windows、Linux 三平台格式检查、React/Vite 前端构建、Python helper 脚本语法检查、单测、clippy 和 workspace build，覆盖 OCR 与翻译 provider 验收脚本的语法检查。
- `snaptext-core` 提供配置、错误、历史记录、PP-OCRv6 det -> cls -> rec 推理骨架、OCR 模型 manifest、图片预处理、截图/划词边界和翻译抽象。
- OCR 到翻译的共享 pipeline 已补充空文本保护：图片/截图 OCR 未检测到可翻译文本时会直接返回 OCR 错误，不再调用翻译服务或写入空历史。
- 翻译结果会拒绝 provider 返回的空译文，历史记录也会拒绝空译文落库，避免截图、图片、划词链路产生无效历史项。
- 配置文件和历史数据库已接入 `directories` 约定目录，配置保存前会统一校验目标语言、热键、翻译服务地址和模型目录。
- 配置加载、保存和 Tauri 更新命令会规范化用户输入边界，自动修剪目标语言、热键、API Key、OpenAI 模型名和自定义模型目录的首尾空白，空 API Key 会落为未配置状态。
- 配置校验会拒绝截图热键和划词热键重复，避免全局热键路由冲突；设置页保存失败时不会替换当前运行配置。
- SQLite 历史记录已覆盖写入、读取、清空和最近 500 条保留策略测试。
- OpenAI-compatible、DeepL、Google、local HTTP 翻译 provider 已具备真实 HTTP 请求实现。
- 翻译请求会统一限制批量和文本长度：单次最多 8 条、单条最多 12,000 字符、总计最多 24,000 字符，避免划词超长文本或 OCR 异常输出直接冲击 provider 限额和桌面响应性。
- 翻译 provider 响应会校验返回条数必须与输入条数一致，且每条译文不能为空，避免多文本翻译顺序/数量契约被破坏。
- 已补充翻译 provider mock HTTP 验收脚本，普通本机环境可验证 OpenAI-compatible、DeepL、Google、local HTTP 四类适配器的请求构造、鉴权 header 和响应解析。
- 截图后端已接入 `xcap`，支持全屏截图、区域截图、截图区域翻译命令边界。
- 截图区域会在捕获前校验非空和当前显示器边界，避免跨显示器/越界框选直接落到 `xcap` 失败路径。
- 前端 overlay 框选坐标会按预览尺寸映射回原始截图尺寸，支持反向拖拽和部分越界裁剪，并拒绝极小或完全越界选区。
- 划词读取已按平台接入 macOS Accessibility、Windows UI Automation、Linux X11/Wayland selection 命令路径。
- 划词文本会统一清理 NUL、CRLF/CR 换行和每行边缘空白，避免不同平台 selection API 的文本格式差异进入翻译请求和历史记录。
- 图片翻译支持选择、拖拽、粘贴图片并复用 OCR + 翻译 + 历史链路。
- 图片输入解码已覆盖 PNG、JPEG、WebP 三种 v1 格式，并对空 base64 payload 返回明确错误。
- Tauri 图片命令入口同时接受纯 base64 和 `data:image/...;base64,...` payload，兼容浏览器 FileReader 原始 data URL 输出。
- Tauri 图片命令入口会拒绝超过 25 MiB 的原始图片 payload，以及超过 2400 万像素的解码图片，避免超大图阻塞桌面 UI 或拖垮 OCR 流程。
- 前端选择、拖拽、粘贴图片前会按 MIME 类型拒绝非 PNG/JPEG/WebP 文件，并显示明确提示。
- `ui/` 提供 React + Vite + Tailwind 4 前端壳，使用 TanStack Router 管理主窗口/历史/设置路由，使用 TanStack Query 管理配置、历史、诊断和翻译 mutation，并覆盖图片入口、结果操作、历史复制/清空、模型校验、桌面能力诊断入口、overlay 框选和 pinned result 独立结果窗口。
- `snaptext-tauri` 提供 Tauri 2 桌面入口、全局热键插件注册、系统托盘菜单、配置更新、历史记录、模型校验、桌面能力诊断、划词翻译、截图翻译、图片翻译，以及 overlay / result 两类辅助窗口调度命令边界。
- 桌面能力诊断会集中报告截图、划词、全局热键和 OCR 模型状态，并按平台给出 macOS Screen Recording/Accessibility、Windows 权限边界、Linux Wayland/X11 工具链和模型文件缺失的处理动作；设置页可复制稳定格式的诊断摘要，便于粘贴到三平台 QA 记录。
- 当前截图翻译、图片翻译、划词翻译产生的结果都可以同步到 pinned result 独立结果窗口。
- pinned result 独立结果窗口入口会校验源类型、源文本、译文和目标语言，避免无效快照覆盖当前结果。
- 当前支持“先翻译、后 Pin”场景：点击 Pin 时会把主窗口当前结果快照立即同步到独立结果窗口。
- pinned result 独立结果窗口会同时显示源类型、目标语言、源文本和译文，并支持基于当前源文本重新翻译。
- 主窗口中的 `Retranslate` 现在也覆盖划词翻译结果，不再只支持截图和图片链路。
- 前端已解析后端结构化错误，OCR 模型缺失、字典为空、ONNX 无法加载、翻译 Key 缺失、截图/划词能力问题可显示为更明确的状态文本。
- 设置页已补齐配置保存状态反馈，保存时会明确显示配置已通过桌面端校验。
- Tauri capability 和正式应用图标已接入，bundle 配置已声明 `icons/icon.png`、`icons/icon.icns` 和 `icons/icon.ico`。
- Tauri bundle 已声明 OCR 模型目录资源映射；真实模型放入 `models/` 后会随安装包分发到资源目录的 `models/` 下。
- 已补充打包与权限说明文档，见 `docs/release-packaging.md`。
- 已补充本地发布前检查脚本，见 `scripts/release_preflight.py`。
- 已补充最终发布门脚本，见 `scripts/release_gate.py`，用于汇总静态预检、真实 OCR 模型、翻译 provider、桌面安装包产物、发布产物 manifest、三平台 QA 记录和签名记录。
- 已补充前端静态资源构建脚本，见 `scripts/build_frontend.py`，用于生成并校验 Tauri `frontendDist` 需要的 React/Vite `ui/dist`。
- 已补充当前平台通用打包脚本，见 `scripts/package_desktop.py`，用于串联前端资源构建、Tauri release build 和当前平台产物验证。
- 已补充 macOS 打包脚本，见 `scripts/package_macos.py`，会校验 release binary、`.app` 主可执行文件、`Info.plist` 和可选 `.dmg` 产物。
- 已补充跨平台安装包产物验证脚本，见 `scripts/verify_desktop_bundles.py`，用于在 macOS/Windows/Linux 实机或 CI 打包后检查原生安装包是否产出且非空。
- 已补充发布产物 manifest 脚本，见 `scripts/generate_release_manifest.py`，用于生成并校验 release 安装包的 `release-manifest.json` 和 `SHA256SUMS`。
- 已补充桌面端实机验收清单和记录校验脚本，见 `docs/desktop-qa-checklist.md` 和 `scripts/verify_desktop_qa.py`，用于发布前记录三平台权限、桌面能力诊断摘要、热键、overlay、截图/划词/图片翻译和安装包验证结果。
- 已补充发布签名/公证记录校验脚本，见 `scripts/verify_release_signing.py`，用于发布前记录 macOS notarization、Windows Authenticode 和 Linux checksums/包签名证据。
- 已补充 OCR 模型交付说明，见 `models/README.md`。设置页 `Validate models` 会检查必要文件、识别字典和 ONNX session 加载状态。
- 已补充真实 OCR smoke test 入口：模型在位后可运行固定图片完整 OCR 流程。
- 已补充 manifest 驱动的 OCR 模型安装脚本，见 `scripts/install_ocr_models.py`，用于下载、SHA-256 校验、落盘和触发真实模型验收。
- 已补充 OCR 模型安装脚本自测，见 `scripts/test_install_ocr_models.py`，使用本地 fake manifest 覆盖下载、hash 校验、拒绝覆盖和 checksum 写入逻辑。
- 已补充真实模型发布验收脚本，见 `scripts/verify_ocr_models.py`。
- 已补充翻译服务发布验收脚本，见 `scripts/verify_translator_providers.py`。
- 已安装本地 Tauri CLI：`.tools/bin/cargo-tauri`，当前验证版本为 `tauri-cli 2.11.3`。
- 已验证 macOS 本地打包：`cargo-tauri build --bundles app --no-sign` 可生成 `.app`，`cargo-tauri build --bundles dmg --no-sign` 可在非沙箱环境生成 `.dmg`。

仍未完成或未验证：

- 仓库未包含真实 PP-OCRv6 multilingual ONNX 模型文件，`models/` 目录仍需放入 `det.onnx`、`cls.onnx`、`rec.onnx`、`rec_dict.txt` 后才能完成真实 OCR 端到端验证。
- 当前已接入独立 overlay 顶层窗口和 pinned result 独立结果窗口，但透明视觉、多显示器定位和不同桌面环境的交互细节仍需在 macOS / Windows / Linux 实机继续收口。
- Windows 和 Linux 代码路径尚未在对应实机环境完成截图、热键、划词验证。
- 安装包签名、平台权限实机验证和发布级打包仍需收口。

## 工程结构

```text
crates/
├── snaptext-core/      # 无 GUI 依赖的业务核心
└── snaptext-tauri/     # Tauri 2 桌面入口
goal/                   # 计划与目标文档
models/                 # PP-OCRv6 ONNX 模型目录
ui/                     # React/Vite 前端应用
```

## 本地验证

桌面开发推荐使用 Tauri CLI，它会按 `tauri.conf.json` 自动启动 React/Vite 前端：

```bash
cd crates/snaptext-tauri
../../.tools/bin/cargo-tauri dev
```

也可以从仓库根目录直接运行 Rust 包。debug 构建会检测 `127.0.0.1:1420`，如果 Vite 未启动，会自动在 `ui/` 内执行 `bun run dev`：

```bash
cargo run -p snaptext-tauri
```

SnapText 免费源默认使用线上地址 `https://translate.snaptext.app`。本地调试服务地址不在设置页暴露，可通过客户端环境变量选择：

```bash
VITE_SNAPTEXT_CLOUD_ENV=local cargo run -p snaptext-tauri
```

```bash
cargo fmt --all -- --check
python3 scripts/build_frontend.py
python3 -m py_compile scripts/build_frontend.py scripts/generate_release_manifest.py scripts/install_ocr_models.py scripts/package_desktop.py scripts/package_macos.py scripts/release_gate.py scripts/release_preflight.py scripts/test_build_frontend.py scripts/test_desktop_bundles.py scripts/test_desktop_qa.py scripts/test_install_ocr_models.py scripts/test_ocr_models.py scripts/test_packaging.py scripts/test_release_gate.py scripts/test_release_manifest.py scripts/test_release_signing.py scripts/test_translator_providers.py scripts/verify_desktop_bundles.py scripts/verify_desktop_qa.py scripts/verify_release_signing.py scripts/verify_translator_providers.py scripts/verify_ocr_models.py
python3 scripts/test_build_frontend.py
python3 scripts/test_install_ocr_models.py
python3 scripts/test_ocr_models.py
python3 scripts/test_packaging.py
python3 scripts/test_desktop_bundles.py
python3 scripts/test_release_gate.py
python3 scripts/test_release_manifest.py
python3 scripts/test_desktop_qa.py
python3 scripts/test_release_signing.py
python3 scripts/test_translator_providers.py
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --workspace
```

翻译 provider 的 mock HTTP 集成验收需要当前环境允许绑定本地 loopback listener。普通桌面开发机上可运行：

```bash
python3 scripts/verify_translator_providers.py
```

该命令会运行默认被 `ignored` 的 provider 级测试，覆盖 OpenAI-compatible、DeepL、Google 和 local HTTP 四类翻译适配器。受限沙箱如果禁止监听 `127.0.0.1`，脚本会明确失败并提示到真实开发机重跑。

生成 Tauri 打包所需前端静态资源：

```bash
python3 scripts/build_frontend.py
```

该命令需要本机安装 `bun`，会在 `ui/` 内运行依赖安装校验和 Vite production build。

发布前静态检查可以运行：

```bash
python3 scripts/release_preflight.py
```

最终发布门会汇总静态预检、真实 OCR 模型、翻译 provider、桌面安装包和三平台 QA 记录：

```bash
python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)"
```

当前开发环境只想查看外部缺口时，可以运行：

```bash
python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)" --skip-static --allow-missing-external --allow-dirty-worktree
```

`--allow-missing-external` 只用于本地进度汇总，不能作为发布通过依据；正式发布必须让 `python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)"` 返回成功。

正式发布门固定要求三平台 bundle 产物，等价于 `python3 scripts/verify_desktop_bundles.py --platform all`。`--bundle-platform <platform>` 只能和 `--allow-missing-external` 一起用于本地诊断单个平台缺口，不能缩小正式发布范围。

`--release-commit` 必须等于当前 checkout 的 `git rev-parse HEAD`；如果传入其他合法 SHA，最终发布门会在运行外部发布检查前失败。

`--dry-run` 未显式传入 `--release-commit` 时会自动使用当前 checkout 的 `git rev-parse HEAD` 填充下游 manifest、QA 和 signing 校验命令，避免 dry-run 输出出现不可发布的 `unknown` commit。

`--allow-dirty-worktree` 只用于本地进度汇总；正式发布默认要求 `git status --porcelain` 为空，确保发布证据和当前 HEAD 完全一致。

当前平台通用 Tauri 打包入口：

```bash
python3 scripts/package_desktop.py --skip-installers
python3 scripts/package_desktop.py
```

`--skip-installers` 只构建 release binary，并在 macOS 上同时要求已有 `.app` bundle；完整命令会按当前平台 Tauri 配置生成原生安装包并运行产物验证。也可以指定当前平台 bundle 类型：

```bash
python3 scripts/package_desktop.py --bundles msi
python3 scripts/package_desktop.py --bundles deb
python3 scripts/package_desktop.py --bundles app --no-sign
```

macOS 本地 Tauri 打包验证：

```bash
python3 scripts/package_macos.py --skip-dmg
python3 scripts/package_macos.py
```

`--skip-dmg` 会验证 release 二进制和 `.app` bundle；完整命令还会生成 `.dmg`。DMG 打包依赖 macOS `hdiutil` 访问磁盘镜像设备；如果在沙箱环境出现 `hdiutil: create failed - 设备未配置`，需要在真实系统权限环境下重跑完整命令。

任一桌面平台完成 Tauri 打包后，可以校验当前平台产物：

```bash
python3 scripts/verify_desktop_bundles.py
```

在只验证 release 二进制和 macOS `.app` 目录、不要求安装包文件时，可运行：

```bash
python3 scripts/verify_desktop_bundles.py --skip-installers
```

该脚本按当前平台检查 release binary、macOS `.app` 目录以及对应安装包是否存在且非空。跨平台全量检查需要先在对应系统完成打包并汇总 `target/release/bundle` 中的安装包产物；`--platform all` 只验证汇总后的 macOS `.dmg`、Windows `.msi`/NSIS `.exe`、Linux `.deb`/`.rpm`/`.AppImage`，不要求三平台 release binary 同时存在。各 bundle 子目录中如果混入其他版本或未知命名的 `SnapText` 安装包，脚本会失败，避免旧版本附件进入发布目录。

汇总三平台安装包产物后，生成并校验发布 manifest：

```bash
python3 scripts/generate_release_manifest.py --write --version 0.1.0 --commit "$(git rev-parse HEAD)"
python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all
```

这会生成并校验 `dist/release-manifest.json` 和 `dist/SHA256SUMS`，用于下载页或 GitHub Release 附件校验；正式发布校验会要求 macOS、Windows、Linux 三个平台和 `.dmg`、`.msi`、NSIS `.exe`、`.deb`、`.rpm`、`.AppImage` 六类附件都存在，且 manifest 与 checksums 内容一致。Manifest 的 `generated_at` 必须是带时区的 ISO-8601 时间，且不能晚于当前 UTC 时间。`dist/` 输出目录必须和 `target/release/bundle` 产物目录分离，脚本会拒绝把 manifest 或 `SHA256SUMS` 写入或读取到 artifact root 内，避免发布产物扫描混入审计文件。Manifest 写入前也会拒绝空安装包、旧版本 `SnapText` 安装包和白名单目录中未知扩展名的 `SnapText` 文件，避免错误附件被带入发布清单。

桌面端实机验收记录模板：

```bash
python3 scripts/verify_desktop_qa.py --write-example
cp docs/desktop-qa-record.example.json docs/desktop-qa-record.json
python3 scripts/verify_desktop_qa.py docs/desktop-qa-record.json
```

`docs/desktop-qa-checklist.md` 列出了 macOS、Windows、Linux 必须覆盖的权限、桌面能力诊断摘要、热键、overlay、截图翻译、划词翻译、图片翻译、安装包和设置持久化场景。正式发布前，`desktop-qa-record.json` 中所有必填项都必须为 `pass`；桌面能力诊断 evidence 必须包含 `[screenshot]`、`[selection]`、`[global_hotkey]` 和 `[ocr_worker]` 四项复制摘要；其他 evidence 也必须包含对应命令、平台能力或功能关键词，例如 `package_desktop.py`、`verify_desktop_bundles.py`、`Screen Recording`、`UI Automation`、`X11` 或 `Wayland`。校验脚本会拒绝未知平台、拼错或额外的检查项、模板占位内容、过短证据、缺失关键词和未来日期，确保 QA 记录可以被机器审计。

发布签名/公证记录模板：

```bash
python3 scripts/verify_release_signing.py --write-example
cp docs/release-signing-record.example.json docs/release-signing-record.json
python3 scripts/verify_release_signing.py docs/release-signing-record.json
```

正式发布前，`release-signing-record.json` 必须记录 macOS Developer ID 签名、公证、staple、Gatekeeper 验证，Windows Authenticode 签名和时间戳，以及 Linux checksums/包签名计划的通过证据；evidence 还必须包含对应命令或产物关键词，例如 `codesign`、`notarytool`、`spctl`、`signtool`、`SHA256SUMS` 和 `AppImage`。涉及发布附件的签名/checksum 项还必须提到本次版本的具体产物名，并覆盖完整附件族：macOS `SnapText_0.1.0_aarch64.dmg`，Windows `SnapText_0.1.0_x64.msi` 和 `SnapText_0.1.0_x64.exe`，Linux `SnapText_0.1.0_amd64.deb`、`SnapText-0.1.0-1.x86_64.rpm` 和 `SnapText_0.1.0_amd64.AppImage`。校验脚本同样会拒绝未知平台、未知检查项、模板占位内容、过短证据、缺失具体产物名和未来日期。

真实 PP-OCRv6 模型放入 `models/` 后，再运行：

```bash
cp models/manifest.example.json models/manifest.json
python3 scripts/install_ocr_models.py --manifest models/manifest.json --model-dir models
python3 scripts/verify_ocr_models.py
SNAPTEXT_OCR_MODEL_DIR=models cargo test -p snaptext-core --test ocr_smoke -- --ignored --nocapture
```

通常优先使用 `scripts/install_ocr_models.py` 从填好 URL 和 SHA-256 的 `manifest.json` 安装模型；安装脚本会保留 `models/manifest.json` 并写入 `models/SHA256SUMS`。正式发布使用 `python3 scripts/verify_ocr_models.py --require-sha256 models`，它会同时校验 `manifest.json`、`SHA256SUMS`、实际文件哈希和 OCR smoke test。后面的 `cargo test` 是等价的底层 smoke test 命令，便于调试。

## 下一步

1. 放入真实 PP-OCRv6 multilingual ONNX 模型和识别字典，运行固定图片 OCR smoke test，验证真实 OCR 输出。
2. 在普通桌面开发机运行 `python3 scripts/verify_translator_providers.py`，完成翻译 provider mock HTTP 验收。
3. 在 macOS/Windows/Linux 实机校验 overlay 窗口、权限诊断文案和多显示器行为。
4. 在 Windows 和 Linux 实机验证截图、热键、划词和构建。
5. 在 Windows 和 Linux 实机运行 `python3 scripts/package_desktop.py` 并用 `python3 scripts/verify_desktop_bundles.py` 复核产物。
6. 按 `docs/desktop-qa-checklist.md` 完成三平台实机验收，并运行 `python3 scripts/verify_desktop_qa.py docs/desktop-qa-record.json`。
7. 在三平台打包后运行 `python3 scripts/verify_desktop_bundles.py` 或汇总产物后运行 `python3 scripts/verify_desktop_bundles.py --platform all`。
8. 生成发布 manifest：`python3 scripts/generate_release_manifest.py --write --version 0.1.0 --commit "$(git rev-parse HEAD)"`，并运行 `python3 scripts/generate_release_manifest.py --manifest dist/release-manifest.json --checksums dist/SHA256SUMS --require-platforms all --require-artifact-kinds all`。
9. 完成安装包签名、公证和发布级打包配置，并运行 `python3 scripts/verify_release_signing.py docs/release-signing-record.json`。
10. 运行 `python3 scripts/release_gate.py --release-commit "$(git rev-parse HEAD)"`，确认所有发布门通过。
