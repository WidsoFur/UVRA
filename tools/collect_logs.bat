@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ============================================
echo   UVRA Diagnostics Log Collector
echo ============================================
echo.

:: Resolve project root (parent of tools\)
set "TOOLS_DIR=%~dp0"
pushd "%TOOLS_DIR%.."
set "PROJECT_ROOT=%CD%"
popd

:: Timestamp for output folder: YYYY-MM-DD_HH-MM-SS
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "STAMP=%%t"

set "OUT_DIR=%PROJECT_ROOT%\logs\diagnostics\%STAMP%"
mkdir "%OUT_DIR%" 2>nul
mkdir "%OUT_DIR%\steamvr" 2>nul
mkdir "%OUT_DIR%\steam" 2>nul
mkdir "%OUT_DIR%\uvra" 2>nul
mkdir "%OUT_DIR%\driver" 2>nul
mkdir "%OUT_DIR%\system" 2>nul

echo [i] Output folder: %OUT_DIR%
echo.

:: ---------- 1. Resolve Steam install path via openvrpaths.vrpath ----------
set "VRPATH=%LOCALAPPDATA%\openvr\openvrpaths.vrpath"
set "STEAM_ROOT="

if exist "%VRPATH%" (
    copy /y "%VRPATH%" "%OUT_DIR%\steamvr\openvrpaths.vrpath" >nul
    for /f "usebackq delims=" %%r in (`powershell -NoProfile -Command ^
        "$d = Get-Content '%VRPATH%' -Raw | ConvertFrom-Json; " ^
        "if ($d.runtime) { $rt = $d.runtime[0] -replace '\\\\','\' -replace '/','\'; " ^
        "  Resolve-Path (Join-Path $rt '..\..\..\..') | Select-Object -ExpandProperty Path }"`) do set "STEAM_ROOT=%%r"
)

if defined STEAM_ROOT (
    echo [i] Steam root: %STEAM_ROOT%
) else (
    echo [!] Could not resolve Steam path from openvrpaths. Trying defaults...
    if exist "C:\Program Files (x86)\Steam\logs\vrserver.txt" set "STEAM_ROOT=C:\Program Files (x86)\Steam"
    if exist "D:\Steam\logs\vrserver.txt" set "STEAM_ROOT=D:\Steam"
    if exist "D:\Program Files (x86)\Steam\logs\vrserver.txt" set "STEAM_ROOT=D:\Program Files (x86)\Steam"
)

if not defined STEAM_ROOT (
    echo [!] Steam install not found. Skipping SteamVR/Steam logs.
    goto :skip_steam
)

:: ---------- 2. SteamVR logs ----------
echo [*] Copying SteamVR logs...
set "SVR_LOGS=%STEAM_ROOT%\logs"
if exist "%SVR_LOGS%" (
    for %%F in (vrserver.txt vrserver.txt.previous vrcompositor.txt vrcompositor.txt.previous vrdashboard.txt vrdashboard.txt.previous vrwebhelper.txt webhelper.txt vrmonitor.txt vrstartup.txt) do (
        if exist "%SVR_LOGS%\%%F" copy /y "%SVR_LOGS%\%%F" "%OUT_DIR%\steamvr\" >nul
    )
    :: vrclient_*.txt (pattern)
    for %%F in ("%SVR_LOGS%\vrclient_*.txt") do copy /y "%%F" "%OUT_DIR%\steamvr\" >nul 2>&1
    echo   OK
) else (
    echo   [!] %SVR_LOGS% not found
)

:: ---------- 3. Steam logs ----------
echo [*] Copying Steam core logs...
if exist "%STEAM_ROOT%\logs\content_log.txt" copy /y "%STEAM_ROOT%\logs\content_log.txt" "%OUT_DIR%\steam\" >nul
if exist "%STEAM_ROOT%\logs\stderr.txt"      copy /y "%STEAM_ROOT%\logs\stderr.txt"      "%OUT_DIR%\steam\" >nul
if exist "%STEAM_ROOT%\logs\connection_log.txt" copy /y "%STEAM_ROOT%\logs\connection_log.txt" "%OUT_DIR%\steam\" >nul
echo   OK

:skip_steam

