# SnapText 设计规格

> 日期：2026-06-17
> 状态：已批准（待实现）
> 项目代号：SnapText

## 1. 目标与范围

SnapText 是一款基于 PaddlePaddle **PP-OCRv6 multilingual** 模型、面向桌面端（macOS / Windows / Linux）的多模态翻译软件。v1 重点支持：

1. **截图翻译**：用户框选屏幕任意区域，OCR 后整段翻译，结果以浮窗显示。
2. **划词翻译**：用户选中屏幕上任意文本后通过全局热键触发翻译。
3. **图片翻译**：用户拖拽/粘贴图片到应用窗口，识别后整段翻译。

非目标（v1 不做）：

- 屏幕取词（鼠标悬停即时翻译）—— 复杂度高，留待后续迭代。
- 本地翻译模型（仅支持可插拔云服务 / 本地 HTTP）。
- 多用户协作、云同步。
- Linux Wayland 之外所有合成器的完全适配（X11 + 主流 Wayland 合成器为基准）。

## 2. 成功标准

| 维度 | 标准 |
|------|------|
| 功能 | 上述三种模式均端到端可用；翻译结果在 5 秒内（依赖网络）显示 |
| 性能 | OCR 推理单张 1080p 截图 < 1.5 秒（Apple Silicon / M2 基线） |
| 体积 | 安装包 ≤ 80MB（含 ONNX 模型） |
| 平台 | macOS 13+（v1 优先），Windows 10+ / Ubuntu 22.04+（CI 编译通过） |
| 质量 | 核心模块单测覆盖率 ≥ 70%；关键 E2E 用例通过 |

## 3. 技术选型（已确认）

| 领域 | 选型 |
|------|------|
| 客户端语言 | Rust 1.85+（edition 2024） |
| GUI 框架 | Tauri 2.x |
| 前端 | Leptos 0.7 编译为 WASM（嵌入 Tauri WebView） |
| OCR 推理 | `ort` 2.x（ONNX Runtime 绑定） |
| OCR 模型 | PP-OCRv6 multilingual（中文/英文/日文/韩文/法文/德文/俄文等） |
| 翻译服务 | 可插拔：`Translator` trait 抽象 + 至少实现 OpenAI 兼容、DeepL、Google、本地 HTTP |
| 系统托盘 | Tauri 系统托盘（菜单栏常驻） |
| 数据持久化 | SQLite（`rusqlite` bundled），历史记录最近 500 条 |
| 配置 | YAML（`serde_yaml`），目录遵循 `directories` crate 约定 |
| 全局热键 | `tauri-plugin-global-shortcut` |
| 截图 | `xcap`（macOS / Windows / Linux 统一接口） |
| 划词监听 | macOS `accessibility` API / Windows UI Automation / Linux X11 selection + Wayland `wlr-data-control` |
| 异步运行时 | `tokio` 1.x |
| HTTP | `reqwest` 0.12+（`rustls-tls`） |
| 日志 | `tracing` + `tracing-subscriber` |
| 测试 | `cargo test` + `mockito`/`wiremock` + `wasm-bindgen-test` + `tauri::test` |

## 4. 架构

### 4.1 Crate 划分

```
snaptext/                          # Cargo workspace
├── Cargo.toml                     # workspace 根
├── crates/
│   ├── snaptext-core/             # 业务库（无 GUI/Tauri 依赖）
│   ├── snaptext-frontend/         # Leptos 0.7 → WASM
│   └── snaptext-tauri/            # Tauri 2 应用入口
├── ui/                            # Leptos 源码
│   ├── Cargo.toml
│   ├── src/
│   ├── style/                     # CSS
│   └── index.html
├── models/                        # PP-OCRv6 multilingual ONNX
│   ├── det.onnx
│   ├── cls.onnx
│   ├── rec.onnx
│   └── rec_dict.txt
├── goal/                          # plan / 设计产物
└── docs/superpowers/specs/
```

### 4.2 模块职责

#### `snaptext-core`（无 GUI 依赖，可独立单测）

- `ocr`
  - PP-OCRv6 multilingual 三阶段 pipeline：检测（det）→ 方向分类（cls）→ 识别（rec）
  - `OcrEngine::new(model_dir)` 懒加载；`run(image: DynamicImage) -> Result<Vec<TextLine>>`
  - `TextLine { text: String, bbox: BBox, confidence: f32 }`
