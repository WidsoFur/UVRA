#Requires -Version 5.1
# UVRA Diagnostics Log Collector

$ErrorActionPreference = 'Continue'

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "    OK - $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    [!] $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "[i] $msg" -ForegroundColor Gray }

Write-Host "============================================"
Write-Host "  UVRA Diagnostics Log Collector"
Write-Host "============================================"
Write-Host ""

# ---------- Project root = parent of tools/ ----------
$ToolsDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ToolsDir
Write-Info "Project root: $ProjectRoot"

$Stamp   = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$OutDir  = Join-Path $ProjectRoot "logs\diagnostics\$Stamp"
Write-Info "Output:       $OutDir"
Write-Host ""

# Create folders
foreach ($sub in @('steamvr','steam','uvra','driver','system')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $OutDir $sub) | Out-Null
}
Write-OK "Folders created"
Write-Host ""

# ---------- Helper: copy files by wildcard from src to dst ----------
function Copy-Matching {
    param([string]$SrcDir, [string]$DstDir, [string[]]$Patterns, [string]$Label)
    if (-not $SrcDir -or -not (Test-Path $SrcDir)) {
        Write-Warn2 "$Label - source not found: $SrcDir"
        return 0
    }
    $n = 0
    foreach ($p in $Patterns) {
        $files = Get-ChildItem -Path $SrcDir -Filter $p -File -ErrorAction SilentlyContinue
        foreach ($f in $files) {
            try {
                Copy-Item -LiteralPath $f.FullName -Destination $DstDir -Force -ErrorAction Stop
                $n++
            } catch {
                # Likely file locked; try read-and-write fallback
                try {
                    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
                    [System.IO.File]::WriteAllBytes((Join-Path $DstDir $f.Name), $bytes)
                    $n++
                } catch {
                    Write-Warn2 "locked/unreadable: $($f.Name)"
                }
            }
        }
    }
    Write-OK "$Label - $n file(s) from $SrcDir"
    return $n
}

# ---------- 1. Resolve Steam / SteamVR paths ----------
$VrPath     = Join-Path $env:LOCALAPPDATA 'openvr\openvrpaths.vrpath'
$SteamLogs  = $null
$SteamCfg   = $null
$RuntimeDir = $null
$ExternalDrivers = @()

if (Test-Path $VrPath) {
    Copy-Item $VrPath (Join-Path $OutDir 'steamvr\openvrpaths.vrpath') -Force
    try {
        $vp = Get-Content $VrPath -Raw | ConvertFrom-Json
        if ($vp.log)              { $SteamLogs  = $vp.log[0] }
        if ($vp.config)           { $SteamCfg   = $vp.config[0] }
        if ($vp.runtime)          { $RuntimeDir = $vp.runtime[0] }
        if ($vp.external_drivers) { $ExternalDrivers = @($vp.external_drivers) }
    } catch { Write-Warn2 "Failed to parse openvrpaths.vrpath" }
}

