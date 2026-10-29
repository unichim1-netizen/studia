"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { API, apiFetch } from "@/lib/api";
import AdminGuard from "@/components/AdminGuard";

const BANKS = ["vietcombank", "mbbank", "techcombank", "acb", "tpbank", "bidv", "vietinbank", "agribank", "vpbank", "sacombank", "vib", "ocb", "shb", "hdbank", "msb"];

type Pack = { id?: string; name: string; books: number; price_vnd: number; description?: string | null; highlight?: boolean; active?: boolean; _dirty?: boolean };

function Packs() {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([apiFetch("/admin/packs"), apiFetch("/admin/settings")]);
    if (p.ok) setPacks((await p.json()).packs || []);
    if (s.ok) setCfg(await s.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  const say = (ok: boolean, text: string) => setMsg({ ok, text });
  const err = async (r: Response) => { const j = await r.json().catch(() => ({})); return typeof j.detail === "string" ? j.detail : "Lưu thất bại"; };

  const edit = (i: number, patch: Partial<Pack>) => setPacks(ps => ps!.map((p, j) => j === i ? { ...p, ...patch, _dirty: true } : p));

  const savePack = async (p: Pack) => {
    setBusy(true); setMsg(null);
    const body = { name: p.name, books: Number(p.books), price_vnd: Number(p.price_vnd), description: p.description || "", highlight: !!p.highlight, active: !!p.active };
    const r = p.id
      ? await apiFetch(`/admin/packs/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await apiFetch("/admin/packs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { say(true, `Đã lưu gói "${p.name}".`); load(); } else say(false, await err(r));
  };

  const removePack = async (p: Pack) => {
    if (!p.id) { setPacks(ps => ps!.filter(x => x !== p)); return; }
    if (!window.confirm(`Xoá gói "${p.name}"? Gói đã có đơn sẽ chỉ bị ngừng bán.`)) return;
    const r = await apiFetch(`${API}/admin/packs/${p.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    say(r.ok, r.ok ? (j.deactivated ? "Gói đã có đơn nên chỉ ngừng bán." : "Đã xoá gói.") : "Không xoá được gói.");
    load();
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await apiFetch("/admin/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ free_book_limit: Number(cfg.free_book_limit), order_ttl_minutes: Number(cfg.order_ttl_minutes), bank: cfg.bank }),
    });
    setBusy(false);
    if (r.ok) { setCfg(await r.json()); say(true, "Đã lưu cài đặt."); } else say(false, await err(r));
  };

  if (!packs || !cfg) return <div className="wrap"><div className="skeleton" style={{ height: 400 }} /></div>;
  const webhookUrl = `${API}/billing/webhook/sepay`;

  return (
    <div className="wrap stagger">
      <header className="page-head"><div><h1 className="page-title">Gói &amp; cài đặt</h1><p className="page-sub">Giá mới áp dụng cho đơn tạo sau khi lưu; đơn đang chờ giữ giá cũ.</p></div></header>
      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "st-alert st-alert-success" : "st-alert st-alert-danger"}>{msg.text}</div>}

      <section className="st-card" aria-labelledby="pk-h">
        <div className="sec-head"><h2 id="pk-h" className="sec-title">Gói lượt upload</h2>
          <button className="st-btn st-btn-secondary st-btn-sm" type="button" onClick={() => setPacks(ps => [...ps!, { name: "", books: 5, price_vnd: 0, active: false, _dirty: true }])}><Plus size={16} strokeWidth={2} />Thêm gói</button>
        </div>
        <div className="table-box" style={{ border: 0 }}>
          <table className="table">
            <thead><tr><th scope="col">Tên gói</th><th scope="col" style={{ width: 110 }}>Số sách</th><th scope="col" style={{ width: 170 }}>Giá (đ)</th><th scope="col">Mô tả ngắn</th><th scope="col">Nổi bật</th><th scope="col">Đang bán</th><th scope="col"><span className="st-sr">Hành động</span></th></tr></thead>
            <tbody>
              {packs.map((p, i) => (
                <tr key={p.id || `new-${i}`}>
                  <td><input className="input" value={p.name} onChange={(e) => edit(i, { name: e.target.value })} aria-label="Tên gói" placeholder="VD: Gói vừa" /></td>
                  <td><input className="input" type="number" min={1} value={p.books} onChange={(e) => edit(i, { books: Number(e.target.value) })} aria-label="Số sách" /></td>
                  <td><input className="input" type="number" min={0} step={1000} value={p.price_vnd} onChange={(e) => edit(i, { price_vnd: Number(e.target.value) })} aria-label="Giá" /></td>
                  <td><input className="input" value={p.description || ""} onChange={(e) => edit(i, { description: e.target.value })} aria-label="Mô tả" /></td>
                  <td><button type="button" className="sw" role="switch" aria-checked={!!p.highlight} aria-label="Nổi bật" onClick={() => edit(i, { highlight: !p.highlight })} /></td>
                  <td><button type="button" className="sw" role="switch" aria-checked={!!p.active} aria-label="Đang bán" onClick={() => edit(i, { active: !p.active })} /></td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="st-btn st-btn-primary st-btn-sm" type="button" disabled={busy || !p._dirty} onClick={() => savePack(p)}>Lưu</button>
                      <button className="icon-btn" type="button" aria-label={`Xoá gói ${p.name}`} onClick={() => removePack(p)}><Trash2 size={17} strokeWidth={1.75} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta" style={{ marginTop: 8 }}>Gói chỉ hiện cho học sinh khi bật Đang bán và giá lớn hơn 0.</p>
      </section>

      <form style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16, alignItems: "start" }} onSubmit={saveSettings}>
        <section className="st-card stack" style={{ gap: 14 }} aria-labelledby="fr-h">
          <h2 id="fr-h" className="heading-3">Tài khoản miễn phí</h2>
          <label className="field"><span className="field-label">Số sách học sinh được tải miễn phí</span>
            <input className="input" type="number" min={0} max={100} value={cfg.free_book_limit} onChange={(e) => setCfg({ ...cfg, free_book_limit: e.target.value })} style={{ width: 120 }} /></label>
          <label className="field"><span className="field-label">Mã thanh toán hết hạn sau (phút)</span>
            <input className="input" type="number" min={5} max={1440} value={cfg.order_ttl_minutes} onChange={(e) => setCfg({ ...cfg, order_ttl_minutes: e.target.value })} style={{ width: 120 }} /></label>
          <p className="meta">Đổi số sách miễn phí áp dụng ngay cho mọi học sinh, kể cả tài khoản cũ.</p>
        </section>
        <section className="st-card stack" style={{ gap: 14 }} aria-labelledby="bk-h">
          <h2 id="bk-h" className="heading-3">Tài khoản nhận tiền</h2>
          <label className="field"><span className="field-label">Ngân hàng (tên viết tắt hoặc mã BIN)</span>
            <input className="input" list="banks" value={cfg.bank.bank_id} onChange={(e) => setCfg({ ...cfg, bank: { ...cfg.bank, bank_id: e.target.value } })} placeholder="vd: vietcombank hoặc 970436" />
            <datalist id="banks">{BANKS.map(b => <option key={b} value={b} />)}</datalist></label>
          <label className="field"><span className="field-label">Số tài khoản</span>
            <input className="input" value={cfg.bank.account_no} onChange={(e) => setCfg({ ...cfg, bank: { ...cfg.bank, account_no: e.target.value } })} inputMode="numeric" /></label>
          <label className="field"><span className="field-label">Tên chủ tài khoản</span>
            <input className="input" value={cfg.bank.account_name} onChange={(e) => setCfg({ ...cfg, bank: { ...cfg.bank, account_name: e.target.value } })} placeholder="IN HOA, KHÔNG DẤU" /></label>
        </section>
        <div style={{ gridColumn: "1 / -1" }}><button className="st-btn st-btn-primary" type="submit" disabled={busy}>Lưu cài đặt</button></div>
      </form>

      <section className="st-card stack" style={{ gap: 12 }} aria-labelledby="wh-h">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h2 id="wh-h" className="heading-3">Webhook ngân hàng (SePay)</h2>
          <span className={cfg.webhook_auth ? "st-badge st-badge-success" : "st-badge st-badge-danger"}>{cfg.webhook_auth ? `Đã cấu hình · ${cfg.webhook_auth === "hmac" ? "HMAC" : "API key"}` : "Chưa cấu hình"}</span>
        </div>
        <div className="row-wrap" style={{ gap: 8 }}><span className="field-label">URL webhook</span><span className="memo">{webhookUrl}</span>
          <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(webhookUrl)}>Sao chép</button></div>
        <ol className="ink2" style={{ margin: 0, paddingLeft: 20, fontSize: 14.5, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>Trên SePay: thêm tài khoản ngân hàng nhận tiền, tạo webhook trỏ tới URL trên, chỉ gửi giao dịch tiền vào.</li>
          <li>Chọn xác thực API key (hoặc HMAC) và đặt cùng giá trị vào <code>SEPAY_API_KEY</code> (hoặc <code>SEPAY_WEBHOOK_SECRET</code>) trong backend/.env.</li>
          <li>Đặt cấu trúc mã thanh toán trên SePay với tiền tố <b>{cfg.payment_code_prefix}</b>.</li>
        </ol>
      </section>
    </div>
  );
}

export default function AdminPacksPage() {
  return <AdminGuard><Packs /></AdminGuard>;
}
