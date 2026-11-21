# 一步发布：测试 → 打包预览 → npm publish → 打 tag 推送。
# 需要先跑过 `npm login`，并且 git 已经能推送到 GitHub（第一次会弹登录窗口）。
param([switch]$SkipPush)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version

Write-Host "== 1/4 客户端冒烟测试" -ForegroundColor Cyan
node .test/client-check.mjs
if ($LASTEXITCODE -ne 0) { Write-Host "client-check 失败，停止。" -ForegroundColor Red; exit 1 }

Write-Host "== 2/4 打包预览（28 个文件、约 234 kB；模型权重和 models/ 不进包）" -ForegroundColor Cyan
npm pack --dry-run 2>&1 | Select-Object -Last 6

Write-Host "== 3/4 npm publish" -ForegroundColor Cyan
Write-Host "   如果提示 OTP，输入验证器里的 6 位数字" -ForegroundColor DarkGray
npm publish
if ($LASTEXITCODE -ne 0) { Write-Host "发布失败：多半是还没 npm login，或需要 --otp=123456。" -ForegroundColor Red; exit 1 }

if ($SkipPush) {
  Write-Host "== 4/4 已跳过 git 推送" -ForegroundColor Yellow
  exit 0
}

Write-Host "== 4/4 打 tag v$version 并推送" -ForegroundColor Cyan
git tag -f "v$version"
git push origin main
git push origin "v$version"
if ($LASTEXITCODE -ne 0) { Write-Host "git 推送失败：在终端里手动跑 git push，按窗口提示登录 GitHub。" -ForegroundColor Red; exit 1 }

Write-Host "完成：https://www.npmjs.com/package/dsh-live-captions" -ForegroundColor Green
Write-Host "      https://github.com/flashvayne/dsh-live-captions" -ForegroundColor Green
