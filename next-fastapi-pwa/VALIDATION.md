# Kết quả kiểm tra — 19/10/2026

## Frontend JavaScript thuần

- Runtime: HTML, CSS và JavaScript ES modules; IndexedDB gốc của trình duyệt. Không còn React, Next.js, TypeScript hoặc thư viện runtime khác.
- `npm test`: 13/13 pass. Kiểm tra outbox offline, coalesce, retry/mất ACK, xóa/tombstone, server-authoritative conflict, health probe, timeout, recovery và chống phản hồi cũ/request chồng chéo.
- `npm run build`: pass với Vite 7.3.7; tạo `dist/`, sourcemap và `sw.js` có phiên bản cache theo nội dung build.
- Chrome headless + API giả lập: thêm công việc, hoàn thành, sửa, render nội dung dưới dạng text; offline reload từ Service Worker; thay đổi offline tồn tại sau reload; conflict hiện đúng bản server và thông báo tên công việc; xóa offline được gửi thành tombstone; không có lỗi JavaScript runtime.
- Kiểm tra tương thích dữ liệu: seed database `sync-lab`, store `state`, key `workspace` theo cấu trúc bản frontend cũ trước khi khởi động bản JS. Công việc cùng mutation pending được đọc, hiển thị và đồng bộ thành công.
- Trong bài test browser với API giả lập, trạng thái network và navigator được điều khiển đồng nhất; route mock không được trả API thành công khi test offline.
- Ảnh giao diện: [demo.png](demo.png).

## Backend Docker

Backend và Docker Compose không thay đổi trong lần refactor frontend này. Kiểm tra trước đó: 8/8 test backend trong container với PostgreSQL thật pass, dùng schema test riêng; `/health` trên máy host trả `{"status":"ok"}`.

Đã xử lý lỗi DNS `db` trước đó: container web đang chạy nhưng không có network endpoint (`NetworkSettings.Networks={}`). Tạo lại riêng web bằng `docker compose up -d --force-recreate web` khôi phục mạng, DNS và port 8000; giữ nguyên volume PostgreSQL.