- `translate`
  - `#[async_trait] pub trait Translator { async fn translate(&self, req: TranslateRequest) -> Result<TranslateResponse>; }`
  - `TranslateRequest { texts: Vec<String>, source: Option<Lang>, target: Lang }`
  - 实现：`OpenAiCompatibleTranslator`、`DeepLTranslator`、`GoogleTranslator`、`LocalHttpTranslator`
  - `TranslatorRegistry`：通过 `config` 选择的当前实例
- `screenshot`
  - `Screencap::new() -> Result<Self>`（按平台选择后端）
  - `capture_full_screen() -> Result<RgbaImage>`
  - `capture_region(bbox) -> Result<RgbaImage>`
  - macOS：`xcap` + 屏幕录制权限检查
- `selection`
  - `SelectionWatcher::new() -> Result<Self>` 后台线程 / tokio 任务
  - 事件流：`SelectionEvent { text: String, app_bundle_id: Option<String> }`
  - macOS：使用 `macos-accessibility-client` 或 `core-foundation` 包装
  - Windows：`uiautomation` crate
  - Linux：X11 `xcb` + Wayland `wlr-data-control` 自动检测
- `hotkey`
  - 在 `core` 中仅暴露 `HotkeyAction` 枚举 + 注册接口；实现委托给 `tauri-plugin-global-shortcut`（在 `snaptext-tauri` 中）
- `history`
  - `HistoryStore::open(path) -> Result<Self>`（rusqlite bundled）
  - `insert(record)`、`recent(limit)`、`clear()`
  - 保留 500 条 FIFO
- `config`
  - `AppConfig { translator: TranslatorConfig, hotkeys: HotkeyConfig, ui: UiConfig, target_lang: Lang, ... }`
  - `load() / save()`，路径 `directories::ProjectDirs::data_dir().join("config.yaml")`
- `error`
  - `pub enum Error { Ocr(OcrError), Translate(TranslateError), Screenshot(ScreenshotError), Selection(SelectionError), History(HistoryError), Config(ConfigError), Io(std::io::Error) }`
  - 实现 `thiserror::Error` + `serde::Serialize`（用于 Tauri 命令返回给前端）

#### `snaptext-frontend`（Leptos → WASM）

- 入口 `lib.rs`：`#[wasm_bindgen(start)]`
- 视图：
  - `Overlay`：截图选区半透明遮罩（接收 `screenshot:ready` 事件、提交 `screenshot:region`）
  - `ResultPanel`：OCR+翻译结果浮窗，固定/可拖拽
  - `Settings`：API Key、热键、目标语言、OCR 模型路径
  - `HistoryView`：最近翻译列表
- 通过 `#[wasm_bindgen]` 函数包装 Tauri `invoke` + `listen`
- 状态管理：`leptos::create_signal` + `create_resource`（加载异步数据）

#### `snaptext-tauri`（应用入口）

- `main.rs`
  - 初始化 `tracing`
  - 加载 `AppConfig`（`snaptext_core::config`）
  - 启动 `tokio` runtime
  - 创建 `OcrEngine`（懒加载，但预热）
  - 创建 `HistoryStore`
  - 创建 `Screencap` / `SelectionWatcher`
  - 创建 Tauri `Builder`：注册命令、注册插件、装载 WASM 入口、创建系统托盘
- Tauri 命令（暴露给 WASM）
  - `screenshot_full() -> Result<ImageMeta>`
  - `translate_region(bbox: BBox) -> Result<TranslationResult>`
  - `translate_selection(text: String) -> Result<TranslationResult>`
  - `translate_image(base64_png: String) -> Result<TranslationResult>`
  - `get_config() / update_config(patch)`
  - `get_history(limit) -> Result<Vec<HistoryRecord>>`
  - `clear_history()`
- Tauri 事件
  - `screenshot:ready` 推送全屏截图元数据
  - `selection:changed` 推送新选中文本
  - `translate:progress` 推送推理/网络进度
  - `translate:done` 推送最终结果
  - `error:occurred` 推送错误

## 5. 数据流

### 5.1 截图翻译