:: ---------- 4. OpenGloves driver settings ----------
echo [*] Copying OpenGloves driver settings...
set "OG_SETTINGS=%PROJECT_ROOT%\opengloves\resources\settings\default.vrsettings"
if exist "%OG_SETTINGS%" copy /y "%OG_SETTINGS%" "%OUT_DIR%\driver\default.vrsettings" >nul

set "OG_PRESETS=%PROJECT_ROOT%\opengloves\resources\settings\pose_presets.json"
if exist "%OG_PRESETS%" copy /y "%OG_PRESETS%" "%OUT_DIR%\driver\pose_presets.json" >nul

:: Check if driver is registered in openvrpaths
if defined STEAM_ROOT (
    powershell -NoProfile -Command ^
        "try { $d = Get-Content '%VRPATH%' -Raw | ConvertFrom-Json; $d.external_drivers } catch {}" > "%OUT_DIR%\driver\registered_external_drivers.txt" 2>nul
)
echo   OK

:: ---------- 5. UVRA app logs + calibrations ----------
echo [*] Copying UVRA app logs and calibrations...
if exist "%PROJECT_ROOT%\logs\uvra.log"        copy /y "%PROJECT_ROOT%\logs\uvra.log"        "%OUT_DIR%\uvra\" >nul
if exist "%PROJECT_ROOT%\logs\raw_data.log"    copy /y "%PROJECT_ROOT%\logs\raw_data.log"    "%OUT_DIR%\uvra\" >nul
:: rotated logs
for %%F in ("%PROJECT_ROOT%\logs\uvra_*.log" "%PROJECT_ROOT%\logs\raw_data_*.log") do (
    if exist "%%F" copy /y "%%F" "%OUT_DIR%\uvra\" >nul 2>&1
)
if exist "%PROJECT_ROOT%\data\calibration_left.json"  copy /y "%PROJECT_ROOT%\data\calibration_left.json"  "%OUT_DIR%\uvra\" >nul
if exist "%PROJECT_ROOT%\data\calibration_right.json" copy /y "%PROJECT_ROOT%\data\calibration_right.json" "%OUT_DIR%\uvra\" >nul
if exist "%PROJECT_ROOT%\firmware\src\config.h"       copy /y "%PROJECT_ROOT%\firmware\src\config.h"       "%OUT_DIR%\uvra\firmware_config.h" >nul
echo   OK

:: ---------- 6. System info ----------
echo [*] Collecting system info...
(
    echo === UVRA Diagnostics Report ===
    echo Timestamp: %STAMP%
    echo Project:   %PROJECT_ROOT%
    echo Steam:     %STEAM_ROOT%
    echo.
    echo === Windows ===
    ver
    echo.
    echo === GPU / OS details ===
) > "%OUT_DIR%\system\summary.txt"

:: Detailed system info (quick subset, don't wait forever)
powershell -NoProfile -Command ^
    "Get-ComputerInfo -Property 'OsName','OsVersion','OsBuildNumber','CsName','CsManufacturer','CsModel','CsTotalPhysicalMemory' | Format-List" ^
    >> "%OUT_DIR%\system\summary.txt" 2>nul

powershell -NoProfile -Command ^
    "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,VideoProcessor,AdapterRAM | Format-List" ^
    >> "%OUT_DIR%\system\gpu.txt" 2>nul

:: Processes related to VR (is SteamVR running? our app?)
powershell -NoProfile -Command ^
    "Get-Process | Where-Object { $_.ProcessName -match 'vr|steam|uvra|opengloves' } | Select-Object Id,ProcessName,StartTime,Path | Format-List" ^
    > "%OUT_DIR%\system\vr_processes.txt" 2>nul
echo   OK

:: ---------- 7. Zip the output ----------
echo.
echo [*] Packing into ZIP...
set "ZIP_FILE=%PROJECT_ROOT%\logs\diagnostics\uvra_diagnostics_%STAMP%.zip"
powershell -NoProfile -Command ^
    "Compress-Archive -Path '%OUT_DIR%\*' -DestinationPath '%ZIP_FILE%' -Force"

if exist "%ZIP_FILE%" (
    echo   OK
    echo.
    echo ============================================
    echo [OK] Diagnostics collected.
    echo.
    echo   Folder: %OUT_DIR%
    echo   Zip:    %ZIP_FILE%
    echo.
    echo   Send the ZIP to the developer.
    echo ============================================
) else (
    echo   [!] Zip failed, but the folder is ready: %OUT_DIR%
)

echo.
pause
endlocal
