# AutoSub Typo Pro for CapCut

Ứng dụng desktop Electron tự động tạo phụ đề & typography cho CapCut PC.

## Phát hành & Cập nhật tự động

- **Repo GitHub:** `AgentC0rn/AutoSub-Typo-Pro`
- **Cập nhật tự động:** `resources/app/shared/core/updater.js` kiểm tra GitHub Releases REST API khi khởi động và hỗ trợ tải bản cập nhật nhanh (`AutoSub-Typo-Pro-Update-vX.Y.Z.zip`) hoặc bộ cài Inno Setup (`AutoSub-Typo-Pro-Setup-X.Y.Z-Win64.exe`).
- **Lệnh phát hành nhanh:**
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1 -Notes "Mô tả thay đổi"
  ```
  *(Thêm `-FullInstaller` nếu muốn đóng gói kèm file cài đặt đầy đủ qua `installer.iss`.)*
- **Lưu ý Git:** Các file runtime Electron (`*.exe`, `*.dll`, `*.pak`, `*.dat`, `*.bin`, `locales/`, `resources/tools/`) được bỏ qua trong `.gitignore` vì vượt giới hạn Git repo và được phân phối qua Release Assets.

## Agent skills

### Issue tracker

Issues live in GitHub (`AgentC0rn/AutoSub-Typo-Pro`). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage labels in GitHub Issues. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo (`GLOSSARY.md` and `docs/adr/`). See `docs/agents/domain.md`.
