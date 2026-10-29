---
version: 1.0
name: Studia
description: Hệ thống thiết kế của Studia — nền tảng luyện thi IELTS cho người Việt. Xanh mực (brand, navy) mang sự tin cậy học thuật, cam (accent) mang năng lượng và tiến bộ, trên nền giấy ấm. Tối giản, thân thiện, chuyển động mượt nhưng tiết chế. Nguồn đầy đủ (logo, component, trang mẫu) nằm trong artifact Design System "Studia"; giá trị chạy thật nằm trong frontend/src/app/globals.css.

colors:
  # light / dark
  canvas: { light: "#f8f6f2", dark: "#0b1022" }
  surface: { light: "#ffffff", dark: "#131a33" }
  surface-raised: { light: "#ffffff", dark: "#1a2242" }
  surface-sunken: { light: "#f1eee8", dark: "#090d1c" }
  hairline: { light: "#e5e0d8", dark: "#273055" }
  border-control: { light: "#80869e", dark: "#636e96" }
  ink: { light: "#0e1630", dark: "#edf0f8" }
  ink-secondary: { light: "#3a4260", dark: "#c2c8dc" }
  ink-muted: { light: "#5e6480", dark: "#949bb8" }
  brand: { light: "#2344c9", dark: "#7d9bff" }
  brand-hover: { light: "#1a3399", dark: "#a3b8ff" }
  brand-tint: { light: "#e9eefd", dark: "#1c2752" }
  on-brand: { light: "#ffffff", dark: "#0b1022" }
  navy: { light: "#0f1f4d", dark: "#1b2a5e" }
  on-navy: "#f8f6f2"
  accent: { light: "#f2611f", dark: "#ff8a4f" }
  accent-strong: { light: "#c2410c", dark: "#ff9f6e" }
  accent-tint: { light: "#ffede3", dark: "#3a2117" }
  on-accent: { light: "#0e1630", dark: "#0b1022" }
  success: { light: "#0d7a5f", dark: "#4ccfa6" }
  success-tint: { light: "#e1f4ec", dark: "#0f2e27" }
  danger: { light: "#c0281c", dark: "#ff8577" }
  danger-tint: { light: "#fde8e6", dark: "#3a1714" }
  warning: { light: "#a15c00", dark: "#f2b451" }
  warning-tint: { light: "#fff3d6", dark: "#33270f" }
  plum: { light: "#9b2c6f", dark: "#f08cc0" }
  marker: { light: "#ffe27a", dark: "#5a4710" }
  logo-ink: { light: "#0f1f4d", dark: "#f8f6f2" }
  logo-accent: "#f2611f"

typography:
  families:
    display: "Bricolage Grotesque"   # tiêu đề, con số lớn, từ vựng trên flashcard
    sans: "Be Vietnam Pro"           # toàn bộ giao diện
    reading: "Literata"              # bài đọc IELTS, câu ví dụ, phiên âm
  display-xl: { family: display, size: 64px, lineHeight: 68px, weight: 750, letterSpacing: -2px }
  display-l:  { family: display, size: 48px, lineHeight: 54px, weight: 700, letterSpacing: -1.5px }
  heading-1:  { family: display, size: 34px, lineHeight: 42px, weight: 700, letterSpacing: -0.8px }
  heading-2:  { family: display, size: 24px, lineHeight: 32px, weight: 650, letterSpacing: -0.4px }
  heading-3:  { family: display, size: 19px, lineHeight: 26px, weight: 600, letterSpacing: -0.2px }
  stat:       { family: display, size: 40px, lineHeight: 44px, weight: 700, letterSpacing: -1px, numeric: tabular }
  title:      { family: sans, size: 17px, lineHeight: 26px, weight: 600 }
  body-lg:    { family: sans, size: 17px, lineHeight: 28px, weight: 400 }
  body:       { family: sans, size: 15px, lineHeight: 24px, weight: 400 }
  label:      { family: sans, size: 14px, lineHeight: 20px, weight: 550 }
  caption:    { family: sans, size: 13px, lineHeight: 18px, weight: 400 }
  eyebrow:    { family: sans, size: 12px, lineHeight: 16px, weight: 650, letterSpacing: 0.6px, transform: uppercase }
  passage:    { family: reading, size: 18px, lineHeight: 31px, weight: 400 }
  passage-sm: { family: reading, size: 16px, lineHeight: 27px, weight: 400 }

