# Todo Sync Lab — JavaScript thuần + FastAPI + PostgreSQL + PWA

Frontend dùng HTML, CSS và JavaScript ES modules, không có React, Next.js hay TypeScript. Vite chạy server phát triển có hot reload và build các file tĩnh. FastAPI + PostgreSQL chạy trong Docker như trước.

## Chạy để debug

Yêu cầu: Node.js 20.19+ hoặc 22.12+, npm, Docker và Docker Compose. Cổng 3000, 8000, 5432, 5678 cần còn trống.

Trong thư mục `next-fastapi-pwa`:

```bash
docker compose up --build -d
docker compose logs -f web
```

Nếu tài khoản chưa có quyền Docker, thêm `sudo` vào lệnh Docker. Mở terminal khác:

```bash
cd frontend
npm install
npm run dev
```

- Giao diện: http://localhost:3000
- API/Swagger: http://localhost:8000/docs
- Health: http://localhost:8000/health
- Snapshot database: http://localhost:8000/tasks

Dừng frontend cũ bằng Ctrl+C trước khi chuyển sang lệnh mới. Vite giữ cổng 3000 cố định; nếu đang bị chiếm sẽ báo lỗi để tránh vô tình đổi origin và kho dữ liệu local.

Sửa HTML/JavaScript → Vite tự tải lại trang; sửa CSS → cập nhật CSS. Sửa Python → Uvicorn reload nhờ bind mount. Không cần build lại Docker trừ khi đổi dependencies/Dockerfile.

API mặc định là `http://localhost:8000`. Copy `frontend/.env.example` thành `frontend/.env.local` và sửa `VITE_API_URL` nếu cần. Restart dev server hoặc build lại sau khi đổi biến môi trường.

## Cấu trúc frontend

```text
frontend/
├── index.html              Khung giao diện và template công việc
├── src/
│   ├── main.js             Khởi động, sự kiện DOM, điều phối sync
│   ├── view.js             Render DOM, trạng thái, thông báo và nhật ký
│   ├── storage.js          IndexedDB gốc: đọc/ghi và chờ transaction commit
│   ├── sync.js             Task, outbox, push/pull, conflict
│   ├── connection.js       Probe /health, timeout, tránh request chồng chéo
│   ├── config.js           API URL, chu kỳ kiểm tra/sync
│   ├── pwa.js              Đăng ký Service Worker cho bản build
│   └── styles.css          Giao diện
├── service-worker.js       Mẫu worker, Vite điền cache version và danh sách file
├── public/                 Manifest, icon
├── tests/                  Node test + fake IndexedDB
└── vite.config.js          Cổng, sourcemap, tạo worker cache các file đã build
```

Không có thư viện chạy trong trình duyệt. Vite và fake-indexeddb chỉ là dev dependencies. Database trình duyệt vẫn dùng `sync-lab`, store `state`, key `workspace`, nên dữ liệu từ bản Next.js cũ được giữ khi dùng cùng origin `http://localhost:3000`.

Tên thư mục dự án được giữ để không đổi Docker Compose project và volume PostgreSQL.

## Luồng xử lý

```text
Sự kiện DOM (submit / click)
  → main.js gọi editTask()
  → ghi task + outbox nguyên tử vào IndexedDB
  → phát sync-state → view.js cập nhật DOM
  → nếu gọi được backend: POST /sync/push
  → FastAPI kiểm tra mutationId và baseVersion trong transaction
      đúng version → commit PostgreSQL, tăng version → HTTP 200
      sai version → HTTP 409 kèm bản server
  → nhận ACK: xóa mutation đã gửi khỏi outbox
  → conflict: bỏ thay đổi bị từ chối, dùng bản server, thông báo tên công việc
  → GET /tasks để pull snapshot (gồm tombstone)
  → lưu IndexedDB → render DOM
```

- PostgreSQL là nguồn dữ liệu chính thức.
- `baseVersion=0` tạo mới; sửa/xóa phải khớp version server.
- UUID phân biệt task/mutation; retry cùng mutation không ghi trùng khi mất phản hồi.
- IndexedDB lưu cả dữ liệu local, outbox và thông báo conflict trong một lần commit.
- Outbox gộp các thay đổi chưa gửi trên cùng công việc. Xóa lưu `deleted=true` để đồng bộ sau khi online.
- Web Locks tuần tự hóa các lần sửa/sync giữa các tab cùng origin. Hai tab cùng trình duyệt chia sẻ dữ liệu và outbox.
- Conflict báo tên công việc và tự render bản server; nếu server đã xóa thì bỏ khỏi danh sách. **Đã hiểu** chỉ đóng thông báo.
- Pull dùng snapshot đầy đủ cho demo nhỏ. Backend dùng PostgreSQL advisory transaction lock để kiểm tra version/ghi/nhớ mutation nguyên tử.
- Sync sau thao tác, khi kết nối phục hồi và mỗi 15 giây lúc app đang mở. Khi đóng app, outbox được giữ để lần mở tiếp theo xử lý.
- Đây là workspace demo dùng chung, chưa có đăng nhập/phân quyền.

## Trạng thái kết nối

`config.js` đặt chu kỳ kiểm tra là **500 ms**. `connection.js` gọi `/health` không cache, timeout 4 giây. Các lần kiểm tra dùng chung request đang chạy để tránh hủy liên tục request chậm.

