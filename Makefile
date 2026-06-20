# SnapText 开发命令快捷入口。
#
# 这些目标只封装现有脚本，不重复实现构建逻辑，确保发布和 CI 行为
# 仍然集中维护在 scripts/ 目录中。

PYTHON ?= python3
BUN ?= bun
CARGO ?= cargo

MODEL_DIR ?= models
MODEL_TIER ?= tiny
MODEL_MANIFEST ?= models/manifest.json

# 设置 FORCE=1、NO_SIGN=1、SKIP_VERIFY=1 或 SKIP_SMOKE_TEST=1 可追加对应参数。
FORCE_ARG := $(if $(filter 1 true yes,$(FORCE)),--force,)
NO_SIGN_ARG := $(if $(filter 1 true yes,$(NO_SIGN)),--no-sign,)
SKIP_VERIFY_ARG := $(if $(filter 1 true yes,$(SKIP_VERIFY)),--skip-verify,)
SKIP_SMOKE_ARG := $(if $(filter 1 true yes,$(SKIP_SMOKE_TEST)),--skip-smoke-test,)

TAURI_DIR := crates/snaptext-tauri
LOCAL_CARGO_TAURI := .tools/bin/cargo-tauri
CARGO_TAURI := $(if $(wildcard $(LOCAL_CARGO_TAURI)),$(abspath $(LOCAL_CARGO_TAURI)),cargo-tauri)

.PHONY: help
help: ## 显示可用的 make 目标。
	@awk 'BEGIN {FS = ":.*##"; printf "SnapText make 目标:\n"} /^[a-zA-Z0-9_.-]+:.*##/ {printf "  %-28s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: dev
dev: dev-tauri ## 启动推荐的 Tauri 开发模式。

.PHONY: dev-tauri
dev-tauri: ## 启动 Tauri dev；tauri.conf.json 会启动前端开发服务。
	cd $(TAURI_DIR) && $(CARGO_TAURI) dev

.PHONY: dev-cargo
dev-cargo: ## 使用 cargo run 启动桌面端；debug main 会按需启动 Bun/Vite。
	$(CARGO) run -p snaptext-tauri

.PHONY: dev-local
dev-local: ## 使用本地 SnapText Cloud 后端启动桌面端。
	VITE_SNAPTEXT_CLOUD_ENV=local $(CARGO) run -p snaptext-tauri

.PHONY: ui-dev
ui-dev: ## 只启动 React/Vite 前端开发服务，使用 Bun。
	cd ui && $(BUN) run dev

.PHONY: ui-install
ui-install: ## 使用 Bun 和锁文件安装前端依赖。
	cd ui && $(BUN) install --frozen-lockfile

.PHONY: build-frontend
build-frontend: ## 通过仓库前端构建脚本生成 ui/dist。
	$(PYTHON) scripts/build_frontend.py

.PHONY: build
build: ## 构建整个 Rust workspace。
	$(CARGO) build --workspace

.PHONY: fmt
fmt: ## 格式化 Rust 代码。
	$(CARGO) fmt --all

.PHONY: fmt-check
fmt-check: ## 检查 Rust 格式，不写入修改。
	$(CARGO) fmt --all -- --check

.PHONY: test
test: ## 运行 Rust workspace 测试。
	$(CARGO) test --workspace

.PHONY: test-tauri
test-tauri: ## 运行 Tauri crate 单元测试。
	$(CARGO) test -p snaptext-tauri --lib

.PHONY: clippy
clippy: ## 运行严格 Rust lint 检查。
	$(CARGO) clippy --workspace --all-targets -- -D warnings

.PHONY: preflight
preflight: ## 运行本地发布前检查。
	$(PYTHON) scripts/release_preflight.py

.PHONY: install-tauri-cli
install-tauri-cli: ## 缺少 cargo-tauri 时安装 Tauri CLI 到 .tools。
	$(CARGO) install tauri-cli --root .tools --locked

.PHONY: install-onnx
install-onnx: ## 下载 PaddleOCR 资源、转换为 ONNX，并安装到 MODEL_DIR。
	$(PYTHON) scripts/install_paddleocr_onnx_models.py --tier $(MODEL_TIER) --model-dir $(MODEL_DIR) $(FORCE_ARG) $(SKIP_VERIFY_ARG) $(SKIP_SMOKE_ARG) $(ONNX_ARGS)

.PHONY: install-onnx-manifest
install-onnx-manifest: ## 从 MODEL_MANIFEST 安装已有 ONNX 资源到 MODEL_DIR。
	$(PYTHON) scripts/install_ocr_models.py --manifest $(MODEL_MANIFEST) --model-dir $(MODEL_DIR) $(FORCE_ARG) $(SKIP_VERIFY_ARG) $(ONNX_MANIFEST_ARGS)

.PHONY: verify-onnx
verify-onnx: ## 校验 MODEL_DIR 中的 OCR 模型文件和 SHA256SUMS。
	$(PYTHON) scripts/verify_ocr_models.py $(MODEL_DIR) --require-sha256 $(VERIFY_ONNX_ARGS)

.PHONY: write-onnx-sha
write-onnx-sha: ## 为当前 OCR 模型文件写入 models/SHA256SUMS。
	$(PYTHON) scripts/verify_ocr_models.py $(MODEL_DIR) --write-sha256-manifest $(VERIFY_ONNX_ARGS)

.PHONY: ocr-smoke
ocr-smoke: ## 使用 MODEL_DIR 运行 ignored 真实 OCR smoke test。
	SNAPTEXT_OCR_MODEL_DIR=$(MODEL_DIR) $(CARGO) test -p snaptext-core --test ocr_smoke -- --ignored --nocapture

.PHONY: package
package: ## 构建并校验当前平台桌面安装包。
	$(PYTHON) scripts/package_desktop.py $(NO_SIGN_ARG) $(PACKAGE_ARGS)

.PHONY: package-skip-installers
package-skip-installers: ## 构建并校验 release binary，不生成原生安装包。
	$(PYTHON) scripts/package_desktop.py --skip-installers $(NO_SIGN_ARG) $(PACKAGE_ARGS)

.PHONY: package-bundles
package-bundles: ## 构建指定 Tauri bundle 类型，例如 make package-bundles BUNDLES=dmg NO_SIGN=1。
	@test -n "$(BUNDLES)" || (echo "用法: make package-bundles BUNDLES=app|dmg|msi|deb [NO_SIGN=1]"; exit 2)
	$(PYTHON) scripts/package_desktop.py --bundles $(BUNDLES) $(NO_SIGN_ARG) $(PACKAGE_ARGS)

.PHONY: package-dry-run
package-dry-run: ## 只打印打包命令，不实际执行。
	$(PYTHON) scripts/package_desktop.py --dry-run $(NO_SIGN_ARG) $(PACKAGE_ARGS)
