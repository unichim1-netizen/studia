"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Mascot from "@/components/mascot/Mascot";
import { API, apiFetch } from "@/lib/api";
import { TIME_PLAN, checkEssay, essayType, loadHistory, outlineFor, paragraphsOf, pushHistory, type CheckResult, type WritingHistory } from "@/lib/writingCheck";
import { CheckPanel, OutlineCard, PromptPicker, TimerCard } from "./parts";
import AiContextCard from "@/components/AiContextCard";
import { describeUsed, payload, type AiContext, type UsedContext } from "@/lib/aiContext";
import "./writing.css";

type Task = "task1" | "task2";
type Issue = { type: string; text: string; suggestion: string; explanation_vi: string };
type SentenceResult = { index: number; original: string; corrected: string; changed: boolean; issues: Issue[] };
type Criterion = { name: string; band: number; comment_vi: string; strengths: string[]; improvements: string[] };
type Result = {
  task: Task; words: number; min_words: number; under_length: boolean; overall: number;
  criteria: Record<"task" | "coherence" | "lexical" | "grammar", Criterion>;
  summary_vi: string; priorities_vi: string[]; sentences: SentenceResult[]; issue_count: number;
  model_rewrite?: { paragraph_index: number | null; text: string; notes_vi: string[] } | null;
  context?: UsedContext;
};

const TASKS: { id: Task; label: string; min: number; hint: string; sample: string }[] = [
  {
    id: "task1", label: "Task 1", min: 150, hint: "Mô tả biểu đồ, bảng, quy trình hoặc bản đồ (Academic) / viết thư (General)",
    sample: "The chart below shows the percentage of households with internet access in three countries between 2000 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
  },
  {
    id: "task2", label: "Task 2", min: 250, hint: "Viết bài luận nêu quan điểm, thảo luận hoặc giải pháp",
    sample: "Some people believe that studying abroad is the best way to gain a good education, while others think students should stay in their own country. Discuss both views and give your own opinion.",
  },
];

const ISSUE_LABEL: Record<string, string> = { grammar: "Ngữ pháp", vocabulary: "Từ vựng", spelling: "Chính tả", punctuation: "Dấu câu", style: "Diễn đạt" };
const CRIT_ORDER = ["task", "coherence", "lexical", "grammar"] as const;
const CRIT_VI: Record<string, string> = { task: "Hoàn thành yêu cầu đề", coherence: "Mạch lạc và liên kết", lexical: "Vốn từ", grammar: "Ngữ pháp" };

const countWords = (t: string) => (t.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
const bandColor = (b: number) => (b >= 7 ? "var(--success)" : b >= 5.5 ? "var(--brand)" : b >= 4.5 ? "var(--accent-strong)" : "var(--danger)");

/** Tách câu gốc thành các đoạn, bôi đậm phần lỗi mà AI chỉ ra (chỉ lần xuất hiện đầu, không chồng lấn). */
function segments(original: string, issues: Issue[]): { text: string; issue?: Issue }[] {
  const spans: { start: number; end: number; issue: Issue }[] = [];
  for (const iss of issues) {
    if (!iss.text) continue;
    const start = original.indexOf(iss.text);
    if (start < 0) continue;
    const end = start + iss.text.length;
    if (spans.some((s) => start < s.end && end > s.start)) continue;
    spans.push({ start, end, issue: iss });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: { text: string; issue?: Issue }[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push({ text: original.slice(pos, s.start) });
    out.push({ text: original.slice(s.start, s.end), issue: s.issue });
    pos = s.end;
  }
  if (pos < original.length) out.push({ text: original.slice(pos) });
  return out.length ? out : [{ text: original }];
}

function BandRing({ band }: { band: number }) {
  const R = 54, C = 2 * Math.PI * R;
  return (
    <div className="st-band wr-ring" role="img" aria-label={`Overall band ${band} trên 9`}>
      <svg width="140" height="140" viewBox="0 0 140 140" fill="none" aria-hidden="true">
        <circle className="st-band-track" cx="70" cy="70" r={R} strokeWidth="11" />
        <circle className="st-band-arc" cx="70" cy="70" r={R} strokeWidth="11" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - band / 9)} />
      </svg>
      <div className="st-band-center"><div className="st-band-score">{band.toFixed(1)}</div><div className="st-band-label">Overall</div></div>
    </div>
  );
}

