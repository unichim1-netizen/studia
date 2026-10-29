"use client";

import { useEffect, useState } from "react";
import { API, apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

const FALLBACK_STEPS = [
  "Tải lên", "Đọc nội dung từng trang", "Tách chương và bài đọc", "Lập chỉ mục cho Trợ lý AI", "Tạo chủ đề, bài học và flashcard",
];
const STEP_HINT = [
  "", "Trang ảnh scan được nhận dạng chữ", "Nhận diện Test, Passage, Part",
  "Để hỏi đáp có trích dẫn trang", "Dùng cho Học, Quiz và Dựng đề",
];

/** Tiến trình xử lý sách theo từng bước; tự hỏi lại trạng thái mỗi 4 giây khi đang chạy. */
export default function ProcessingPipeline({ bookId, initial, onDone, onRetry }: {
  bookId: string; initial: any; onDone?: () => void; onRetry?: () => void;
}) {
  const [book, setBook] = useState<any>(initial);
  const failed = book.processing_status === "failed";
  const running = book.processing_status === "processing" || book.processing_status === "pending";

  usePolling(async () => {
    try {
      const r = await apiFetch(`${API}/documents/${bookId}/status`);
      if (!r.ok) return;
      const d = await r.json();
      setBook(d);
      if (d.processing_status === "completed") onDone?.();
    } catch {}
  }, 4000, running);

  const steps: string[] = book.steps || FALLBACK_STEPS;
  const cur = Math.min(Math.max(Number(book.processing_step) || (running ? 2 : 1), 1), steps.length);
  // Bước đọc trang: tiến độ theo số trang đã đọc (có từ migration v14), các bước khác tính nửa bước
  const pageFrac = book.page_count ? Math.min(1, (Number(book.pages_done) || 0) / Number(book.page_count)) : 0.5;
  const pct = failed ? Math.round(((cur - 1) / steps.length) * 100)
    : Math.round(((cur - 1 + (cur === 2 ? pageFrac : 0.5)) / steps.length) * 100);
  const stateOf = (i: number) => (failed && i + 1 === cur ? "fail" : i + 1 < cur ? "done" : i + 1 === cur ? "run" : "todo");
  const color = { done: "var(--success)", run: "var(--brand)", fail: "var(--danger)", todo: "var(--surface-sunken)" } as const;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="st-card" aria-labelledby="pp-top">
        <span className={`st-badge ${failed ? "st-badge-danger" : "st-badge-brand"}`}>
          {failed ? `Dừng ở bước ${cur}` : "Đang xử lý"}
        </span>
        <p id="pp-top" className="ink2" style={{ marginTop: 10 }}>
          {failed
            ? "Studia không xử lý xong cuốn sách này."
            : "Studia đang đọc sách để tách chương, tạo chủ đề và bài học. Bạn có thể rời trang và quay lại sau."}
        </p>
        {failed && book.ingest_error && <p className="st-alert st-alert-danger" role="alert" style={{ marginTop: 12 }}>{book.ingest_error}</p>}
        {running && book.resuming && (
          <p className="st-alert" role="status" style={{ marginTop: 12 }}>Máy chủ vừa khởi động lại. Studia đang chạy tiếp từ trang chưa đọc, phần đã xong được giữ nguyên.</p>
        )}
        {running && book.stalled && (
          <p className="st-alert st-alert-warning" role="status" style={{ marginTop: 12 }}>Vài phút nay chưa thấy tiến triển. Studia sẽ tự chạy tiếp, hoặc bạn bấm "Xử lý lại" để làm lại từ đầu.</p>
        )}
        {running && Number(book.page_count) > 0 && (
          <p className="meta num" style={{ marginTop: 8 }}>Đã đọc {book.pages_done ?? 0}/{book.page_count} trang{Number(book.ocr_page_count) > 0 ? ` · ${book.ocr_page_count} trang scan cần nhận dạng chữ` : ""}</p>
        )}
        <div className="st-progress-track" role="progressbar" aria-label="Tiến độ xử lý" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 8, marginTop: 16 }}>
          <div className="st-progress-fill" style={{ width: `${pct}%`, background: failed ? "var(--danger)" : undefined }} />
        </div>
      </section>

      <section className="st-card" aria-labelledby="pp-h">
        <h2 id="pp-h" className="sec-title" style={{ marginBottom: 4 }}>Các bước</h2>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {steps.map((label, i) => {
            const s = stateOf(i);
            return (
              <li key={label} style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr)", gap: 14, padding: "12px 0" }}>
                <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", font: "650 13px/1 var(--font-sans)", background: color[s], color: s === "todo" ? "var(--ink-muted)" : "var(--on-brand)" }}>
                  {s === "done" ? "✓" : s === "fail" ? "!" : i + 1}
                </span>
                <div>
                  <b style={{ font: "600 15px/22px var(--font-sans)", color: s === "todo" ? "var(--ink-muted)" : "var(--ink)" }}>{label}</b>
                  {s === "run" && STEP_HINT[i] && <p className="meta">{STEP_HINT[i]}</p>}
                  {i + 1 === cur && book.processing_detail && (
                    <p style={{ fontSize: 14, color: failed ? "var(--danger)" : "var(--ink-muted)", marginTop: 2 }}>{book.processing_detail}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {(failed || book.stalled) && onRetry && (
          <div className="row-wrap" style={{ gap: 8, marginTop: 8 }}>
            <button className="st-btn st-btn-primary st-btn-sm" type="button" onClick={onRetry}>Xử lý lại</button>
          </div>
        )}
      </section>
      <p className="meta">Sách đang xử lý chưa dùng được cho Quiz và Trợ lý AI. Các trang đã đọc xong vẫn mở được ở mục Đọc sách.</p>
    </div>
  );
}