```
用户按 ⌘⇧T (macOS) / Ctrl+Shift+T (Win/Linux)
   → tauri-plugin-global-shortcut 触发
   → core::hotkey 处理为 HotkeyAction::Screenshot
   → snaptext-tauri 调用 core::screenshot::capture_full_screen
   → 写文件到 tempdir + emit "screenshot:ready" { path, width, height }
   → Leptos Overlay 组件显示全屏遮罩 + 框选交互
   → 用户框选完成 → emit "screenshot:region" { x, y, w, h }
   → snaptext-tauri 调用 core::screenshot::capture_region
   → core::ocr::run(image) → Vec<TextLine>
   → 聚合为单个字符串 → core::translate::translate
   → 写入 history → emit "translate:done"
   → Leptos ResultPanel 在光标旁显示
```

### 5.2 划词翻译

```
SelectionWatcher 持续监听
   → emit "selection:changed" { text, source_app }
   → 用户按 ⌘⇧D (划词翻译热键)
   → snaptext-tauri 从当前 selection 拉取文本
   → translate(text) → emit "translate:done"
```

### 5.3 图片翻译

```
用户拖拽/粘贴图片到 ResultPanel / 浮窗
   → 读取为 DynamicImage
   → core::ocr::run → translate → emit "translate:done"
```

## 6. 数据模型

### 6.1 配置

```yaml
# ~/Library/Application Support/snaptext/config.yaml
target_lang: en
ui:
  theme: system
  result_panel_dock: cursor
hotkeys:
  screenshot: "CmdOrCtrl+Shift+T"
  selection: "CmdOrCtrl+Shift+D"
translator:
  provider: openai_compatible  # openai_compatible | deepl | google | local_http
  openai_compatible:
    base_url: https://api.openai.com/v1
    api_key: sk-xxx
    model: gpt-4o-mini
ocr:
  model_dir: bundled  # bundled | <custom path>
  use_gpu: false
```

### 6.2 历史记录（SQLite）

```sql
CREATE TABLE history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  INTEGER NOT NULL,        -- Unix ms
    source      TEXT NOT NULL,           -- 'screenshot' | 'selection' | 'image'
    source_text TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    target_text TEXT NOT NULL,
    image_path  TEXT,                    -- 可选：缩略图路径
    confidence  REAL
);
CREATE INDEX idx_history_created_at ON history(created_at DESC);
```

保留策略：插入时若总数 > 500，删除最早的多余记录。

## 7. 错误处理

- 统一 `snaptext_core::Error`，`thiserror` 派生 `Display` + `Error` + `Serialize`（Tauri 命令边界）
- 错误分类：
  - **可恢复**：网络抖动、用户未选区 → 通知用户重试
  - **配置缺失**：API Key 未填 → 引导至设置页
  - **权限缺失**：屏幕录制/辅助功能 → 引导至系统设置
  - **资源错误**：模型文件损坏 → 提示重新下载（v1 仅打包，重下功能留 v2）
- 所有错误写入 `tracing` 日志到 `$DATA_DIR/logs/snaptext.log`（每日轮转，`tracing-appender`）
- 前端统一通过 `Result<T, JsValue>` 模式处理；`JsValue` 中含 `{ kind, message, hint }`

## 8. 安全与权限

### 8.1 macOS

- `Info.plist`：
  - `NSAppleEventsUsageDescription`：用于划词监听
  - `NSScreenCaptureUsageDescription`：用于屏幕截图
  - `NSDesktopFolderUsageDescription`：用于历史记录缩略图（可选）
- 首次启动检测：
  - `CGPreflightScreenCaptureAccess()` → false 时弹窗引导
  - `AXIsProcessTrusted()` → false 时弹窗引导
  - 提供 `tauri-plugin-shell` 打开 `x-apple.systempreferences:com.apple.preference.security?Privacy_*`

### 8.2 Windows

- 不需要特殊清单声明
- UI Automation 默认可用；UAC 视情况

### 8.3 Linux

- X11：直接访问 selection
- Wayland：通过 `xdg-desktop-portal`（`wlr-data-control` / `screencopy`）自动授权
- AppImage 内置 portal fallback

### 8.4 数据

- API Key 仅存本地配置文件，**永不**通过网络发送（除对应翻译服务）
- 不收集遥测；首次启动显示隐私声明

## 9. 性能