export default function WritingPage() {
  const [task, setTask] = useState<Task>("task2");
  const [prompt, setPrompt] = useState("");
  const [essay, setEssay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [outline, setOutline] = useState<Record<string, string>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [strict, setStrict] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [history, setHistory] = useState<WritingHistory>([]);
  const [loaded, setLoaded] = useState(false);
  const essayRef = useRef<HTMLTextAreaElement>(null);
  const aiCtx = useRef<AiContext | null>(null);

  // Giữ bản nháp (đề, bài, dàn ý, giờ bắt đầu) khi tải lại trang
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem("studia_writing_draft") || "null");
      if (d) {
        setTask(d.task === "task1" ? "task1" : "task2"); setPrompt(d.prompt || ""); setEssay(d.essay || "");
        setOutline(d.outline || {}); setImage(d.image || null); setSource(d.source || ""); setStartedAt(d.startedAt || null); setStrict(!!d.strict);
      }
    } catch {}
    setHistory(loadHistory());
    setNow(Date.now());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem("studia_writing_draft", JSON.stringify({ task, prompt, essay, outline, image, source, startedAt, strict })); } catch {}
  }, [loaded, task, prompt, essay, outline, image, source, startedAt, strict]);

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const cfg = TASKS.find((t) => t.id === task)!;
  const words = useMemo(() => countWords(essay), [essay]);
  const enough = words >= 30;
  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  const timeUp = !!startedAt && elapsed >= TIME_PLAN[task].total * 60;
  const locked = strict && timeUp;
  const paraCount = useMemo(() => paragraphsOf(essay).length, [essay]);

  const switchTask = (t: Task) => {
    if (t === task) return;
    setTask(t); setPrompt(""); setImage(null); setSource(""); setOutline({}); setStartedAt(null); setCheck(null); setResult(null);
  };

  const insertOutline = (text: string) => {
    setEssay((e) => (e.trim() ? `${e.trim()}\n\n${text}` : text));
    if (!startedAt) setStartedAt(Date.now());
    setTimeout(() => essayRef.current?.focus(), 30);
  };

  const runCheck = () => {
    setCheck(checkEssay(task, prompt, essay));
    setTimeout(() => document.getElementById("wr-ck")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const res = await apiFetch(`${API}/writing/grade`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task, prompt, essay,
          context: aiCtx.current ? payload(aiCtx.current, "writing") : undefined,
          attempt: {
            minutes_used: startedAt ? Math.round(elapsed / 60) : 0,
            // dàn ý người học đã lập, ghi theo tên từng phần để AI nhận xét bài có đi theo kế hoạch không
            outline: outlineFor(task, task === "task2" ? essayType(prompt) : "unknown")
              .filter((p) => (outline[p.id] || "").trim()).map((p) => `${p.title}: ${outline[p.id].trim()}`).join("\n"),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Không chấm được bài, thử lại sau");
      setResult(data);
      pushHistory({ at: Date.now(), task, words, band: typeof data.overall === "number" ? data.overall : null, seconds: Math.round(elapsed), promptHead: (source || prompt).slice(0, 80) });
      setHistory(loadHistory());
      setTimeout(() => document.getElementById("wr-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e: any) {
      setError(e.message || "Không chấm được bài, thử lại sau");
    }
    setBusy(false);
  };

  const shown = result ? result.sentences.filter((s) => !onlyIssues || s.changed) : [];

  return (
    <div className="wrap stagger wr">
      <header className="page-head">
        <div>
          <h1 className="page-title">Luyện & chấm Writing</h1>
          <p className="page-sub">Lập dàn ý 4 đoạn, viết trong giới hạn 20 phút (Task 1) hoặc 40 phút (Task 2), soát lỗi lặp từ và lỗi phổ biến ngay lập tức, rồi để Coal chấm chi tiết theo 4 tiêu chí IELTS.</p>
        </div>
      </header>

      <section className="st-card wr-form" aria-label="Đề bài">
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div className="seg" role="tablist" aria-label="Loại bài">
            {TASKS.map((t) => (
              <button key={t.id} type="button" role="tab" className="seg-btn" aria-selected={task === t.id} onClick={() => switchTask(t.id)}>{t.label}</button>
            ))}
          </div>
          <PromptPicker task={task} onPick={(p) => { setPrompt(p.text); setImage(p.image); setSource(p.source); setOutline({}); setCheck(null); setResult(null); }} />
        </div>
        <p className="meta">{cfg.hint}. Tối thiểu {cfg.min} từ, chuẩn {TIME_PLAN[task].total} phút.</p>

        <label className="wr-label" htmlFor="wr-prompt">
          Đề bài{source ? ` · ${source}` : ""}
          <button type="button" className="link" onClick={() => { setPrompt(cfg.sample); setImage(null); setSource(""); }}>Dùng đề mẫu</button>
        </label>
        <textarea id="wr-prompt" className="wr-area" rows={3} value={prompt} maxLength={2000} placeholder="Dán đề bài vào đây để chấm đúng yêu cầu (không bắt buộc)" onChange={(e) => setPrompt(e.target.value)} />
        {image && <img src={image} alt="Hình minh hoạ của đề Task 1" style={{ maxWidth: "100%", maxHeight: 420, objectFit: "contain", borderRadius: "var(--radius-sm)", background: "#fff", marginTop: 6 }} />}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
        <OutlineCard task={task} prompt={prompt} outline={outline} onChange={setOutline} onInsert={insertOutline} />

        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <TimerCard task={task} startedAt={startedAt} now={now} strict={strict}
            onStart={() => { setStartedAt(Date.now()); setNow(Date.now()); essayRef.current?.focus(); }}
            onReset={() => setStartedAt(null)} onStrict={setStrict} />

          <section className="st-card wr-form" aria-label="Bài viết của bạn">
            <label className="wr-label" htmlFor="wr-essay">Bước 2 · Bài viết <span className="meta">mỗi đoạn cách một dòng trống</span></label>
            <textarea id="wr-essay" ref={essayRef} className="wr-area wr-essay" rows={16} value={essay} readOnly={locked}
              placeholder="Viết hoặc dán bài của bạn bằng tiếng Anh…" spellCheck={false}
              onChange={(e) => { setEssay(e.target.value); if (!startedAt && e.target.value.length > 20) setStartedAt(Date.now()); }} />
            {locked && <p role="status" className="wr-warn">Hết giờ, bài đã khoá. Soát lỗi và chấm để xem kết quả (bỏ chọn “Khoá bài khi hết giờ” nếu muốn viết tiếp).</p>}

            <div className="wr-bar">
              <span className="wr-count num" data-short={words < cfg.min || undefined}>
                {words} / {cfg.min} từ · {paraCount} đoạn{words > 0 && words < cfg.min ? " · chưa đủ độ dài" : ""}
                {startedAt && elapsed > 60 ? ` · ${Math.round(words / (elapsed / 60))} từ/phút` : ""}
              </span>
              <div className="row-wrap" style={{ gap: 8 }}>
                <button type="button" className="st-btn st-btn-secondary" onClick={runCheck} disabled={!essay.trim()}>Bước 3 · Soát nhanh</button>
                <button type="button" className="st-btn st-btn-primary" onClick={submit} disabled={busy || !enough}>
                  {busy ? "Coal đang chấm…" : "Chấm chi tiết bằng AI"}
                </button>
              </div>
            </div>
            {!enough && essay.trim() && <p className="meta">Cần ít nhất 30 từ để chấm bằng AI.</p>}
            {error && <div role="alert" className="gp-msg">{error}{check ? "" : " Bạn vẫn có thể bấm “Soát nhanh” để kiểm tra lỗi ngay trên máy."}</div>}
          </section>
        </div>
      </div>

      <AiContextCard skill="writing" onChange={(c) => { aiCtx.current = c; }} />

      {check && <CheckPanel r={check} task={task} />}

      {busy && (
        <section className="st-card wr-wait" aria-live="polite">
          <Mascot mood="focus" size={96} talking label="" />
          <div><b>Coal đang đọc bài của bạn</b><p className="meta">Chấm 4 tiêu chí và soát từng câu, khoảng 10–30 giây.</p></div>
        </section>
      )}

      {result && !busy && (
        <div id="wr-result" className="wr-result">
          <section className="st-card wr-top">
            <BandRing band={result.overall} />
            <div className="wr-top-text">
              <div className="eyebrow">Kết quả · {TASKS.find((t) => t.id === result.task)?.label} · {result.words} từ</div>
              <p className="wr-summary">{result.summary_vi}</p>
              {result.context && <p className="meta" style={{ marginTop: 6 }}>{describeUsed(result.context)}</p>}
              {result.under_length && <p className="wr-warn">Bài ngắn hơn {result.min_words} từ nên điểm tiêu chí đầu bị trừ.</p>}
              {result.priorities_vi.length > 0 && (
                <>
                  <h2 className="heading-3" style={{ marginTop: 12 }}>Nên sửa trước</h2>
                  <ol className="wr-prio">{result.priorities_vi.map((p, i) => <li key={i}>{p}</li>)}</ol>
                </>
              )}
            </div>
          </section>

          <section className="wr-crit" aria-label="Điểm 4 tiêu chí">
            {CRIT_ORDER.map((k) => {
              const c = result.criteria[k];
              return (
                <article key={k} className="st-card wr-c">
                  <div className="wr-c-head">
                    <div><b>{c.name}</b><span className="meta">{CRIT_VI[k]}</span></div>
                    <span className="wr-c-band num" style={{ color: bandColor(c.band) }}>{c.band.toFixed(1)}</span>
                  </div>
                  <div className="bar" aria-hidden="true"><i style={{ width: `${(c.band / 9) * 100}%`, background: bandColor(c.band) }} /></div>
                  <p className="wr-c-note">{c.comment_vi}</p>
                  {c.strengths.length > 0 && <ul className="wr-list ok">{c.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                  {c.improvements.length > 0 && <ul className="wr-list todo">{c.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                </article>
              );
            })}
          </section>

          {result.model_rewrite && (
            <section className="st-card" aria-labelledby="wr-rw-h">
              <h2 id="wr-rw-h" className="sec-title">Viết lại ở band mục tiêu{result.model_rewrite.paragraph_index != null ? ` · đoạn ${result.model_rewrite.paragraph_index + 1}` : ""}</h2>
              <p className="meta" style={{ marginTop: 4 }}>Coal chọn đoạn kéo điểm xuống nhiều nhất và viết lại, giữ nguyên ý của bạn. Đối chiếu từng câu để thấy khác biệt, đừng chép nguyên văn.</p>
              <p lang="en" style={{ marginTop: 10, font: "400 16.5px/1.7 var(--font-reading, var(--font-sans))", padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)", whiteSpace: "pre-wrap" }}>{result.model_rewrite.text}</p>
              {result.model_rewrite.notes_vi.length > 0 && <ul className="wr-list ok" style={{ marginTop: 10 }}>{result.model_rewrite.notes_vi.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </section>
          )}

          <section className="st-card" aria-labelledby="wr-sent-h">
            <div className="sec-head">
              <h2 id="wr-sent-h" className="sec-title">Sửa lỗi từng câu</h2>
              <label className="wr-toggle">
                <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
                Chỉ hiện câu cần sửa ({result.sentences.filter((s) => s.changed).length}/{result.sentences.length})
              </label>
            </div>
            {shown.length === 0 ? (
              <p className="meta">Không có câu nào cần sửa. Tốt lắm!</p>
            ) : (
              <ol className="wr-sents">
                {shown.map((s) => (
                  <li key={s.index} className="wr-s" data-changed={s.changed || undefined}>
                    <span className="wr-s-n num">{s.index + 1}</span>
                    <div className="wr-s-body">
                      <p className="wr-orig" lang="en">
                        {segments(s.original, s.issues).map((seg, i) => seg.issue
                          ? <mark key={i} className="wr-mark" data-type={seg.issue.type} title={ISSUE_LABEL[seg.issue.type] || seg.issue.type}>{seg.text}</mark>
                          : <span key={i}>{seg.text}</span>)}
                      </p>
                      {s.corrected !== s.original && <p className="wr-fix" lang="en"><span className="wr-tag">Gợi ý</span>{s.corrected}</p>}
                      {s.issues.length > 0 && (
                        <ul className="wr-issues">
                          {s.issues.map((iss, i) => (
                            <li key={i}>
                              <span className="wr-tag" data-type={iss.type}>{ISSUE_LABEL[iss.type] || iss.type}</span>
                              {iss.text && iss.suggestion && <span lang="en"><s>{iss.text}</s> → <b>{iss.suggestion}</b></span>}
                              {iss.explanation_vi && <span className="meta"> {iss.explanation_vi}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {history.length > 0 && (
        <section className="st-card" aria-labelledby="wr-hist">
          <h2 id="wr-hist" className="sec-title" style={{ marginBottom: 10 }}>Các bài đã chấm</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {history.slice(-8).reverse().map((h) => (
              <li key={h.at} className="row" style={{ gap: 12, fontSize: 14, alignItems: "baseline", flexWrap: "wrap" }}>
                <b className="num" style={{ minWidth: 34, color: h.band != null ? bandColor(h.band) : undefined }}>{h.band != null ? h.band.toFixed(1) : "—"}</b>
                <span className="st-badge">{h.task === "task1" ? "Task 1" : "Task 2"}</span>
                <span className="meta">{new Date(h.at).toLocaleDateString("vi-VN")} · {h.words} từ{h.seconds ? ` · ${Math.round(h.seconds / 60)} phút` : ""}</span>
                <span className="ink2" style={{ flex: 1, minWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.promptHead}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
