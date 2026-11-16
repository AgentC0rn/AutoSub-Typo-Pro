param(
  [string]$Version,
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Bump = 'patch',
  [string]$Notes = '',
  [string]$NotesFile = '',
  [switch]$FullInstaller,
  [switch]$SkipPush,
  [switch]$NoBump
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$PkgPath = Join-Path $Root 'resources\app\package.json'
if (-not (Test-Path $PkgPath)) { throw "Khong tim thay $PkgPath" }

function Refresh-Tool([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "Khong tim thay '$Name' trong PATH." }
  return $cmd.Source
}

$gitExe = Refresh-Tool 'git'
$ghExe = Refresh-Tool 'gh'
$nodeExe = Refresh-Tool 'node'

if (-not $SkipPush) {
  & $ghExe auth status | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Chua dang nhap GitHub CLI. Hay chay 'gh auth login'." }
}

$pkgRaw = Get-Content -Raw -Encoding UTF8 $PkgPath
$pkgObj = $pkgRaw | ConvertFrom-Json
$curVer = [string]$pkgObj.version

if ($NoBump) {
  $Version = $curVer
} elseif (-not $Version) {
  $parts = ($curVer -replace '^v', '') -split '\.'
  $maj = [int]$parts[0]; $min = [int]$parts[1]; $pat = [int]$parts[2]
  switch ($Bump) {
    'major' { $maj++; $min = 0; $pat = 0 }
    'minor' { $min++; $pat = 0 }
    default { $pat++ }
  }
  $Version = "$maj.$min.$pat"
} else {
  $Version = $Version -replace '^v', ''
}

$Tag = "v$Version"
Write-Host "=== Chuan bi phat hanh $Tag (hien tai: v$curVer) ===" -ForegroundColor Cyan

if (-not $SkipPush) {
  $prevErrAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $ghExe release view $Tag 1>$null 2>$null
  $exists = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $prevErrAction
  if ($exists) { throw "Release $Tag da ton tai tren GitHub. Hay chon version khac." }
}

if ($Version -ne $curVer) {
  $pkgObj.version = $Version
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $updatedJson = ($pkgObj | ConvertTo-Json -Depth 10) + "`n"
  [System.IO.File]::WriteAllText($PkgPath, $updatedJson, $utf8NoBom)
  Write-Host "[OK] Cap nhat package.json -> $Version"
}

Write-Host "=== Kiem tra cu phap JavaScript ===" -ForegroundColor Cyan
$jsFiles = Get-ChildItem -Recurse -File -Path (Join-Path $Root 'resources\app') -Filter '*.js'
foreach ($f in $jsFiles) {
  & $nodeExe -c $f.FullName
  if ($LASTEXITCODE -ne 0) { throw "Loi cu phap trong $($f.FullName)" }
}
& $nodeExe -e "const u = require('./resources/app/shared/core/updater.js'); const assert = require('assert'); assert(u.isNewerVersion('v2.0.10', '2.0.2')); assert(!u.isNewerVersion('v2.0.0', '2.0.0'));"
if ($LASTEXITCODE -ne 0) { throw "Kiem tra updater.js that bai" }
Write-Host "[OK] Tat ca $($jsFiles.Count) file JS hop le"

$DistDir = Join-Path $Root 'dist'
if (-not (Test-Path $DistDir)) { New-Item -ItemType Directory -Path $DistDir | Out-Null }

$ZipName = "AutoSub-Typo-Pro-Update-$Tag.zip"
$ZipPath = Join-Path $DistDir $ZipName
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$AppDir = Join-Path $Root 'resources\app'
$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $appFiles = Get-ChildItem -Recurse -File -Path $AppDir
  foreach ($file in $appFiles) {
    $rel = $file.FullName.Substring($Root.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
$zipInfo = Get-Item $ZipPath
if ($zipInfo.Length -le 0) { throw "Dong goi ZIP that bai" }
Write-Host ("[OK] Da tao {0} ({1:N2} MB)" -f $ZipName, ($zipInfo.Length / 1MB))

$Assets = @($ZipPath)

$SignScript = Join-Path $PSScriptRoot 'sign.ps1'

if ($FullInstaller) {
  if (Test-Path $SignScript) {
    & $SignScript -Files @((Join-Path $Root 'AutoSub Typo Pro.exe'))
  }
  $isccCandidates = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
  )
  $iscc = $isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $iscc) { throw "Khong tim thay ISCC.exe (Inno Setup 6)." }
  Write-Host "=== Dang dong goi Full Installer voi Inno Setup 6 ===" -ForegroundColor Cyan
  & $iscc "/DMyAppVersion=$Version" (Join-Path $Root 'installer.iss')
  if ($LASTEXITCODE -ne 0) { throw "ISCC.exe that bai (exit $LASTEXITCODE)" }
  $setupPath = Join-Path $DistDir "AutoSub-Typo-Pro-Setup-$Version-Win64.exe"
  if (-not (Test-Path $setupPath)) { throw "Khong thay file $setupPath sau khi build" }
  if (Test-Path $SignScript) {
    & $SignScript -Files @($setupPath)
  }
  $setupInfo = Get-Item $setupPath
  Write-Host ("[OK] Da tao {0} ({1:N2} MB)" -f $setupInfo.Name, ($setupInfo.Length / 1MB))
  $Assets += $setupPath
}

if ($SkipPush) {
  Write-Host "=== SkipPush bat: dung truoc buoc Git push & GitHub Release ===" -ForegroundColor Yellow
  exit 0
}

Write-Host "=== Commit & Push len GitHub ===" -ForegroundColor Cyan
& $gitExe add -A
$status = & $gitExe status --porcelain
if ($status) {
  & $gitExe commit -m "release: $Tag"
  if ($LASTEXITCODE -ne 0) { throw "git commit that bai" }
}
& $gitExe push -u origin HEAD
if ($LASTEXITCODE -ne 0) { throw "git push that bai" }

Write-Host "=== Dang tao GitHub Release $Tag ===" -ForegroundColor Cyan
$smartScreenNote = @"

---

### Lưu ý khi cài đặt lần đầu trên Windows (SmartScreen)
- Ứng dụng là phần mềm độc lập miễn phí (chưa đăng ký chứng chỉ thương mại Microsoft), nên **lần đầu tiên** chạy bộ cài có thể hiện bảng xanh *"Windows protected your PC"*:
  1. Bấm **`More info`** *(Thông tin thêm)* → chọn **`Run anyway`** *(Vẫn chạy)* — chỉ cần làm **1 lần duy nhất**.
  2. *(Hoặc chuột phải vào file `.exe` vừa tải → **Properties** → tích **Unblock** → **OK**.)*
- Sau khi đã có app trên máy, các bản cập nhật OTA (`.zip`) tự động cập nhật ngay trong app và **không hiện lại cảnh báo này nữa**.
- Nếu dùng nội bộ trong team, chạy file `certs\Cai-Chung-Chi.bat` 1 lần để Windows nhận diện chữ ký số `AutoSub Typo Pro` hợp lệ.
"@

$ghArgs = @('release', 'create', $Tag) + $Assets + @('--title', "AutoSub Typo Pro $Tag")
$tempNotes = $null
try {
  if ($NotesFile -and (Test-Path $NotesFile)) {
    $rawNotes = Get-Content -Raw -Encoding UTF8 $NotesFile
    if ($rawNotes -notmatch 'SmartScreen') { $rawNotes = $rawNotes.TrimEnd() + "`n" + $smartScreenNote }
    $tempNotes = Join-Path $env:TEMP "autosub-rel-notes-$PID.md"
    [System.IO.File]::WriteAllText($tempNotes, $rawNotes, (New-Object System.Text.UTF8Encoding($false)))
    $ghArgs += @('--notes-file', $tempNotes)
  } elseif ($Notes) {
    $rawNotes = $Notes
    if ($rawNotes -notmatch 'SmartScreen') { $rawNotes = $rawNotes.TrimEnd() + "`n" + $smartScreenNote }
    $tempNotes = Join-Path $env:TEMP "autosub-rel-notes-$PID.md"
    [System.IO.File]::WriteAllText($tempNotes, $rawNotes, (New-Object System.Text.UTF8Encoding($false)))
    $ghArgs += @('--notes-file', $tempNotes)
  } else {
    $ghArgs += @('--generate-notes')
  }
  & $ghExe @ghArgs
  if ($LASTEXITCODE -ne 0) { throw "gh release create that bai" }
} finally {
  if ($tempNotes -and (Test-Path $tempNotes)) { Remove-Item -Force $tempNotes -ErrorAction SilentlyContinue }
}

& $ghExe release view $Tag --json url,tagName,assets --jq '{tagName, url, assets: [.assets[] | {name, size}]}'
