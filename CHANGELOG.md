# Changelog — AutoSub Typo Pro for CapCut

Tất cả các thay đổi đáng chú ý của dự án được ghi nhận tại đây và đồng bộ lên GitHub Releases.

---

## [v2.0.3] - 2026-11-16

### Tính năng mới & Cải tiến
- **Ghi thẳng vào project & timeline đang chọn (không tạo bản sao):**
  - Bấm **"Ghi thẳng vào CapCut"** sẽ ghi trực tiếp vào chính project và timeline bạn đã chọn từ đầu (tự cập nhật thời gian sửa trong `draft_meta_info.json` và `root_meta_info.json` để project hiển thị mới nhất trong CapCut).
  - Bổ sung tùy chọn **"Thay thế phụ đề AutoSub cũ trong timeline này (khi ghi lại)"** (bật mặc định): mỗi lần chỉnh sửa và ghi lại sẽ thay sạch track AutoSub trước đó mà không chồng nhiều lớp trùng lặp và không chạm vào các track chữ thủ công khác của bạn. Vẫn tự động giữ bản sao lưu `.autosub.bak` trước lần ghi đầu tiên.
- **Chế độ mới: 🎬 Sub Phim Ngang (Horizontal Movie Subtitles):**
  - Thêm nút chuyển đổi 2 chế độ ngay ở Bước 3: **✨ Typography nổi bật** và **🎬 Sub Phim Ngang**.
  - Tự động gom câu thoại cân đối 1–2 dòng ngang theo tỷ lệ khung hình (16:9 ngang hoặc 9:16 dọc), căn giữa ở vùng đáy an toàn (`86%`, chỉnh linh hoạt bằng thanh trượt Vị trí dọc & Cỡ chữ), hỗ trợ xem thử trực tiếp trên khung Preview (kể cả viền chữ và hộp nền mờ).
  - Thêm kiểu chuyển cảnh **"Cắt gọn (kiểu Phim)"** mặc định cho sub ngang (cắt nét chuẩn Netflix/Cinema, hoặc chọn Mờ nhẹ / Lướt êm Cinema).
- **4 Preset Subtitle CapCut mới được tuyển chọn:**
  - **Netflix Cinema Sub:** chữ trắng ngà chuẩn phim, bóng đổ mềm tự nhiên, không viền thô.
  - **Hộp Nền Tối (YouTube / DVD):** chữ trắng trên nền đen mờ bo góc (`background_style: 1`), đọc rõ trên mọi cảnh nền sáng/rối.
  - **CapCut Viral Viền Đậm:** phong cách Alex Hormozi / Shorts với viền đen dày + nhấn vàng neon / cyan.
  - **Phim Điện Ảnh Vàng Cổ Điển:** chữ vàng ấm cổ điển kèm viền đen mảnh sắc nét.
  - Đồng bộ thuộc tính **Viền chữ (`strokes`)** và **Hộp nền (`background_*`)** chuẩn schema CapCut 9.8+ (`check_flag` 23 / 47) cả trên màn hình xem thử lẫn khi xuất vào CapCut.

---

## [v2.0.2] - 2026-11-16

### Tính năng mới
- **Pre-launch OTA Splash:** Kiểm tra và tự động tải/cài bản cập nhật OTA từ GitHub Releases ngay trước khi mở ứng dụng chính (timeout 4.5 giây khi mất mạng, có nút **Bỏ qua, mở ngay** và cơ chế chống lặp `--ota-target`).
- Đóng gói kèm bộ cài đầy đủ `AutoSub-Typo-Pro-Setup-2.0.2-Win64.exe` bằng Inno Setup 6.

---

## [v2.0.1] - 2026-11-16

### Tính năng mới
- Tích hợp cơ chế tự động cập nhật (Auto-Update) qua GitHub Releases REST API (`AutoSub-Typo-Pro-Update-vX.Y.Z.zip` ~1.3 MB và dự phòng `Setup-*.exe`).
- Thêm nút **🔄 Cập nhật** trong giao diện và quy trình phát hành tự động `scripts/release.ps1`.
