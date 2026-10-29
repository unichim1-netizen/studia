"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { API, apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import AdminGuard from "@/components/AdminGuard";

type Doc = {
  id: string; title: string; source_type?: string; processing_status: string; visibility: string; created_at: string; readers: number;
  description: string; category: string; sort_order: number | null; featured: boolean;
};
type Draft = { title: string; description: string; category: string; sort_order: string; featured: boolean };

function SharedLibrary() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [scope, setScope] = useState<"shared" | "all">("shared");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch(`/admin/library?scope=${scope}`);
    if (r.ok) setDocs((await r.json()).documents || []);
  }, [scope]);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 15000);

  const patch = async (d: Doc, body: object) => {
    setBusy(d.id); setMsg(null);
    const r = await apiFetch(`/admin/documents/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) setMsg({ ok: false, text: typeof j.detail === "string" ? j.detail : "Không lưu được" });
    load();
    return r.ok;
  };

  const setVis = async (d: Doc, visibility: string) => {
    const ok = await patch(d, { visibility });
    if (ok) setMsg({ ok: true, text: visibility === "shared" ? `"${d.title}" đã hiện cho học sinh.` : visibility === "private" ? `Đã đưa "${d.title}" ra khỏi thư viện chung.` : `Đã ẩn "${d.title}".` });
  };

  const startEdit = (d: Doc) => {
    setEditing(d.id);
    setDraft({ title: d.title, description: d.description || "", category: d.category || "", sort_order: d.sort_order == null ? "" : String(d.sort_order), featured: !!d.featured });
  };

  const saveEdit = async (d: Doc) => {
    if (!draft) return;
    const body: Record<string, unknown> = { title: draft.title, description: draft.description, category: draft.category, featured: draft.featured };
    if (draft.sort_order.trim() !== "") body.sort_order = Number(draft.sort_order);
    if (await patch(d, body)) { setMsg({ ok: true, text: `Đã lưu "${draft.title}".` }); setEditing(null); }
  };

  const remove = async (d: Doc) => {
    if (!window.confirm(`Xoá hẳn "${d.title}"? Học sinh đang học sách này sẽ mất bài học và ghi chú liên quan.`)) return;
    const r = await apiFetch(`${API}/documents/${d.id}`, { method: "DELETE" });
    setMsg(r.ok ? { ok: true, text: "Đã xoá sách." } : { ok: false, text: "Không xoá được sách." });
    load();
  };

  const st = (s: string) => s === "completed" ? <span className="st-badge st-badge-success">Sẵn sàng</span>
    : s === "failed" ? <span className="st-badge st-badge-danger">Lỗi xử lý</span> : <span className="st-badge st-badge-brand">Đang xử lý</span>;

  const visBadge = (v: string) => v === "shared" ? <span className="st-badge st-badge-success">Đang hiện</span>
    : v === "shared_draft" ? <span className="st-badge st-badge-warning">Đang ẩn</span> : <span className="st-badge">Sách riêng</span>;

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div><h1 className="page-title">Sách hệ thống</h1><p className="page-sub">Sách ở thư viện chung hiện cho mọi học sinh, kể cả tài khoản miễn phí, và không tính vào lượt upload. Nổi bật lên đầu, rồi theo thứ tự bạn đặt.</p></div>
        <Link className="st-btn st-btn-primary" href="/books">Tải sách vào thư viện chung</Link>
      </header>
      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "st-alert st-alert-success" : "st-alert st-alert-danger"}>{msg.text}</div>}

      <div className="seg" role="radiogroup" aria-label="Phạm vi" style={{ width: "fit-content" }}>
        <button type="button" className="seg-btn" role="radio" aria-checked={scope === "shared"} onClick={() => { setScope("shared"); setDocs(null); }}>Thư viện chung</button>
        <button type="button" className="seg-btn" role="radio" aria-checked={scope === "all"} onClick={() => { setScope("all"); setDocs(null); }}>Mọi sách (kể cả của học sinh)</button>
      </div>

      {!docs ? <div className="skeleton" style={{ height: 300 }} /> : docs.length === 0 ? (
        <div className="st-card" style={{ textAlign: "center", padding: 32 }}>
          <p className="ink2">Chưa có sách nào. Bấm “Tải sách vào thư viện chung”, hoặc chuyển sang “Mọi sách” để đưa sách của một học sinh vào thư viện.</p>
        </div>
      ) : (
        <div className="table-box">
          <table className="table">
            <thead><tr><th scope="col">Sách</th><th scope="col">Xử lý</th><th scope="col">Người đọc</th><th scope="col">Hiện cho học sinh</th><th scope="col"><span className="st-sr">Hành động</span></th></tr></thead>
            <tbody>
              {docs.map((d) => {
                const shared = d.visibility === "shared" || d.visibility === "shared_draft";
                const on = d.visibility === "shared";
                const ready = d.processing_status === "completed";
                return (
                  <Fragment key={d.id}>
                    <tr>
                      <td>
                        <b style={{ color: "var(--ink)", fontWeight: 600 }}>{d.featured ? "★ " : ""}{d.title}</b>
                        <div className="meta">{(d.source_type || "").toUpperCase()} · thêm {new Date(d.created_at).toLocaleDateString("vi-VN")}{d.category ? ` · ${d.category}` : ""}{d.sort_order != null ? ` · thứ tự ${d.sort_order}` : ""}</div>
                        {d.description && <div className="meta" style={{ marginTop: 2 }}>{d.description}</div>}
                      </td>
                      <td>{st(d.processing_status)}</td>
                      <td className="num">{d.readers}</td>
                      <td>
                        {shared ? (
                          <button type="button" className="sw" role="switch" aria-checked={on} aria-label={`Hiện ${d.title} cho học sinh`}
                            disabled={busy === d.id || (!on && !ready)} title={!on && !ready ? "Chờ xử lý xong mới bật hiện được" : undefined}
                            onClick={() => setVis(d, on ? "shared_draft" : "shared")} />
                        ) : visBadge(d.visibility)}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                          <Link className="link" href={ready ? `/books/${d.id}` : `/books/${d.id}/read`}>Mở</Link>
                          {shared ? (
                            <>
                              <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={() => (editing === d.id ? setEditing(null) : startEdit(d))}>{editing === d.id ? "Đóng" : "Sửa thông tin"}</button>
                              <button className="st-btn st-btn-ghost st-btn-sm" type="button" disabled={busy === d.id} onClick={() => setVis(d, "private")}>Gỡ khỏi thư viện</button>
                            </>
                          ) : (
                            <button className="st-btn st-btn-secondary st-btn-sm" type="button" disabled={busy === d.id || !ready} title={!ready ? "Chờ xử lý xong" : undefined}
                              onClick={() => setVis(d, "shared_draft")}>Đưa vào thư viện (đang ẩn)</button>
                          )}
                          <button className="icon-btn" type="button" aria-label={`Xoá ${d.title}`} onClick={() => remove(d)}><Trash2 size={17} strokeWidth={1.75} /></button>
                        </div>
                      </td>
                    </tr>
                    {editing === d.id && draft && (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--surface-sunken)" }}>
                          <form className="stack" style={{ gap: 12, padding: "8px 0" }} onSubmit={(e) => { e.preventDefault(); saveEdit(d); }}>
                            <label className="field"><span className="field-label">Tên sách</span>
                              <input className="input" value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required /></label>
                            <label className="field"><span className="field-label">Mô tả ngắn (hiện trên thẻ sách, tối đa 500 ký tự)</span>
                              <textarea className="input" rows={2} maxLength={500} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} style={{ width: "100%" }} /></label>
                            <div className="row-wrap" style={{ gap: 16, alignItems: "end" }}>
                              <label className="field" style={{ minWidth: 180 }}><span className="field-label">Danh mục</span>
                                <input className="input" value={draft.category} maxLength={60} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="VD: Reading" /></label>
                              <label className="field" style={{ minWidth: 120 }}><span className="field-label">Thứ tự (số nhỏ lên trước)</span>
                                <input className="input" type="number" min={0} max={100000} value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} style={{ width: 120 }} /></label>
                              <label className="row" style={{ gap: 8, cursor: "pointer" }}>
                                <button type="button" className="sw" role="switch" aria-checked={draft.featured} aria-label="Nổi bật" onClick={() => setDraft({ ...draft, featured: !draft.featured })} />
                                <span className="ink2">Nổi bật (luôn ở đầu danh sách)</span>
                              </label>
                            </div>
                            <div className="row" style={{ gap: 8 }}>
                              <button className="st-btn st-btn-primary st-btn-sm" type="submit" disabled={busy === d.id}>Lưu</button>
                              <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={() => setEditing(null)}>Huỷ</button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="meta">Sách đang xử lý chỉ bật hiện được khi đã sẵn sàng. Tắt hiện không xoá tiến độ của học sinh đã học sách đó.</p>
    </div>
  );
}

export default function AdminLibraryPage() {
  return <AdminGuard><SharedLibrary /></AdminGuard>;
}
