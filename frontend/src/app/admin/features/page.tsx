"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { refreshSiteConfig } from "@/lib/siteConfig";
import AdminGuard from "@/components/AdminGuard";

type Feature = { id: string; label: string; description: string; enabled: boolean };
type Limit = { value: number; default: number; min: number; max: number; overridden: boolean };
type Config = {
  features: Feature[];
  limits: Record<string, Limit>;
  reminders: { enabled: boolean; env_enabled: boolean; smtp_configured: boolean };
  ai: { provider: string; model: string; gemini_configured: boolean };
};

const LIMIT_LABELS: Record<string, { label: string; unit: string; hint: string }> = {
  MAX_PDF_MB: { label: "Dung lượng sách tối đa", unit: "MB", hint: "Áp dụng cho PDF và DOCX tải lên. Mặc định 100 MB; máy chủ RAM 1 GB nên tránh xử lý nhiều tệp lớn cùng lúc." },
  MAX_PDF_PAGES: { label: "Số trang PDF tối đa", unit: "trang", hint: "Sách nhiều trang xử lý lâu và tốn lượt gọi AI." },
  MAX_AUDIO_MB: { label: "Dung lượng audio đề thi tối đa", unit: "MB", hint: "Áp dụng cho tệp audio Listening của bộ đề." },
};

