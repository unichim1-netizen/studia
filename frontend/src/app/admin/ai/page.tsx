"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import AdminGuard from "@/components/AdminGuard";

type Skill = "writing" | "speaking";
type SkillCfg = {
  strictness: string; extra_instructions: string; use_learner_context: boolean;
  max_issues?: number; model_rewrite?: boolean; better_answer?: boolean; use_metrics?: boolean;
};
type Cfg = { feedback_language: string; timeout_sec: number; writing: SkillCfg; speaking: SkillCfg };
type Options = {
  strictness: { id: string; label: string; description: string }[];
  feedback_languages: { id: string; label: string }[];
  limits: { extra_max: number; timeout: [number, number]; max_issues: [number, number] };
};
type State = { config: Cfg; defaults: Cfg; options: Options };

const SKILL_LABEL: Record<Skill, string> = { writing: "Writing", speaking: "Speaking" };
const STRICT_VI: Record<string, string> = {
  lenient: "Phân vân giữa hai band thì cho band cao hơn, nêu điểm mạnh trước. Hợp với học sinh mới bắt đầu, cần động lực.",
  standard: "Chấm như giám khảo IELTS theo band descriptors công khai.",
  strict: "Phân vân thì cho band thấp hơn, chỉ ra mọi lỗi mất điểm. Hợp với học sinh sắp thi.",
};

