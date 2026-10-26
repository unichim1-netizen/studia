# Cài Studia lên iPhone (Expo, không cần máy Mac)

Hai cách, chọn theo việc bạn có tài khoản Apple Developer (99 USD/năm) hay không.

| | Expo Go (cách A) | Bản cài riêng (cách B) |
|---|---|---|
| Chi phí | Miễn phí | Apple Developer 99 USD/năm |
| Cài thế nào | Tải Expo Go từ App Store | Build bằng EAS, cài từ link |
| Cần máy tính bật kèm | Có (đang chạy `expo start`) | Không, app chạy độc lập |
| Bước "Tin cậy" | Không có | Có thể có (xem bước 7) |
| Thông báo đẩy | Không đáng tin | Có |
| Đăng nhập Google | Có (cần thêm 1 địa chỉ trong Supabase) | Có |

## Cách A: Expo Go (thử nhanh)

1. Trên iPhone cài **Expo Go** từ App Store.
2. Trên máy tính, tạo `mobile/.env` từ `mobile/.env.example` (điền địa chỉ API, Supabase URL, Supabase anon key).
3. Chạy:
   ```bash
   cd mobile
   npm install
   npx expo start --tunnel
   ```
   `--tunnel` cho phép điện thoại ở ngoài mạng nhà. Lần đầu Expo hỏi cài `@expo/ngrok`, chọn Yes.
4. Mở app Máy ảnh của iPhone, quét mã QR trong terminal, mở bằng Expo Go.
5. Địa chỉ API phải gọi được từ điện thoại. Backend của bạn đã có HTTPS, dùng dạng `https://api.3-25-144-63.sslip.io/api/v1` (sửa theo domain thật của bạn). `http://IP-nhà:8000` chỉ chạy khi điện thoại cùng Wi-Fi.

## Cách B: Bản cài riêng trên iPhone

### Chuẩn bị (làm một lần)

- Tài khoản Expo miễn phí: đăng ký ở expo.dev.
- Tài khoản **Apple Developer** (developer.apple.com/programs, 99 USD/năm). Không có thì chỉ dùng được cách A.
- iPhone bật **Chế độ nhà phát triển**: Cài đặt > Quyền riêng tư và bảo mật > Chế độ nhà phát triển > Bật, rồi khởi động lại máy (mục này chỉ hiện sau khi bạn cài profile ở bước 5).
- Backend đã deploy bản có kết bạn và thông báo, và đã chạy `migration_v11.sql`, `migration_v12.sql` trong Supabase. Backend phải có HTTPS (bản iOS từ chối `http://`).

### Các bước

1. **Cài thư viện** (trong thư mục `mobile`):
   ```bash
   npm install
   ```
2. **Đăng nhập Expo:**
   ```bash
   npx eas-cli login
   ```
3. **Tạo dự án EAS** (ghi ID dự án vào `app.json`, thông báo đẩy cần ID này):
   ```bash
   npx eas-cli init
   ```
   Commit lại thay đổi trong `app.json`.
4. **Khai báo biến môi trường** trên trang expo.dev: chọn dự án > Environment variables > thêm hai biến cho môi trường **Preview**, hiển thị kiểu **Plain text**:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

   `EXPO_PUBLIC_API_URL` đã nằm sẵn trong `eas.json` (mục `preview`). Nếu domain backend của bạn khác `api.3-25-144-63.sslip.io` thì sửa ở đó. Tệp `.env` trên máy không được gửi lên EAS, nên phải khai báo ở bước này.
5. **Đăng ký iPhone** để Apple cho phép cài:
   ```bash
   npx eas-cli device:create
   ```
   Chọn "Website", lệnh in ra một link/QR. Mở link bằng **Safari trên iPhone**, bấm Cho phép tải profile, rồi vào Cài đặt > Đã tải về hồ sơ > Cài đặt. Lần đầu lệnh sẽ hỏi Apple ID của tài khoản Developer.
6. **Build** (chạy trên cloud, khoảng 15 đến 30 phút):
   ```bash
   npx eas-cli build --platform ios --profile preview
   ```
   Khi hỏi đăng nhập Apple và tạo chứng chỉ, chọn để EAS tự quản lý (Yes). Xong sẽ có link và mã QR để cài.
7. **Cài và tin cậy:** mở link bằng Safari trên iPhone, bấm Cài đặt. Nếu mở app mà iOS báo "Nhà phát triển doanh nghiệp chưa được tin cậy", vào Cài đặt > Cài đặt chung > **VPN và Quản lý thiết bị** > chọn tên nhà phát triển > **Tin cậy**. (Bản cài qua đăng ký thiết bị thường không hiện thông báo này.)
8. Mở Studia, đăng nhập.

### Sau này

- Sửa code xong muốn có trên điện thoại: chạy lại bước 6 và cài bản mới (chưa cấu hình EAS Update để cập nhật không cần build lại).
- Thêm iPhone mới: chạy lại bước 5 cho máy đó rồi build lại, bản cài cũ không tự chạy trên máy mới.

## Đăng nhập bằng Google (cấu hình một lần)

Nút Google đã có sẵn trong app, nhưng cần bật ở hai nơi:

1. **Google Cloud Console** (console.cloud.google.com) > APIs & Services > Credentials > Create credentials > OAuth client ID, loại **Web application**. Ở "Authorized redirect URIs" thêm `https://<mã-dự-án-supabase>.supabase.co/auth/v1/callback`. Lấy Client ID và Client secret. (Lần đầu Google yêu cầu thiết lập màn hình đồng ý OAuth.)
2. **Supabase** > Authentication > Providers > Google: bật, dán Client ID và Client secret.
3. **Supabase** > Authentication > URL Configuration > Redirect URLs: thêm
   - `studia://**` (bản cài riêng),
   - địa chỉ Expo Go: mở app ở chế độ `npx expo start`, bấm nút Google một lần, tìm dòng `[auth] Địa chỉ chuyển hướng Google: exp://...` trong terminal rồi thêm đúng địa chỉ đó (hoặc dạng `exp://**`).

Lưu ý khi đưa lên App Store: Apple yêu cầu có thêm "Đăng nhập bằng Apple" nếu app có đăng nhập qua Google. Bản cài riêng (ad hoc) không qua duyệt nên chưa bị ràng buộc.

## Gặp lỗi thì xem

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Mở app báo "Thiếu cấu hình" | Chưa khai báo hai biến Supabase ở bước 4, hoặc khai báo sai môi trường (phải là Preview) |
| "Không kết nối được máy chủ Studia" | Địa chỉ API sai, không phải HTTPS, hoặc backend chưa chạy |
| Bấm Google báo "chưa được phép nhận kết quả" | Chưa thêm địa chỉ chuyển hướng ở Supabase (bước 3 của mục Google) |
| Bấm Google báo "chưa được bật" | Chưa bật provider Google ở Supabase |
| Tab Bạn bè báo lỗi 404 | Backend đang chạy chưa có tính năng kết bạn, hoặc chưa chạy migration |
| Không có thông báo đẩy | Chưa cấp quyền thông báo cho Studia (Cài đặt iPhone > Thông báo), công tắc Thông báo trong app đang tắt, hoặc chưa chạy `eas init` |
| Cài xong không mở được | iPhone chưa đăng ký ở bước 5 (build xong mới đăng ký thì phải build lại), hoặc chưa bật Chế độ nhà phát triển |
