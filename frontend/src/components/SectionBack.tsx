"use client";

import { useRouter, usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Nút quay lại (về URL trước đó) đặt bên trái tiêu đề các màn hình gộp (vd. Luyện nói, Lỗi sai).
 * Chỉ hiện ở đúng đường dẫn trong `paths`; trang con tự quản giao diện.
 */
export default function SectionBack({ paths }: { paths: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  if (!paths.includes(pathname)) return null;
  return (
    <div className="wrap section-back" style={{ marginBottom: 8 }}>
      <button
        type="button"
        className="icon-btn icon-btn-solid"
        aria-label="Quay lại"
        title="Quay lại"
        onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      >
        <ArrowLeft size={20} strokeWidth={2} />
      </button>
    </div>
  );
}
