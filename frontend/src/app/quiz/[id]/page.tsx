"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { API, apiFetch } from "@/lib/api";
import { X, Check } from "lucide-react";

type Option = { id: string; text: string };
type Question = {
  id?: string;
  question_text: string;
  question_type?: string;
  exercise_type?: string;
  options?: (Option | string)[];
  correct_answer?: string;
  explanation?: string;
  grading_rubric?: string;
  difficulty?: number;
};
type Answer = { value: string; confidence: number; timeMs: number };

const LETTERS = "ABCDEFGH";

function normOptions(q: Question): Option[] {
  return (q.options || []).map((o, i) =>
    typeof o === "string" ? { id: LETTERS[i] || String(i + 1), text: o } : o
  );
}

/** Câu hỏi mở (tự luận ngắn) được chấm bằng AI thay vì so khớp đáp án. */
function isOpen(q: Question) {
  return q.exercise_type === "recall" || q.exercise_type === "sentence_construction"
    || (normOptions(q).length === 0 && !(q.correct_answer || "").trim());
}

export default function QuizPage({ params }: { params: { id: string } }) {
  const search = useSearchParams();
  const mode = search.get("mode") === "multi" ? "multi" : "single";
  const [docId, setDocId] = useState<string | null>(search.get("doc"));
  const [topicName, setTopicName] = useState("");
  const [quizId, setQuizId] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [phase, setPhase] = useState<"loading" | "error" | "quiz" | "grading" | "result">("loading");
  const [error, setError] = useState("");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [draft, setDraft] = useState("");
  const [confidence, setConfidence] = useState(3);
  const [result, setResult] = useState<any>(null);
  const shownAt = useRef(Date.now());

  const load = async () => {
    setPhase("loading");
    setError("");
    setAnswers({});
    setIdx(0);
    setDraft("");
    try {
      let name = topicName;
      let doc = docId;
      if (!name) {
        const tr = await apiFetch(`${API}/documents/topics/${params.id}`);
        if (!tr.ok) throw new Error("Không tìm thấy chủ đề này.");
        const t = await tr.json();
        name = t.name;
        doc = doc || t.document_id || null;
        setTopicName(name);
        setDocId(doc);
      }
      const res = await apiFetch(`${API}/quizzes/${mode === "multi" ? "generate-multi" : "generate"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic_id: params.id, topic_name: name, document_id: doc, question_count: 5, user_mastery: 50,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Không tạo được câu hỏi.");
      const qs: Question[] = d.questions || [];
      if (qs.length === 0) throw new Error("AI chưa sinh được câu hỏi cho chủ đề này. Hãy thử lại sau.");
      setQuizId(d.quiz_id);
      setQuestions(qs);
      setPhase("quiz");
      shownAt.current = Date.now();
    } catch (e: any) {
      setError(e?.message || "Không kết nối được máy chủ.");
      setPhase("error");
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params.id, mode]);

  const q = questions[idx];
  const options = useMemo(() => (q ? normOptions(q) : []), [q]);
  const open = q ? isOpen(q) : false;
  const canNext = open ? draft.trim().length > 0 : !!draft;

  const next = () => {
    if (!q || !canNext) return;
    const updated = { ...answers, [idx]: { value: draft.trim(), confidence, timeMs: Date.now() - shownAt.current } };
    setAnswers(updated);
    setDraft("");
    setConfidence(3);
    shownAt.current = Date.now();
    if (idx + 1 < questions.length) setIdx(idx + 1);
    else finish(updated);
  };

  const finish = async (final: Record<number, Answer>) => {
    setPhase("grading");
    try {
      const closed = questions.map((qq, i) => ({ qq, i })).filter(x => !isOpen(x.qq));
      const openOnes = questions.map((qq, i) => ({ qq, i })).filter(x => isOpen(x.qq));
      let full: any = null;
      if (closed.length > 0) {
        const res = await apiFetch(`${API}/quizzes/submit-full`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quiz_id: quizId, topic_id: params.id, topic_name: topicName,
            answers: closed.map(({ qq, i }) => ({
              question_id: qq.id, question: qq, user_answer: final[i]?.value || "",
              response_time_ms: final[i]?.timeMs || 5000, confidence_rating: final[i]?.confidence || 3,
            })),
          }),
        });
        if (!res.ok) throw new Error("Không chấm được bài trắc nghiệm.");
        full = await res.json();
      }
      const graded: Record<number, any> = {};
      await Promise.all(openOnes.map(async ({ qq, i }) => {
        const res = await apiFetch(`${API}/quizzes/grade-open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_text: qq.question_text, grading_rubric: qq.grading_rubric || "",
            user_answer: final[i]?.value || "", topic_id: params.id, topic_name: topicName, document_id: docId,
          }),
        });
        if (res.ok) graded[i] = (await res.json()).grading;
      }));
      setResult({ full, graded, closedIdx: closed.map(c => c.i) });
      setPhase("result");
    } catch (e: any) {
      setError(e?.message || "Có lỗi khi chấm bài.");
      setPhase("error");
    }
  };

  // Phím tắt: A–H chọn đáp án, Enter để sang câu tiếp
  useEffect(() => {
    if (phase !== "quiz") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      const k = e.key.toUpperCase();
      const hit = options.find((o) => o.id.toUpperCase() === k);
      if (hit) { setDraft(hit.id); e.preventDefault(); }
      else if (e.key === "Enter") { next(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exitHref = docId ? `/books/${docId}` : "/books";
  const header = (
    <header className="row" style={{ gap: 16 }}>
      <Link className="icon-btn icon-btn-solid" href={exitHref} aria-label="Thoát quiz" title="Thoát"><X size={18} strokeWidth={2} /></Link>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <span className="label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{topicName || "Chủ đề"} · {mode === "multi" ? "Bài tập nhiều dạng" : "Kiểm tra nhanh"}</span>
          {phase === "quiz" && <span className="meta num">Câu {idx + 1}/{questions.length}</span>}
        </div>
        <div className="st-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={questions.length || 1} aria-valuenow={phase === "result" ? questions.length : idx} aria-label="Tiến độ quiz">
          <div className="st-progress-fill" style={{ width: `${phase === "result" ? 100 : questions.length ? (idx / questions.length) * 100 : 0}%` }} />
        </div>
      </div>
    </header>
  );

  const wrap = (children: React.ReactNode) => (
    <div className="wrap-narrow">
      {header}
      {children}
    </div>
  );

  if (phase === "loading" || phase === "grading") {
    return wrap(
      <div className="st-card stack" style={{ padding: 32, gap: 14 }}>
        <div className="skeleton" style={{ height: 28, width: "70%" }} />
        {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 52 }} />)}
        <p className="meta" style={{ textAlign: "center" }}>{phase === "loading" ? "Đang tạo câu hỏi từ nội dung sách…" : "Đang chấm bài…"}</p>
      </div>
    );
  }

  if (phase === "error") {
    return wrap(
      <div className="st-card stack" style={{ padding: 28, gap: 16 }}>
        <p role="alert" className="st-alert st-alert-danger">{error}</p>
        <div className="row">
          <button className="st-btn st-btn-primary" type="button" onClick={() => (questions.length && Object.keys(answers).length === questions.length ? finish(answers) : load())}>Thử lại</button>
          <Link className="st-btn st-btn-secondary" href={exitHref}>Quay lại</Link>
        </div>
      </div>
    );
  }

  if (phase === "result" && result) {
    const full = result.full;
    const closedTotal = result.closedIdx.length;
    const openGraded = Object.values(result.graded) as any[];
    const correct = (full?.correct_count || 0) + openGraded.filter((g) => g?.is_acceptable).length;
    const total = closedTotal + openGraded.length || questions.length;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const closedResults: any[] = full?.results || [];
    const good = pct >= 70;

    return wrap(
      <div className="stack" style={{ gap: 16 }}>
        <section className="st-card st-enter" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", padding: 28 }}>
          <div style={{ font: "700 56px/1 var(--font-display)", letterSpacing: -1.5, color: good ? "var(--success)" : "var(--ink)" }} className="num">{pct}%</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 className="heading-2">{good ? "Làm tốt lắm!" : "Gần được rồi — ôn lại phần chưa đúng nhé."}</h1>
            <p className="ink2" style={{ marginTop: 4 }}>Đúng {correct}/{total} câu{full?.message ? ` · ${full.message}` : ""}</p>
            {full?.plan_adapted && <p className="meta" style={{ marginTop: 6, color: "var(--accent-strong)" }}>Lịch học đã được điều chỉnh để ôn lại phần còn yếu.</p>}
          </div>
        </section>

        {questions.map((qq, i) => {
          const a = answers[i];
          const opts = normOptions(qq);
          const ci = result.closedIdx.indexOf(i);
          const r = ci >= 0 ? closedResults[ci] : null;
          const g = result.graded[i];
          const ok = r ? r.is_correct : g?.is_acceptable;
          const label = (v?: string) => { const o = opts.find((x) => x.id === v); return o ? `${o.id}. ${o.text}` : v || "(bỏ trống)"; };
          return (
            <article key={i} className="st-card stack" style={{ gap: 10, padding: 22, background: ok ? "var(--surface)" : "var(--surface)" }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <p className="passage-sm" style={{ color: "var(--ink)" }}><b className="num" style={{ fontFamily: "var(--font-sans)" }}>{i + 1}. </b>{qq.question_text}</p>
                <span className={ok ? "st-badge st-badge-success" : "st-badge st-badge-danger"} style={{ flexShrink: 0 }}>{ok ? <><Check size={14} strokeWidth={2.4} /> Đúng</> : <><X size={14} strokeWidth={2.4} /> Chưa đúng</>}</span>
              </div>
              <div className="ink2" style={{ fontSize: 14.5 }}>Bạn trả lời: {label(a?.value)}</div>
              {r && !r.is_correct && <div style={{ fontSize: 14.5 }}>Đáp án đúng: <b>{label(r.correct_answer)}</b></div>}
              {r?.explanation && <p className="ink2" style={{ fontSize: 14.5, padding: "10px 12px", borderRadius: "var(--radius-sm)", background: ok ? "var(--success-tint)" : "var(--danger-tint)" }}>{r.explanation}</p>}
              {g && (
                <div className="stack" style={{ gap: 6, fontSize: 14.5 }}>
                  <div>Điểm AI chấm: <b className="num">{g.score}/100</b></div>
                  {g.feedback_vi && <p className="ink2">{g.feedback_vi}</p>}
                  {g.missing_points?.length > 0 && <div className="meta">Còn thiếu: {g.missing_points.join("; ")}</div>}
                  {g.improved_version && <div className="passage-sm ink2" style={{ paddingLeft: 12, borderLeft: "2px solid var(--marker)" }}>{g.improved_version}</div>}
                </div>
              )}
            </article>
          );
        })}

        <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="st-btn st-btn-ghost" type="button" onClick={load}>Làm bộ câu hỏi mới</button>
          <Link className="st-btn st-btn-secondary" href="/review">Lịch ôn tập</Link>
          <Link className="st-btn st-btn-primary" href={docId ? `/books/${docId}` : "/dashboard"}>Xong</Link>
        </div>
      </div>
    );
  }

  if (!q) return null;

  return wrap(
    <section className="st-card" style={{ padding: 32 }} aria-labelledby="q-h">
      {q.question_type && <div className="row-wrap" style={{ marginBottom: 14 }}><span className="st-badge st-badge-brand">{q.exercise_type || q.question_type}</span>{q.difficulty ? <span className="st-badge">Độ khó {q.difficulty}/5</span> : null}</div>}
      <h1 id="q-h" className="passage" style={{ color: "var(--ink)", fontSize: 20, lineHeight: "32px" }}>{q.question_text}</h1>

      {open || options.length === 0 ? (
        <label className="field" style={{ marginTop: 20 }}>
          <span className="st-sr">Câu trả lời</span>
          <textarea className="input" rows={open && q.exercise_type !== "fill_blank" ? 5 : 2} value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={q.exercise_type === "fill_blank" ? "Điền từ còn thiếu" : "Nhập câu trả lời của bạn"} />
        </label>
      ) : (
        <div className="stack" role="radiogroup" aria-labelledby="q-h" style={{ gap: 10, marginTop: 24 }}>
          {options.map((opt) => {
            const selected = draft === opt.id;
            return (
              <button key={opt.id} type="button" role="radio" aria-checked={selected} onClick={() => setDraft(opt.id)} className={`st-option${selected ? " st-option-selected" : ""}`}>
                <span className="st-option-key" aria-hidden="true">{opt.id}</span>
                <span className="st-option-text">{opt.text}</span>
              </button>
            );
          })}
        </div>
      )}

      <fieldset style={{ border: 0, padding: 0, margin: "24px 0 0" }}>
        <legend className="field-label" style={{ marginBottom: 8 }}>Bạn chắc chắn đến đâu?</legend>
        <div className="seg" style={{ width: "100%", flexWrap: "wrap" }}>
          {[{ val: 1, label: "Đoán" }, { val: 2, label: "Phân vân" }, { val: 3, label: "Khá chắc" }, { val: 4, label: "Rất chắc" }].map((c) => (
            <button key={c.val} type="button" className="seg-btn" aria-pressed={confidence === c.val} onClick={() => setConfidence(c.val)} style={{ flex: 1, justifyContent: "center" }}>{c.label}</button>
          ))}
        </div>
        <p className="meta" style={{ marginTop: 6 }}>Độ tự tin giúp lịch ôn chính xác hơn: đúng nhưng còn đoán vẫn sẽ được nhắc lại sớm.</p>
      </fieldset>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 24, flexWrap: "wrap" }}>
        <span className="meta">{options.length > 0 && !open ? <>Phím tắt: <span className="kbd">{options[0]?.id}</span>–<span className="kbd">{options[options.length - 1]?.id}</span> chọn · <span className="kbd">Enter</span> tiếp</> : !canNext ? "Nhập câu trả lời để tiếp tục." : " "}</span>
        <button type="button" className="st-btn st-btn-primary st-btn-lg" onClick={next} disabled={!canNext} title={!canNext ? "Chọn hoặc nhập câu trả lời trước" : undefined}>
          {idx + 1 < questions.length ? "Câu tiếp theo" : "Nộp bài"}
        </button>
      </div>
    </section>
  );
}
