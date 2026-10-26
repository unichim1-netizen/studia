# Studia mobile

App React Native (Expo SDK 58, TypeScript, expo-router) cho Studia. Dùng chung backend FastAPI (`../backend`, mọi API dưới `/api/v1`) và đăng nhập Supabase như web (`../frontend`). Không có backend riêng.

## Màn hình

| Tab / trang | Gọi API | Ghi chú |
|---|---|---|
| Đăng nhập, đăng ký, quên mật khẩu | Supabase Auth | Có nút "Tiếp tục với Google" (xem mục Đăng nhập bằng Google). Lỗi Supabase được dịch sang tiếng Việt. Liên kết đặt lại mật khẩu mở trang `/reset-password` của web (`EXPO_PUBLIC_WEB_URL`). |
| Hôm nay | `GET /learning-paths/today`, `/schedule/streak`, `/profile`, `/flashcards/due`; `PATCH /learning-paths/plans/{date}/tasks/{idx}` | Coal đổi tư thế theo streak (cùng luật với web), đếm ngược ngày thi, tick nhiệm vụ. |
| Ôn thẻ | `GET /flashcards/due`, `POST /flashcards/review` | Lật thẻ, chấm 1–4 (Quên / Khó / Nhớ / Dễ). |
| Lịch học | `GET /schedule/streak`, `/schedule/summary`, `/schedule/day/{day}`; `POST/PATCH/DELETE /schedule/slots` | Lịch tháng tô theo số phút học. Ngày đã qua chỉ xem; hôm nay và ngày tới thêm/sửa được khung giờ. |
| Bạn bè | `GET /friends`, `GET /friends/feed`, `POST /friends/moments`, `POST /friends/requests`, `PUT/DELETE /friends/moments/{id}/reaction` | Kết bạn bằng mã 6 ký tự, chụp khoảnh khắc học gửi bạn bè (kiểu Locket), xem bảng tin, thả cháy / thích / giỏi lắm. Xem mục "Bạn bè và khoảnh khắc" bên dưới. |
| Writing | `POST /writing/grade` | 4 tiêu chí band, điểm tổng, sửa từng câu. Bài nháp lưu trên máy. 503 (AI đang nghỉ) hiện lời nhắn nhẹ nhàng. |
| Hỏi Coal | `POST /tutor/ask` | Giữ `session_id` và 40 tin gần nhất trên máy; tin lỗi có nút "Gửi lại". |
| Cài đặt | | Giao diện sáng / tối / theo máy, đăng xuất. Mở từ nút bánh răng ở tab Hôm nay. |

Cờ tính năng lấy từ `GET /config/public` (`flashcards`, `plan`, `writing`, `tutor`, `friends`): tính năng bị tắt thì ẩn tab.

## Bạn bè và khoảnh khắc

- Mỗi người có một mã 6 ký tự (tab Bạn bè, biểu tượng thêm bạn). Gửi mã cho bạn hoặc nhập mã của bạn để gửi lời mời; bạn ấy chấp nhận mới thành bạn bè. Hai bên cùng nhập mã của nhau thì kết bạn luôn. Tối đa 50 bạn, 20 lời mời đang chờ.
- "Hôm nay bạn học gì?" mở màn chụp ảnh (máy ảnh hoặc thư viện), thêm lời nhắn rồi gửi. Ảnh vuông, cũng lưu vào lịch học của bạn và tính vào chuỗi ngày. Chạm biểu tượng mắt gạch trên ảnh của mình để ngừng chia sẻ.
- Chỉ bạn bè đã chấp nhận mới xem được ảnh (backend cấp link tạm, người lạ nhận 404). Bỏ kết bạn thì hai bên không thấy ảnh của nhau nữa.
- Số lời mời đang chờ hiện trên icon tab Bạn bè, làm mới khi mở app và khi quay lại app (kể cả khi tắt thông báo đẩy).
- Cần chạy `backend/sql/migration_v11.sql` (bảng bạn bè, biểu cảm, cột `study_moments.shared`) rồi `backend/sql/migration_v12.sql` (bảng `push_tokens`) trong Supabase SQL Editor. Quản lý có thể tắt tính năng ở trang Quản trị, mục "Kết bạn và chia sẻ khoảnh khắc".
- Chạy backend local với kho ảnh cục bộ (không dùng Supabase Storage): đặt `BACKEND_PUBLIC_URL=http://<IP LAN>:8000` cho backend, nếu không link ảnh trỏ về `localhost` và điện thoại không tải được ảnh.
- Expo Go hỏi quyền máy ảnh / ảnh lần đầu. Trên web không có máy ảnh, nút Chụp ảnh mở hộp chọn tệp.

## Xử lý lỗi

