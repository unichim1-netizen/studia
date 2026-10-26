"use client";

import { useState } from "react";
import { BUILTIN_TESTS } from "@/lib/examConfig";
import {
  ESSAY_LABEL, THESIS_HINT, TIME_PLAN, essayType, outlineFor,
  type CheckResult, type Finding, type Task,
} from "@/lib/writingCheck";

/* ---------- Chọn đề Cambridge ---------- */

export type PickedPrompt = { text: string; image: string | null; source: string };

/** Lấy đề Writing từ các bộ Cambridge đang mở (bỏ dòng "You should spend about…" và "Write at least…"). */
export function PromptPicker({ task, onPick }: { task: Task; onPick: (p: PickedPrompt) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = async (demoType: string, title: string) => {
    if (!demoType) return;
    setBusy(true); setErr("");
    try {
      const m = /^cambridge(\d+)_test(\d)$/.exec(demoType);
      if (!m) throw new Error();
      const d = (await import(`@/data/cambridge${m[1]}_test${m[2]}.json`)).default as Record<string, unknown>;
      const raw = String(d[task === "task1" ? "writing_task1" : "writing_task2"] || "");
      const text = raw.replace(/You should spend about \d+ minutes on this task\.\s*/i, "").replace(/Write about the following topic:\s*/i, "")
        .replace(/\s*Write at least \d+ words\.?\s*$/i, "").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) throw new Error();
      onPick({ text, image: task === "task1" ? (d.writing_task1_image as string) || null : null, source: `${title} · ${task === "task1" ? "Task 1" : "Task 2"}` });
    } catch { setErr("Không mở được đề này."); }
    setBusy(false);
  };
  return (
    <span className="row" style={{ gap: 8, alignItems: "center" }}>
      <select className="input" style={{ height: 34, fontSize: 13.5, maxWidth: 230 }} disabled={busy} value="" aria-label="Chọn đề Cambridge"
        onChange={(e) => { const t = BUILTIN_TESTS.find((x) => x.demoType === e.target.value); if (t) pick(t.demoType as string, t.title); }}>
        <option value="">{busy ? "Đang mở…" : "Chọn đề Cambridge…"}</option>
        {BUILTIN_TESTS.map((t) => <option key={t.key} value={t.demoType as string}>{t.title}</option>)}
      </select>
      {err && <span className="meta" style={{ color: "var(--danger)" }}>{err}</span>}
    </span>
  );
}

/* ---------- Dàn ý ---------- */