rounded: { xs: 6px, sm: 10px, md: 14px, lg: 20px, xl: 28px, full: 999px }

spacing: { 1: 4px, 2: 8px, 3: 12px, 4: 16px, 5: 20px, 6: 24px, 8: 32px, 10: 40px, 12: 48px, 16: 64px, 24: 96px }

size:
  control-sm: 36px
  control-md: 44px   # vùng chạm tối thiểu
  control-lg: 52px
  sidebar: 248px
  sidebar-collapsed: 72px
  content: 960px
  reading: 680px

shadow:
  xs: "0 1px 2px rgba(15,31,77,.06)"
  sm: "0 1px 2px rgba(15,31,77,.04), 0 4px 12px rgba(15,31,77,.06)"
  md: "0 2px 4px rgba(15,31,77,.04), 0 12px 32px rgba(15,31,77,.10)"
  lg: "0 4px 8px rgba(15,31,77,.05), 0 24px 64px rgba(15,31,77,.16)"
  focus-ring: "0 0 0 2px {canvas}, 0 0 0 4px {brand}"

motion:
  dur-instant: 90ms      # nhấn nút
  dur-fast: 160ms        # hover, tooltip
  dur-base: 240ms        # xuất hiện, chọn đáp án, sidebar
  dur-slow: 420ms        # lật thẻ, progress
  dur-celebrate: 700ms   # band score, xong ngày học (1 lần/màn)
  ease-out: "cubic-bezier(0.22, 1, 0.36, 1)"
  ease-in-out: "cubic-bezier(0.65, 0, 0.35, 1)"
  ease-spring: "cubic-bezier(0.34, 1.56, 0.64, 1)"
  ease-in: "cubic-bezier(0.55, 0, 1, 0.45)"

components:
  logo: "components/Logo.tsx — variant lockup | mark | wordmark; màu qua --logo-ink/--logo-accent"
  button: ".btn-primary (việc chính) · .btn-accent (CTA marketing) · .btn-secondary · .btn-ghost · .btn-emerald; cỡ .btn-sm / mặc định 44px / .btn-lg"
  card: ".glass-panel — surface + hairline + radius-lg; <a>/.interactive nâng 2px khi hover"
  badge: ".badge + .badge-indigo|emerald|amber|rose"
  nav: ".nav-item trong .app-sidebar; nền active trượt bằng framer-motion layoutId"
  input: ".input-field + .label-text — viền border-control, focus-ring"
  progress: ".progress-bar-bg/.progress-bar-fill, .knowledge-bar-*"
  task: ".task-item + .task-check(.done) — dấu ✓ nảy và được vẽ ra"
  quiz: ".quiz-option(.selected|.correct|.wrong) + .quiz-option-key — đúng nảy, sai rung"
  flashcard: ".flip-card-* — lật 3D 420ms ease-in-out"
  fsrs: ".fsrs-btn .fsrs-again|hard|good|easy"
  chat: ".chat-bubble-ai|assistant (góc trên-trái vuông) · .chat-bubble-user (navy, góc trên-phải vuông) · .typing-dots"
  exam: ".exam-* — header, timer (warning/danger/critical), navigator, option, splitter, modal"
---

# Studia — hướng dẫn thiết kế

## Nguyên tắc
1. **Nội dung học là nhân vật chính.** Chrome lùi lại: nền `canvas`, card `surface`, viền `hairline`. Màu đậm chỉ cho hành động và phản hồi.
2. **Một việc chính mỗi màn.** Một nút primary (hoặc một nút accent trên landing), một vòng band score lớn, một khối navy.
3. **Phản hồi tức thì, không ồn ào.** ≤160ms cho mọi thao tác; ăn mừng nhỏ (nảy, vẽ ✓), không confetti.
4. **Đọc được lâu.** Line-height rộng cho dấu tiếng Việt, cột đọc ≤ 680px, tương phản ≥ 4.5:1 ở cả hai theme.

## Logo
Hai bong bóng hội thoại lệch nhau tạo chữ **S** (hỏi – đáp), chữ "studia" nét tròn, chấm chữ i màu cam. Dùng `<Logo />`; file ảnh: `frontend/public/icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`. Không đổi màu, không xoay, không thêm bóng/gradient.

