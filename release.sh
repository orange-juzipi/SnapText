#!/usr/bin/env bash
# 创建并推送发布 tag；推送后会触发 GitHub Actions 打包 workflow。

set -euo pipefail

usage() {
  echo "用法: ./release.sh v0.1.0"
}

version="${1:-}"
if [[ -z "$version" ]]; then
  usage
  exit 2
fi

if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "错误: 版本号必须形如 v0.1.0、v1.2.3-rc.1"
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误: 当前目录不是 git 仓库"
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

current_branch="$(git branch --show-current)"
if [[ -z "$current_branch" ]]; then
  echo "错误: 当前处于 detached HEAD，不能直接发布"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "错误: 工作区存在未提交改动，请先提交或暂存后再发布"
  git status --short
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$version" >/dev/null; then
  echo "错误: 本地 tag 已存在: $version"
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$version" >/dev/null 2>&1; then
  echo "错误: 远端 tag 已存在: $version"
  exit 1
fi

echo "准备发布 $version"
echo "分支: $current_branch"
echo "提交: $(git rev-parse --short HEAD)"

git tag -a "$version" -m "发布 $version"
git push origin "$version"

echo "已推送 tag: $version"
echo "GitHub Actions 将自动触发 Package Desktop workflow。"