- `src/lib/api.ts`: mọi lời gọi có timeout (20 s, chấm Writing 120 s, Hỏi Coal 90 s) và báo lỗi tiếng Việt cho mất mạng / quá giờ.
- 401: thử làm mới token một lần, vẫn hỏng thì đăng xuất trên máy và màn hình đăng nhập báo "Phiên đăng nhập đã hết hạn".
- 402/403/404/422/429/5xx: hiện `detail` tiếng Việt của backend (kể cả mảng lỗi 422 của FastAPI); không có thì dùng câu mặc định theo mã.
- Mọi màn hình có trạng thái đang tải, lỗi (nút Thử lại), rỗng; kéo xuống để làm mới.
- Dữ liệu API đi qua các hàm `normalize*` trong `src/lib/studia.ts`: thiếu trường hay sai kiểu thì dùng giá trị mặc định, không crash.
- `AppErrorBoundary` bọc toàn app, cộng thêm `ErrorBoundary` của expo-router cho từng route.

## Cài lên iPhone

Hướng dẫn từng bước (Expo Go và bản cài riêng bằng EAS, bước "Tin cậy" trong VPN và Quản lý thiết bị, cấu hình Google, bảng lỗi thường gặp) nằm ở [HUONG_DAN_IOS.md](HUONG_DAN_IOS.md). `eas.json` đã có profile `preview` (bản cài thử) và `production`.

## Đăng nhập bằng Google

Nút Google ở màn Đăng nhập và Đăng ký dùng OAuth của Supabase: mở trang Google trong trình duyệt hệ thống, Supabase chuyển về `studia://auth-callback` (Expo Go: `exp://.../--/auth-callback`) kèm token rồi app đặt phiên. Không cần module Google riêng nên chạy được trong Expo Go lẫn bản cài. Phải bật một lần ở Google Cloud và Supabase, xem mục "Đăng nhập bằng Google" trong [HUONG_DAN_IOS.md](HUONG_DAN_IOS.md). Chưa bật thì app báo lỗi tiếng Việt, đăng nhập email vẫn dùng bình thường. Chưa thử đăng nhập Google thật vì cần khoá Google của bạn; phần tạo địa chỉ đăng nhập và đọc kết quả trả về đã kiểm tra.

## Icon và màn hình chờ

Icon là Coal (tư thế `happy`) trên nền navy của thương hiệu, màn hình chờ cùng màu nên bấm icon vào app liền mạch. Tạo lại bằng:

```bash
python -I mobile/scripts/make_icons.py
```

Script ghi `assets/icon.png` (iOS), `adaptive-icon.png` + `monochrome-icon.png` (Android, gồm icon theo chủ đề Android 13+), `splash-icon.png`, `favicon.png`. Icon chỉ đổi sau khi build lại (Expo Go luôn hiện icon của Expo Go).

## Tốc độ và chuyển động

- Mở màn hình là hiện ngay dữ liệu lần trước (`src/lib/cache.ts`, lưu theo tài khoản, xoá khi đăng xuất), rồi làm mới phía sau. Mất mạng vẫn xem được, có dòng báo.
- Lần đầu chưa có dữ liệu thì hiện khung xương (skeleton) thay vì vòng quay.
- Màn hình chờ gốc giữ tới khi font và phiên đăng nhập sẵn sàng rồi mờ dần; chỉ nạp 4 tệp font.
- Tab Hôm nay tải trước lịch tháng này để mở tab Lịch học là có ngay. Tab đang ẩn được "đóng băng", không render lại.
- Ảnh Coal dùng `expo-image` (giải mã ngoài luồng chính, đổi tư thế bằng mờ chéo).
- Chuyển động chỉ dùng transform/opacity trên luồng giao diện (native driver): vào màn mờ dần nhích lên 8px xếp tầng, nút co 0.97 khi nhấn, nền tab trượt theo tab đang chọn, ô tick bật nhẹ, thanh tiến độ chạy mượt. Bật "Giảm chuyển động" trên máy thì tắt hết.
- Thanh điều hướng dưới chỉ có icon (tên tab vẫn đọc được bằng trình đọc màn hình); icon Ôn thẻ có số thẻ đến hạn.

## Thông báo đẩy

Có hai loại thông báo, đều từ tab Bạn bè: lời mời kết bạn (và khi lời mời được chấp nhận) và ảnh mới của bạn bè. Ảnh mới chỉ báo cho bạn bè đã chấp nhận, và đăng nhiều ảnh trong 5 phút chỉ báo một lần. Chạm thông báo mở thẳng màn hình tương ứng, kể cả khi app đang tắt.