# Fallback candidates for Steam logs
$CandidateLogDirs = @(
    $SteamLogs,
    "C:\Program Files (x86)\Steam\logs",
    "C:\Program Files\Steam\logs",
    "D:\Steam\logs",
    "E:\Steam\logs",
    "${env:ProgramFiles(x86)}\Steam\logs",
    "$env:ProgramFiles\Steam\logs"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

if ($CandidateLogDirs.Count -eq 0) {
    Write-Warn2 "No Steam logs directory found"
} else {
    Write-Info "Steam log dirs found:"
    $CandidateLogDirs | ForEach-Object { Write-Info "  $_" }
}
if ($SteamCfg) { Write-Info "Steam config:  $SteamCfg" }
if ($RuntimeDir) { Write-Info "SteamVR runtime: $RuntimeDir" }
Write-Host ""

# ---------- 2. SteamVR logs ----------
Write-Step "SteamVR logs"
$steamvrPatterns = @(
    'vrserver*.txt','vrcompositor*.txt','vrdashboard*.txt','vrmonitor*.txt',
    'vrstartup*.txt','vrwebhelper*.txt','webhelper*.txt','vrclient_*.txt',
    'driver_*.txt','controller*.txt','basestation*.txt','lighthouse*.txt',
    'oculus*.txt','openxr*.txt'
)
foreach ($d in $CandidateLogDirs) {
    Copy-Matching -SrcDir $d -DstDir (Join-Path $OutDir 'steamvr') -Patterns $steamvrPatterns -Label "SteamVR" | Out-Null
}

# ---------- 3. Steam core logs ----------
Write-Step "Steam core logs"
$steamPatterns = @(
    'content_log*.txt','connection_log*.txt','stderr*.txt','bootstrap_log*.txt',
    'cloud_log*.txt','console_log*.txt','compat_log*.txt','cef_log*.txt',
    'gameprocess_log*.txt','appinfo_log*.txt','configstore_log*.txt',
    'parental_log*.txt','systemaudio*.txt','workshop_log*.txt'
)
foreach ($d in $CandidateLogDirs) {
    Copy-Matching -SrcDir $d -DstDir (Join-Path $OutDir 'steam') -Patterns $steamPatterns -Label "Steam" | Out-Null
}

# ---------- 4. SteamVR config ----------
Write-Step "SteamVR config"
if ($SteamCfg -and (Test-Path $SteamCfg)) {
    foreach ($n in @('steamvr.vrsettings','chaperone_info.vrchap','chaperone.vrchap','steamvrdriver.vrsettings')) {
        $p = Join-Path $SteamCfg $n
        if (Test-Path $p) { Copy-Item $p (Join-Path $OutDir 'steamvr') -Force; Write-OK $n }
    }
} else { Write-Warn2 "Steam config dir not resolved" }

# ---------- 5. OpenGloves driver (multiple locations) ----------
Write-Step "OpenGloves driver"

# Gather candidate driver roots
$DriverRoots = @()

# a) From external_drivers registered via vrpath
foreach ($ext in $ExternalDrivers) {
    if ($ext -and (Test-Path $ext)) { $DriverRoots += $ext }
}

# b) Inside SteamVR runtime drivers dir
if ($RuntimeDir) {
    $p = Join-Path $RuntimeDir 'drivers\opengloves'
    if (Test-Path $p) { $DriverRoots += $p }
}

# c) Inside Steam install tree
foreach ($d in $CandidateLogDirs) {
    $steamRoot = Split-Path -Parent $d
    $p = Join-Path $steamRoot 'steamapps\common\SteamVR\drivers\opengloves'
    if (Test-Path $p) { $DriverRoots += $p }
}

# d) Project-local opengloves/
$projOG = Join-Path $ProjectRoot 'opengloves'
if (Test-Path $projOG) { $DriverRoots += $projOG }

$DriverRoots = $DriverRoots | Where-Object { $_ } | Select-Object -Unique
if ($DriverRoots.Count -eq 0) {
    Write-Warn2 "No OpenGloves driver install found"
} else {
    foreach ($root in $DriverRoots) {
        Write-Info "  driver root: $root"
        $subDst = Join-Path $OutDir ('driver\' + (Split-Path $root -Leaf) + '_' + [Math]::Abs($root.GetHashCode()))
        New-Item -ItemType Directory -Force -Path $subDst | Out-Null

        $driverFiles = @(
            (Join-Path $root 'resources\settings\default.vrsettings'),
            (Join-Path $root 'resources\settings\pose_presets.json'),
            (Join-Path $root 'driver.vrdrivermanifest')
        )
        foreach ($f in $driverFiles) {
            if (Test-Path $f) { Copy-Item $f $subDst -Force }
        }
        # driver log subfolder
        $logsSub = Join-Path $root 'logs'
        if (Test-Path $logsSub) {
            Get-ChildItem $logsSub -File -ErrorAction SilentlyContinue | ForEach-Object {
                try { Copy-Item $_.FullName $subDst -Force } catch {}
            }
        }
        # any .log / .txt files in driver root
        Get-ChildItem $root -File -Include *.log,*.txt -ErrorAction SilentlyContinue | ForEach-Object {
            try { Copy-Item $_.FullName $subDst -Force } catch {}
        }
        Write-OK "driver: $root"
    }
}

# Save list of registered external drivers
$ExternalDrivers | Out-File (Join-Path $OutDir 'driver\registered_external_drivers.txt') -Encoding UTF8

# ---------- 6. UVRA app logs + calibrations ----------
Write-Step "UVRA app data"

# Possible UVRA log locations
$UvraLogCandidates = @(
    (Join-Path $ProjectRoot 'logs'),
    (Join-Path $env:APPDATA 'uvra\logs'),
    (Join-Path $env:APPDATA 'UVRA\logs'),
    (Join-Path $env:LOCALAPPDATA 'uvra\logs'),
    (Join-Path $env:LOCALAPPDATA 'UVRA\logs')
) | Where-Object { Test-Path $_ } | Select-Object -Unique

$uvraCount = 0
foreach ($d in $UvraLogCandidates) {
    Get-ChildItem $d -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -match '\.(log|txt)$' -or $_.Name -match '^(uvra|raw_data)'
    } | ForEach-Object {
        try {
            $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
            [System.IO.File]::WriteAllBytes((Join-Path $OutDir "uvra\$($_.Name)"), $bytes)
            $uvraCount++
        } catch { Write-Warn2 "uvra log locked: $($_.Name)" }
    }
}
Write-OK "UVRA logs: $uvraCount file(s)"

# Calibrations & firmware config
$dataDir = Join-Path $ProjectRoot 'data'
foreach ($f in @('calibration_left.json','calibration_right.json','devices.json','pose_offsets.json')) {
    $p = Join-Path $dataDir $f
    if (Test-Path $p) { Copy-Item $p (Join-Path $OutDir 'uvra') -Force; Write-OK $f }
}
$fw = Join-Path $ProjectRoot 'firmware\src\config.h'
if (Test-Path $fw) { Copy-Item $fw (Join-Path $OutDir 'uvra\firmware_config.h') -Force; Write-OK "firmware config.h" }

# ---------- 7. System info ----------
Write-Step "System info"
$summary = Join-Path $OutDir 'system\summary.txt'
@"
=== UVRA Diagnostics Report ===
Timestamp:   $Stamp
Project:     $ProjectRoot
Steam logs:  $($CandidateLogDirs -join '; ')
Steam cfg:   $SteamCfg
Runtime:     $RuntimeDir

"@ | Out-File $summary -Encoding UTF8

try {
    Get-ComputerInfo -Property 'OsName','OsVersion','OsBuildNumber','CsName','CsManufacturer','CsModel','CsTotalPhysicalMemory' |
        Format-List | Out-File $summary -Append -Encoding UTF8
} catch {}

try {
    Get-CimInstance Win32_VideoController |
        Select-Object Name,DriverVersion,VideoProcessor,AdapterRAM |
        Format-List | Out-File (Join-Path $OutDir 'system\gpu.txt') -Encoding UTF8
} catch {}

try {
    Get-Process | Where-Object { $_.ProcessName -match 'vr|steam|uvra|opengloves|vrchat' } |
        Select-Object Id,ProcessName,StartTime,Path |
        Format-List | Out-File (Join-Path $OutDir 'system\vr_processes.txt') -Encoding UTF8
} catch {}

try {
    Get-NetAdapter | Select-Object Name,Status,LinkSpeed,MacAddress |
        Format-Table -AutoSize | Out-File (Join-Path $OutDir 'system\network.txt') -Encoding UTF8
} catch {}

Write-OK "System info collected"

# ---------- 8. Summary: what files ended up where ----------
$manifest = Join-Path $OutDir 'system\manifest.txt'
Get-ChildItem $OutDir -Recurse -File | ForEach-Object {
    "{0,10:N0}  {1}" -f $_.Length, $_.FullName.Substring($OutDir.Length + 1)
} | Out-File $manifest -Encoding UTF8

# ---------- 9. Zip ----------
Write-Host ""
Write-Step "Packing ZIP"
$ZipFile = Join-Path $ProjectRoot "logs\diagnostics\uvra_diagnostics_$Stamp.zip"
try {
    Compress-Archive -Path (Join-Path $OutDir '*') -DestinationPath $ZipFile -Force
    Write-OK "zip: $ZipFile"
} catch {
    Write-Warn2 "Zip failed: $($_.Exception.Message). Folder still available: $OutDir"
}

Write-Host ""
Write-Host "============================================"
Write-Host "[OK] Diagnostics collected" -ForegroundColor Green
Write-Host "  Folder: $OutDir"
Write-Host "  Zip:    $ZipFile"
Write-Host "  Send the ZIP to the developer."
Write-Host "============================================"
