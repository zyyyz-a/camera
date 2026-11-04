# Strip Blackmagic branding + remove network permissions.
# Rules live in debrand-rules.json (UTF-8) so this script stays pure ASCII.
param(
  [string]$Root = "D:\pojia\mediastorm_re\apktool_out",
  [string]$Rules = "D:\pojia\mediastorm_re\debrand-rules.json"
)

$ErrorActionPreference = "Stop"
$resDir   = Join-Path $Root "res"
$manifest = Join-Path $Root "AndroidManifest.xml"

# 1) backup
$bak = Join-Path $Root "_backup_debrand"
New-Item -ItemType Directory -Force -Path $bak | Out-Null
Get-ChildItem $resDir -Directory -Filter "values*" | ForEach-Object {
  $f = Join-Path $_.FullName "strings.xml"
  if (Test-Path $f) { Copy-Item $f (Join-Path $bak ($_.Name + "_strings.xml")) -Force }
}
Copy-Item $manifest (Join-Path $bak "AndroidManifest.xml") -Force
Write-Host "[1/4] backup -> $bak"

# 2) branding rules
$ruleList = Get-Content -LiteralPath $Rules -Raw -Encoding UTF8 | ConvertFrom-Json
$changed = 0
Get-ChildItem $resDir -Recurse -Filter "strings.xml" | ForEach-Object {
  $c = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
  $orig = $c
  foreach ($r in $ruleList) { $c = $c.Replace([string]$r.from, [string]$r.to) }
  $c = $c -replace ' {2,}', ' '
  if ($c -ne $orig) {
    Set-Content -LiteralPath $_.FullName -Value $c -Encoding UTF8 -NoNewline
    $script:changed++
  }
}
Write-Host "[2/4] strings updated: $changed files"

# 3) drop network / sensitive permissions
$m = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8
$perms = @(
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.READ_PHONE_STATE',
  'android.permission.BLUETOOTH_PRIVILEGED'
)
foreach ($p in $perms) {
  $m = [regex]::Replace($m, '<uses-permission\s+android:name="' + [regex]::Escape($p) + '"[^/]*/>', '')
}
Set-Content -LiteralPath $manifest -Value $m -Encoding UTF8 -NoNewline
Write-Host "[3/4] removed permissions: $($perms -join ', ')"

# 4) verify
Write-Host "[4/4] residual check:"
$left = 0
Get-ChildItem $resDir -Recurse -Filter "strings.xml" | ForEach-Object {
  $c = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
  $n = ([regex]::Matches($c, '(?i)blackmagic')).Count
  if ($n -gt 0) { $left += $n; Write-Host "  $($_.Directory.Name): $n" }
}
Write-Host "  remaining 'blackmagic' in strings: $left"
$hasInet = [bool](Select-String -LiteralPath $manifest -Pattern 'permission.INTERNET' -Quiet)
Write-Host "  INTERNET permission still present: $hasInet"