- Người dùng bật/tắt trong Cài đặt, mục Thông báo (cũng có thẻ mời bật ở tab Bạn bè, bấm "Để sau" thì không hỏi lại). Đăng xuất sẽ gỡ thiết bị khỏi danh sách nhận.
- Backend gửi qua dịch vụ Expo Push (`backend/app/services/push.py`), không cần thêm khoá nào. Nếu dự án Expo bật "Enhanced Security" thì đặt biến môi trường `EXPO_ACCESS_TOKEN` cho backend.
- Điều kiện để nhận thông báo thật trên điện thoại:
  1. Tạo dự án EAS (miễn phí): `npx eas-cli init` trong thư mục `mobile` (ghi ID dự án vào `app.json`). Chưa chạy thì Cài đặt báo "chưa được cấu hình".
  2. **Android: dùng development build hoặc bản cài, không dùng Expo Go** (Expo Go trên Android bỏ push từ SDK 53). Cần cấu hình khoá FCM qua EAS (`npx eas-cli credentials`).
  3. iOS: cần tài khoản Apple Developer để build; Expo sẽ hướng dẫn tạo khoá push (APNs) khi build.
- Build thử: `npx eas-cli build --profile development --platform android` (hoặc `ios`), cài file về máy rồi `npx expo start --dev-client`.
- Web không có thông báo đẩy; Cài đặt chỉ giải thích.

## Chạy trên Expo Go với backend local

1. Cài phụ thuộc:
   ```bash
   cd mobile
   npm install
   ```
2. Tạo `mobile/.env` từ `.env.example`:
   - `EXPO_PUBLIC_API_URL`: điện thoại không hiểu `localhost` là máy tính của bạn. Dùng IP LAN của máy chạy backend, vd `http://192.168.1.10:8000/api/v1` (xem IP bằng `ipconfig`, mục IPv4).
   - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`: giống `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` trong `frontend/.env.local`.
   - `EXPO_PUBLIC_WEB_URL` (tuỳ chọn): địa chỉ web Studia cho email quên mật khẩu.
3. Chạy backend sao cho điện thoại gọi được: uvicorn phải nghe trên mọi địa chỉ, không chỉ `127.0.0.1`:
   ```bash
   cd backend
   python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```
   Windows có thể hỏi mở tường lửa cho Python: chọn cho phép trên mạng Private. Điện thoại và máy tính phải cùng Wi‑Fi.
4. Chạy app:
   ```bash
   cd mobile
   npx expo start
   ```
   Mở Expo Go trên điện thoại, quét mã QR. Không cùng mạng được thì dùng `npx expo start --tunnel` (khi đó backend vẫn phải truy cập được từ điện thoại).
5. Thử bản web (tuỳ chọn): `npx expo start --web`. Trình duyệt bị CORS chặn nếu origin không nằm trong `CORS_ORIGINS` của backend, vd thêm `http://localhost:8081` vào biến môi trường đó khi chạy backend. App trên điện thoại không bị CORS.

Đổi `.env` thì phải dừng và chạy lại `npx expo start` (Expo nhúng biến lúc build bundle).

## Lệnh kiểm tra

```bash
npx tsc --noEmit
```

```bash
npx expo export --platform web
```

```bash
npx expo-doctor
```

## Cấu trúc

```
src/app/            route (expo-router): _layout, sign-in, sign-up, forgot-password, settings, manage-friends, share-moment, day/[day], (tabs)/…
src/components/     Coal (ảnh tư thế), ui (Text, Card, Button, Field, trạng thái tải/lỗi/rỗng), motion, TabBar, Avatar, MomentCard, ErrorBoundary
src/lib/            api (fetch + lỗi), studia + friends (endpoint + chuẩn hoá), cache, mascot (luật tư thế), theme (token màu từ globals.css), auth, config
assets/coal/        25 ảnh WebP của Coal, chép từ frontend/public/coal
```

Luật chọn tư thế Coal ở `src/lib/mascot.ts` chép từ `frontend/src/lib/mascot.ts` và `frontend/src/components/mascot/Mascot.tsx`; token màu ở `src/lib/theme.tsx` chép từ `frontend/src/app/globals.css`. Sửa ở web thì nhớ sửa cả ở đây.

## Chưa làm

- Thông báo đẩy nhắc giờ học (hạ tầng push đã có cho tab Bạn bè nhưng nhắc học vẫn chỉ qua email).
- Chưa thử nhận thông báo thật trên điện thoại: chưa có dự án EAS và development build. Phần gửi của backend đã kiểm tra bằng test với dịch vụ Expo giả.
- Ảnh "khoảnh khắc" trong lịch: chỉ xem, chưa chụp / tải ảnh lên.
- Bạn bè: thông báo khi bạn bè thả cảm xúc cho ảnh của bạn, chọn giờ yên lặng, chọn gửi cho một vài người thay vì tất cả, ảnh đại diện (đang dùng chữ cái đầu), chặn người dùng.
- Các tính năng khác của web: thư viện sách, đọc ebook, thi thử, nghe chép, phát âm, hội thoại tình huống, thanh toán, sửa hồ sơ / ngày thi.
- Tạo bộ thẻ, thêm thẻ mới (`/flashcards/decks`, `/flashcards/custom-create`).
- Đăng nhập Google / Apple, đặt lại mật khẩu ngay trong app (đang dùng trang web).
- Chưa build bản cài (EAS) và chưa thử trên máy iOS / Android thật; đã kiểm tra bản web với backend xem thử.
