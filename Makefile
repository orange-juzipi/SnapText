# SnapText 项目入口：初始化、调试和正式打包。

PYTHON ?= python3
BUN ?= bun
CARGO ?= cargo

TAURI_DIR := crates/snaptext-tauri
LOCAL_CARGO_TAURI := .tools/bin/cargo-tauri
CARGO_TAURI := $(abspath $(LOCAL_CARGO_TAURI))
HOST_SYSTEM := $(shell uname -s 2>/dev/null || echo Windows)

.DEFAULT_GOAL := help
.PHONY: help init dev package

help: ## 显示项目命令。
	@awk 'BEGIN {FS = ":.*##"; printf "SnapText 命令:\n"} /^[a-zA-Z0-9_.-]+:.*##/ {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

init: ## 安装前端依赖、预取 Rust 依赖并安装仓库内 Tauri CLI。
	@command -v $(PYTHON) >/dev/null 2>&1 || { echo "未找到 $(PYTHON)，请先安装 Python 3。"; exit 1; }
	@command -v $(BUN) >/dev/null 2>&1 || { echo "未找到 $(BUN)，请先安装 Bun。"; exit 1; }
	@command -v $(CARGO) >/dev/null 2>&1 || { echo "未找到 $(CARGO)，请先安装 Rust toolchain。"; exit 1; }
	cd ui && $(BUN) install --frozen-lockfile
	$(CARGO) fetch --locked
	@if [ ! -x "$(LOCAL_CARGO_TAURI)" ]; then \
		$(CARGO) install tauri-cli --root .tools --locked; \
	else \
		$(CARGO_TAURI) --version; \
	fi

dev: ## 启动 Tauri 调试模式和 Vite 前端服务。
	@test -x "$(LOCAL_CARGO_TAURI)" || { echo "未初始化项目，请先运行 make init。"; exit 1; }
	cd $(TAURI_DIR) && $(CARGO_TAURI) dev

package: ## 生成当前平台的正式发布包并校验产物。
ifeq ($(HOST_SYSTEM),Darwin)
	$(PYTHON) scripts/package_macos.py --skip-dmg --ad-hoc-sign
else ifeq ($(OS),Windows_NT)
	$(PYTHON) scripts/package_desktop.py --bundles nsis --no-sign
else
	$(PYTHON) scripts/package_desktop.py --bundles deb --no-sign
endif