## Màu
- Chữ: `ink` → `ink-secondary` → `ink-muted`. Không dùng màu nhạt hơn `ink-muted` cho chữ.
- `brand` cho nút/link/active; chữ trên nó là `on-brand` (theme tối là chữ tối).
- `accent` (cam) chỉ cho streak, CTA marketing, điểm nhấn minh hoạ, logo. Làm chữ dùng `accent-strong`; chữ trên nền cam là `on-accent`.
- Trạng thái `success` / `danger` / `warning` luôn kèm icon hoặc chữ. `marker` là bút dạ quang cho từ vựng.
- Không gradient trên mặt phẳng UI, không tím-xanh, không emoji trong giao diện.
- Tên biến cũ (`--primary`, `--text-muted`, `--bg-card`, `--accent-emerald`…) vẫn hoạt động — là alias trỏ về token mới. Code mới hãy dùng tên token mới.

## Chữ
Bricolage Grotesque cho tiêu đề và con số; Be Vietnam Pro cho giao diện; Literata cho văn bản tiếng Anh cần đọc kỹ (bài đọc, ví dụ, phiên âm, bài viết Writing). Viết hoa chữ cái đầu câu ("Ôn tập flashcard"), không Title Case. Con số dùng `.tabular`.

## Chuyển động
Chỉ animate `transform`/`opacity` (và `width` của progress). Vào màn: fade-up 8px, xếp tầng 60ms (`.stagger`). Nút nhấn `scale(.97)`; card hover nâng 2px; đúng → `bump` + ✓; sai → `shake` một lần; số liệu đếm lên (`<CountUp />`). Chuyển trang: mờ dần 240ms. `prefers-reduced-motion` tắt toàn bộ.

## Khuôn trang (áp cho mọi màn có sidebar)
Một trang học luôn theo thứ tự: thanh tab nhóm (nếu có) → đầu trang → nội dung.
- **Khung**: `<div className="wrap stagger">` (rộng 1080px) hoặc `wrap-narrow` (760px) cho màn đọc/viết một cột.
- **Đầu trang**: `<header className="page-head"><div><h1 className="page-title">…</h1><p className="page-sub">…</p></div>{nút phụ}</header>`. Tiêu đề trùng với nhãn trên sidebar (hoặc là dạng đầy đủ của nhãn đó). Không dùng `.crumb` cho trang đã có thanh tab nhóm.
- **Thanh tab nhóm**: trang nằm trong một nhóm sidebar (`NavFolder`) hoặc trong `tabSections` của `MainLayout.tsx` tự có thanh tab anh em ở đầu trang. Muốn gộp các trang thành nhóm thì khai báo ở đó, đừng tự vẽ tab trong trang.
- **Tab và bộ chọn**: đổi giữa các màn/chế độ của cùng một trang dùng `.tabs.page-tabs` + `.tab` (gạch chân). Chọn một giá trị trong nội dung (tốc độ, Part, nguồn đề) dùng `.seg` + `.seg-btn`. Lọc nhiều giá trị dùng `.st-chip`.
- **Nút**: chỉ dùng bộ `st-btn` (`st-btn-primary | secondary | ghost | accent`, cỡ `st-btn-sm | st-btn-lg`, `st-btn-block`). Các lớp `.btn-primary`… cũ trong `globals.css` chỉ còn để tương thích, không dùng ở code mới.
- **Thông báo trong trang**: `.st-alert` + `st-alert-success | danger | warning` (mặc định là thông tin), kèm `role="status"` hoặc `role="alert"`. Không tự viết `style` nền/màu cho hộp báo lỗi.
- **Ô nhập**: `<label className="st-field"><span className="st-field-label">…</span><input className="st-input" /></label>`.
- **Ngoại lệ có chủ đích**: Hôm nay (hero riêng), Ôn luyện và Kiểm tra trình độ (chế độ tập trung, thanh trên riêng), Coal (khung chat), phòng thi và các trang không khung (đăng nhập, onboarding, blog).
- `vibrant.css` phủ một lớp màu lên toàn app (gradient nút chính, ô số liệu, thanh tiến độ, đốm màu nền). Lớp này nhận diện qua class `st-*`, nên dùng sai bộ class cũ thì nút sẽ "phẳng" khác hẳn trang bên cạnh.

## Iconography
`lucide-react`, nét 1.75, cỡ 16/20/24, luôn `currentColor`. Nút chỉ có icon phải có `aria-label`.

## Responsive
< 768px: ẩn sidebar, hiện thanh trên (logo + đổi theme) và thanh tab dưới 5 mục; nội dung 1 cột; ô số liệu 3 cột gọn.
