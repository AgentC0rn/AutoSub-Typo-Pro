# Changelog — AutoSub Typo Pro for CapCut

Tất cả các thay đổi đáng chú ý của dự án được ghi nhận tại đây và đồng bộ lên GitHub Releases.

---

## [v2.0.5] - 2026-11-16

### Tính năng mới (New Features)
- **Hoàn tác / Làm lại (Undo / Redo) toàn diện:**
  - Thêm nút **↶ Hoàn tác** (`Ctrl+Z`) và **↷ Làm lại** (`Ctrl+Y` / `Ctrl+Shift+Z`) ở Bước 3, hỗ trợ tối đa 80 bước lịch sử cho mỗi timeline (giữ riêng lịch sử khi chuyển qua lại giữa các timeline trong project).
  - Ghi nhận lịch sử cho mọi thao tác chỉnh sửa: tách/gộp cụm, nhấn/bỏ nhấn từ, kéo chọn cụm nhấn, đổi kiểu nhấn, sửa/tách từ ở Bản chép lời, đổi font/màu/bộ phối, thanh trượt cỡ chữ & vị trí dọc, animation, bật phát sáng và chuyển chế độ.
- **Áp dụng 1 hoặc nhiều dạng nhấn (`Viết tay`, `Đậm vàng`, `Đậm xanh`) cho nhiều cụm từ trong cùng 1 khung:**
  - Nâng cấp `layout.js` và `capcut-typo.js` hỗ trợ `g.emphases` đa vùng/đa kiểu trong cùng 1 cụm chữ, kể cả khi các từ khác kiểu nằm cùng 1 dòng hoặc tách thành các dòng nhấn riêng biệt.
  - Thêm thanh **Bút nhấn** (`✦ Tự động`, `Viết tay`, `Đậm vàng`, `Đậm xanh`, `✕ Bỏ nhấn`) và thao tác **kéo chuột qua nhiều từ** (hoặc `Shift+bấm`) để nhấn cả cụm từ dài trong 1 lần kéo; phần đầu mỗi thẻ cụm hiển thị nhãn đổi kiểu riêng cho từng vùng nhấn.
- **Nhận dạng Whisper & điều phối ngắt sub tiếng Việt thông minh hơn (`vi-phrases.js`, `whisper.js`, `layout.js`, `srt.js`):**
  - Bổ sung từ điển cụm từ ghép tiếng Việt (`công nghệ`, `hàn băng`, `mát lạnh`, `kỹ thuật`, `triệt lông`, `nang lông`, `khách hàng`, `liệu trình`…), bảo vệ từ chức năng đầu cụm (`ở`, `tại`, `để`, `sau`, `của`, `những`, `các`…) và tiểu từ cuối câu (`nha`, `nhé`, `vậy`…), kết hợp giải thuật **quy hoạch động (DP)** theo khoảng lặng & ranh giới mệnh đề để không còn ngắt trơ từ giữa cụm (`"... Biomatic công | nghệ ..."` → `"ở kỹ thuật triệt Biomatic"` | `"công nghệ hàn băng"` | `"siêu mát lạnh"`).
  - Bổ sung ngữ cảnh `--prompt` + `-sns` cho `whisper-cli.exe` tiếng Việt và tự động sửa một số lỗi đồng âm hay gặp (`siêu mắt lạnh` → `siêu mát lạnh`, `liều trình` → `liệu trình`, `năng lông` → `nang lông`, `Inbook` → `Inbox`, `nhân yêu đã` → `nhận ưu đãi`).

### Sửa lỗi (Bug Fixes)
- **Sửa lỗi lệch cỡ chữ & dính chữ trên `9:16` ở các font có chiều cao `hhea` khác Montserrat (như `SVN-Gilroy Bold/Heavy` trong preset *Cosmic Cyber Neon*, `SVN-Blenda Script`, `Oswald`, `Anton`):**
  - Bổ sung hệ số chuẩn hoá `capcutFontScale(file) = 1.219 / ttf.lineHeight(file, 1)` trong `capcut-typo.js` và đồng bộ trong `drawStage` (`renderer.js`), giúp loại bỏ hiện tượng CapCut PC phóng to `~1.16×–1.22×` gây đè chữ sát nhau trên `SVN-Gilroy` và `SVN-Blenda`.

---

## [v2.0.4] - 2026-11-16

### Sửa lỗi (Bug Fixes)
- **Sửa triệt để lỗi lệch kích thước & chồng chữ khi thêm từ Preview vào CapCut PC (đặc biệt trên khung ngang `4:3`, `16:9` và độ phân giải 720p/1440p/4K):**
  - Đồng bộ hệ quy chiếu cỡ chữ thực tế của CapCut (`capcutUnitPx(W) = W / 216`, thay cho `Math.min(W, H) / 216` trước đây chỉ đúng trên khung dọc `9:16` / vuông `1:1` nhưng khiến khung `4:3` bị CapCut phóng to `1.333×` và `16:9` bị phóng to `1.778×` quanh tâm cố định, gây dính/đè chữ).
  - Bổ sung `refScale(W, H) = Math.min(W, H) / 1080` để cỡ chữ hiển thị giữ nguyên tỉ lệ thẩm mỹ đồng đều trên cả 720p, 1080p, 1440p và 4K ở cả 2 chế độ **Typography nổi bật** và **Sub Phim Ngang** (kèm biên an toàn `0.96×` trong `line_max_width: 0.86` để CapCut không tự xuống dòng ngoài ý muốn).
  - Tính toán toạ độ từ đúng `exactPx = size * unitPx` (loại bỏ sai số làm tròn), tăng khoảng đệm tối thiểu giữa các từ & khi bật viền (`strokes`), giảm độ ép dòng khi có viền để dấu tiếng Việt không chạm nhau.
  - Chuẩn hóa `line-height: 1.05` và `max-width: 86%` cho lớp Preview CSS khớp CapCut; cập nhật `ttf.js` ước lượng ký tự thiếu glyph, và đồng bộ `useLetterColor: true` / `use_effect_default_color: false` / độ dài UTF-16 `range` trong `capcut.js`.

---

## [v2.0.3] - 2026-11-16

### Tính năng mới & Cải tiến
- **Ghi thẳng vào project & timeline đang chọn (không duplicate):**
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
- **Chữ ký số nội bộ `AgentC0rn` & hướng dẫn SmartScreen:**
  - Tích hợp script ký số nội bộ [sign.ps1](scripts/sign.ps1) với chứng chỉ `CN=AgentC0rn` (khóa công khai tại `certs/AgentC0rn.cer` và script cài tin cậy 1-click `certs/Cai-Chung-Chi.bat`).
  - Tự động đính kèm hướng dẫn SmartScreen lần đầu cài đặt vào Release Notes trên GitHub.

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
