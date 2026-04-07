@echo off
chcp 65001 >nul
echo ============================================
echo   UVRA Driver Cleanup Tool
echo ============================================
echo.

set "VRPATH=%LOCALAPPDATA%\openvr\openvrpaths.vrpath"

if not exist "%VRPATH%" (
    echo [!] openvrpaths.vrpath not found: %VRPATH%
    echo     SteamVR might not be installed.
    pause
    exit /b 1
)

echo [i] Current openvrpaths.vrpath:
echo.
type "%VRPATH%"
echo.
echo ============================================

:: Use PowerShell to remove any external_drivers entry containing "opengloves" or "UVRA"
echo [*] Removing driver entries (opengloves / UVRA)...
powershell -NoProfile -Command ^
  "$f = '%VRPATH%'; " ^
  "$data = Get-Content $f -Raw | ConvertFrom-Json; " ^
  "$before = $data.external_drivers.Count; " ^
  "$data.external_drivers = @($data.external_drivers | Where-Object { $_ -notmatch 'opengloves' -and $_ -notmatch 'UVRA' }); " ^
  "$after = $data.external_drivers.Count; " ^
  "$removed = $before - $after; " ^
  "if ($removed -gt 0) { " ^
  "  $data | ConvertTo-Json -Depth 10 | Set-Content $f -Encoding UTF8; " ^
  "  Write-Host \"[OK] Removed $removed driver entry(s).\"; " ^
  "} else { " ^
  "  Write-Host '[i] No matching driver entries found. Already clean.'; " ^
  "}"

echo.
echo [i] Updated openvrpaths.vrpath:
echo.
type "%VRPATH%"
echo.
echo ============================================
echo [OK] Done. Restart SteamVR and reinstall the driver from UVRA.
echo ============================================
pause
