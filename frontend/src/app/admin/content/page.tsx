"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { refreshSiteConfig } from "@/lib/siteConfig";
import { LEVELS, SEGMENTS, estimateSeconds, wordCount, type Level } from "@/lib/dictation";
import { DEFAULT_SENTENCES, type PronSentence } from "@/lib/pronunciationBank";
import AdminGuard from "@/components/AdminGuard";

type Seg = { id: string; level: Level; topic: string; text: string };
type Ann = { enabled: boolean; text: string; level: "info" | "warning" };
type Msg = { ok: boolean; text: string } | null;

const put = (body: object) => apiFetch("/admin/content", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const errText = async (r: Response) => { const j = await r.json().catch(() => ({})); return typeof j.detail === "string" ? j.detail : "Lưu thất bại"; };

function Content() {
  const [loaded, setLoaded] = useState(false);
  const [ann, setAnn] = useState<Ann>({ enabled: false, text: "", level: "info" });
  const [segs, setSegs] = useState<Seg[]>(SEGMENTS);
  const [segsCustom, setSegsCustom] = useState(false);
  const [sents, setSents] = useState<PronSentence[]>(DEFAULT_SENTENCES);
  const [sentsCustom, setSentsCustom] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch("/admin/content");
    if (!r.ok) return;
    const c = await r.json();
    setAnn(c.announcement);
    setSegs(c.dictation_segments || SEGMENTS); setSegsCustom(!!c.dictation_segments);
    setSents(c.pronunciation_sentences || DEFAULT_SENTENCES); setSentsCustom(!!c.pronunciation_sentences);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (body: object, ok: string) => {
    setBusy(true); setMsg(null);
    const r = await put(body);
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: ok }); refreshSiteConfig(true); load(); } else setMsg({ ok: false, text: await errText(r) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!loaded) return <div className="wrap"><div className="skeleton" style={{ height: 400 }} /></div>;

  const editSeg = (i: number, p: Partial<Seg>) => setSegs((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const editSent = (i: number, p: Partial<PronSentence>) => setSents((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Nội dung &amp; thông báo</h1>
          <p className="page-sub">Thông báo toàn hệ thống, ngân hàng đoạn Nghe chép và câu luyện Phát âm.</p>
        </div>
      </header>
      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "st-alert st-alert-success" : "st-alert st-alert-danger"}>{msg.text}</div>}

      <section className="st-card stack" style={{ gap: 14 }} aria-labelledby="an-h">
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <h2 id="an-h" className="heading-3">Thông báo toàn hệ thống</h2>
          <button type="button" className="sw" role="switch" aria-checked={ann.enabled} aria-label="Hiện thông báo"
            onClick={() => setAnn((a) => ({ ...a, enabled: !a.enabled }))} />
        </div>
        <label className="field"><span className="field-label">Nội dung (tối đa 300 ký tự)</span>
          <textarea className="input" rows={2} maxLength={300} value={ann.text} onChange={(e) => setAnn((a) => ({ ...a, text: e.target.value }))}
            placeholder="VD: Hệ thống bảo trì lúc 22:00 tối nay, có thể gián đoạn khoảng 15 phút." style={{ width: "100%" }} /></label>
        <label className="field" style={{ maxWidth: 240 }}><span className="field-label">Mức độ</span>
          <select className="input" value={ann.level} onChange={(e) => setAnn((a) => ({ ...a, level: e.target.value as Ann["level"] }))}>
            <option value="info">Thông tin</option><option value="warning">Cảnh báo</option>
          </select></label>
        {ann.text && (
          <div className="row" style={{ gap: 12, padding: "12px 16px", borderRadius: "var(--radius-md)", background: ann.level === "warning" ? "var(--warning-tint)" : "var(--brand-tint)" }}>
            <span><b style={{ fontWeight: 600 }}>{ann.level === "warning" ? "Lưu ý: " : "Thông báo: "}</b>{ann.text}</span>
          </div>
        )}
        <div><button className="st-btn st-btn-primary" type="button" disabled={busy} onClick={() => run({ announcement: ann }, ann.enabled ? "Đã lưu và đang hiện cho học sinh." : "Đã lưu (thông báo đang tắt).")}>Lưu thông báo</button></div>
      </section>

      <section className="st-card stack" style={{ gap: 14 }} aria-labelledby="dc-h">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h2 id="dc-h" className="heading-3">Ngân hàng đoạn Nghe chép</h2>
          <span className={segsCustom ? "st-badge st-badge-brand" : "st-badge"}>{segsCustom ? "Đang dùng bộ riêng" : "Đang dùng bộ có sẵn"}</span>
        </div>
        <p className="meta">Mỗi đoạn nên dài 25–35 từ (khoảng 10–15 giây). Lưu thì thay toàn bộ ngân hàng của học sinh; “Khôi phục” để quay về {SEGMENTS.length} đoạn có sẵn.</p>
        <div className="stack" style={{ gap: 12 }}>
          {segs.map((s, i) => {
            const w = wordCount(s.text);
            return (
              <div key={`${s.id}-${i}`} className="row-wrap" style={{ gap: 8, alignItems: "flex-start", padding: 12, border: "1px solid var(--hairline)", borderRadius: "var(--radius-md)" }}>
                <select className="input" aria-label="Cấp độ" style={{ width: 140 }} value={s.level} onChange={(e) => editSeg(i, { level: e.target.value as Level })}>
                  {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
                <input className="input" aria-label="Chủ đề" style={{ width: 160 }} value={s.topic} maxLength={60} onChange={(e) => editSeg(i, { topic: e.target.value })} placeholder="Chủ đề" />
                <div style={{ flex: 1, minWidth: 260 }}>
                  <textarea className="input" aria-label="Nội dung đoạn nghe" rows={3} value={s.text} onChange={(e) => editSeg(i, { text: e.target.value })} style={{ width: "100%" }} lang="en" spellCheck={false} />
                  <span className="meta" style={{ color: w < 18 || w > 40 ? "var(--warning)" : undefined }}>{w} từ · khoảng {Math.round(estimateSeconds(s.text, 1))} giây</span>
                </div>
                <button type="button" className="icon-btn" aria-label={`Xoá đoạn ${i + 1}`} onClick={() => setSegs((x) => x.filter((_, j) => j !== i))}><Trash2 size={17} strokeWidth={1.75} /></button>
              </div>
            );
          })}
        </div>
        <div className="row-wrap" style={{ gap: 8 }}>
          <button className="st-btn st-btn-secondary st-btn-sm" type="button" onClick={() => setSegs((x) => [...x, { id: `x${Date.now().toString(36)}`, level: "mid", topic: "", text: "" }])}><Plus size={16} strokeWidth={2} />Thêm đoạn</button>
          <button className="st-btn st-btn-primary" type="button" disabled={busy || !segs.length} onClick={() => run({ dictation_segments: segs }, `Đã lưu ${segs.length} đoạn.`)}>Lưu ngân hàng</button>
          {segsCustom && <button className="st-btn st-btn-ghost" type="button" disabled={busy}
            onClick={() => window.confirm("Bỏ bộ riêng và quay về bộ có sẵn?") && run({ dictation_segments: null }, "Đã khôi phục bộ có sẵn.")}>Khôi phục mặc định</button>}
        </div>
      </section>

      <section className="st-card stack" style={{ gap: 14 }} aria-labelledby="pr-h">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h2 id="pr-h" className="heading-3">Câu luyện Phát âm</h2>
          <span className={sentsCustom ? "st-badge st-badge-brand" : "st-badge"}>{sentsCustom ? "Đang dùng bộ riêng" : "Đang dùng bộ có sẵn"}</span>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {sents.map((s, i) => (
            <div key={i} className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
              <input className="input" aria-label="Nhóm" style={{ width: 220 }} value={s.group} maxLength={60} onChange={(e) => editSent(i, { group: e.target.value })} placeholder="Nhóm, VD: Part 1 · Hometown" />
              <input className="input" aria-label="Câu luyện" style={{ flex: 1, minWidth: 260 }} value={s.text} onChange={(e) => editSent(i, { text: e.target.value })} lang="en" spellCheck={false} />
              <button type="button" className="icon-btn" aria-label={`Xoá câu ${i + 1}`} onClick={() => setSents((x) => x.filter((_, j) => j !== i))}><Trash2 size={17} strokeWidth={1.75} /></button>
            </div>
          ))}
        </div>
        <div className="row-wrap" style={{ gap: 8 }}>
          <button className="st-btn st-btn-secondary st-btn-sm" type="button" onClick={() => setSents((x) => [...x, { group: x[x.length - 1]?.group || "", text: "" }])}><Plus size={16} strokeWidth={2} />Thêm câu</button>
          <button className="st-btn st-btn-primary" type="button" disabled={busy || !sents.length} onClick={() => run({ pronunciation_sentences: sents }, `Đã lưu ${sents.length} câu.`)}>Lưu câu luyện</button>
          {sentsCustom && <button className="st-btn st-btn-ghost" type="button" disabled={busy}
            onClick={() => window.confirm("Bỏ bộ riêng và quay về bộ có sẵn?") && run({ pronunciation_sentences: null }, "Đã khôi phục bộ có sẵn.")}>Khôi phục mặc định</button>}
        </div>
      </section>
    </div>
  );
}

export default function AdminContentPage() {
  return <AdminGuard><Content /></AdminGuard>;
}
