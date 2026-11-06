# 将旁路 xlsx.full.min.js 内联进 脱敏工具.html（若 HTML 中仍是 src 引用）
$ErrorActionPreference = "Stop"
$htmlPath = Join-Path $PSScriptRoot "脱敏工具.html"
$xlsxPath = Join-Path $PSScriptRoot "xlsx.full.min.js"
$html = [System.IO.File]::ReadAllText($htmlPath)
$tag = '<script src="xlsx.full.min.js"></script>'
if ($html -notmatch [regex]::Escape($tag)) {
  Write-Host "已是内联版本或未找到 script src 标签，跳过。"
  exit 0
}
$xlsx = [System.IO.File]::ReadAllText($xlsxPath)
$inline = "<script>`r`n/* SheetJS Community Edition — see NOTICE (Apache-2.0) */`r`n$xlsx`r`n</script>"
$packed = $html.Replace($tag, $inline)
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($htmlPath, $packed, $utf8)
Write-Host "已打包:" (Get-Item $htmlPath).Length
