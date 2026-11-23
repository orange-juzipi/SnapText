# SnapText 项目入口：初始化、模型安装、调试和正式打包。

PYTHON ?= python3
BUN ?= bun
CARGO ?= cargo

TAURI_DIR := crates/snaptext-tauri
LOCAL_CARGO_TAURI := .tools/bin/cargo-tauri
PADDLE_VENV := .venv-paddle
ifeq ($(OS),Windows_NT)
LOCAL_CARGO_TAURI := $(LOCAL_CARGO_TAURI).exe
PADDLE_PYTHON ?= py -3.12
PADDLE_BIN := $(PADDLE_VENV)/Scripts
PADDLE_EXE := .exe
else
PADDLE_PYTHON ?= python3.12
PADDLE_BIN := $(PADDLE_VENV)/bin
endif
CARGO_TAURI := $(abspath $(LOCAL_CARGO_TAURI))
HOST_SYSTEM := $(shell uname -s 2>/dev/null || echo Windows)
PADDLE_VENV_PYTHON := $(PADDLE_BIN)/python$(PADDLE_EXE)
PADDLEX := $(PADDLE_BIN)/paddlex$(PADDLE_EXE)
OCR_MODEL_FILES := $(addprefix models/,det.onnx cls.onnx rec.onnx rec_dict.txt manifest.json SHA256SUMS)

.DEFAULT_GOAL := help
.PHONY: help init install-onnx dev dev-local package

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

# 已有模型或清单时只做校验，避免覆盖用户选择的模型。
# macOS 的 Python 缺少默认证书文件时，使用系统 CA 证书完成 TLS 校验。
install-onnx: ## 安装并校验 SnapText 的 PaddleOCR ONNX 模型。
	@set -e; \
	if [ -n "$(wildcard $(OCR_MODEL_FILES))" ]; then \
		$(PADDLE_PYTHON) scripts/verify_ocr_models.py --require-sha256 --skip-smoke-test models; \
	else \
		printf '%s\n' '正在准备 PaddleOCR 转换环境，首次运行需要下载依赖。'; \
		if [ ! -x "$(PADDLE_VENV_PYTHON)" ]; then \
			$(PADDLE_PYTHON) -m venv "$(PADDLE_VENV)"; \
		fi; \
		if [ "$(HOST_SYSTEM)" = Darwin ] && [ -z "$${SSL_CERT_FILE:-}" ] && [ -r /etc/ssl/cert.pem ] && \
			"$(PADDLE_VENV_PYTHON)" -c 'import ssl, sys; sys.exit(ssl.get_default_verify_paths().cafile is not None)'; then \
			export SSL_CERT_FILE=/etc/ssl/cert.pem; \
			export PIP_CERT="$${PIP_CERT:-$$SSL_CERT_FILE}"; \
		fi; \
		"$(PADDLE_VENV_PYTHON)" -m pip install -q paddlepaddle paddleocr paddlex; \
		if [ ! -x "$(PADDLE_BIN)/paddle2onnx$(PADDLE_EXE)" ]; then \
			"$(PADDLEX)" --install paddle2onnx; \
		fi; \
		. "$(PADDLE_BIN)/activate"; \
		"$(PADDLE_VENV_PYTHON)" scripts/install_paddleocr_onnx_models.py --paddlex "$(abspath $(PADDLEX))" --skip-smoke-test; \
	fi

dev: ## 启动 Tauri 调试模式和 Vite 前端服务。
	@test -x "$(LOCAL_CARGO_TAURI)" || { echo "未初始化项目，请先运行 make init。"; exit 1; }
	cd $(TAURI_DIR) && $(CARGO_TAURI) dev

dev-local: ## 使用本机 SnapText Cloud（127.0.0.1:8080）启动调试模式。
	@test -x "$(LOCAL_CARGO_TAURI)" || { echo "未初始化项目，请先运行 make init。"; exit 1; }
	cd $(TAURI_DIR) && SNAPTEXT_CLOUD_ENV=local $(CARGO_TAURI) dev

package: ## 生成当前平台的正式发布包并校验产物。
ifeq ($(HOST_SYSTEM),Darwin)
	$(PYTHON) scripts/package_macos.py --skip-dmg --ad-hoc-sign
else ifeq ($(OS),Windows_NT)
	$(PYTHON) scripts/package_desktop.py --bundles nsis --no-sign
else
	$(PYTHON) scripts/package_desktop.py --bundles deb --no-sign
endif
