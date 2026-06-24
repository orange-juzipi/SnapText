#!/usr/bin/env bash
# 创建并推送发布 tag；推送后会触发 GitHub Actions 打包 workflow。

set -euo pipefail

usage() {
  echo "用法: ./release.sh v0.1.0"
}

github_actions_url() {
  local remote_url repo
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  case "$remote_url" in
    git@github.com:*.git)
      repo="${remote_url#git@github.com:}"
      repo="${repo%.git}"
      echo "https://github.com/$repo/actions/workflows/package.yml"
      ;;
    https://github.com/*.git)
      repo="${remote_url#https://github.com/}"
      repo="${repo%.git}"
      echo "https://github.com/$repo/actions/workflows/package.yml"
      ;;
    https://github.com/*)
      repo="${remote_url#https://github.com/}"
      echo "https://github.com/$repo/actions/workflows/package.yml"
      ;;
  esac
}

previous_release_tag() {
  git describe --tags --abbrev=0 "${version}^" 2>/dev/null || true
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

previous_tag="$(previous_release_tag)"
git tag -a "$version" -m "发布 $version"
git push origin "$version"

actions_url="$(github_actions_url)"

echo "已推送 tag: $version"
echo
echo "本次发布内容:"
echo "- Git tag: $version"
echo "- Source branch: $current_branch"
echo "- Source commit: $(git rev-parse --short HEAD)"
echo "- GitHub Actions workflow: Package Desktop"
echo "- GitHub Release: 自动创建 $version release 页面"
echo "- Release assets: macOS unsigned SnapText.app tar.gz、Windows NSIS .exe"
echo "- macOS note: 未签名/未公证验证包可能被 Gatekeeper 拦截"
echo "- Release notes: 自动生成提交记录和完整更新日志链接"
echo "- Checksums: 自动生成 checksums.txt"
echo
if [[ -n "$previous_tag" ]]; then
  echo "提交记录: $previous_tag..$version"
  git log --oneline "$previous_tag..$version"
else
  echo "提交记录: first release..$version"
  git log --oneline "$version"
fi
if [[ -n "$actions_url" ]]; then
  echo
  echo "查看打包进度: $actions_url"
else
  echo
  echo "GitHub Actions 将自动触发 Package Desktop workflow。"
fi
