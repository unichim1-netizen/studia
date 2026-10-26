"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Quy tắc đặt tiêu đề tab: khớp từ trên xuống, quy tắc cụ thể đặt trước quy tắc chung. */
const RULES: [RegExp, string][] = [
  [/^\/$/, "Hôm nay"],
  [/^\/welcome/, "Luyện IELTS cùng Coal"],
  [/^\/login/, "Đăng nhập"],
  [/^\/signup/, "Đăng ký"],
  [/^\/forgot-password/, "Quên mật khẩu"],
  [/^\/reset-password/, "Đặt lại mật khẩu"],
  [/^\/auth\/callback/, "Đang đăng nhập"],
  [/^\/onboarding/, "Làm quen với Studia"],
  [/^\/placement/, "Kiểm tra đầu vào"],
  [/^\/dashboard/, "Tiến độ"],
  [/^\/knowledge-map/, "Bản đồ kiến thức"],
  [/^\/books\/[^/]+\/read/, "Đọc sách"],
  [/^\/books\/[^/]+\/exam-builder/, "Dựng đề thi từ sách"],
  [/^\/books\/[^/]+/, "Sách"],
  [/^\/books/, "Thư viện sách"],
  [/^\/lesson/, "Bài học"],
  [/^\/quiz/, "Làm quiz"],
  [/^\/plan/, "Lịch học"],
  [/^\/journal/, "Nhật ký"],
  [/^\/practice/, "Ôn luyện"],
  [/^\/review/, "Ôn tập"],
  [/^\/flashcards/, "Thẻ từ vựng"],
  [/^\/vocabulary/, "Từ vựng"],
  [/^\/scenarios/, "Luyện nói: hội thoại"],
  [/^\/pronunciation/, "Luyện nói: phát âm"],
  [/^\/dictation/, "Nghe chép chính tả"],
  [/^\/reading/, "Luyện đọc"],
  [/^\/speaking/, "Speaking IELTS"],
  [/^\/writing/, "Luyện Writing"],
  [/^\/feedback/, "Lỗi sai"],
  [/^\/mistakes/, "Lỗi sai"],
  [/^\/exam\/[^/]+/, "Làm bài thi"],
  [/^\/exam/, "Thi thử IELTS"],
  [/^\/tutor/, "Coal, bạn học AI"],
  [/^\/billing\/[^/]+/, "Thanh toán đơn hàng"],
  [/^\/billing/, "Gói và lượt upload"],
  [/^\/settings/, "Cài đặt"],
  [/^\/admin\/users/, "Quản trị: tài khoản"],
  [/^\/admin\/orders/, "Quản trị: thanh toán"],
  [/^\/admin\/packs/, "Quản trị: gói và cài đặt"],
  [/^\/admin\/library/, "Quản trị: sách hệ thống"],
  [/^\/admin\/features/, "Quản trị: tính năng và giới hạn"],
  [/^\/admin\/content/, "Quản trị: nội dung và thông báo"],
  [/^\/admin\/ai/, "Quản trị: cấu hình chấm AI"],
  [/^\/admin/, "Quản trị: tổng quan"],
  [/^\/config-test/, "Công cụ kiểm thử"],
];

export const BASE_TITLE = "Studia | Luyện thi IELTS";

export function titleFor(pathname: string): string {
  const hit = RULES.find(([re]) => re.test(pathname));
  return hit ? `${hit[1]} | Studia` : BASE_TITLE;
}

/**
 * Đổi tiêu đề tab theo trang đang mở. Blog tự đặt tiêu đề bằng metadata của Next nên bỏ qua ở đây.
 * Hầu hết trang của app là client component nên không dùng được `export const metadata`.
 */
export default function RouteTitle() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/blog" || pathname.startsWith("/blog/")) return;
    document.title = titleFor(pathname);
  }, [pathname]);
  return null;
}
