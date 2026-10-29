"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatVnd, ORDER_STATUS, useAccount } from "@/lib/account";
import AdminGuard, { fmtDateTime, initials } from "@/components/AdminGuard";

const REASON: Record<string, string> = { purchase: "Mua gói", upload: "Tải sách", admin_adjust: "Quản lý điều chỉnh", refund: "Hoàn lượt" };

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { account: me } = useAccount();
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch(`/admin/users/${id}`);
    if (r.ok) setD(await r.json()); else setMsg({ ok: false, text: "Không tìm thấy tài khoản." });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const call = async (path: string, method: string, body: any, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await apiFetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: ok }); load(); return true; }
    setMsg({ ok: false, text: typeof j.detail === "string" ? j.detail : "Thao tác thất bại" });
    return false;
  };

  if (!d) return <div className="wrap">{msg ? <div role="alert" className="st-card">{msg.text}</div> : <div className="skeleton" style={{ height: 400 }} />}</div>;
  const u = d.user, q = d.quota;
  const isMe = me?.id === u.id;
  const locked = u.status === "locked";

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <Link className="crumb" href="/admin/users"><ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />Tài khoản</Link>
          <div className="row" style={{ gap: 14 }}>
            <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, font: "650 18px/1 var(--font-sans)", background: u.role === "admin" ? "var(--navy)" : "var(--brand-tint)", color: u.role === "admin" ? "var(--on-navy)" : "var(--brand)" }}>{initials(u.full_name, u.email)}</span>
            <div>
              <h1 className="page-title" style={{ fontSize: 28, lineHeight: "34px" }}>{u.full_name || u.email || "(chưa có email)"}</h1>
              <p className="page-sub" style={{ marginTop: 0 }}>{u.email || u.id} · tham gia {u.created_at ? new Date(u.created_at).toLocaleDateString("vi-VN") : "—"} · hoạt động {fmtDateTime(u.last_seen_at)}</p>
            </div>
          </div>
        </div>
        <span className={locked ? "st-badge st-badge-danger" : "st-badge st-badge-success"}>{locked ? "Bị khoá" : "Hoạt động"}</span>
      </header>

      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "st-alert st-alert-success" : "st-alert st-alert-danger"}>{msg.text}</div>}

      <div className="split">
        <div className="stack" style={{ gap: 16 }}>
          <section aria-label="Tóm tắt" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <div className="st-stat"><span className="meta">Lượt còn</span><span className="st-stat-value num">{q.unlimited ? "∞" : q.remaining}</span></div>
            <div className="st-stat"><span className="meta">Sách đã tải</span><span className="st-stat-value num">{d.documents.length}</span></div>
            <div className="st-stat"><span className="meta">Lượt đã mua</span><span className="st-stat-value num">{q.purchased}</span></div>
          </section>

          <section className="st-card" aria-labelledby="lg-h">
            <div className="sec-head"><h2 id="lg-h" className="sec-title">Sổ lượt upload</h2><span className="meta">Miễn phí: {q.free}</span></div>
            {d.ledger.length === 0 ? <p className="meta">Chưa có thay đổi nào.</p> : d.ledger.map((r: any) => (
              <div key={r.id} className="ledger-row">
                <span className="meta">{new Date(r.created_at).toLocaleDateString("vi-VN")}</span>
                <span>{REASON[r.reason] || r.reason}{r.note ? ` · ${r.note}` : ""}</span>
                <b className="num" style={{ textAlign: "right", color: r.delta > 0 ? "var(--success)" : "var(--ink-muted)" }}>{r.delta > 0 ? `+${r.delta}` : `−${Math.abs(r.delta)}`}</b>
              </div>
            ))}
          </section>

          <section className="st-card" aria-labelledby="od-h">
            <div className="sec-head"><h2 id="od-h" className="sec-title">Đơn thanh toán</h2></div>
            {d.orders.length === 0 ? <p className="meta">Chưa có đơn nào.</p> : (
              <div className="stack" style={{ gap: 8 }}>
                {d.orders.map((o: any) => {
                  const st = ORDER_STATUS[o.status] || { label: o.status, badge: "st-badge" };
                  return (
                    <div key={o.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--hairline)" }}>
                      <span><b className="num" style={{ fontWeight: 600 }}>{o.code}</b> <span className="meta">· +{o.books} sách · {formatVnd(o.amount_vnd)} · {fmtDateTime(o.created_at)}</span></span>
                      <span className={st.badge}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="st-card" aria-labelledby="bk-h">
            <div className="sec-head"><h2 id="bk-h" className="sec-title">Sách đã tải</h2></div>
            {d.documents.length === 0 ? <p className="meta">Chưa tải sách nào.</p> : (
              <div className="stack" style={{ gap: 8 }}>
                {d.documents.map((doc: any) => (
                  <div key={doc.id} className="lrow">
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="lrow-title" style={{ display: "block", fontSize: 14.5 }}>{doc.title}</span>
                      <span className="meta">{doc.processing_status === "completed" ? "Sẵn sàng" : doc.processing_status === "failed" ? "Lỗi xử lý" : "Đang xử lý"} · {new Date(doc.created_at).toLocaleDateString("vi-VN")}{doc.visibility && doc.visibility !== "private" ? " · thư viện chung" : ""}</span>
                    </span>
                    {(doc.visibility || "private") === "private" && doc.processing_status === "completed" && (
                      <button className="st-btn st-btn-ghost st-btn-sm" type="button" disabled={busy}
                        onClick={() => call(`/admin/documents/${doc.id}`, "PATCH", { visibility: "shared_draft" }, `Đã đưa "${doc.title}" vào thư viện chung (đang ẩn).`)}>Đưa vào thư viện chung</button>
                    )}
                    <Link className="link" href={`/books/${doc.id}`}>Mở</Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <section className="st-card stack" style={{ gap: 14 }} aria-labelledby="rl-h">
            <h2 id="rl-h" className="heading-3">Vai trò</h2>
            <div className="seg" role="radiogroup" aria-label="Vai trò" style={{ width: "100%" }}>
              {(["student", "admin"] as const).map((r) => (
                <button key={r} className="seg-btn" type="button" role="radio" aria-checked={u.role === r} aria-pressed={u.role === r}
                  disabled={busy || (isMe && r === "student")} style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => u.role !== r && window.confirm(r === "admin" ? "Cấp quyền quản lý? Người này sẽ có toàn quyền: tài khoản, thanh toán, thư viện chung." : "Hạ xuống học sinh?")
                    && call(`/admin/users/${u.id}`, "PATCH", { role: r }, "Đã đổi vai trò.")}>
                  {r === "admin" ? "Quản lý" : "Học sinh"}
                </button>
              ))}
            </div>
            <p className="meta">Quản lý có toàn quyền: tải sách không giới hạn, quản lý tài khoản, thanh toán và thư viện chung.</p>
          </section>

          {!q.unlimited && (
            <section className="st-card stack" style={{ gap: 12 }} aria-labelledby="cr-h">
              <h2 id="cr-h" className="heading-3">Điều chỉnh lượt</h2>
              <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
                <label className="field" style={{ width: 100 }}><span className="field-label">Số lượt</span><input className="input" type="number" min={1} value={delta} onChange={(e) => setDelta(Math.max(1, Number(e.target.value) || 1))} /></label>
                <label className="field" style={{ flex: 1 }}><span className="field-label">Lý do</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Bắt buộc, lưu vào sổ" /></label>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="st-btn st-btn-secondary" type="button" style={{ flex: 1 }} disabled={busy || !reason.trim()}
                  onClick={async () => { if (await call(`/admin/users/${u.id}/credits`, "POST", { delta: -delta, reason }, `Đã trừ ${delta} lượt.`)) setReason(""); }}>Trừ</button>
                <button className="st-btn st-btn-primary" type="button" style={{ flex: 1 }} disabled={busy || !reason.trim()}
                  onClick={async () => { if (await call(`/admin/users/${u.id}/credits`, "POST", { delta, reason }, `Đã cộng ${delta} lượt.`)) setReason(""); }}>Cộng lượt</button>
              </div>
            </section>
          )}

          {!isMe && (
            <section className="st-card stack" style={{ gap: 12, borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)" }} aria-labelledby="lk-h">
              <h2 id="lk-h" className="heading-3">{locked ? "Mở khoá tài khoản" : "Khoá tài khoản"}</h2>
              <p className="meta">{locked ? "Người dùng đăng nhập và học lại được như cũ." : "Người dùng không gọi được API nào nữa (bị chặn trong khoảng 30 giây). Dữ liệu giữ nguyên, mở khoá lúc nào cũng được."}</p>
              <button className="st-btn st-btn-secondary" type="button" disabled={busy} style={locked ? undefined : { color: "var(--danger)" }}
                onClick={() => (locked || window.confirm("Khoá tài khoản này?")) && call(`/admin/users/${u.id}`, "PATCH", { status: locked ? "active" : "locked" }, locked ? "Đã mở khoá." : "Đã khoá tài khoản.")}>
                {locked ? "Mở khoá" : "Khoá tài khoản"}
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminUserDetailPage() {
  return <AdminGuard><Detail /></AdminGuard>;
}
