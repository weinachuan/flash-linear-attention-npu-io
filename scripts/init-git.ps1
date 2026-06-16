Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path ".git")) {
  git init
}

git add .
git commit -m "初始化 flash-linear-attention-npu IO 控制台"

Write-Host "本地 git 仓库已初始化。"
Write-Host "如需创建 GitHub 私有仓库，请安装并登录 GitHub CLI 后执行："
Write-Host "gh repo create flash-linear-attention-npu-io --private --source . --remote origin --push"