- OCR 引擎使用 `ort::Session::run_async`，不阻塞 UI 线程
- 模型加载懒加载（首次 OCR 时），加载后常驻内存（`OnceCell<Arc<Mutex<...>>>`）
- 截图原始 buffer 处理后立即 drop；临时 PNG 用 `tempfile::tempdir()`
- WASM 端不处理图像数据，仅接收元数据 + 渲染结果
- 推理使用 CPU；macOS 上未来可启用 CoreML EP（`ort` 支持）

## 10. 打包与发布

- `tauri build` 三平台产物：
  - macOS：`.app` + `.dmg`（含公证书 + notarization 步骤在 CI 配置）
  - Windows：`.msi` / `.exe`
  - Linux：`.deb` / `.AppImage`
- 模型文件在 `tauri.conf.json` 的 `bundle.resources` 中声明，随安装包分发
- CI：GitHub Actions matrix（macOS-latest / windows-latest / ubuntu-latest）
- v1 **仅发布 macOS 版本**（按用户决策）；Windows / Linux CI 仅验证编译与单测

## 11. 测试策略

### 11.1 单元测试（`snaptext-core`）

- `ocr`：用 `tests/fixtures/*.png` 跑完整 pipeline，断言识别文本 + 置信度区间
- `translate`：`mockito` / `wiremock` mock HTTP 响应，验证请求构造与响应解析
- `history`：CRUD 往返 + FIFO 限制
- `config`：YAML 往返 + 字段缺省值
- `selection`：注入 trait 抽象（不依赖真实平台 API）以做单测

### 11.2 集成测试

- `snaptext-tauri`：`tauri::test::mock_builder` 测试命令调用、事件流、托盘创建
- 关键 E2E：模拟热键 → 假截图 → 验证翻译事件

### 11.3 WASM 端

- `wasm-bindgen-test` 跑组件 snapshot（精简覆盖）

### 11.4 CI 门槛

- `cargo test --workspace` 全绿
- `cargo clippy --all-targets -- -D warnings`
- `cargo fmt --check`
- 覆盖率：`cargo-llvm-cov` ≥ 70%（`snaptext-core`）

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Leptos 0.7 + Tauri 2 集成资料少 | 构建脚本调试耗时 | 预研阶段产出最小可运行 demo；参考 Tauri 官方 `with-leptos` 例子 |
| PP-OCRv6 multilingual ONNX 算子兼容性 | OCR 失效 | 推理前用小图 fixture smoke test；准备回退到 PP-OCRv4 server 模型 |
| macOS 屏幕录制权限被拒 | 截图不可用 | 启动检测 + 引导；UI 提供"重试权限"按钮 |
| macOS 辅助功能被拒 | 划词不可用 | 同上；提供"复制文本到剪贴板"兜底 |
| Wayland 合成器差异 | Linux 划词/截图失败 | 仅承诺 GNOME/KDE Plasma/Sway 测试通过；其他合成器文档提示 |
| ort crate 升级 ABI 变化 | 编译失败 | 在 plan 中固定 `ort = "2.0.x"` 而非 `2`；CI 锁版本 |

## 13. 里程碑

> v1 仅交付 macOS。Windows / Linux 标注为 v1.1+。

- **M0 - 工程脚手架**（plan 第 1 阶段）：workspace、CI、Tauri+Leptos 最小 demo
- **M1 - 核心能力**（plan 第 2 阶段）：config、history、translate trait + 2 个实现
- **M2 - OCR 集成**（plan 第 3 阶段）：PP-OCRv6 multilingual pipeline + 单测 fixture
- **M3 - 截图翻译**（plan 第 4 阶段）：截图 + 选区 + Overlay UI
- **M4 - 划词翻译**（plan 第 5 阶段）：监听 + 热键
- **M5 - 图片翻译**（plan 第 6 阶段）：拖拽/粘贴 + ResultPanel
- **M6 - 设置/历史 UI**（plan 第 7 阶段）：Leptos 设置页 + 历史视图
- **M7 - 打包发布**（plan 第 8 阶段）：macOS `.dmg` + 公证

## 14. 开放问题

> v1 不解决；记录供未来迭代参考。

- 是否需要支持本地翻译模型（ONNX NLLB / MarianMT）？
- 划词翻译是否要支持"自动取词"（无热键）？
- 是否需要支持自定义 OCR 模型（用户训练或第三方模型）？
- 是否需要支持 PDF 翻译？