function Features() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [reminders, setReminders] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (c: Config) => {
    setCfg(c);
    setFlags(Object.fromEntries(c.features.map((f) => [f.id, f.enabled])));
    setLimits(Object.fromEntries(Object.entries(c.limits).map(([k, v]) => [k, String(v.value)])));
    setReminders(c.reminders.enabled);
  };

  const load = useCallback(async () => {
    const r = await apiFetch("/admin/config");
    if (r.ok) apply(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!cfg) return <div className="wrap"><div className="skeleton" style={{ height: 400 }} /></div>;

  const dirty =
    cfg.features.some((f) => flags[f.id] !== f.enabled) ||
    Object.entries(cfg.limits).some(([k, v]) => Number(limits[k]) !== v.value) ||
    reminders !== cfg.reminders.enabled;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const changedLimits: Record<string, number> = {};
    for (const [k, v] of Object.entries(cfg.limits)) {
      const n = Number(limits[k]);
      if (n !== v.value) changedLimits[k] = n;
    }
    const r = await apiFetch("/admin/config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        features: flags,
        limits: changedLimits,
        ...(reminders !== cfg.reminders.enabled ? { reminders_enabled: reminders } : {}),
      }),
    });
    setBusy(false);
    if (r.ok) { apply(await r.json()); refreshSiteConfig(true); setMsg({ ok: true, text: "Đã lưu. Học sinh thấy thay đổi trong vòng một phút." }); }
    else { const j = await r.json().catch(() => ({})); setMsg({ ok: false, text: typeof j.detail === "string" ? j.detail : "Lưu thất bại" }); }
  };

  const resetLimit = async (name: string) => {
    setBusy(true); setMsg(null);
    const r = await apiFetch("/admin/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limits: { [name]: null } }) });
    setBusy(false);
    if (r.ok) { apply(await r.json()); setMsg({ ok: true, text: "Đã quay về giá trị trong .env." }); }
  };

  const remindersLocked = !cfg.reminders.env_enabled;

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Tính năng &amp; giới hạn</h1>
          <p className="page-sub">Bật hoặc tắt từng tính năng cho học sinh và đặt giới hạn tải lên. Có hiệu lực không cần deploy lại.</p>
        </div>
      </header>
      {msg && <div role={msg.ok ? "status" : "alert"} style={{ padding: "10px 14px", borderRadius: "var(--radius-md)", background: msg.ok ? "var(--success-tint)" : "var(--danger-tint)", color: msg.ok ? "var(--success)" : "var(--danger)" }}>{msg.text}</div>}

      <form className="stack" style={{ gap: 16 }} onSubmit={save}>
        <section className="st-card" aria-labelledby="ft-h">
          <h2 id="ft-h" className="heading-3">Tính năng</h2>
          <p className="meta" style={{ margin: "4px 0 12px" }}>Tắt một tính năng thì học sinh không thấy mục đó trong menu và API cũng từ chối. Quản lý vẫn vào được để kiểm thử.</p>
          <div className="stack" style={{ gap: 0 }}>
            {cfg.features.map((f) => (
              <div key={f.id} className="row" style={{ gap: 16, padding: "12px 0", borderTop: "1px solid var(--hairline)", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontWeight: 600 }}>{f.label}</b>
                  <div className="meta">{f.description}</div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className={flags[f.id] ? "st-badge st-badge-success" : "st-badge st-badge-danger"}>{flags[f.id] ? "Đang bật" : "Đã tắt"}</span>
                  <button type="button" className="sw" role="switch" aria-checked={!!flags[f.id]} aria-label={`${f.label}: ${flags[f.id] ? "tắt" : "bật"}`}
                    onClick={() => setFlags((s) => ({ ...s, [f.id]: !s[f.id] }))} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="st-card" aria-labelledby="lm-h">
          <h2 id="lm-h" className="heading-3">Giới hạn tải lên</h2>
          <div className="stack" style={{ gap: 16, marginTop: 12 }}>
            {Object.entries(cfg.limits).map(([k, v]) => (
              <div key={k} className="row-wrap" style={{ gap: 12, alignItems: "end" }}>
                <label className="field" style={{ minWidth: 220 }}>
                  <span className="field-label">{LIMIT_LABELS[k]?.label || k}</span>
                  <span className="row" style={{ gap: 8 }}>
                    <input className="input" type="number" min={v.min} max={v.max} value={limits[k] ?? ""} style={{ width: 120 }}
                      onChange={(e) => setLimits((s) => ({ ...s, [k]: e.target.value }))} />
                    <span className="meta">{LIMIT_LABELS[k]?.unit}</span>
                  </span>
                </label>
                <span className="meta" style={{ flex: 1, minWidth: 200 }}>
                  {LIMIT_LABELS[k]?.hint} Mặc định trong .env: {v.default}. Cho phép {v.min}–{v.max}.
                </span>
                {v.overridden && <button type="button" className="st-btn st-btn-ghost st-btn-sm" disabled={busy} onClick={() => resetLimit(k)}>Dùng mặc định</button>}
              </div>
            ))}
          </div>
        </section>

        <section className="st-card" aria-labelledby="rm-h">
          <div className="row" style={{ justifyContent: "space-between", gap: 16 }}>
            <div>
              <h2 id="rm-h" className="heading-3">Nhắc lịch học qua email</h2>
              <p className="meta" style={{ marginTop: 4 }}>
                {remindersLocked ? "Đang tắt ở mức hệ thống (REMINDERS_ENABLED=false trong .env), không bật lại được từ đây."
                  : !cfg.reminders.smtp_configured ? "Chưa cấu hình SMTP trong .env nên hệ thống chưa gửi email nào, kể cả khi bật."
                  : "Quản lý có thể tạm dừng gửi nhắc nhở cho toàn bộ học sinh."}
              </p>
            </div>
            <button type="button" className="sw" role="switch" aria-checked={reminders} disabled={remindersLocked} aria-label="Nhắc lịch học qua email"
              onClick={() => setReminders((v) => !v)} />
          </div>
        </section>

        <section className="st-card" aria-labelledby="ai-h">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <h2 id="ai-h" className="heading-3">Trợ lý AI</h2>
            <span className={cfg.ai.gemini_configured ? "st-badge st-badge-success" : "st-badge st-badge-danger"}>{cfg.ai.gemini_configured ? "Đã có khoá Gemini" : "Chưa có khoá Gemini"}</span>
          </div>
          <p className="meta" style={{ marginTop: 6 }}>Nhà cung cấp: {cfg.ai.provider} · mô hình {cfg.ai.model}. Khoá API và mô hình đặt trong backend/.env trên máy chủ (không đưa lên giao diện để tránh lộ khoá). Muốn giảm chi phí AI, tắt “Gia sư AI” hoặc “Hội thoại tình huống” ở trên.</p>
        </section>

        <div className="row" style={{ gap: 12 }}>
          <button className="st-btn st-btn-primary" type="submit" disabled={busy || !dirty}>Lưu thay đổi</button>
          {dirty && <span className="meta">Có thay đổi chưa lưu</span>}
        </div>
      </form>
    </div>
  );
}

export default function AdminFeaturesPage() {
  return <AdminGuard><Features /></AdminGuard>;
}
