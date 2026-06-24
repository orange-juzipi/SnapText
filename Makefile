# SnapText 开发与构建快捷入口。
#
# 这里仅保留日常开发、前端构建、Rust 构建和桌面打包命令。
# 打包逻辑仍集中在 scripts/ 和 Tauri 配置中，Makefile 只做薄封装。

PYTHON ?= python3
BUN ?= bun
CARGO ?= cargo

TAURI_DIR := crates/snaptext-tauri
LOCAL_CARGO_TAURI := .tools/bin/cargo-tauri
CARGO_TAURI := $(if $(wildcard $(LOCAL_CARGO_TAURI)),$(abspath $(LOCAL_CARGO_TAURI)),cargo-tauri)

# 本地无签名构建可使用 NO_SIGN=1；额外参数可通过 PACKAGE_ARGS 透传给打包脚本。
NO_SIGN_ARG := $(if $(filter 1 true yes,$(NO_SIGN)),--no-sign,)
UNSIGNED_LOCAL_CONFIG := '{"bundle":{"createUpdaterArtifacts":false}}'
UNSIGNED_TAURI_ARGS := $(if $(filter 1 true yes,$(NO_SIGN)),--config $(UNSIGNED_LOCAL_CONFIG) --no-sign,)

MACOS_TARGET ?= universal-apple-darwin
WINDOWS_TARGET ?= x86_64-pc-windows-msvc
LINUX_TARGET ?= x86_64-unknown-linux-gnu

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
	SNAPTEXT_CLOUD_ENV=local $(CARGO) run -p snaptext-tauri

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

.PHONY: package
package: package-current ## 构建并校验当前平台桌面安装包。

.PHONY: package-current
package-current: ## 构建并校验当前平台桌面安装包。
	$(PYTHON) scripts/package_desktop.py $(NO_SIGN_ARG) $(PACKAGE_ARGS)

.PHONY: package-no-installer
package-no-installer: ## 构建当前平台 release binary，不生成原生安装包。
	$(PYTHON) scripts/package_desktop.py --skip-installers $(NO_SIGN_ARG) $(PACKAGE_ARGS)

.PHONY: package-bundles
package-bundles: ## 构建当前平台指定 Tauri bundle，例如 make package-bundles BUNDLES=dmg NO_SIGN=1。
	@test -n "$(BUNDLES)" || (echo "用法: make package-bundles BUNDLES=app|dmg|msi|deb|rpm|appimage [NO_SIGN=1]"; exit 2)
	$(PYTHON) scripts/package_desktop.py --bundles $(BUNDLES) $(NO_SIGN_ARG) $(PACKAGE_ARGS)

.PHONY: package-macos
package-macos: build-frontend ## 构建 macOS 目标；默认 universal-apple-darwin，可覆盖 MACOS_TARGET。
	cd $(TAURI_DIR) && $(CARGO_TAURI) build --target $(MACOS_TARGET) $(UNSIGNED_TAURI_ARGS)

.PHONY: package-windows
package-windows: build-frontend ## 构建 Windows 目标；默认 x86_64-pc-windows-msvc，可覆盖 WINDOWS_TARGET。
	cd $(TAURI_DIR) && $(CARGO_TAURI) build --target $(WINDOWS_TARGET) $(UNSIGNED_TAURI_ARGS)

.PHONY: package-linux
package-linux: build-frontend ## 构建 Linux 目标；默认 x86_64-unknown-linux-gnu，可覆盖 LINUX_TARGET。
	cd $(TAURI_DIR) && $(CARGO_TAURI) build --target $(LINUX_TARGET) $(UNSIGNED_TAURI_ARGS)

.PHONY: package-all-platforms
package-all-platforms: package-macos package-windows package-linux ## 依次构建 macOS、Windows 和 Linux 目标。

.PHONY: package-dry-run
package-dry-run: ## 只打印当前平台打包命令，不实际执行。
	$(PYTHON) scripts/package_desktop.py --dry-run $(NO_SIGN_ARG) $(PACKAGE_ARGS)

.PHONY: install-tauri-cli
install-tauri-cli: ## 缺少 cargo-tauri 时安装 Tauri CLI 到 .tools。
	$(CARGO) install tauri-cli --root .tools --locked
