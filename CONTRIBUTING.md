# 参与 SnapText 开发

感谢你为 SnapText 提交问题、文档或代码。提交前请先阅读本文件。不要在公开 issue、Pull Request 或日志中粘贴密钥、设备私钥和用户数据。

## 开发环境

SnapText 是 Rust workspace、Tauri 2 和 React/Vite 应用。开始前请安装：

- Rust toolchain 1.98 或更高版本
- Python 3
- Bun

初始化依赖并安装本地 Tauri CLI：

```bash
make init
```

运行桌面开发模式：

```bash
make dev
```

OCR 模型不在 Git 仓库中。需要验证 Paddle OCR 时，按照 [模型说明](models/README.md) 安装模型，并显式设置 `SNAPTEXT_OCR_MODEL_DIR`。

## 提交前检查

代码变更至少运行与改动相关的检查；涉及跨平台或发布链路时运行完整发布预检：

```bash
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo build --workspace
python3 scripts/test_build_frontend.py
python3 scripts/release_preflight.py
```

真实 OCR smoke test 依赖本地模型，默认不会在普通测试中执行：

```bash
SNAPTEXT_OCR_MODEL_DIR=models cargo test -p snaptext-core --test ocr_smoke -- --ignored --nocapture
```

## 代码约定

- Rust 使用 `rustfmt`，模块、函数和变量使用 `snake_case`，类型使用 `PascalCase`。
- 与 Tauri 或浏览器无关的逻辑放在 `crates/snaptext-core`。
- 新增公开行为时补充测试；平台相关行为、OCR 假设和发布规则用简短注释说明。
- 前端保持 React/Vite 入口和现有 UI 组件约定，不要提交 `ui/dist` 或 `ui/node_modules`。
- 不要提交 API key、签名私钥、真实用户数据、OCR 模型二进制或发布证据原件。

## Pull Request

Pull Request 请说明变更目的、影响范围和已运行的验证命令。涉及界面、窗口、权限、打包或发布流程时，请附截图、复现步骤或 QA 记录。保持每个 PR 聚焦一个主题，避免把无关的格式化或生成物混入变更。

提交信息建议使用简短的 `<scope>: <summary>` 格式，例如 `文档: 更新模型说明`。提交信息使用中文；版本发布流程和门禁以 README 中的“打包与发布”章节为准。
