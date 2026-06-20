# SnapText 桌面 QA 清单

## 通用检查

每个平台都需要记录 `docs/desktop-qa-record.json`，并在发布前运行：

```bash
python3 scripts/verify_desktop_qa.py docs/desktop-qa-record.json
```

必须覆盖以下通用检查项：

- `package_build`：记录 `package_desktop.py` 或 `cargo-tauri build` 输出。
- `bundle_verification`：记录 `verify_desktop_bundles.py` 对安装包或 bundle 的校验结果。
- `app_launch`：记录安装后启动主窗口的结果。
- `model_validation`：记录 `verify_ocr_models.py`、设置页 Validate models 或 `SHA256SUMS` 校验结果。
- `translator_provider_validation`：记录 `verify_translator_providers.py` 覆盖 OpenAI-compatible、DeepL、Google 和 local HTTP。
- `desktop_capability_diagnostics`：复制设置页桌面能力诊断摘要，证据必须包含 `[screenshot]`、`[selection]`、`[global_hotkey]` 和 `[ocr_worker]`，并使用 `[capability] status - action` 格式。
- `screenshot_translation`：验证截图 OCR 翻译。
- `selection_translation`：验证划词翻译和热键触发。
- `image_translation`：验证选择、拖拽和粘贴图片。
- `global_hotkeys`：验证全局 hotkey 注册、触发和冲突处理。
- `overlay_window`：验证 overlay 框选、反向拖拽和越界裁剪。
- `result_window`：验证 result 独立窗口、复制和 Pin。
- `history`：验证历史记录写入、复制和清空。
- `settings_persistence`：验证设置保存和重启后加载。

## macOS

macOS 额外覆盖：

- `screen_recording_permission`：记录 Screen Recording 权限状态和截图链路结果。
- `accessibility_permission`：记录 Accessibility 权限状态和划词链路结果。
- `dmg_install`：记录 dmg 安装和启动结果。

## Windows

Windows 额外覆盖：

- `ui_automation_selection`：记录 UI Automation selection 在普通窗口中的划词结果。
- `privilege_boundary`：记录普通权限和 elevated/admin 窗口边界。
- `installer_install`：记录 installer 安装、启动和卸载结果。

## Linux

Linux 额外覆盖：

- `x11_session`：记录 X11 下 overlay、selection 和截图结果。
- `wayland_session`：记录 Wayland 下 overlay、selection 和截图结果。
- `selection_tools`：记录 `wl-clipboard`、`xclip` 或 `xsel` 工具可用性。
- `installer_install`：记录 deb/rpm/AppImage 安装或启动结果。
