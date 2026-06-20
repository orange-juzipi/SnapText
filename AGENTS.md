# 仓库指南

## 项目结构与模块组织

SnapText 是一个用于桌面 OCR 与翻译应用的 Rust workspace，桌面壳基于 Tauri。核心逻辑位于 `crates/snaptext-core/src`，包含 OCR、翻译、截图、历史记录、配置和 pipeline 模块。React/Vite 前端位于 `ui/`，源码在 `ui/src`，静态构建产物输出到 `ui/dist`。Tauri 桌面入口位于 `crates/snaptext-tauri/src`；权限、图标和配置位于 `crates/snaptext-tauri/`。Python 辅助脚本和发布检查在 `scripts/`。OCR 模型 manifest 在 `models/`；真实模型二进制不要提交。QA 模板在 `docs/`。

## 构建、测试与开发命令

- `cargo fmt --all -- --check`：检查 Rust 格式。
- `python3 scripts/build_frontend.py --dry-run`：检查 React/Vite 前端构建命令连线。
- `cargo test --workspace`：运行 Rust 测试。
- `cargo clippy --workspace --all-targets -- -D warnings`：运行严格 lint。
- `cargo build --workspace`：构建所有 crate。
- `python3 scripts/test_build_frontend.py`：自测前端构建脚本连线。
- `python3 scripts/build_frontend.py`：生成 `ui/dist`；需要 Bun。
- `python3 scripts/release_preflight.py`：运行本地发布前静态检查。
- `python3 scripts/package_desktop.py --skip-installers`：验证当前平台 bundle。

## 代码风格与命名规范

使用 Rust 2024 edition，并保持代码通过 `rustfmt`。Rust 函数、模块和变量使用 snake_case；类型和枚举变体使用 PascalCase。GUI 无关逻辑应放在 `snaptext-core`，不要在其中引入 Tauri 或浏览器依赖。Python 脚本优先使用标准库，文件系统操作使用 `Path`。对不明显的平台行为、OCR 假设和发布规则添加简洁注释。

## 测试规范

Rust 集成测试放在各 crate 的 `tests/` 目录，例如 `crates/snaptext-core/tests/ocr_smoke.rs`。Python 自测使用 `scripts/test_*.py`，环境或发布校验使用 `scripts/verify_*.py`。依赖真实 OCR 模型或桌面能力的测试应保持显式 opt-in。真实 OCR 验证前，设置 `SNAPTEXT_OCR_MODEL_DIR=models`，再运行 ignored smoke test。

## Commit 与 Pull Request 规范

当前历史使用较短的 conventional 风格信息，例如 `docs: add SnapText v1 design spec`。可行时优先使用 `<scope>: <summary>`。执行 `git commit` 时，提交信息使用中文；除非明确要求，不要自动提交，提交应留给人工操作。PR 应说明变更内容、列出已运行的验证命令、关联 issue；涉及 UI、overlay、打包或权限变化时，附截图或 QA 记录。

## 安全与配置提示

不要提交 API Key、签名凭据、真实用户历史数据库或大型模型二进制。发布证据文件应基于 `docs/` 中的示例维护。发布前检查生成产物，例如 `dist/`、`target/` 和 `ui/dist`。