- **Đang kiểm tra kết nối**: chưa có kết quả.
- **Online**: API trả HTTP thành công và `{status: 'ok'}`.
- **Offline**: trình duyệt báo mất mạng.
- **Không kết nối được máy chủ**: API lỗi/timeout hoặc không thể truy cập khi trình duyệt chưa báo offline.

Ngoài timer, app kiểm tra khi online/offline, focus hoặc quay lại tab. Online nghĩa là kết nối được API, không chứng minh có Internet; localhost vẫn chạy khi tắt Wi-Fi.

## Demo offline và conflict

Trong DevTools → Network → chọn Offline để chặn mạng của tab, rồi thử thêm/sửa/xóa. Chọn lại No throttling: app kiểm tra kết nối và gửi hàng đợi. Nếu API dừng thì dữ liệu vẫn được giữ trong IndexedDB.

Muốn giả lập hai thiết bị độc lập, dùng cửa sổ thường A và cửa sổ ẩn danh B:

1. A tạo công việc, B sync để nhận cùng version.
2. B offline rồi sửa công việc.
3. A sửa và sync cùng công việc lên server.
4. B online lại: nhận HTTP 409, báo tên công việc, tự hiển thị bản server.
5. Bấm Đã hiểu để đóng thông báo; có thể sửa tiếp từ version mới.

Nếu dùng hai tab thường, tab online có thể gửi outbox do tab offline tạo vì cùng IndexedDB.

Đọc trực tiếp database:

```bash
docker compose exec db psql -U todo -d todo -c 'SELECT id, title, completed, deleted, version FROM tasks ORDER BY updated_at DESC;'
```

## PWA và reload khi offline

Chế độ dev không đăng ký worker để cache không ảnh hưởng hot reload. Trang đang mở vẫn thao tác offline được; để reload offline, dùng bản build:

```bash
cd frontend
npm run build
npm run start
```

`build` tạo `dist/`; `start` dùng Vite preview ở cổng 3000 để demo bản build. Khi triển khai thật, phục vụ `dist/` bằng static hosting có HTTPS.

1. Mở http://localhost:3000 ở No throttling.
2. Chờ nhật ký **PWA sẵn sàng.**
3. Application → Service Workers: bỏ chọn Bypass for network nếu đang bật.
4. Network → Offline, reload trang.

`vite.config.js` tự đưa HTML/JS/CSS/icon vào danh sách precache của `dist/sw.js`, tạo cache version theo nội dung build. Worker install cache toàn bộ app, activate xóa cache cũ của dự án và claim trang. Điều hướng thử mạng trước rồi fallback HTML cache; JS/CSS/icon lấy cache trước. API đi thẳng mạng, không bị worker cache. Không cần gửi WARM_CACHE như bản Next.js trước.

Khi trở lại dev, dừng preview và chạy `npm run dev`. Code dev gỡ worker của dự án. Nếu thấy giao diện cũ, mở online và Unregister worker rồi reload; không Clear site data nếu muốn giữ IndexedDB.

## Đặt breakpoint

Mở thư mục `next-fastapi-pwa` trong VS Code. Cấu hình `.vscode/launch.json` có **Frontend JavaScript** để mở Chrome và **FastAPI in Docker** để attach port 5678 (cần Python Debugger extension).

| Tình huống | File / hàm |
|---|---|
| Nhận click/submit | `frontend/src/main.js` → listener task-form / task-list |
| Thêm/sửa/xóa local | `frontend/src/sync.js` → `editTask()` |
| IndexedDB commit | `frontend/src/storage.js` → `transaction()` và `tx.oncomplete` |
| Gửi thay đổi | `frontend/src/sync.js` → vòng for trong `sync()` |
| Backend nhận request | `backend/app/main.py` → `push()` |
| Kiểm tra phiên bản | `push()` → so sánh version và baseVersion |
| Nhận conflict | `sync()` → HTTP 409 |
| Render kết quả | `frontend/src/view.js` → `renderState()` |
| Kiểm tra kết nối | `frontend/src/connection.js` → `check()` |
| Offline assets | `frontend/service-worker.js` / worker `sw.js` trong DevTools |

Bản build có sourcemap để debug các module JS nguồn. Request sync timeout 8 giây: dừng breakpoint backend lâu sẽ khiến frontend giữ outbox và thử lại sau. Attach debugger lại nếu phiên bị ngắt khi Python reload.

## Kiểm tra và dừng

Frontend:

```bash
cd frontend
npm test
npm run build
```

Backend (schema test riêng, không dùng dữ liệu demo):

```bash
docker compose exec -e TEST_DATABASE_URL=postgresql://todo:todo@db:5432/todo web python -m pytest tests -v
```

Ctrl+C frontend và `docker compose down` để dừng. Volume PostgreSQL còn nguyên; `docker compose down -v` xóa database demo. IndexedDB thuộc từng origin/browser và không bị xóa khi dừng Docker.

Nếu db healthy nhưng web không resolve được `db`, kiểm tra:

```bash
docker inspect next-fastapi-pwa-web-1 --format '{{json .NetworkSettings.Networks}}'
```

Nếu là `{}`, tạo lại riêng web:

```bash
docker compose up -d --force-recreate web
docker compose logs --tail=30 web
curl http://localhost:8000/health
```

Tham khảo: [Vite](https://vite.dev/guide/), [Vite build/preview](https://vite.dev/guide/static-deploy.html), [FastAPI Docker](https://fastapi.tiangolo.com/deployment/docker/).