/** Dàn ý 4 đoạn có gợi ý và câu mẫu; bấm câu mẫu để chèn vào ô. Bản nháp do trang cha giữ. */
export function OutlineCard({ task, prompt, outline, onChange, onInsert }: {
  task: Task; prompt: string; outline: Record<string, string>;
  onChange: (o: Record<string, string>) => void; onInsert: (text: string) => void;
}) {
  const type = task === "task2" ? essayType(prompt) : "unknown";
  const parts = outlineFor(task, type);
  const filled = parts.filter((p) => (outline[p.id] || "").trim()).length;
  const toEssay = () => onInsert(parts.map((p) => (outline[p.id] || "").trim()).filter(Boolean).join("\n\n"));
  return (
    <section className="st-card" style={{ padding: 18 }} aria-labelledby="wr-ol">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 id="wr-ol" className="sec-title" style={{ fontSize: 17 }}>Bước 1 · Dàn ý 4 đoạn</h2>
        <span className="meta">{filled}/{parts.length} đoạn</span>
      </div>
      {task === "task2" && prompt.trim() && (
        <p style={{ marginTop: 8, fontSize: 14 }}>
          <span className="st-badge">{ESSAY_LABEL[type]}</span>{" "}
          <span className="ink2">{THESIS_HINT[type]}</span>
        </p>
      )}
      {task === "task1" && <p className="ink2" style={{ marginTop: 8, fontSize: 14 }}>Đi từ tổng quan đến chi tiết: mở bài → tổng quan (xu hướng chính, không số liệu) → 2 đoạn chi tiết có số liệu.</p>}
      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {parts.map((p, i) => (
          <div key={p.id}>
            <label className="st-field-label" htmlFor={`ol-${p.id}`}>{i + 1}. {p.title}</label>
            <p className="meta" style={{ margin: "2px 0 6px" }}>{p.hint}</p>
            <textarea id={`ol-${p.id}`} className="input" rows={2} lang="en" value={outline[p.id] || ""} style={{ width: "100%", fontSize: 14.5 }}
              onChange={(e) => onChange({ ...outline, [p.id]: e.target.value })} placeholder="Ghi ý ngắn bằng tiếng Anh (từ khoá, ý chính, ví dụ)…" />
            <div className="row-wrap" style={{ gap: 6, marginTop: 4 }}>
              {p.frames.map((f) => (
                <button key={f} type="button" className="st-btn st-btn-ghost st-btn-sm" lang="en" style={{ fontSize: 12.5 }}
                  onClick={() => onChange({ ...outline, [p.id]: `${(outline[p.id] || "").trim()} ${f}`.trim() })}>{f}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="st-btn st-btn-secondary st-btn-sm" style={{ marginTop: 12 }} disabled={!filled} onClick={toEssay}>Chèn dàn ý vào bài để viết tiếp</button>
    </section>
  );
}

/* ---------- Hẹn giờ ---------- */

export function TimerCard({ task, startedAt, now, strict, onStart, onReset, onStrict }: {
  task: Task; startedAt: number | null; now: number; strict: boolean;
  onStart: () => void; onReset: () => void; onStrict: (v: boolean) => void;
}) {
  const plan = TIME_PLAN[task];
  const total = plan.total * 60;
  const elapsed = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;
  const left = total - elapsed;
  const over = startedAt != null && left < 0;
  // bước hiện tại theo kế hoạch chia giờ
  let acc = 0, cur = -1;
  plan.steps.forEach(([, m], i) => { if (startedAt && elapsed >= acc * 60) cur = i; acc += m; });
  const mmss = (s: number) => `${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, "0")}`;
  return (
    <section className="st-card" style={{ padding: 16 }} aria-label="Hẹn giờ">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div role="timer" aria-live="off">
          <b style={{ font: "700 28px/1 var(--font-display)", fontVariantNumeric: "tabular-nums", color: over ? "var(--danger)" : undefined }}>
            {startedAt ? (over ? `+${mmss(-left)}` : mmss(left)) : `${plan.total}:00`}
          </b>
          <span className="meta" style={{ marginLeft: 8 }}>{startedAt ? (over ? "quá giờ" : "còn lại") : `chuẩn ${plan.total} phút cho ${task === "task1" ? "Task 1" : "Task 2"}`}</span>
        </div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <label className="row" style={{ gap: 6, cursor: "pointer", fontSize: 13.5 }}>
            <input type="checkbox" checked={strict} onChange={(e) => onStrict(e.target.checked)} /> Khoá bài khi hết giờ
          </label>
          {startedAt ? <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={onReset}>Đặt lại</button>
            : <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={onStart}>Bắt đầu tính giờ</button>}
        </div>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "var(--surface-sunken)", marginTop: 10, overflow: "hidden", display: "flex" }}>
        {plan.steps.map(([label, m], i) => (
          <div key={label} title={`${label}: ${m} phút`} style={{ flex: m, borderRight: i < plan.steps.length - 1 ? "2px solid var(--surface)" : undefined, background: "transparent", position: "relative" }}>
            <div style={{ position: "absolute", inset: 0, width: `${Math.max(0, Math.min(100, ((elapsed / 60 - plan.steps.slice(0, i).reduce((a, [, x]) => a + x, 0)) / m) * 100))}%`, background: over ? "var(--danger)" : "var(--brand)" }} />
          </div>
        ))}
      </div>
      <div className="row-wrap" style={{ gap: 14, marginTop: 6 }}>
        {plan.steps.map(([label, m], i) => (
          <span key={label} className="meta" style={{ fontWeight: i === cur ? 700 : undefined, color: i === cur ? "var(--ink)" : undefined }}>{label} · {m}′</span>
        ))}
      </div>
    </section>
  );
}

/* ---------- Kết quả soát nhanh ---------- */

const LV_COLOR: Record<Finding["level"], string> = { ok: "var(--success)", warn: "var(--warning)", bad: "var(--danger)" };
const LV_MARK: Record<Finding["level"], string> = { ok: "✓", warn: "!", bad: "✕" };

function FindingList({ items }: { items: Finding[] }) {
  if (!items.length) return <p className="meta">Không thấy vấn đề.</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
      {items.map((f, i) => (
        <li key={i} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <span aria-label={f.level === "ok" ? "Ổn" : f.level === "warn" ? "Nên xem lại" : "Cần sửa"}
            style={{ flex: "0 0 20px", height: 20, borderRadius: "50%", display: "grid", placeItems: "center", font: "700 12px/1 var(--font-sans)", background: LV_COLOR[f.level], color: "var(--surface)" }}>{LV_MARK[f.level]}</span>
          <div style={{ minWidth: 0 }}>
            <b style={{ fontSize: 14.5 }} lang={f.title.startsWith("“") ? "en" : undefined}>{f.title}</b>
            {f.fix && <span style={{ fontSize: 14 }}> → <b lang="en" style={{ color: "var(--success)" }}>{f.fix}</b></span>}
            {f.detail && <div className="ink2" style={{ fontSize: 13.5 }}>{f.detail}</div>}
            {f.quote && <div className="meta" lang="en" style={{ fontStyle: "italic", marginTop: 2 }}>“{f.quote}”</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CheckPanel({ r, task }: { r: CheckResult; task: Task }) {
  const all = [...r.structure, ...r.vocabulary, ...r.grammar, ...r.style];
  const bad = all.filter((f) => f.level === "bad").length, warn = all.filter((f) => f.level === "warn").length;
  const groups: [string, string, Finding[]][] = [
    ["Cấu trúc & yêu cầu đề", task === "task1" ? "Task Achievement · Coherence" : "Task Response · Coherence", r.structure],
    ["Từ vựng", "Lexical Resource", r.vocabulary],
    ["Ngữ pháp", "Grammatical Range & Accuracy", r.grammar],
    ["Văn phong & liên kết", "Coherence & Cohesion", r.style],
  ];
  return (
    <section className="st-card st-enter" style={{ padding: 20 }} aria-labelledby="wr-ck">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 id="wr-ck" className="sec-title">Soát bài nhanh</h2>
        <span className="meta">{bad} lỗi cần sửa · {warn} điểm nên xem lại · {r.paragraphs.length} đoạn · {r.sentences} câu · trung bình {Math.round(r.avgSentence)} từ/câu</span>
      </div>
      <p className="meta" style={{ marginTop: 4 }}>Kiểm tra tự động theo quy tắc, chạy ngay trên máy bạn. Nó bắt được lỗi cấu trúc và lỗi phổ biến; lỗi ngữ pháp tinh tế, ý tưởng và độ mạch lạc cần chấm bằng AI hoặc giáo viên.</p>

      <div className="row-wrap" style={{ gap: 6, marginTop: 12 }} aria-label="Độ dài từng đoạn">
        {r.paragraphs.map((p, i) => <span key={i} className="st-badge" title={p.text.slice(0, 120)}>Đoạn {i + 1}: {p.words} từ</span>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 16 }}>
        {groups.map(([title, crit, items]) => (
          <div key={title}>
            <div style={{ marginBottom: 8 }}><b>{title}</b> <span className="meta">· {crit}</span></div>
            <FindingList items={items} />
          </div>
        ))}
      </div>

      {r.repeated.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <b>Từ lặp và gợi ý thay thế</b>
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4, fontSize: 14 }}>
            {r.repeated.map((x) => (
              <li key={x.word} lang="en"><b>{x.word}</b> <span className="meta">×{x.n}</span>{x.alt.length ? <> → {x.alt.join(", ")}</> : <span className="meta"> (dùng đại từ hoặc diễn đạt lại)</span>}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <b>Từ nối đã dùng</b>
        <div className="row-wrap" style={{ gap: 6, marginTop: 8 }}>
          {r.linkers.map((l) => (
            <span key={l.group} className={`st-badge ${l.used.length ? "st-badge-success" : ""}`} title={l.used.join(", ")}>
              {l.group}: {l.used.length ? l.used.slice(0, 3).join(", ") : "chưa có"}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
