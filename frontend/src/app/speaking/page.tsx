"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { BUILTIN_TESTS } from "@/lib/examConfig";
import { play, stopSpeech } from "@/lib/dictation";
import {
  IEE, LONG_PAUSE, PARAPHRASE_BANK, PART_TARGET,
  analyze, hasVietnamese, keyIdeas, loadAttempts, mergeVoiced, overlap, questionsFrom, saveAttempts,
  type Analysis, type Part, type SpkAttempt, type SpkQuestion,
} from "@/lib/speaking";
import { useAnswerRecorder, type Recorded } from "@/lib/useAnswerRecorder";
import AiGrade from "./AiGrade";

type Mode = "practice" | "paraphrase";
type Phase = "plan" | "prep" | "rec" | "review";

const SELF_CHECKS = [
  "Ngập ngừng, im lặng lâu",
  "Lỗi ngữ pháp (thì, chia động từ, mạo từ)",
  "Phát âm chưa rõ (âm cuối, trọng âm)",
  "Từ vựng đơn giản / lặp từ",
  "Thiếu giải thích hoặc ví dụ",
  "Dịch từ tiếng Việt sang, câu thiếu tự nhiên",
];

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.15);
    o.onended = () => ctx.close();
  } catch {}
}

export default function SpeakingPage() {
  const recorder = useAnswerRecorder();
  const [mode, setMode] = useState<Mode>("practice");
  const [part, setPart] = useState<Part>(1);
  const [testId, setTestId] = useState(BUILTIN_TESTS[0]?.demoType as string);
  const [bank, setBank] = useState<SpkQuestion[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [qIdx, setQIdx] = useState(0);
  const [custom, setCustom] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [phase, setPhase] = useState<Phase>("plan");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [hideNotes, setHideNotes] = useState(false);
  const [prepLeft, setPrepLeft] = useState(60);
  const [recStart, setRecStart] = useState(0);
  const [tick, setTick] = useState(0);
  const [rec, setRec] = useState<Recorded | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const [prev, setPrev] = useState<string[]>([]); // lời các lần nói trước của cùng câu hỏi (để đo diễn đạt lại)
  const [checks, setChecks] = useState<string[]>([]);
  const [selfNote, setSelfNote] = useState("");
  const [corrected, setCorrected] = useState("");
  const [saved, setSaved] = useState(false);
  const [aiBand, setAiBand] = useState<number | null>(null);
  const [history, setHistory] = useState<SpkAttempt[]>([]);
  const [ppIdx, setPpIdx] = useState(0);
  const [ppHide, setPpHide] = useState(false);
  const autoStop = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setHistory(loadAttempts()); setPpIdx(Math.floor(Math.random() * PARAPHRASE_BANK.length)); return () => stopSpeech(); }, []);

  // nạp câu hỏi của bộ đề đang chọn
  useEffect(() => {
    if (!testId) return;
    let stale = false;
    setLoadErr("");
    const m = /^cambridge(\d+)_test(\d)$/.exec(testId);
    if (!m) return;
    import(`@/data/cambridge${m[1]}_test${m[2]}.json`)
      .then((mod) => { if (!stale) { setBank(questionsFrom(testId, (mod.default as { speaking?: object }).speaking || {})); setQIdx(0); } })
      .catch(() => { if (!stale) setLoadErr("Không tải được câu hỏi của đề này."); });
    return () => { stale = true; };
  }, [testId]);

  const list = useMemo(() => bank.filter((q) => q.part === part), [bank, part]);
  const q: SpkQuestion | undefined = mode === "paraphrase" ? undefined
    : useCustom && custom.trim() ? { id: `custom-${custom.trim().slice(0, 40)}`, part, text: custom.trim(), topic: "Câu hỏi của bạn" }
    : list[Math.min(qIdx, list.length - 1)];
  const pp = PARAPHRASE_BANK[ppIdx % PARAPHRASE_BANK.length];
  const T = PART_TARGET[part];

  const resetAttempt = (keepPrev = false) => {
    stopSpeech(); recorder.cancel(); clearTimeout(autoStop.current);
    setPhase("plan"); setRec(null); setResult(null); setChecks([]); setSelfNote(""); setCorrected(""); setSaved(false); setPrepLeft(60); setAiBand(null);
    if (!keepPrev) { setPrev([]); setNotes({}); }
  };
  useEffect(() => { resetAttempt(); }, [part, qIdx, testId, mode, useCustom, ppIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // đồng hồ chuẩn bị Part 2 và đồng hồ ghi âm
  useEffect(() => {
    if (phase !== "prep" && phase !== "rec") return;
    const t = setInterval(() => setTick(Date.now()), 250);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase !== "prep") return;
    const left = Math.max(0, 60 - (tick - recStart) / 1000);
    setPrepLeft(left);
    if (left <= 0) { beep(); startRecording(); }
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const elapsed = phase === "rec" ? (tick - recStart) / 1000 : 0;

  const sayQuestion = () => {
    const text = mode === "paraphrase" ? pp.text : q ? (q.part === 2 ? `${q.text}. ${(q.bullets || []).join(". ")}` : q.text) : "";
    if (text) play({ text, rate: 0.95 });
  };

  const startPrep = () => { stopSpeech(); setRecStart(Date.now()); setTick(Date.now()); setPhase("prep"); };

  const startRecording = async () => {
    stopSpeech();
    const ok = await recorder.start();
    if (!ok) { setPhase("plan"); return; }
    setRecStart(Date.now()); setTick(Date.now()); setPhase("rec");
    // Part 2: giám khảo dừng ở 2 phút
    clearTimeout(autoStop.current);
    const max = mode === "paraphrase" ? 30 : part === 2 ? 125 : T.max + 30;
    autoStop.current = setTimeout(() => finish(), max * 1000);
  };

  const finish = async () => {
    clearTimeout(autoStop.current);
    const out = await recorder.stop();
    if (!out) return;
    setRec(out);
    setResult(mode === "paraphrase" ? null : analyze(out, part, q?.bullets || []));
    setPhase("review");
  };

  const sayAgain = () => {
    if (rec?.transcript) setPrev((p) => [...p, rec.transcript]);
    resetAttempt(true);
  };

  const saveSelfReview = () => {
    if (!rec || !q || !result) return;
    const a: SpkAttempt = {
      at: Date.now(), qid: q.id, part, question: q.text, transcript: rec.transcript, seconds: Math.round(result.speechSec),
      wpm: result.wpm, pauses: result.pauses.length, levels: result.indicators.map((i) => i.level),
      selfNote: [checks.length ? `Tự đánh dấu: ${checks.join("; ")}` : "", selfNote].filter(Boolean).join(". "), corrected,
      paraphrase: prev.length && rec.transcript ? Math.round(overlap(prev[prev.length - 1], rec.transcript) * 100) : undefined,
      aiBand: aiBand ?? undefined,
    };
    const next = [...history, a];
    saveAttempts(next); setHistory(next); setSaved(true);
  };

  const notesVi = Object.values(notes).some(hasVietnamese);
  const lastOverlap = prev.length && rec?.transcript ? overlap(prev[prev.length - 1], rec.transcript) : null;

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Speaking IELTS</h1>
          <p className="page-sub">Trả lời thành tiếng câu hỏi Part 1, 2, 3, ghi âm rồi nghe lại để tự tìm chỗ ngập ngừng, lỗi ngữ pháp, phát âm. Ghi ý bằng tiếng Anh theo khung Idea – Explanation – Example và tập diễn đạt lại thay vì học thuộc.</p>
        </div>
      </header>

      {(!recorder.supported.record || !recorder.supported.recognize) && (
        <div className="st-card" role="alert" style={{ padding: 14, marginBottom: 16, borderColor: "var(--warning)" }}>
          {!recorder.supported.record ? <b>Trình duyệt này không ghi âm được.</b> : <b>Trình duyệt chưa hỗ trợ nhận dạng giọng nói.</b>}{" "}
          <span className="ink2">Dùng Chrome hoặc Edge để có đủ ghi âm, lời nhận dạng và phân tích.</span>
        </div>
      )}

      <div className="row-wrap" style={{ gap: 12, marginBottom: 16, alignItems: "center" }}>
        <div className="tabs page-tabs" role="tablist" aria-label="Chế độ" style={{ marginBottom: 0 }}>
          <button type="button" role="tab" className="tab" aria-selected={mode === "practice"} onClick={() => setMode("practice")}>Luyện Part 1–3</button>
          <button type="button" role="tab" className="tab" aria-selected={mode === "paraphrase"} onClick={() => setMode("paraphrase")}>Luyện diễn đạt lại</button>
        </div>
        {mode === "practice" && (
          <div className="seg" role="radiogroup" aria-label="Phần thi">
            {([1, 2, 3] as Part[]).map((p) => <button key={p} type="button" role="radio" className="seg-btn" aria-checked={part === p} onClick={() => setPart(p)}>Part {p}</button>)}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {/* Câu hỏi */}
          <section className="st-card" style={{ padding: 22 }} aria-labelledby="sp-q">
            {mode === "practice" ? (
              <>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span id="sp-q" className="eyebrow" style={{ color: "var(--ink-muted)" }}>{T.label}</span>
                  <div className="row-wrap" style={{ gap: 6 }}>
                    <select className="input" style={{ height: 34, fontSize: 13.5 }} value={testId} onChange={(e) => { setUseCustom(false); setTestId(e.target.value); }} aria-label="Bộ đề">
                      {BUILTIN_TESTS.map((t) => <option key={t.key} value={t.demoType as string}>{t.title.replace("Cambridge IELTS", "Cam")}</option>)}
                    </select>
                    <button type="button" className="st-btn st-btn-ghost st-btn-sm" title="Câu hỏi bất ngờ để luyện phản xạ"
                      onClick={() => { setUseCustom(false); const t = BUILTIN_TESTS[Math.floor(Math.random() * BUILTIN_TESTS.length)]; setTestId(t.demoType as string); setQIdx(Math.floor(Math.random() * 6)); }}>Ngẫu nhiên</button>
                  </div>
                </div>
                {loadErr && <p role="alert" style={{ color: "var(--danger)", marginTop: 8 }}>{loadErr}</p>}
                {q ? (
                  <>
                    <p lang="en" style={{ font: "600 22px/1.45 var(--font-reading)", marginTop: 12 }}>{q.text}</p>
                    {q.bullets && q.bullets.length > 0 && (
                      <ul lang="en" style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: 15.5, display: "grid", gap: 2 }}>
                        <li style={{ listStyle: "none", marginLeft: -20 }} className="meta">You should say:</li>
                        {q.bullets.map((b) => <li key={b}>{b}</li>)}
                      </ul>
                    )}
                    <div className="row-wrap" style={{ gap: 8, marginTop: 14, alignItems: "center" }}>
                      <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={sayQuestion}>Nghe giám khảo hỏi</button>
                      {!useCustom && list.length > 1 && (
                        <>
                          <button type="button" className="st-btn st-btn-ghost st-btn-sm" disabled={qIdx <= 0} onClick={() => setQIdx((i) => i - 1)}>← Câu trước</button>
                          <span className="meta">{Math.min(qIdx, list.length - 1) + 1}/{list.length}</span>
                          <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setQIdx((i) => (i + 1) % list.length)}>Câu sau →</button>
                        </>
                      )}
                    </div>
                  </>
                ) : <p className="meta" style={{ marginTop: 12 }}>{bank.length ? "Đề này không có câu hỏi cho phần này." : "Đang tải câu hỏi…"}</p>}
                <details style={{ marginTop: 14 }} open={useCustom}>
                  <summary className="meta" style={{ cursor: "pointer" }}>Dùng câu hỏi của bạn</summary>
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <input className="input" lang="en" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Do you prefer living in a city or the countryside?" style={{ flex: 1, height: 38 }} />
                    <button type="button" className="st-btn st-btn-secondary st-btn-sm" disabled={!custom.trim()} onClick={() => setUseCustom(true)}>Dùng</button>
                  </div>
                </details>
                <p className="ink2" style={{ fontSize: 14, marginTop: 12, padding: "8px 10px", background: "var(--surface-sunken)", borderRadius: "var(--radius-sm)" }}>{T.tip}</p>
              </>
            ) : (
              <>
                <span id="sp-q" className="eyebrow" style={{ color: "var(--ink-muted)" }}>Diễn đạt lại · {pp.topic}</span>
                <p lang="en" style={{ font: "600 21px/1.5 var(--font-reading)", marginTop: 12, filter: ppHide && phase !== "review" ? "blur(7px)" : undefined }}>{pp.text}</p>
                <p className="ink2" style={{ fontSize: 14, marginTop: 10 }}>Nói lại ý này bằng cách của bạn: đổi từ (đồng nghĩa, từ loại), đổi cấu trúc (chủ động ↔ bị động, tách/gộp câu). Giữ nguyên ý, không lặp nguyên văn.</p>
                <div className="row-wrap" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
                  <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={sayQuestion}>Nghe câu</button>
                  <label className="row" style={{ gap: 6, cursor: "pointer", fontSize: 14 }}><input type="checkbox" checked={ppHide} onChange={(e) => setPpHide(e.target.checked)} /> Che chữ khi nói</label>
                  <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setPpIdx((i) => i + 1)}>Câu khác →</button>
                </div>
              </>
            )}
          </section>

          {/* Ghi chú I-E-E / chuẩn bị Part 2 */}
          {mode === "practice" && q && (
            <section className="st-card" style={{ padding: 20 }} aria-labelledby="sp-plan">
              <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <h2 id="sp-plan" className="sec-title" style={{ fontSize: 17 }}>{part === 2 ? "1 phút chuẩn bị: ghi từ khoá" : "Nghĩ bằng tiếng Anh: Idea – Explanation – Example"}</h2>
                {phase === "prep" && <b role="timer" style={{ font: "700 24px/1 var(--font-display)", color: prepLeft < 10 ? "var(--danger)" : undefined }}>{fmt(prepLeft)}</b>}
              </div>
              <p className="meta" style={{ marginTop: 4 }}>Chỉ ghi từ khoá tiếng Anh, không viết câu hoàn chỉnh. Mục đích là luyện nghĩ thẳng bằng tiếng Anh, không dịch từ tiếng Việt.</p>
              {notesVi && <p role="status" style={{ marginTop: 8, color: "var(--warning)", fontSize: 14 }}>Ghi chú đang có tiếng Việt. Thử ghi bằng từ tiếng Anh đơn giản, kể cả khi chưa biết từ “xịn”.</p>}
              {!(hideNotes && phase === "rec") ? (
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  {(part === 2 ? (q.bullets || []).map((b, i) => ({ id: `b${i}`, label: b, hint: "", frames: [] as string[] })) : IEE).map((f) => (
                    <div key={f.id}>
                      <label className="st-field-label" htmlFor={`sp-${f.id}`} lang={part === 2 ? "en" : undefined}>{f.label}</label>
                      {f.hint && <span className="meta" style={{ marginLeft: 8 }}>{f.hint}</span>}
                      <input id={`sp-${f.id}`} className="input" lang="en" value={notes[f.id] || ""} onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                        style={{ width: "100%", height: 38, marginTop: 4 }} placeholder="keywords…" disabled={phase === "review"} />
                      {f.frames.length > 0 && phase !== "review" && (
                        <div className="row-wrap" style={{ gap: 4, marginTop: 4 }}>
                          {f.frames.map((fr) => <span key={fr} className="meta" lang="en" style={{ padding: "1px 6px", borderRadius: 4, background: "var(--surface-sunken)" }}>{fr}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="meta" style={{ marginTop: 10 }}>Ghi chú đang được ẩn để bạn nói tự nhiên như trong phòng thi.</p>}
              {part !== 2 && (
                <label className="row" style={{ gap: 6, cursor: "pointer", fontSize: 13.5, marginTop: 10 }}>
                  <input type="checkbox" checked={hideNotes} onChange={(e) => setHideNotes(e.target.checked)} /> Ẩn ghi chú khi nói (như thi thật)
                </label>
              )}
            </section>
          )}

          {/* Ghi âm */}
          {(mode === "paraphrase" || q) && (
            <section className="st-card row-wrap" style={{ gap: 24, padding: "22px 24px", alignItems: "center" }} aria-label="Ghi âm">
              {phase === "rec" ? (
                <button type="button" onClick={finish} aria-label="Dừng và phân tích"
                  style={{ width: 84, height: 84, borderRadius: "50%", border: 0, cursor: "pointer", background: "var(--danger)", color: "var(--on-accent, #fff)", boxShadow: `0 0 0 ${6 + Math.round(recorder.level * 12)}px var(--danger-tint)`, transition: "box-shadow .1s" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              ) : (
                <button type="button" disabled={!recorder.supported.record || phase === "review"}
                  onClick={() => (part === 2 && mode === "practice" && phase === "plan" ? startPrep() : startRecording())}
                  aria-label={part === 2 && mode === "practice" && phase === "plan" ? "Bắt đầu 1 phút chuẩn bị" : "Bắt đầu nói"}
                  style={{ width: 84, height: 84, borderRadius: "50%", border: 0, cursor: "pointer", background: "var(--accent)", color: "var(--on-accent)", boxShadow: "0 0 0 8px var(--accent-tint)", opacity: phase === "review" ? 0.5 : 1 }}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></svg>
                </button>
              )}
              <div style={{ flex: 1, minWidth: 220 }} role="status" aria-live="polite">
                {phase === "rec" ? (
                  <>
                    <b style={{ font: "650 18px/24px var(--font-sans)" }}>Đang ghi · {fmt(elapsed)}</b>
                    {mode === "practice" && (
                      <div style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--surface-sunken)", marginTop: 8 }}>
                        <div style={{ width: `${Math.min(100, (elapsed / T.max) * 100)}%`, height: "100%", borderRadius: 4, background: elapsed < T.min ? "var(--warning)" : elapsed > T.max ? "var(--danger)" : "var(--success)" }} />
                        <i aria-hidden="true" style={{ position: "absolute", left: `${(T.ideal / T.max) * 100}%`, top: -3, bottom: -3, width: 2, background: "var(--ink-muted)" }} />
                      </div>
                    )}
                    <p className="meta" style={{ marginTop: 6 }}>{mode === "practice" ? `Mục tiêu ~${T.ideal} giây. Bấm nút đỏ khi nói xong.` : "Nói xong bấm nút đỏ."}</p>
                    {recorder.live && <p className="meta" lang="en" style={{ marginTop: 6 }}>“{recorder.live}”</p>}
                  </>
                ) : phase === "prep" ? (
                  <><b style={{ font: "650 18px/24px var(--font-sans)" }}>Đang chuẩn bị · còn {Math.ceil(prepLeft)} giây</b>
                    <p className="meta">Hết giờ sẽ có tiếng bíp và tự bắt đầu ghi âm.</p>
                    <button type="button" className="st-btn st-btn-secondary st-btn-sm" style={{ marginTop: 8 }} onClick={startRecording}>Bắt đầu nói ngay</button></>
                ) : phase === "review" ? (
                  <><b style={{ font: "650 18px/24px var(--font-sans)" }}>Đã ghi xong</b><p className="meta">Nghe lại bản ghi bên dưới và tự đánh dấu lỗi trước khi xem phân tích.</p></>
                ) : (
                  <><b style={{ font: "650 18px/24px var(--font-sans)" }}>{part === 2 && mode === "practice" ? "Bấm để bắt đầu 1 phút chuẩn bị" : "Bấm để trả lời"}</b>
                    <p className="meta">{prev.length ? `Lần nói thứ ${prev.length + 1}: hãy diễn đạt khác lần trước.` : "Nói to, rõ như đang nói với giám khảo."}</p></>
                )}
                {recorder.error && <p role="alert" style={{ color: "var(--danger)", marginTop: 6 }}>{recorder.error}</p>}
              </div>
            </section>
          )}
        </div>

        {/* Cột phải: kết quả, tự sửa, tiến độ */}
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          {phase === "review" && rec && (
            <section className="st-card st-enter" style={{ padding: 20 }} aria-labelledby="sp-res">
              <h2 id="sp-res" className="sec-title">Nghe lại bản ghi</h2>
              {rec.url ? <audio src={rec.url} controls style={{ width: "100%", marginTop: 10 }} /> : <p className="meta">Không có âm thanh.</p>}
              <Timeline rec={rec} />
              <p className="st-field-label" style={{ marginTop: 14 }}>Studia nghe được</p>
              <p lang="en" style={{ font: "500 16px/1.7 var(--font-reading)", marginTop: 4 }}>
                {rec.transcript ? <MarkedTranscript text={rec.transcript} /> : <span className="meta">Không nhận ra lời nói. Nói to, rõ hơn và đưa micro lại gần.</span>}
              </p>

              {mode === "paraphrase" && rec.transcript && <ParaphraseVerdict source={pp.text} said={rec.transcript} />}

              {lastOverlap != null && (
                <p style={{ marginTop: 12, fontSize: 14.5, color: lastOverlap > 0.5 ? "var(--warning)" : "var(--success)" }}>
                  Trùng {Math.round(lastOverlap * 100)}% cụm từ với lần nói trước.{" "}
                  {lastOverlap > 0.5 ? "Bạn đang lặp lại gần như nguyên văn, dấu hiệu học thuộc. Thử đổi từ, đổi cấu trúc, thêm ví dụ khác." : "Tốt, bạn đã diễn đạt lại theo cách khác."}
                </p>
              )}

              <div className="row-wrap" style={{ gap: 8, marginTop: 14 }}>
                <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={sayAgain}>Nói lại, diễn đạt khác</button>
                {mode === "practice" && !useCustom && <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => setQIdx((i) => (i + 1) % Math.max(1, list.length))}>Câu tiếp theo</button>}
                {mode === "paraphrase" && <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => setPpIdx((i) => i + 1)}>Câu khác</button>}
              </div>
            </section>
          )}

          {phase === "review" && result && mode === "practice" && (
            <>
              <section className="st-card" style={{ padding: 20 }} aria-labelledby="sp-self">
                <h2 id="sp-self" className="sec-title" style={{ fontSize: 17 }}>Tự sửa lỗi khi nghe lại</h2>
                <p className="meta" style={{ marginTop: 4 }}>Nghe bản ghi ít nhất một lần, đánh dấu những gì bạn tự nhận ra. Tự phát hiện lỗi giúp nhớ lâu hơn là đọc nhận xét.</p>
                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  {SELF_CHECKS.map((c) => (
                    <label key={c} className="row" style={{ gap: 8, cursor: "pointer", fontSize: 14.5 }}>
                      <input type="checkbox" checked={checks.includes(c)} onChange={(e) => setChecks((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))} /> {c}
                    </label>
                  ))}
                </div>
                <label className="st-field-label" htmlFor="sp-note" style={{ display: "block", marginTop: 12 }}>Lỗi cụ thể tôi nghe thấy</label>
                <textarea id="sp-note" className="input" rows={2} value={selfNote} onChange={(e) => setSelfNote(e.target.value)} style={{ width: "100%", marginTop: 4 }} placeholder="vd. nói “he go” thay vì “he goes”; ngập ngừng khi tìm từ “convenient”" />
                <label className="st-field-label" htmlFor="sp-fix" style={{ display: "block", marginTop: 10 }}>Câu tôi sẽ nói lại cho đúng</label>
                <textarea id="sp-fix" className="input" rows={2} lang="en" value={corrected} onChange={(e) => setCorrected(e.target.value)} style={{ width: "100%", marginTop: 4 }} placeholder="He goes to work by bus because it is more convenient." />
                <button type="button" className="st-btn st-btn-secondary st-btn-sm" style={{ marginTop: 10 }} disabled={saved} onClick={saveSelfReview}>{saved ? "Đã lưu vào nhật ký luyện nói" : "Lưu bài tự sửa"}</button>
              </section>

              <AnalysisPanel a={result} part={part} />

              {rec && q && (
                <AiGrade part={part} rec={rec} analysis={result}
                  question={q.part === 2 && q.bullets?.length ? `${q.text} You should say: ${q.bullets.join("; ")}` : q.text}
                  selfReview={[checks.length ? `Tự đánh dấu: ${checks.join("; ")}` : "", selfNote, corrected ? `Câu sửa lại: ${corrected}` : ""].filter(Boolean).join(". ")}
                  onGraded={(b) => { setAiBand(b); setSaved(false); }} />
              )}
            </>
          )}

          <ProgressPanel history={history} />
        </div>
      </div>
    </div>
  );
}

/* ---------- Dòng thời gian: khoảng có tiếng và chỗ ngập ngừng ---------- */

function Timeline({ rec }: { rec: Recorded }) {
  const v = mergeVoiced(rec.voiced);
  const total = Math.max(rec.durationSec, 1);
  const gaps: [number, number][] = [];
  for (let i = 1; i < v.length; i++) if (v[i][0] - v[i - 1][1] >= LONG_PAUSE) gaps.push([v[i - 1][1], v[i][0]]);
  if (!v.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="st-field-label">Nhịp nói</span>
        <span className="meta">{gaps.length} lần ngập ngừng ≥ {LONG_PAUSE}s</span>
      </div>
      <div style={{ position: "relative", height: 22, borderRadius: 6, background: "var(--surface-sunken)", marginTop: 6, overflow: "hidden" }} role="img"
        aria-label={`Bản ghi ${Math.round(total)} giây, ${gaps.length} lần ngập ngừng`}>
        {v.map(([a, b], i) => <i key={i} style={{ position: "absolute", left: `${(a / total) * 100}%`, width: `${Math.max(0.4, ((b - a) / total) * 100)}%`, top: 4, bottom: 4, borderRadius: 3, background: "var(--brand)" }} />)}
        {gaps.map(([a, b], i) => (
          <i key={`g${i}`} title={`Im lặng ${(b - a).toFixed(1)}s ở ${fmt(a)}`}
            style={{ position: "absolute", left: `${(a / total) * 100}%`, width: `${((b - a) / total) * 100}%`, top: 0, bottom: 0, background: "var(--danger-tint)", borderLeft: "2px solid var(--danger)", borderRight: "2px solid var(--danger)" }} />
        ))}
      </div>
      <div className="row-wrap" style={{ gap: 6, marginTop: 6 }}>
        {gaps.map(([a, b], i) => <span key={i} className="st-badge st-badge-danger">{fmt(a)} · im {(b - a).toFixed(1)}s</span>)}
      </div>
      <p className="meta" style={{ marginTop: 4 }}>Thanh xanh là lúc bạn nói; vùng đỏ là khoảng im lặng dài. Tua bản ghi tới các mốc đó để nghe bạn bị kẹt ở đâu.</p>
    </div>
  );
}

const FILLER_RE = /\b(um+|uh+|er+|erm|ah+|hmm+|you know|i mean|kind of|sort of|basically|actually|literally)\b/gi;
const FILLER_ONE = /^(um+|uh+|er+|erm|ah+|hmm+|you know|i mean|kind of|sort of|basically|actually|literally)$/i;

function MarkedTranscript({ text }: { text: string }) {
  const parts = text.split(FILLER_RE);
  return (
    <>
      {parts.map((p, i) => (FILLER_ONE.test(p) ? <mark key={i} title="Từ đệm" style={{ background: "var(--warning-tint)", borderRadius: 3, padding: "0 2px" }}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function ParaphraseVerdict({ source, said }: { source: string; said: string }) {
  const ov = overlap(source, said);
  const ratio = said.split(/\s+/).length / Math.max(1, source.split(/\s+/).length);
  const ideas = keyIdeas(source, said);
  const verdict = ov > 0.4
    ? { ok: false, text: "Bạn lặp lại khá nhiều cụm của câu gốc. Thử đổi từ loại (convenient → convenience), dùng từ đồng nghĩa, đổi chủ ngữ hoặc chuyển chủ động ↔ bị động." }
    : ratio < 0.5
      ? { ok: false, text: "Câu nói lại ngắn hơn nhiều so với câu gốc, có thể đã thiếu ý. Đối chiếu các ý chính bên dưới." }
      : { ok: true, text: "Cách nói đã khác câu gốc. Giờ tự kiểm tra: các ý chính bên dưới đều có trong câu của bạn chưa (dù bằng từ khác)?" };
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)" }}>
      <div className="row-wrap" style={{ gap: 16 }}>
        <span><b>{Math.round(ov * 100)}%</b> <span className="meta">trùng nguyên cụm với câu gốc (càng thấp càng tốt)</span></span>
        <span><b>{Math.round(ratio * 100)}%</b> <span className="meta">độ dài so với câu gốc</span></span>
      </div>
      <p style={{ marginTop: 6, fontSize: 14.5, color: verdict.ok ? "var(--success)" : "var(--warning)" }}>{verdict.text}</p>
      {ideas.length > 0 && (
        <div className="row-wrap" style={{ gap: 6, marginTop: 6, alignItems: "center" }}>
          <span className="meta">Ý chính:</span>
          {ideas.map((k) => <span key={k.word} lang="en" className={`st-badge ${k.same ? "" : "st-badge-success"}`} title={k.same ? "Bạn giữ nguyên từ này" : "Bạn đã dùng cách nói khác (tự kiểm tra ý còn đủ)"}>{k.word}{k.same ? " (giữ nguyên)" : ""}</span>)}
        </div>
      )}
    </div>
  );
}

/* ---------- Phân tích 4 tiêu chí ---------- */

const LEVEL_TEXT = ["", "Cần cải thiện", "Khá", "Tốt"];
const LEVEL_COLOR = ["", "var(--danger)", "var(--warning)", "var(--success)"];

function AnalysisPanel({ a, part }: { a: Analysis; part: Part }) {
  return (
    <section className="st-card" style={{ padding: 20 }} aria-labelledby="sp-an">
      <h2 id="sp-an" className="sec-title" style={{ fontSize: 17 }}>Phân tích theo 4 tiêu chí</h2>
      <p className="meta" style={{ marginTop: 4 }}>Mỗi tiêu chí chiếm 25% điểm Speaking. Đây là chỉ số tham khảo đo tự động từ bản ghi, không phải band chính thức.</p>
      <p style={{ marginTop: 10, fontSize: 14.5, color: a.lengthVerdict.level === "ok" ? "var(--success)" : "var(--warning)" }}>{a.lengthVerdict.text}</p>
      <div className="row-wrap" style={{ gap: 6, marginTop: 8 }} aria-label="Cấu trúc I-E-E">
        {(["idea", "explain", "example"] as const).map((k, i) => (
          <span key={k} className={`st-badge ${a.iee[k] ? "st-badge-success" : "st-badge-warning"}`}>{IEE[i].label.split(" · ")[0]} {a.iee[k] ? "✓" : "chưa rõ"}</span>
        ))}
      </div>
      {part === 2 && a.bullets.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <span className="st-field-label">Các ý trong thẻ đề</span>
          <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 3, fontSize: 14 }}>
            {a.bullets.map((b) => <li key={b.text} lang="en" style={{ color: b.covered ? "var(--success)" : "var(--ink-secondary)" }}>{b.covered ? "✓" : "○"} {b.text}</li>)}
          </ul>
        </div>
      )}
      <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
        {a.indicators.map((ind) => (
          <div key={ind.key}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <b style={{ fontSize: 14.5 }}>{ind.label}</b>
              <span className="row" style={{ gap: 4, alignItems: "center" }} aria-label={LEVEL_TEXT[ind.level]}>
                {[1, 2, 3].map((n) => <i key={n} style={{ width: 18, height: 6, borderRadius: 3, background: n <= ind.level ? LEVEL_COLOR[ind.level] : "var(--surface-sunken)" }} />)}
                <span className="meta" style={{ marginLeft: 4 }}>{LEVEL_TEXT[ind.level]}</span>
              </span>
            </div>
            <div className="meta">{ind.summary}</div>
            {ind.notes.length > 0 && <ul className="ink2" style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13.5, display: "grid", gap: 2 }}>{ind.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          </div>
        ))}
      </div>
      {(a.structures.length > 0 || a.advanced.length > 0) && (
        <div className="meta" style={{ marginTop: 12 }}>
          {a.structures.length > 0 && <div>Cấu trúc đã dùng: {a.structures.join(", ")}.</div>}
          {a.advanced.length > 0 && <div lang="en">Từ ít phổ biến: {a.advanced.join(", ")}.</div>}
        </div>
      )}
    </section>
  );
}

/* ---------- Tiến độ ---------- */

function ProgressPanel({ history }: { history: SpkAttempt[] }) {
  if (!history.length) return (
    <section className="st-card" style={{ padding: 20 }}>
      <h2 className="sec-title" style={{ fontSize: 17 }}>Nhật ký luyện nói</h2>
      <p className="meta" style={{ marginTop: 6 }}>Chưa có. Sau mỗi lần trả lời, bấm “Lưu bài tự sửa” để theo dõi tốc độ nói, số lần ngập ngừng và lỗi bạn đã tự sửa.</p>
    </section>
  );
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const first = history.slice(0, 5), last = history.slice(-5);
  const ppm = (h: SpkAttempt) => (h.seconds ? (h.pauses / h.seconds) * 60 : 0);
  return (
    <section className="st-card" style={{ padding: 20 }} aria-labelledby="sp-prog">
      <h2 id="sp-prog" className="sec-title" style={{ fontSize: 17 }}>Nhật ký luyện nói</h2>
      <div className="row-wrap" style={{ gap: 24, marginTop: 10 }}>
        <div><div className="meta">Số câu đã nói</div><b style={{ font: "700 22px/30px var(--font-display)" }}>{history.length}</b></div>
        <div><div className="meta">Tốc độ (5 lần gần nhất)</div><b style={{ font: "700 22px/30px var(--font-display)" }}>{avg(last.map((h) => h.wpm))}</b> <span className="meta">từ/phút{history.length > 5 ? ` (đầu: ${avg(first.map((h) => h.wpm))})` : ""}</span></div>
        <div><div className="meta">Ngập ngừng mỗi phút</div><b style={{ font: "700 22px/30px var(--font-display)" }}>{(last.reduce((t, h) => t + ppm(h), 0) / last.length).toFixed(1)}</b></div>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "grid", gap: 8 }}>
        {history.slice(-5).reverse().map((h) => (
          <li key={h.at} style={{ fontSize: 13.5, borderTop: "1px solid var(--hairline)", paddingTop: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="st-badge">Part {h.part}</span>
              <span lang="en" className="ink2" style={{ flex: 1, minWidth: 140 }}>{h.question}</span>
              <span className="meta">{h.wpm} từ/phút · {h.pauses} lần ngập ngừng{h.aiBand != null ? ` · AI ${h.aiBand.toFixed(1)}` : ""}</span>
            </div>
            {h.selfNote && <div className="meta" style={{ marginTop: 2 }}>{h.selfNote}</div>}
            {h.corrected && <div lang="en" style={{ marginTop: 2, color: "var(--success)" }}>→ {h.corrected}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
