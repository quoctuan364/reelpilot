# ReelPilot Studio v1.0 — Auto-Publisher cho YouTube Shorts & Facebook Page Reels

**ReelPilot Studio** là Web Dashboard chạy cục bộ trên máy cá nhân (`Node.js >= 22.5 + node:sqlite WAL`, **0 thư viện ngoài**) giúp bạn nạp video dọc `9:16`, dùng **Gemini AI** viết tiêu đề/mô tả/hashtag, lên lịch tự động đăng lên **YouTube Shorts** và **Facebook Page Reels** qua API chính thức.

---

## Tính năng chính

- **Kéo thả Video 9:16 & Xem trước trực tiếp:** Hỗ trợ `.mp4`, `.mov`, `.webm`, `.mkv` (tối đa 250MB), lưu gọn trong `data/uploads/`.
- **AI Viết Tiêu Đề, Mô Tả & Hashtag (`Gemini 2.5 Flash`):** Nhập chủ đề hoặc kịch bản ngắn → tự động sinh tiêu đề chuẩn `#Shorts`, mô tả có CTA, hashtag và mẹo Hook 3 giây đầu (tự có chế độ **Offline Preview** khi chưa gắn Gemini API Key).
- **Chế độ Chạy Thử An Toàn (`Dry-Run Simulation`):** Cho phép kiểm thử toàn bộ luồng tải video, hẹn giờ, bộ lập lịch 15 giây và nhật ký đăng tải trước khi chuyển sang chế độ **Đăng Thật (`LIVE`)**.
- **YouTube Shorts (YouTube Data API v3):** Hỗ trợ OAuth 2.0 (`access_type=offline` tự làm mới token) và giao thức `Resumable Upload`.
- **Facebook Page Reels (Meta Graph API v21.0):** Hỗ trợ đủ quy trình 3 bước chính thức (`start` → `rupload.facebook.com` → `finish` với `video_state=PUBLISHED`) dành cho **Fanpage Facebook**.
- **Lưu trữ bền vững bằng SQLite WAL (`data/reelpilot.sqlite`):** Giữ nguyên hàng đợi, lịch hẹn, nhật ký hoạt động và cấu hình giữa các lần tắt/mở máy.

---

## Khởi chạy nhanh (1-Click trên Windows)

1. Nhấp đúp file **`start-reelpilot.bat`**.
2. Trình duyệt tự mở địa chỉ **`http://localhost:4330`**.
3. Mặc định hệ thống chạy ở chế độ **`DRY-RUN`** — bạn có thể thử upload video, bấm **AI Viết Tiêu Đề**, đặt lịch và bấm **Đăng ngay** để xem luồng hoạt động ngay lập tức.

---

## Hướng dẫn gắn API thật khi muốn chuyển sang chế độ `LIVE`

### 1. YouTube Shorts (Google Cloud Console)
1. Tạo project tại [Google Cloud Console](https://console.cloud.google.com/) → bật **YouTube Data API v3**.
2. Tạo **OAuth 2.0 Client ID** (loại *Web application*) và thêm Authorized Redirect URI:
   ```text
   http://localhost:4330/api/oauth/youtube/callback
   ```
3. Dán `Client ID` và `Client Secret` vào tab **Kết Nối API & Chế Độ** trong ReelPilot → bấm **Kết nối Google / YouTube OAuth**.

### 2. Facebook Page Reels (Meta for Developers)
> Lưu ý: Meta Graph API chỉ hỗ trợ đăng Reels tự động lên **Facebook Page (Fanpage)**, không hỗ trợ trang cá nhân.
1. Tạo ứng dụng tại [Meta for Developers](https://developers.facebook.com/) → lấy **Page ID** và **Page Access Token** có quyền `pages_manage_posts` và `pages_read_engagement`.
2. Dán vào tab **Kết Nối API & Chế Độ** → bấm **Lưu toàn bộ cấu hình** → bấm **Kiểm tra kết nối API**.

### 3. Gemini API Key (Tùy chọn)
1. Lấy API Key miễn phí tại [Google AI Studio](https://aistudio.google.com/).
2. Dán vào ô **Gemini API Key** trong tab **Kết Nối API & Chế Độ**.
