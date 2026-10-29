"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatVnd, ORDER_STATUS } from "@/lib/account";
import AdminGuard, { fmtDateTime } from "@/components/AdminGuard";

const TABS: [string, string][] = [["", "Tất cả"], ["review", "Cần kiểm tra"], ["pending", "Chờ thanh toán"], ["paid", "Đã thanh toán"], ["expired", "Hết hạn"], ["cancelled", "Đã huỷ"], ["rejected", "Từ chối"]];

function Orders() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [txs, setTxs] = useState<any[]>([]);
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ status, q: debounced, page: String(page) });
    const [o, t, pend] = await Promise.all([
      apiFetch(`/admin/orders?${p}`), apiFetch("/admin/transactions?status=unmatched"), apiFetch("/admin/orders?status=pending"),
    ]);
    if (o.ok) setData(await o.json());
    if (t.ok) setTxs((await t.json()).transactions || []);
    if (pend.ok) {
      const pj = await pend.json();
      const ex = await apiFetch("/admin/orders?status=expired").then(r => r.ok ? r.json() : { orders: [] });
      setOpenOrders([...(pj.orders || []), ...(ex.orders || [])]);
    }
  }, [status, debounced, page]);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, path: string, body: any, ok: string) => {
    setBusy(key); setMsg(null);
    const r = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: typeof j.detail === "string" ? j.detail : "Thao tác thất bại" });
    load();
  };

  const review = (data?.orders || []).filter((o: any) => o.status === "review");
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="wrap stagger">
      <header className="page-head"><div><h1 className="page-title">Thanh toán</h1><p className="page-sub">Đơn khớp mã và đủ tiền được duyệt tự động qua webhook ngân hàng. Phần còn lại xử lý ở đây.</p></div></header>
      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "st-alert st-alert-success" : "st-alert st-alert-danger"}>{msg.text}</div>}

      {(txs.length > 0 || (status === "" && review.length > 0)) && (
        <section className="st-card" style={{ borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)" }} aria-labelledby="un-h">
          <div className="sec-head"><h2 id="un-h" className="sec-title">Cần kiểm tra · {txs.length + (status === "" ? review.length : 0)}</h2><span className="meta">Tiền đã về nhưng không tự khớp được</span></div>
          <div className="stack" style={{ gap: 0 }}>
            {status === "" && review.map((o: any) => (
              <div key={o.id} className="row-wrap" style={{ justifyContent: "space-between", gap: 12, padding: "14px 0", borderTop: "1px solid var(--hairline)" }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontWeight: 600 }}>Đơn {o.code} (+{o.books} sách) · nhận {formatVnd(o.paid_amount_vnd)} / cần {formatVnd(o.amount_vnd)}</b>
                  <div className="meta">{o.user_name || o.user_email} · {fmtDateTime(o.updated_at || o.created_at)}{o.note && !o.note.startsWith("Thiếu tiền") ? ` · ${o.note}` : ""}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="st-btn st-btn-ghost st-btn-sm" type="button" disabled={!!busy} onClick={() => act(o.id, `/admin/orders/${o.id}/reject`, { note: "Từ chối sau kiểm tra" }, `Đã từ chối đơn ${o.code}.`)}>Từ chối</button>
                  <button className="st-btn st-btn-primary st-btn-sm" type="button" disabled={!!busy} onClick={() => act(o.id, `/admin/orders/${o.id}/confirm`, { note: "Duyệt sau kiểm tra" }, `Đã duyệt đơn ${o.code}.`)}>Vẫn duyệt</button>
                </div>
              </div>
            ))}
            {txs.map((t) => (
              <div key={t.id} className="row-wrap" style={{ justifyContent: "space-between", gap: 12, padding: "14px 0", borderTop: "1px solid var(--hairline)" }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontWeight: 600 }}>{t.code ? `Mã ${t.code} không thuộc đơn nào` : "Không có mã đơn trong nội dung"} · {formatVnd(t.amount_vnd)}</b>
                  <div className="row-wrap" style={{ gap: 8, marginTop: 4 }}><span className="memo">{t.content || "(trống)"}</span><span className="meta">{fmtDateTime(t.received_at)} · GD {t.provider_txn_id}</span></div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <label className="st-sr" htmlFor={`as-${t.id}`}>Gán cho đơn</label>
                  <select id={`as-${t.id}`} className="input" style={{ width: 220, height: 36 }} value={assign[t.id] || ""} onChange={(e) => setAssign(a => ({ ...a, [t.id]: e.target.value }))}>
                    <option value="">Gán cho đơn…</option>
                    {openOrders.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.user_email || o.user_name} · {formatVnd(o.amount_vnd)}</option>)}
                  </select>
                  <button className="st-btn st-btn-primary st-btn-sm" type="button" disabled={!assign[t.id] || !!busy} onClick={() => act(t.id, `/admin/transactions/${t.id}/assign`, { order_id: assign[t.id] }, "Đã gán và duyệt đơn.")}>Gán &amp; duyệt</button>
                  <button className="st-btn st-btn-ghost st-btn-sm" type="button" disabled={!!busy} onClick={() => window.confirm("Bỏ qua giao dịch này? (không phải tiền mua gói)") && act(t.id, `/admin/transactions/${t.id}/ignore`, {}, "Đã bỏ qua giao dịch.")}>Bỏ qua</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 12 }}>
        <div className="row-wrap" role="group" aria-label="Trạng thái" style={{ gap: 6 }}>
          {TABS.map(([k, label]) => <button key={k || "all"} className="st-chip" type="button" aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1); }}>{label}</button>)}
        </div>
        <label className="input-icon" style={{ width: "min(300px, 100%)" }}>
          <span className="st-sr">Tìm đơn</span>
          <Search className="ico" size={18} strokeWidth={1.75} aria-hidden="true" />
          <input className="input" type="search" placeholder="Mã đơn, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {!data ? <div className="skeleton" style={{ height: 300 }} /> : data.orders.length === 0 ? (
        <div className="st-card" style={{ textAlign: "center" }}><p className="ink2">Không có đơn nào.</p></div>
      ) : (
        <div className="table-box">
          <table className="table">
            <thead><tr><th scope="col">Mã</th><th scope="col">Học sinh</th><th scope="col">Gói</th><th scope="col">Số tiền</th><th scope="col">Trạng thái</th><th scope="col">Cách duyệt</th><th scope="col">Tạo lúc</th><th scope="col"><span className="st-sr">Hành động</span></th></tr></thead>
            <tbody>
              {data.orders.map((o: any) => {
                const st = ORDER_STATUS[o.status] || { label: o.status, badge: "st-badge" };
                return (
                  <tr key={o.id}>
                    <td className="num" style={{ color: "var(--ink)", fontWeight: 600 }}>{o.code}</td>
                    <td><Link className="link" href={`/admin/users/${o.user_id}`} style={{ fontWeight: 500 }}>{o.user_name || o.user_email || o.user_id.slice(0, 8)}</Link></td>
                    <td>+{o.books} sách</td>
                    <td className="num">{formatVnd(o.amount_vnd)}</td>
                    <td><span className={st.badge}>{st.label}</span></td>
                    <td>{o.status === "paid" ? (o.paid_method === "webhook" ? `Webhook · ${fmtDateTime(o.paid_at)}` : `Duyệt tay · ${fmtDateTime(o.paid_at)}`) : "—"}</td>
                    <td>{fmtDateTime(o.created_at)}</td>
                    <td>{["pending", "expired", "review"].includes(o.status) && (
                      <button className="st-btn st-btn-ghost st-btn-sm" type="button" disabled={!!busy}
                        onClick={() => window.confirm(`Duyệt tay đơn ${o.code}? Chỉ làm khi đã thấy tiền trong sao kê.`) && act(o.id, `/admin/orders/${o.id}/confirm`, { note: "Quản lý duyệt tay" }, `Đã duyệt đơn ${o.code}.`)}>Duyệt tay</button>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 && (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="meta num">Trang {page} / {pages}</span>
          <div className="row" style={{ gap: 6 }}>
            <button className="st-btn st-btn-secondary st-btn-sm" type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Trước</button>
            <button className="st-btn st-btn-secondary st-btn-sm" type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Sau</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminOrdersPage() {
  return <AdminGuard><Orders /></AdminGuard>;
}