function AiGrading() {
  const [state, setState] = useState<State | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ skill: Skill; prompt: string } | null>(null);

  const apply = (s: State) => { setState(s); setCfg(JSON.parse(JSON.stringify(s.config))); };
  const load = useCallback(async () => {
    const r = await apiFetch("/admin/ai-grading", { cache: "no-store" });
    if (r.ok) apply(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!state || !cfg) return <div className="wrap"><div className="skeleton" style={{ height: 400 }} /></div>;
  const dirty = JSON.stringify(cfg) !== JSON.stringify(state.config);
  const lim = state.options.limits;

  const setSkill = (skill: Skill, patch: Partial<SkillCfg>) => setCfg((c) => (c ? { ...c, [skill]: { ...c[skill], ...patch } } : c));

  const send = async (body: object, okText: string) => {
    setBusy(true); setMsg(null);
    const r = await apiFetch("/admin/ai-grading", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { apply(await r.json()); setMsg({ ok: true, text: okText }); }
    else { const j = await r.json().catch(() => ({})); setMsg({ ok: false, text: typeof j.detail === "string" ? j.detail : "Lưu thất bại" }); }
  };

  const showPreview = async (skill: Skill) => {
    setMsg(null);
    const r = await apiFetch("/admin/ai-grading/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill, config: cfg, context: { target: 7.0, kind: "Academic", level: "6.0", focus: skill === "writing" ? ["grammar"] : ["fluency"], note: "Em hay quên mạo từ và hay ngập ngừng." } }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setPreview({ skill, prompt: j.prompt });
    else setMsg({ ok: false, text: typeof j.detail === "string" ? j.detail : "Không tạo được bản xem trước" });
  };

  const toggle = (skill: Skill, field: keyof SkillCfg, label: string, hint: string) => (
    <div className="row" style={{ gap: 16, padding: "10px 0", borderTop: "1px solid var(--hairline)", justifyContent: "space-between" }}>
      <div style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{label}</b><div className="meta">{hint}</div></div>
      <button type="button" className="sw" role="switch" aria-checked={!!cfg[skill][field]} aria-label={label}
        onClick={() => setSkill(skill, { [field]: !cfg[skill][field] } as Partial<SkillCfg>)} />
    </div>
  );

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Cấu hình chấm AI</h1>
          <p className="page-sub">Ngữ cảnh AI dùng khi chấm Writing và Speaking: mức chấm, ngôn ngữ nhận xét, hướng dẫn riêng của trung tâm và việc dùng hồ sơ người học (band mục tiêu, Academic/General, điểm muốn tập trung). Có hiệu lực ngay, không cần deploy lại.</p>
        </div>
      </header>
      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "st-alert st-alert-success" : "st-alert st-alert-danger"}>{msg.text}</div>}

      <form className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); send({ config: cfg }, "Đã lưu. Lần chấm tiếp theo sẽ dùng cấu hình mới."); }}>
        <section className="st-card" aria-labelledby="ag-common">
          <h2 id="ag-common" className="heading-3">Chung</h2>
          <div className="row-wrap" style={{ gap: 20, marginTop: 12, alignItems: "end" }}>
            <label className="field" style={{ minWidth: 200 }}>
              <span className="field-label">Ngôn ngữ nhận xét mặc định</span>
              <select className="input" value={cfg.feedback_language} onChange={(e) => setCfg({ ...cfg, feedback_language: e.target.value })}>
                {state.options.feedback_languages.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <label className="field" style={{ minWidth: 200 }}>
              <span className="field-label">Thời gian chờ AI tối đa</span>
              <span className="row" style={{ gap: 8 }}>
                <input className="input" type="number" min={lim.timeout[0]} max={lim.timeout[1]} value={cfg.timeout_sec} style={{ width: 110 }}
                  onChange={(e) => setCfg({ ...cfg, timeout_sec: Number(e.target.value) })} />
                <span className="meta">giây</span>
              </span>
            </label>
          </div>
          <p className="meta" style={{ marginTop: 8 }}>Học sinh có thể tự chọn ngôn ngữ nhận xét khác cho bài của mình. Quá thời gian chờ thì báo “chưa chấm được” thay vì để học sinh đợi mãi (cho phép {lim.timeout[0]}–{lim.timeout[1]} giây).</p>
        </section>

        {(["writing", "speaking"] as Skill[]).map((skill) => (
          <section key={skill} className="st-card" aria-labelledby={`ag-${skill}`}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <h2 id={`ag-${skill}`} className="heading-3">{SKILL_LABEL[skill]}</h2>
              <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => showPreview(skill)}>Xem prompt mẫu</button>
            </div>

            <div style={{ marginTop: 12 }}>
              <span className="field-label">Mức chấm</span>
              <div className="seg" role="radiogroup" aria-label={`Mức chấm ${SKILL_LABEL[skill]}`} style={{ marginTop: 6 }}>
                {state.options.strictness.map((s) => (
                  <button key={s.id} type="button" role="radio" className="seg-btn" aria-checked={cfg[skill].strictness === s.id}
                    onClick={() => setSkill(skill, { strictness: s.id })}>{s.label}</button>
                ))}
              </div>
              <p className="meta" style={{ marginTop: 6 }}>{STRICT_VI[cfg[skill].strictness]}</p>
            </div>

            <label className="field" style={{ marginTop: 12 }}>
              <span className="field-label">Hướng dẫn riêng của trung tâm cho AI</span>
              <textarea className="input" rows={4} value={cfg[skill].extra_instructions} maxLength={lim.extra_max}
                onChange={(e) => setSkill(skill, { extra_instructions: e.target.value })}
                placeholder={skill === "writing"
                  ? "vd. Học viên chủ yếu là học sinh lớp 11–12. Nhận xét kỹ về mạo từ, thì và cách nối câu; gợi ý từ vựng học thuật theo chủ đề Education, Environment."
                  : "vd. Ưu tiên nhận xét về độ trôi chảy và cách mở rộng ý bằng ví dụ cá nhân; nhắc lỗi phát âm âm cuối -s, -ed hay gặp của người Việt."} />
              <span className="meta">{cfg[skill].extra_instructions.length}/{lim.extra_max} ký tự. Được thêm vào prompt dưới mục “Additional instructions from the school”. Không đổi được định dạng kết quả.</span>
            </label>

            <div style={{ marginTop: 12 }}>
              {toggle(skill, "use_learner_context", "Dùng ngữ cảnh người học", "Gửi kèm band mục tiêu, Academic/General, trình độ, tiêu chí muốn tập trung và ghi chú của học sinh. Tắt để mọi bài chấm cùng một chuẩn.")}
              {skill === "writing" ? (
                <>
                  {toggle(skill, "model_rewrite", "Viết lại đoạn yếu nhất ở band mục tiêu", "AI chọn đoạn kéo điểm xuống nhiều nhất và viết lại giữ nguyên ý của học sinh. Tốn thêm thời gian chấm.")}
                  <div className="row" style={{ gap: 16, padding: "10px 0", borderTop: "1px solid var(--hairline)", justifyContent: "space-between", alignItems: "center" }}>
                    <div><b style={{ fontWeight: 600 }}>Số lỗi tối đa mỗi câu</b><div className="meta">Ít lỗi hơn giúp học sinh mới tập trung vào lỗi quan trọng.</div></div>
                    <input className="input" type="number" min={lim.max_issues[0]} max={lim.max_issues[1]} value={cfg.writing.max_issues ?? 4} style={{ width: 80 }}
                      onChange={(e) => setSkill("writing", { max_issues: Number(e.target.value) })} aria-label="Số lỗi tối đa mỗi câu" />
                  </div>
                </>
              ) : (
                <>
                  {toggle(skill, "use_metrics", "Gửi số đo nhịp nói", "Tốc độ nói, số lần ngập ngừng, từ đệm, độ tin cậy nhận dạng đo từ bản ghi. Giúp AI chấm Fluency và ước lượng Pronunciation sát hơn.")}
                  {toggle(skill, "better_answer", "Câu trả lời mẫu ở band mục tiêu", "AI nói lại câu trả lời theo ý của học sinh ở band mục tiêu, kèm cụm từ nên dùng.")}
                </>
              )}
            </div>
            {skill === "speaking" && <p className="meta" style={{ marginTop: 8 }}>AI không nghe được âm thanh: Pronunciation chỉ là ước lượng từ lời nhận dạng và số đo, giao diện luôn ghi rõ điều này cho học sinh.</p>}
          </section>
        ))}

        {preview && (
          <section className="st-card" aria-labelledby="ag-prev">
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <h2 id="ag-prev" className="heading-3">Prompt mẫu · {SKILL_LABEL[preview.skill]}</h2>
              <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setPreview(null)}>Đóng</button>
            </div>
            <p className="meta" style={{ marginTop: 4 }}>Ráp từ cấu hình đang chỉnh (chưa lưu cũng được) với một bài mẫu và một học sinh mẫu. Không gọi AI.</p>
            <pre style={{ marginTop: 10, padding: 14, borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)", whiteSpace: "pre-wrap", fontSize: 12.5, lineHeight: 1.5, maxHeight: 520, overflow: "auto" }}>{preview.prompt}</pre>
          </section>
        )}

        <div className="row-wrap" style={{ gap: 12, alignItems: "center" }}>
          <button className="st-btn st-btn-primary" type="submit" disabled={busy || !dirty}>Lưu thay đổi</button>
          <button className="st-btn st-btn-ghost" type="button" disabled={busy} onClick={() => setCfg(JSON.parse(JSON.stringify(state.config)))}>Huỷ thay đổi</button>
          <button className="st-btn st-btn-ghost" type="button" disabled={busy} onClick={() => { if (confirm("Khôi phục toàn bộ cấu hình chấm AI về mặc định?")) send({ config: null }, "Đã khôi phục mặc định."); }}>Khôi phục mặc định</button>
          {dirty && <span className="meta">Có thay đổi chưa lưu</span>}
        </div>
      </form>
    </div>
  );
}

export default function AdminAiPage() {
  return <AdminGuard><AiGrading /></AdminGuard>;
}
