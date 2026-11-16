param(
  [string[]]$Files,
  [switch]$EnsureCertOnly
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent $PSScriptRoot
$CertsDir = Join-Path $Root 'certs'
$CerPath = Join-Path $CertsDir 'AgentC0rn.cer'
$Subject = 'CN=AgentC0rn'

if (-not (Test-Path $CertsDir)) {
  New-Item -ItemType Directory -Path $CertsDir | Out-Null
}

$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Where-Object { $_.Subject -eq $Subject -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $cert) {
  Write-Host "=== Tao chung chi Code Signing noi bo ($Subject) ===" -ForegroundColor Cyan
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -FriendlyName 'AgentC0rn Code Signing' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(5) `
    -CertStoreLocation 'Cert:\CurrentUser\My'
  Write-Host "[OK] Da tao chung chi moi: $($cert.Thumbprint)" -ForegroundColor Green
} else {
  Write-Host "[OK] Dang dung chung chi noi bo: $($cert.Thumbprint) (het han $($cert.NotAfter.ToString('yyyy-MM-dd')))"
}

Export-Certificate -Cert $cert -FilePath $CerPath -Type CERT -Force | Out-Null
Write-Host "[OK] Da xuat chung chi cong khai (public): $CerPath"

if ($EnsureCertOnly) { exit 0 }

if (-not $Files -or $Files.Count -eq 0) {
  $defaultExe = Join-Path $Root 'AutoSub Typo Pro.exe'
  if (Test-Path $defaultExe) { $Files = @($defaultExe) }
}

foreach ($f in $Files) {
  if (-not (Test-Path $f)) {
    Write-Warning "Bo qua file khong ton tai: $f"
    continue
  }
  $sig = $null
  try {
    $sig = Set-AuthenticodeSignature -FilePath $f -Certificate $cert -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
  } catch {
    Write-Warning "Timestamp server khong phan hoi, thu ky khong kem timestamp..."
    $sig = Set-AuthenticodeSignature -FilePath $f -Certificate $cert -HashAlgorithm SHA256
  }
  if ($sig.Status -eq 'UnknownError' -or $sig.Status -eq 'Valid') {
    Write-Host "[OK] Da ky so: $f (Thumbprint: $($sig.SignerCertificate.Thumbprint), Status hien tai: $($sig.Status))" -ForegroundColor Green
  } else {
    throw "Ky so that bai cho ${f}: $($sig.Status) - $($sig.StatusMessage)"
  }
}
