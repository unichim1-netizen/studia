"use client";

import { useEffect, useState } from "react";
import { BANDS, FOCUS_OPTIONS, NOTE_MAX, defaultContext, loadContext, saveContext, type AiContext, type AiSkill } from "@/lib/aiContext";

/**
 * Thẻ “Ngữ cảnh chấm AI”: người học cho AI biết band mục tiêu, dạng thi, trình độ, điểm muốn nhận xét kỹ và một ghi chú.
 * Thu gọn thì chỉ hiện một dòng tóm tắt. Giá trị lưu ở trình duyệt, dùng chung cho Writing và Speaking (trừ tiêu chí tập trung).
 */
export default function AiContextCard({ skill, onChange }: { skill: AiSkill; onChange?: (c: AiContext) => void }) {
  const [ctx, setCtx] = useState<AiContext | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { const c = loadContext(); setCtx(c); onChange?.(c); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ctx) return null;

  // luôn cập nhật từ giá trị mới nhất để hai thao tác liền nhau không ghi đè lên nhau
  const change = (fn: (c: AiContext) => AiContext) => setCtx((prev) => {
    if (!prev) return prev;
    const n = fn(prev);
    saveContext(n); onChange?.(n);
    return n;
  });
  const update = (patch: Partial<AiContext>) => change((c) => ({ ...c, ...patch }));
  const focus = ctx.focus[skill] || [];
  const toggleFocus = (id: string) => change((c) => {
    const cur = c.focus[skill] || [];
    return { ...c, focus: { ...c.focus, [skill]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } };
  });
  const focusLabels = FOCUS_OPTIONS[skill].filter((f) => focus.includes(f.id)).map((f) => f.label);

  return (
    <section className="st-card" style={{ padding: 16 }} aria-labelledby={`aic-${skill}`}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <b id={`aic-${skill}`} style={{ fontSize: 14.5 }}>Ngữ cảnh chấm AI</b>
          <div className="meta">
            Mục tiêu band {ctx.target.toFixed(1)} · {ctx.kind}{ctx.level ? ` · hiện tại ${ctx.level}` : ""}
            {focusLabels.length ? ` · nhận xét kỹ: ${focusLabels.join(", ")}` : ""}
            {ctx.note ? " · có ghi chú" : ""}{ctx.feedback_language === "en" ? " · nhận xét tiếng Anh" : ""}
          </div>
        </div>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Xong" : "Chỉnh"}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <p className="meta">AI dùng các thông tin này để nhận xét sát với bạn: so với band mục tiêu, đúng dạng thi, kỹ hơn ở điểm bạn chọn. Điểm vẫn chấm theo tiêu chí IELTS, không được nâng vì mục tiêu.</p>
          <div className="row-wrap" style={{ gap: 14, alignItems: "end" }}>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Band mục tiêu</span>
              <select className="input" style={{ height: 38 }} value={ctx.target} onChange={(e) => update({ target: Number(e.target.value) })}>
                {BANDS.map((b) => <option key={b} value={b}>{b.toFixed(1)}</option>)}
              </select>
            </label>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Dạng thi</span>
              <select className="input" style={{ height: 38 }} value={ctx.kind} onChange={(e) => update({ kind: e.target.value as AiContext["kind"] })}>
                <option value="Academic">Academic</option><option value="General Training">General Training</option>
              </select>
            </label>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Trình độ hiện tại</span>
              <input className="input" style={{ height: 38, width: 120 }} value={ctx.level} maxLength={40} placeholder="vd. 5.5–6.0" onChange={(e) => update({ level: e.target.value })} />
            </label>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Ngôn ngữ nhận xét</span>
              <select className="input" style={{ height: 38 }} value={ctx.feedback_language} onChange={(e) => update({ feedback_language: e.target.value as AiContext["feedback_language"] })}>
                <option value="">Theo trung tâm</option><option value="vi">Tiếng Việt</option><option value="en">English</option>
              </select>
            </label>
          </div>
          <div>
            <span className="st-field-label">Muốn AI nhận xét kỹ hơn về</span>
            <div className="row-wrap" style={{ gap: 6, marginTop: 6 }}>
              {FOCUS_OPTIONS[skill].map((f) => (
                <button key={f.id} type="button" className="seg-btn" aria-pressed={focus.includes(f.id)} onClick={() => toggleFocus(f.id)}
                  style={{ border: "1px solid var(--hairline)", background: focus.includes(f.id) ? "var(--brand-tint)" : undefined, fontWeight: focus.includes(f.id) ? 700 : 500 }}>{f.label}</button>
              ))}
            </div>
          </div>
          <label className="st-field">
            <span className="st-field-label">Ghi chú cho giám khảo AI</span>
            <textarea className="input" rows={2} maxLength={NOTE_MAX} value={ctx.note} onChange={(e) => update({ note: e.target.value })}
              placeholder={skill === "writing" ? "vd. Em hay sai mạo từ và thì hiện tại hoàn thành; đang luyện viết câu phức." : "vd. Em hay ngập ngừng khi tìm từ và phát âm sai âm cuối -s."} style={{ width: "100%" }} />
            <span className="meta">{ctx.note.length}/{NOTE_MAX} ký tự. Chỉ để AI hiểu khó khăn của bạn, không thay đổi cách chấm.</span>
          </label>
          <button type="button" className="st-btn st-btn-ghost st-btn-sm" style={{ justifySelf: "start" }}
            onClick={() => { const d = defaultContext(); update({ target: d.target, kind: d.kind, level: d.level }); }}>Lấy lại từ hồ sơ của tôi</button>
        </div>
      )}
    </section>
  );
}
