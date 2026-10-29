"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";

import { API, apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { X, Plus, Search, Upload, ArrowRight, Trash2 } from "lucide-react";
import { useAccount, refreshAccount } from "@/lib/account";
import BuyPacks from "@/components/BuyPacks";

const statusColors: Record<string, string> = {
  completed: "var(--accent-emerald)",
  processing: "var(--accent-amber)",
  pending: "var(--accent-cyan)",
  failed: "var(--accent-rose)",
};
const statusLabels: Record<string, string> = {
  completed: "Đã xử lý",
  processing: "Đang xử lý...",
  pending: "Chờ xử lý",
  failed: "Lỗi",
};

type UploadMode = "text" | "pdf";

export default function BooksPage() {
  const [books, setBooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>("text");
  const [title, setTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploadMsg, setUploadMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [backgroundNotice, setBackgroundNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { account, isAdmin } = useAccount();
  const [tab, setTab] = useState<"mine" | "shared" | null>(null);
  const [showLimit, setShowLimit] = useState(false);
  const [shareUpload, setShareUpload] = useState(false);

  const openUpload = () => {
    if (account && !account.quota.unlimited && account.quota.remaining <= 0) setShowLimit(true);
    else setShowUpload(true);
  };

  const deleteBook = async (book: any) => {
    if (!window.confirm(`Xoá "${book.title}"? Bài học, flashcard và ghi chú từ sách này cũng bị xoá.${isAdmin ? "" : " Lượt upload đã dùng không được hoàn lại."}`)) return;
    const res = await apiFetch(`${API}/documents/${book.id}`, { method: "DELETE" });
    if (res.ok) fetchBooks();
    else window.alert("Không xoá được sách này.");
  };

  useEffect(() => { fetchBooks(); }, []);
  // Chỉ hỏi lại trạng thái khi còn sách đang xử lý (và tab đang mở)
  const anyProcessing = books.some((b: any) => b.processing_status === "processing" || b.processing_status === "pending");
  usePolling(() => fetchBooks(), 5000, anyProcessing);

  const fetchBooks = async () => {
    try {
      const res = await apiFetch(`${API}/documents/`);
      if (res.ok) {
        const data = await res.json();
        setBooks(data.documents || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const reprocess = async (id: string, discardEdits = false) => {
    const res = await apiFetch(`${API}/documents/${id}/reprocess${discardEdits ? "?discard_edits=true" : ""}`, { method: "POST" });
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      if (data.detail?.requires === "discard_edits" && window.confirm(`${data.detail.message} Tiếp tục?`)) {
        return reprocess(id, true);
      }
      if (typeof data.detail === "string") window.alert(data.detail);
      return;
    }
    if (res.ok) fetchBooks();
    else window.alert("Không xử lý lại được tài liệu này.");
  };

  // Bấm "Tải lên và phân tích": kiểm tra nhanh rồi đóng modal ngay, việc tải tệp và xử lý chạy ở nền.
  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) return;
    const file = uploadMode === "pdf" ? pdfFile : null;
    const text = textContent;
    if (uploadMode === "pdf" && !file) { setUploadMsg({ type: "error", text: "Hãy chọn tệp PDF hoặc DOCX" }); return; }
    if (uploadMode === "text" && !text.trim()) { setUploadMsg({ type: "error", text: "Hãy nhập nội dung tài liệu" }); return; }
    const share = isAdmin && shareUpload;

    setShowUpload(false);
    setUploadMsg(null);
    setTitle(""); setTextContent(""); setPdfFile(null);
    setNoticeError(false);
    setBackgroundNotice(`Đang tải lên "${name}"… Bạn có thể tiếp tục dùng app, hệ thống sẽ xử lý ở nền.`);

    (async () => {
      try {
        let res: Response;
        if (file) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("title", name);
          if (share) fd.append("shared", "true");
          res = await apiFetch(`${API}/documents/upload-file`, { method: "POST", body: fd });
        } else {
          res = await apiFetch(`${API}/documents/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: name, source_type: "text", raw_content: text, shared: share }),
          });
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 402) {
          setBackgroundNotice(null); setShowLimit(true); refreshAccount();
        } else if (res.ok) {
          refreshAccount();
          fetchBooks();
          setBackgroundNotice(`Đã nhận "${name}". Hệ thống đang phân tích ở nền, bạn có thể mở đọc ngay khi sách xuất hiện.`);
          setTimeout(() => setBackgroundNotice((n) => (n && n.startsWith("Đã nhận") ? null : n)), 6000);
        } else {
          setNoticeError(true);
          setBackgroundNotice(`Không tải lên được "${name}": ${typeof data.detail === "string" ? data.detail : "Upload thất bại"}`);
        }
      } catch {
        setNoticeError(true);
        setBackgroundNotice(`Không tải lên được "${name}": không kết nối được, vui lòng thử lại sau.`);
      }
    })();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && /\.(pdf|docx)$/i.test(file.name)) { setPdfFile(file); setUploadMode("pdf"); }
  };

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "processing">("all");
  const mine = books.filter((b: any) => !b.is_shared);
  const sharedBooks = books.filter((b: any) => b.is_shared);
  const activeTab = tab ?? (mine.length || !sharedBooks.length ? "mine" : "shared");
  const list = activeTab === "mine" ? mine : sharedBooks;
  const processingBook = mine.find((b: any) => b.processing_status === "processing" || b.processing_status === "pending");
  const counts = {
    all: list.length,
    ready: list.filter((b: any) => b.processing_status === "completed").length,
    processing: list.filter((b: any) => b.processing_status !== "completed").length,
  };
  const shown = list.filter((b: any) =>
    (filter === "all" || (filter === "ready" ? b.processing_status === "completed" : b.processing_status !== "completed")) &&
    (!query.trim() || (b.title || "").toLowerCase().includes(query.trim().toLowerCase())));
  const covers = [
    { background: "var(--navy)", color: "var(--on-navy)", sub: "var(--on-navy)" },
    { background: "var(--brand-tint)", color: "var(--ink)", sub: "var(--ink-muted)" },
    { background: "var(--accent-tint)", color: "var(--ink)", sub: "var(--ink-muted)" },
  ];
  const statusBadge = (s: string) => s === "completed" ? "st-badge st-badge-success" : s === "failed" ? "st-badge st-badge-danger" : "st-badge st-badge-brand";
  const statusText = (s: string) => s === "completed" ? "Sẵn sàng" : s === "failed" ? "Lỗi xử lý" : s === "processing" ? "Đang xử lý" : "Chờ xử lý";
  const q = account?.quota;
  const noCredit = !!q && !q.unlimited && q.remaining <= 0;

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Thư viện sách</h1>
          <p className="page-sub">Học từ Thư viện Studia, hoặc tải sách của riêng bạn để Studia tách thành bài học, flashcard và đề thi.</p>
        </div>
        <button className="st-btn st-btn-primary" type="button" onClick={openUpload}>
          <Plus size={18} strokeWidth={2} /> Tải sách lên
        </button>
      </header>

      <div className="tabs page-tabs" role="tablist" aria-label="Nguồn sách">
        <button className="tab" type="button" role="tab" aria-selected={activeTab === "shared"} onClick={() => { setTab("shared"); setFilter("all"); }}>
          Thư viện Studia <span className="meta num">· {sharedBooks.length}</span>
        </button>
        <button className="tab" type="button" role="tab" aria-selected={activeTab === "mine"} onClick={() => { setTab("mine"); setFilter("all"); }}>
          Sách của tôi <span className="meta num">· {mine.length}</span>
        </button>
      </div>

      {activeTab === "mine" && q && !q.unlimited && (
        <div className="quota-bar" role="status">
          <div style={{ flex: 1, minWidth: 220 }}>
            <b style={{ fontWeight: 600 }}>{q.remaining > 0 ? `Còn ${q.remaining} lượt upload` : `Đã dùng hết lượt upload (${q.used}/${q.free + q.purchased + q.adjusted})`}</b>
            <p className="meta">{q.purchased > 0 ? `Gồm ${q.free} lượt miễn phí và ${q.purchased} lượt đã mua. ` : `Tài khoản miễn phí được tải ${q.free} cuốn. `}Lượt đã mua không hết hạn.</p>
          </div>
          <Link className={`st-btn ${noCredit ? "st-btn-primary" : "st-btn-secondary"} st-btn-sm`} href="/billing">Mua thêm lượt</Link>
        </div>
      )}

      {activeTab === "mine" && (backgroundNotice || processingBook) && (
        <div role={noticeError ? "alert" : "status"} className="st-enter" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: "var(--radius-md)", background: noticeError ? "var(--danger-tint, var(--warning-tint))" : "var(--brand-tint)", color: "var(--ink)" }}>
          {!noticeError && <span className="st-spinner" style={{ color: "var(--brand)" }} aria-hidden="true" />}
          <span style={{ flex: 1 }}>
            {backgroundNotice || <><b style={{ fontWeight: 600 }}>{processingBook.title}</b> đang được phân tích — bạn vẫn có thể đọc ngay trong lúc chờ.</>}
          </span>
          {backgroundNotice && (
            <button className="icon-btn" type="button" aria-label="Ẩn thông báo" onClick={() => setBackgroundNotice(null)} style={{ width: 32, height: 32 }}><X size={16} strokeWidth={2} /></button>
          )}
        </div>
      )}

      {list.length > 0 && (
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div className="seg" role="tablist" aria-label="Lọc sách">
            {([["all", "Tất cả"], ["ready", "Sẵn sàng"], ["processing", "Đang xử lý"]] as const).map(([k, label]) => (
              <button key={k} className="seg-btn" type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                {label} <span className="meta num">{counts[k]}</span>
              </button>
            ))}
          </div>
          <label className="input-icon" style={{ width: 280, maxWidth: "100%" }}>
            <Search className="ico" size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="st-sr">Tìm sách</span>
            <input className="input" type="search" placeholder="Tìm theo tên sách" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      )}

      {loading ? (
        <div className="grid-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 300 }} />)}</div>
      ) : list.length === 0 ? (
        activeTab === "shared" ? (
          <EmptyState
            title="Thư viện Studia chưa có sách"
            description="Quản lý sẽ sớm thêm đề thi và sách học vào đây. Trong lúc chờ, bạn có thể tải sách của riêng mình hoặc làm thử một đề IELTS."
            primary={{ label: "Làm thử một đề IELTS", href: "/exam" }}
          />
        ) : (
          <EmptyState
            title="Bạn chưa tải sách nào"
            description={noCredit ? "Bạn đã dùng hết lượt upload. Mua thêm lượt để tải sách của riêng mình." : "Tải một tài liệu để Studia tách chủ đề, tạo lịch học, flashcard và quiz từ chính nội dung đó."}
            steps={[
              { title: "Chọn tệp", desc: "PDF, DOCX hoặc văn bản dán trực tiếp" },
              { title: "Chờ AI xử lý", desc: "Quá trình chạy nền, bạn vẫn dùng app bình thường" },
              { title: "Đặt mục tiêu học", desc: "Studia xếp bài học theo hạn bạn chọn" },
            ]}
            primary={{ label: "Tải sách lên", onClick: openUpload }}
            secondary={sharedBooks.length ? { label: "Xem Thư viện Studia", onClick: () => setTab("shared") } : undefined}
          />
        )
      ) : (
        <section className="grid-3" aria-label="Danh sách sách">
          {shown.map((book: any, idx: number) => {
            const isReady = book.processing_status === "completed";
            const isReadable = isReady || book.processing_status === "processing" || book.processing_status === "pending" || book.processing_status === "failed";
            const fileKind = (/\.docx$/i.test(book.file_path || "") ? "docx" : book.source_type || "").toUpperCase();
            const cv = covers[idx % covers.length];
            const href = isReady ? `/books/${book.id}` : isReadable ? `/books/${book.id}/read` : "#";
            const canDelete = book.is_owner || isAdmin;
            return (
              <Link key={book.id} href={href} className="book-card" aria-disabled={!isReadable}
                style={{ padding: 16, gap: 14, position: "relative", pointerEvents: isReadable || book.processing_status === "failed" ? "auto" : "none" }}>
                <div style={{ height: 150, borderRadius: "var(--radius-md)", padding: 16, display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", overflow: "hidden", background: cv.background, color: cv.color }}>
                  <span className="eyebrow" style={{ color: cv.sub, opacity: 0.85 }}>{fileKind || "Tài liệu"}</span>
                  <b style={{ font: "700 20px/1.15 var(--font-display)", letterSpacing: "-0.3px", maxWidth: "85%", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{book.title}</b>
                  {idx % covers.length === 0 && <span aria-hidden="true" style={{ position: "absolute", right: -18, bottom: -18, width: 72, height: 72, borderRadius: 36, background: "var(--accent)" }} />}
                </div>
                <div>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span className="lrow-title" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.title}</span>
                    {book.visibility === "shared_draft"
                      ? <span className="st-badge st-badge-warning" style={{ flexShrink: 0 }}>Đang ẩn</span>
                      : <span className={statusBadge(book.processing_status)} style={{ flexShrink: 0 }}>{statusText(book.processing_status)}</span>}
                  </div>
                  <div className="meta" style={{ marginTop: 4 }}>{book.category ? `${book.category} · ` : ""}{book.topic_count > 0 ? `${book.topic_count} chủ đề` : "Đang tách chủ đề"}</div>
                  {book.description && <div className="ink2" style={{ marginTop: 4, fontSize: 13.5, lineHeight: "19px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{book.description}</div>}
                </div>
                <div className="row" style={{ marginTop: "auto", justifyContent: "space-between", pointerEvents: "auto" }}>
                  {book.processing_status === "failed" && (book.is_owner || isAdmin) ? (
                    <button type="button" className="st-btn st-btn-secondary st-btn-sm"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); reprocess(book.id); }}>Xử lý lại</button>
                  ) : isReadable ? (
                    <span className="link">{isReady ? "Mở sách" : "Đọc ngay trong lúc chờ"} <ArrowRight size={16} strokeWidth={2} /></span>
                  ) : <span />}
                  {canDelete && (activeTab === "mine" || isAdmin) && (
                    <button type="button" className="icon-btn" aria-label={`Xoá ${book.title}`} title="Xoá sách" style={{ width: 36, height: 36 }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteBook(book); }}>
                      <Trash2 size={17} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </Link>
            );
          })}
          {activeTab === "mine" && (
            <button type="button" className="book-card" onClick={openUpload}
              style={{ borderStyle: "dashed", borderColor: "var(--border-control)", alignItems: "center", justifyContent: "center", textAlign: "center", minHeight: 280, font: "inherit", cursor: "pointer" }}>
              <span className="tile" aria-hidden="true"><Upload size={22} strokeWidth={1.75} /></span>
              <span className="title">Tải sách lên</span>
              <span className="meta" style={{ maxWidth: 240 }}>{noCredit ? "Cần mua thêm lượt upload" : "PDF, DOCX hoặc văn bản dán trực tiếp"}</span>
            </button>
          )}
        </section>
      )}

      {showLimit && (
        <div className="exam-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="lim-h" onClick={() => setShowLimit(false)}>
          <div className="exam-modal" style={{ maxWidth: 560, position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" type="button" aria-label="Đóng" onClick={() => setShowLimit(false)} style={{ position: "absolute", top: 16, right: 16 }}><X size={20} strokeWidth={2} /></button>
            <h2 id="lim-h" className="heading-2" style={{ paddingRight: 40 }}>Bạn đã dùng hết lượt upload</h2>
            <p className="ink2" style={{ marginTop: 6, marginBottom: 18 }}>
              Tài khoản miễn phí được tải {q?.free ?? 1} cuốn sách. Mua thêm lượt để tải sách khác — mỗi lượt là một cuốn, không hết hạn.
            </p>
            <BuyPacks compact />
            <div className="row" style={{ gap: 8, marginTop: 16 }}>
              <button className="st-btn st-btn-secondary" type="button" style={{ flex: 1 }} onClick={() => { setShowLimit(false); setTab("shared"); }}>Học Thư viện Studia trước</button>
            </div>
            <p className="meta" style={{ marginTop: 12 }}>Thanh toán bằng chuyển khoản ngân hàng. Lượt được cộng tự động khoảng 1 phút sau khi tiền về.</p>
          </div>
        </div>
      )}

      {showUpload && (
        <div className="exam-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="up-h" onClick={() => { setShowUpload(false); setUploadMsg(null); }}>
          <div className="exam-modal" style={{ maxWidth: 600, position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" type="button" aria-label="Đóng" onClick={() => { setShowUpload(false); setUploadMsg(null); }} style={{ position: "absolute", top: 16, right: 16 }}><X size={20} strokeWidth={2} /></button>
            <h2 id="up-h" className="heading-2">Tải sách lên</h2>
            <p className="meta" style={{ marginTop: 4, marginBottom: 20 }}>
              AI tự phân tích và tạo bài học, flashcard từ tài liệu.{q && !q.unlimited ? ` Dùng 1 lượt upload (còn ${q.remaining}).` : ""}
            </p>

            <div className="seg" role="tablist" aria-label="Cách thêm" style={{ width: "100%", marginBottom: 20 }}>
              <button className="seg-btn" type="button" role="tab" aria-selected={uploadMode === "pdf"} onClick={() => setUploadMode("pdf")} style={{ flex: 1, justifyContent: "center" }}>Tệp PDF / DOCX</button>
              <button className="seg-btn" type="button" role="tab" aria-selected={uploadMode === "text"} onClick={() => setUploadMode("text")} style={{ flex: 1, justifyContent: "center" }}>Dán văn bản</button>
            </div>

            <form onSubmit={handleUpload} className="stack" style={{ gap: 16 }}>
              <label className="field"><span className="field-label">Tên tài liệu</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ví dụ: Cambridge IELTS 21 Academic" required />
              </label>

              {uploadMode === "text" ? (
                <label className="field"><span className="field-label">Nội dung</span>
                  <textarea className="input" rows={7} value={textContent} onChange={(e) => setTextContent(e.target.value)} placeholder="Dán nội dung chương sách, bài đọc hoặc ghi chú vào đây…" />
                  <span className="meta num">{textContent.length.toLocaleString("vi-VN")} ký tự</span>
                </label>
              ) : (
                <div className={`drop-zone${dragOver ? " drag-over" : ""}`} role="button" tabIndex={0}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}>
                  <input ref={fileRef} type="file" accept=".pdf,.docx" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) setPdfFile(e.target.files[0]); }} />
                  <span className="tile" style={{ margin: "0 auto 12px" }} aria-hidden="true"><Upload size={22} strokeWidth={1.75} /></span>
                  {pdfFile ? (
                    <><p className="title">{pdfFile.name}</p><p className="meta num">{(pdfFile.size / 1024 / 1024).toFixed(1)} MB · bấm để đổi tệp</p></>
                  ) : (
                    <><p className="title">Kéo thả PDF hoặc DOCX vào đây</p><p className="meta">hoặc bấm để chọn tệp</p></>
                  )}
                </div>
              )}

              {isAdmin && (
                <label className="row" style={{ gap: 12, padding: 12, borderRadius: "var(--radius-md)", background: "var(--surface-sunken)", cursor: "pointer" }}>
                  <button type="button" className="sw" role="switch" aria-checked={shareUpload} aria-label="Đưa vào thư viện chung" onClick={() => setShareUpload(v => !v)} />
                  <span><b style={{ fontWeight: 600 }}>Đưa vào Thư viện Studia</b><span className="meta" style={{ display: "block" }}>Sách ở trạng thái ẩn; bật hiện cho học sinh trong Quản trị › Thư viện chung khi đã xử lý xong.</span></span>
                </label>
              )}

              {uploadMsg && (
                <div role="alert" className={uploadMsg.type === "success" ? "st-alert st-alert-success" : "st-alert st-alert-danger"}>{uploadMsg.text}</div>
              )}

              <button type="submit" className="st-btn st-btn-primary st-btn-lg st-btn-block">Tải lên và phân tích</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
