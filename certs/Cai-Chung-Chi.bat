@echo off
chcp 65001 >nul
setlocal
echo ============================================================
echo   Cai dat chung chi tin cay noi bo - AutoSub Typo Pro
echo ============================================================
echo.
set "CER=%~dp0AutoSubTypoPro.cer"
if not exist "%CER%" (
  echo [LOI] Khong tim thay file AutoSubTypoPro.cer trong thu muc nay!
  pause
  exit /b 1
)
echo Dang cai dat chung chi cong khai vao danh sach tin cay cua Windows (CurrentUser)...
echo (Neu Windows hien bang hoi "Security Warning", hay bam YES de xac nhan 1 lan.)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Import-Certificate -FilePath '%CER%' -CertStoreLocation 'Cert:\CurrentUser\Root'; Import-Certificate -FilePath '%CER%' -CertStoreLocation 'Cert:\CurrentUser\TrustedPublisher' | Out-Null; Write-Host '[OK] Da cai chung chi thanh cong. Thumbprint:' $c.Thumbprint -ForegroundColor Green"
if %errorlevel% neq 0 (
  echo [LOI] Chua hoan tat cai chung chi. Thu chay lai hoac chon Yes khi Windows hoi.
  pause
  exit /b 1
)
set "EXE=%~dp0..\AutoSub Typo Pro.exe"
if exist "%EXE%" (
  echo.
  echo Kiem tra chu ky tren AutoSub Typo Pro.exe:
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-AuthenticodeSignature -LiteralPath '%EXE%' | Format-List Status, StatusMessage"
)
echo.
echo Hoan tat! Tu gio may nay se nhan dien chu ky so AutoSub Typo Pro hop le.
pause
