# Скачивает FFmpeg (GPL-сборка с libx264 и libass) и Auto-Editor в tools\, если их там ещё нет.
param([string]$AutoEditorVersion = "29.3.1")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if (-not ((Test-Path tools/ffmpeg/ffmpeg.exe) -and (Test-Path tools/ffprobe/ffprobe.exe))) {
  Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile ffmpeg.zip
  if (Test-Path ffmpeg-dl) { Remove-Item -Recurse -Force ffmpeg-dl }
  Expand-Archive ffmpeg.zip -DestinationPath ffmpeg-dl
  $bin = (Get-ChildItem ffmpeg-dl -Directory | Select-Object -First 1).FullName + "\bin"
  New-Item -ItemType Directory -Force tools/ffmpeg, tools/ffprobe | Out-Null
  Copy-Item "$bin\ffmpeg.exe" tools/ffmpeg/
  Copy-Item "$bin\ffprobe.exe" tools/ffprobe/
  Remove-Item -Recurse -Force ffmpeg-dl, ffmpeg.zip
}
if (-not (Test-Path tools/auto-editor/auto-editor.exe)) {
  New-Item -ItemType Directory -Force tools/auto-editor | Out-Null
  Invoke-WebRequest "https://github.com/WyattBlue/auto-editor/releases/download/$AutoEditorVersion/auto-editor-windows-amd64.exe" -OutFile tools/auto-editor/auto-editor.exe
}
Write-Host "tools: ffmpeg, ffprobe, auto-editor готовы"
