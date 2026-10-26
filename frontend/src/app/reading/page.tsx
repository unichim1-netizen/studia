"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { BUILTIN_TESTS } from "@/lib/examConfig";
import {
  EMPTY_READ, KIND_LABEL, KIND_TIP, KW_LABEL, PASSAGE_MINUTES, SKIM_TARGET_SEC,
  bandEstimate, estimateLocation, fmtTime, isCorrect, kindOf, loadRead, paragraphMap, paragraphsWith, parsePassage, perQuestionBudget,
  questionKeywords, recordAttempt, saveRead, wordsIn,
  type Keyword, type KwKind, type Passage, type QKind, type Question, type ReadStore, type Ref,
} from "@/lib/reading";
import { useNarrow } from "@/lib/useMediaQuery";
import { KW_BG, KW_FG, PassageView, SentencePanel, TimeBar } from "./parts";

type Phase = "skim" | "answer" | "review";
type Loaded = { id: string; label: string; passage: Passage; questions: Question[] };

const STEPS: { id: Phase; label: string }[] = [
  { id: "skim", label: "Đọc lướt (skimming)" },
  { id: "answer", label: "Từ khoá & đọc quét (scanning)" },
  { id: "review", label: "Xem lại" },
];
const MINUTE_OPTS = [15, 20, 25, 0];
const PASSAGE_KEYS = ["passage1", "passage2", "passage3"] as const;

/** Từ bấm trong câu hỏi → từ khoá, đoán loại theo hình thức. */
const kwOf = (w: string): Keyword => ({ text: /^[A-Z]/.test(w) ? w : w.toLowerCase(), kind: /^\d/.test(w) ? "number" : /^[A-Z]/.test(w) ? "name" : "content" });

export default function ReadingPage() {
  const [store, setStore] = useState<ReadStore>(EMPTY_READ);
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [draft, setDraft] = useState("");

  const [phase, setPhase] = useState<Phase>("skim");
  const [startAt, setStartAt] = useState(0);
  const [now, setNow] = useState(0);
  const [skimSec, setSkimSec] = useState<number | null>(null);
  const [skimView, setSkimView] = useState(true);
  const [gist, setGist] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [kws, setKws] = useState<Record<number, Keyword[]>>({});
  const [active, setActive] = useState<number | null>(null);
  const [scanQ, setScanQ] = useState<number | null>(null);
  const [pinMode, setPinMode] = useState<number | null>(null);
  const [pins, setPins] = useState<Record<number, Ref>>({});
  const [selected, setSelected] = useState<Ref | null>(null);
  const [flash, setFlash] = useState<Ref | null>(null);
  const [customQ, setCustomQ] = useState("");
  const [endAt, setEndAt] = useState<number | null>(null);
  // thời gian đã dùng cho từng câu, và thời gian từ lúc mở câu tới khi ghim được vị trí (tốc độ quét)
  const qTime = useRef<Record<number, number>>({});
  const activeSince = useRef(0);
  const pinSec = useRef<Record<number, number>>({});
  const passageBox = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();

  const S = store.settings;
  const budget = S.minutes * 60;

  useEffect(() => { const s = loadRead(); setStore(s); setDraft(s.custom); }, []);

  // đồng hồ chạy khi đang làm bài
  useEffect(() => {
    if (!doc || phase === "review") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [doc, phase]);

  const elapsed = doc ? Math.max(0, ((endAt ?? (now || startAt)) - startAt) / 1000) : 0;

  const update = (fn: (s: ReadStore) => ReadStore) => setStore((s) => { const n = fn(s); saveRead(n); return n; });

  const begin = (d: Loaded) => {
    setDoc(d);
    setPhase("skim"); setStartAt(Date.now()); setNow(Date.now()); setEndAt(null); setSkimSec(null); setSkimView(true); setGist("");
    setAnswers({}); setKws({}); setActive(null); setScanQ(null); setPinMode(null); setPins({}); setSelected(null); setFlash(null); setCustomQ("");
    qTime.current = {}; pinSec.current = {}; activeSince.current = 0;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openBuiltin = async (demoType: string, idx: number, label: string) => {
    setLoadErr(""); setLoading(`${demoType}-${idx}`);
    try {
      const m = /^cambridge(\d+)_test(\d)$/.exec(demoType);
      if (!m) throw new Error();
      const data = (await import(`@/data/cambridge${m[1]}_test${m[2]}.json`)).default as { reading_passages: Record<string, string>; reading: Question[] };
      const raw = data.reading_passages?.[PASSAGE_KEYS[idx]];
      const questions = (data.reading || []).filter((q) => q.passage === `Passage ${idx + 1}`);
      if (!raw || !questions.length) throw new Error();
      begin({ id: `${demoType}-p${idx + 1}`, label: `${label} · Passage ${idx + 1}`, passage: parsePassage(raw), questions });
    } catch {
      setLoadErr("Không mở được bài đọc này. Thử bài khác.");
    } finally { setLoading(""); }
  };

  const openCustom = () => {
    const text = draft.trim();
    if (!text) return;
    update((s) => ({ ...s, custom: draft }));
    const passage = parsePassage(/\n/.test(text) && text.split("\n")[0].length < 90 ? text : `Bài của bạn\n${text}`);
    begin({ id: "custom", label: "Bài của bạn", passage, questions: [] });
  };

  const close = () => { setDoc(null); setPhase("skim"); };

  /* ---------- theo dõi thời gian từng câu ---------- */
  const activate = (n: number) => {
    if (n === active) return;
    if (phase === "review") {
      setActive(n);
      const est = review?.items.find((i) => i.q.number === n)?.est;
      if (est) goTo(est, false);
      return;
    }
    if (phase !== "answer") return;
    const t = Date.now();
    if (active != null && activeSince.current) qTime.current[active] = (qTime.current[active] || 0) + (t - activeSince.current) / 1000;
    activeSince.current = t;
    setActive(n);
  };
  const flushActive = () => {
    if (active != null && activeSince.current) qTime.current[active] = (qTime.current[active] || 0) + (Date.now() - activeSince.current) / 1000;
    activeSince.current = 0;
  };

  const finishSkim = () => {
    setSkimSec(elapsed); setPhase("answer"); setSkimView(false);
    if (doc?.questions[0]) { activeSince.current = Date.now(); setActive(doc.questions[0].number); }
  };

  const submit = () => {
    if (!doc) return;
    flushActive();
    const t = Date.now();
    setEndAt(t); setNow(t); setPhase("review"); setScanQ(null); setPinMode(null); setSelected(null);
    if (doc.questions.length) {
      const res = doc.questions.map((q) => ({ kind: kindOf(q), ok: isCorrect(q, answers[q.number] || "") }));
      const correct = res.filter((r) => r.ok).length;
      update((s) => recordAttempt(s, doc.id, { at: t, correct, total: doc.questions.length, seconds: Math.round((t - startAt) / 1000), skimSec: Math.round(skimSec ?? 0) }, res, Object.values(pinSec.current)));
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // hết giờ ở chế độ thi: tự nộp
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (doc && S.strict && budget && phase !== "review" && elapsed >= budget) submitRef.current();
  }, [elapsed, doc, S.strict, budget, phase]);

  /* ---------- từ khoá, quét, ghim ---------- */
  const kwFor = (q: Question) => kws[q.number] ?? questionKeywords(q.question);
  const toggleKw = (q: Question, w: string) => {
    const list = kwFor(q);
    const k = kwOf(w.replace(/[’']s$/, ""));
    const has = list.some((x) => x.text.toLowerCase() === k.text.toLowerCase());
    setKws((m) => ({ ...m, [q.number]: has ? list.filter((x) => x.text.toLowerCase() !== k.text.toLowerCase()) : [...list, k] }));
  };

  const customKws = useMemo(() => questionKeywords(customQ), [customQ]);
  const scanKws: Keyword[] = !doc ? [] : doc.questions.length ? (scanQ != null ? kwFor(doc.questions.find((q) => q.number === scanQ) as Question) : []) : customKws;

  const goTo = (r: Ref, flashIt = true) => {
    setSkimView(false);
    requestAnimationFrame(() => {
      document.getElementById(`rd-s-${r.p}-${r.s}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (flashIt) { setFlash(r); setTimeout(() => setFlash((f) => (f === r ? null : f)), 1600); }
    });
  };
  const goPara = (p: number) => document.getElementById(`rd-p-${p}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const onSentence = (r: Ref) => {
    if (pinMode != null && phase === "answer") {
      setPins((m) => ({ ...m, [pinMode]: r }));
      if (pinSec.current[pinMode] == null) pinSec.current[pinMode] = (qTime.current[pinMode] || 0) + (activeSince.current ? (Date.now() - activeSince.current) / 1000 : 0);
      setPinMode(null);
      return;
    }
    setSelected((s) => (s && s.p === r.p && s.s === r.s ? null : r));
  };

  /* ---------- kết quả ---------- */
  const review = useMemo(() => {
    if (!doc || phase !== "review") return null;
    const items = doc.questions.map((q) => {
      const ans = answers[q.number] || "";
      const ok = isCorrect(q, ans);
      const est = estimateLocation(doc.passage, q, kwFor(q));
      return { q, ans, ok, kind: kindOf(q), est, sec: qTime.current[q.number] || 0 };
    });
    const correct = items.filter((i) => i.ok).length;
    const byKind = new Map<QKind, { n: number; ok: number }>();
    for (const i of items) { const k = byKind.get(i.kind) || { n: 0, ok: 0 }; k.n++; if (i.ok) k.ok++; byKind.set(i.kind, k); }
    return { items, correct, byKind };
  }, [doc, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const perQ = doc ? perQuestionBudget(doc.questions.length, budget || PASSAGE_MINUTES * 60) : 0;
  const map = useMemo(() => (doc ? paragraphMap(doc.passage) : []), [doc]);
  const answered = doc ? doc.questions.filter((q) => (answers[q.number] || "").trim()).length : 0;
  const selSentence = doc && selected ? doc.passage.paras[selected.p]?.sentences[selected.s] : null;

  /* ---------- màn chọn bài ---------- */
  if (!doc) {
    const kinds = Object.entries(store.kinds).filter(([, v]) => v.n) as [QKind, { n: number; ok: number }][];
    return (
      <div className="wrap stagger">
        <header className="page-head">
          <div>
            <h1 className="page-title">Luyện đọc</h1>
            <p className="page-sub">Luyện từng passage theo cách làm bài thật: đọc lướt lấy bố cục, gạch từ khoá trong câu hỏi, quét tìm vị trí trong bài, rút gọn câu phức, và giữ nhịp khoảng 20 phút mỗi passage.</p>
          </div>
        </header>

        <section className="st-card" style={{ padding: 20, marginBottom: 16 }} aria-labelledby="rd-how">
          <h2 id="rd-how" className="sec-title" style={{ marginBottom: 10 }}>Cách luyện</h2>
          <ol className="ink2" style={{ paddingLeft: 20, display: "grid", gap: 6, fontSize: 14.5 }}>
            <li><b>Đọc lướt 2–3 phút</b>: chỉ đọc câu đầu mỗi đoạn để biết đoạn nào nói gì. Không dịch từng từ.</li>
            <li><b>Gạch từ khoá</b> trong câu hỏi: ưu tiên tên riêng, số, năm (giữ nguyên trong bài); từ thường hay bị đổi sang từ đồng nghĩa.</li>
            <li><b>Đọc quét</b> tìm vị trí từ khoá, ghim câu chứa đáp án rồi mới đọc kỹ câu đó. Câu dài thì bấm vào để tách mệnh đề, tìm câu lõi.</li>
            <li><b>Giữ nhịp</b>: khoảng {perQuestionBudget(13)} giây mỗi câu. Kẹt quá lâu thì bỏ qua, quay lại sau.</li>
          </ol>
          <div className="row-wrap" style={{ gap: 16, marginTop: 14, alignItems: "end" }}>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Thời gian mỗi passage</span>
              <select className="input" style={{ height: 40 }} value={S.minutes} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, minutes: Number(e.target.value) } }))}>
                {MINUTE_OPTS.map((m) => <option key={m} value={m}>{m ? `${m} phút${m === 20 ? " (chuẩn)" : ""}` : "Không giới hạn"}</option>)}
              </select>
            </label>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={S.strict} disabled={!S.minutes} onChange={(e) => update((s) => ({ ...s, settings: { ...s.settings, strict: e.target.checked } }))} />
              <span className="ink2" style={{ fontSize: 14 }}>Chế độ thi: hết giờ tự nộp bài</span>
            </label>
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
          <section className="st-card" style={{ padding: 20 }} aria-labelledby="rd-pick">
            <h2 id="rd-pick" className="sec-title" style={{ marginBottom: 6 }}>Chọn passage</h2>
            <p className="meta" style={{ marginBottom: 12 }}>Bài đọc và đáp án lấy từ các bộ đề Cambridge đang mở trong Thi thử.</p>
            {loadErr && <p role="alert" style={{ color: "var(--danger)", marginBottom: 8 }}>{loadErr}</p>}
            <div style={{ display: "grid", gap: 12 }}>
              {BUILTIN_TESTS.map((t) => (
                <div key={t.key}>
                  <div style={{ font: "600 14.5px/20px var(--font-sans)", marginBottom: 6 }}>{t.title}</div>
                  <div className="row-wrap" style={{ gap: 8 }}>
                    {[0, 1, 2].map((i) => {
                      const rec = store.passages[`${t.demoType}-p${i + 1}`];
                      return (
                        <button key={i} type="button" className="st-btn st-btn-secondary st-btn-sm" disabled={!!loading}
                          onClick={() => openBuiltin(t.demoType as string, i, t.title)}>
                          {loading === `${t.demoType}-${i}` ? "Đang mở…" : `Passage ${i + 1}`}
                          {rec && <span className={`st-badge ${rec.best / rec.total >= 0.7 ? "st-badge-success" : "st-badge-warning"}`} style={{ marginLeft: 6 }}>{rec.best}/{rec.total}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="stack" style={{ gap: 16 }}>
            <section className="st-card" style={{ padding: 20 }} aria-labelledby="rd-own">
              <h2 id="rd-own" className="sec-title" style={{ marginBottom: 6 }}>Bài của bạn</h2>
              <p className="meta" style={{ marginBottom: 8 }}>Dán một bài đọc bất kỳ (dòng đầu là tiêu đề, mỗi đoạn cách một dòng trống) để luyện đọc lướt, tìm từ khoá và phân tích câu.</p>
              <textarea className="input" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} lang="en" style={{ width: "100%" }}
                placeholder={"Why we need silence\n\nHumans are finely attuned to noise, and for good reason…"} />
              <button type="button" className="st-btn st-btn-primary st-btn-sm" style={{ marginTop: 8 }} disabled={!draft.trim()} onClick={openCustom}>Bắt đầu luyện</button>
            </section>

            <section className="st-card" style={{ padding: 20 }} aria-labelledby="rd-stat">
              <h2 id="rd-stat" className="sec-title" style={{ marginBottom: 10 }}>Tiến độ của bạn</h2>
              {kinds.length ? (
                <>
                  <div style={{ display: "grid", gap: 8 }}>
                    {kinds.map(([k, v]) => {
                      const pct = Math.round((v.ok / v.n) * 100);
                      return (
                        <div key={k}>
                          <div className="row" style={{ justifyContent: "space-between", fontSize: 13.5 }}><span>{KIND_LABEL[k]}</span><span className="meta">{v.ok}/{v.n} · {pct}%</span></div>
                          <div style={{ height: 6, borderRadius: 3, background: "var(--surface-sunken)", marginTop: 4 }}>
                            <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: pct >= 70 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="meta" style={{ marginTop: 12 }}>
                    {Object.keys(store.passages).length} passage đã luyện
                    {store.scanSec.n ? ` · định vị trung bình ${Math.round(store.scanSec.sum / store.scanSec.n)} giây/câu` : ""}
                  </p>
                </>
              ) : <p className="meta">Chưa có. Làm xong một passage, độ chính xác theo từng dạng câu hỏi sẽ hiện ở đây.</p>}
            </section>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- màn luyện ---------- */
  const stepIdx = STEPS.findIndex((s) => s.id === phase);
  const groups: { kind: QKind; instruction?: string | null; qs: Question[] }[] = [];
  for (const q of doc.questions) {
    const k = kindOf(q);
    const g = groups[groups.length - 1];
    if (g && g.kind === k && (!q.group_instruction || q.group_instruction === g.instruction)) g.qs.push(q);
    else groups.push({ kind: k, instruction: q.group_instruction, qs: [q] });
  }
  const activeQ = doc.questions.find((q) => q.number === active);
  const reviewItem = (n: number) => review?.items.find((i) => i.q.number === n);

  return (
    <div className="wrap" style={{ maxWidth: 1400 }}>
      <header className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={close}>← Chọn bài khác</button>
          <h1 style={{ font: "700 20px/28px var(--font-display)", marginTop: 4 }}>{doc.label}</h1>
          <p className="meta">{wordsIn(doc.passage)} từ · {doc.passage.paras.length} đoạn{doc.questions.length ? ` · ${doc.questions.length} câu hỏi` : ""}</p>
        </div>
        <ol aria-label="Các bước" className="row-wrap" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
          {STEPS.filter((s) => doc.questions.length || s.id !== "review").map((s, i) => (
            <li key={s.id} aria-current={s.id === phase ? "step" : undefined} className={`st-badge ${i < stepIdx ? "st-badge-success" : ""}`}
              style={{ padding: "6px 12px", fontSize: 13, outline: s.id === phase ? "2px solid var(--brand)" : undefined, outlineOffset: 1 }}>{i + 1}. {s.label}</li>
          ))}
        </ol>
      </header>

      <div className="st-card" style={{ padding: narrow ? 12 : 16, marginBottom: 16, position: narrow ? "static" : "sticky", top: 8, zIndex: 5 }}>
        <div className="row-wrap" style={{ gap: 20, alignItems: "center" }}>
          <div style={{ flex: "1 1 260px" }}><TimeBar elapsed={elapsed} budget={budget} skimSec={skimSec} phase={phase} /></div>
          <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
            {phase === "skim" && (
              <>
                <button type="button" className="st-btn st-btn-ghost st-btn-sm" aria-pressed={!skimView} onClick={() => setSkimView((v) => !v)}>{skimView ? "Hiện cả bài" : "Chỉ câu chủ đề"}</button>
                <button type="button" className="st-btn st-btn-primary" onClick={finishSkim}>{doc.questions.length ? "Xong đọc lướt → làm câu hỏi" : "Xong đọc lướt"}</button>
              </>
            )}
            {phase === "answer" && doc.questions.length > 0 && (
              <>
                <span className="meta">{answered}/{doc.questions.length} câu</span>
                <button type="button" className="st-btn st-btn-primary" onClick={() => { if (answered < doc.questions.length && !confirm(`Còn ${doc.questions.length - answered} câu chưa làm. Nộp bài?`)) return; submit(); }}>Nộp bài</button>
              </>
            )}
            {phase === "review" && (
              <button type="button" className="st-btn st-btn-secondary" onClick={() => begin(doc)}>Làm lại passage này</button>
            )}
          </div>
        </div>
        {phase === "answer" && activeQ && (() => {
          const spent = (qTime.current[activeQ.number] || 0) + (activeSince.current ? (Date.now() - activeSince.current) / 1000 : 0);
          return (
            <p className="meta" style={{ marginTop: 8, color: spent > perQ * 1.5 ? "var(--danger)" : undefined }} aria-live="polite">
              Câu {activeQ.number}: {fmtTime(spent)} (gợi ý ≤ {fmtTime(perQ)}){spent > perQ * 1.5 ? " · Kẹt lâu rồi, thử bỏ qua và quay lại sau." : ""}
            </p>
          );
        })()}
      </div>

      {phase === "review" && review && (
        <ReviewSummary review={review} elapsed={elapsed} budget={budget} skimSec={skimSec ?? 0} perQ={perQ} gist={gist} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, alignItems: "start" }}>
        {/* Bài đọc */}
        <div className="stack" style={{ gap: 12, minWidth: 0 }}>
          {pinMode != null && (
            <div className="st-card" role="status" style={{ padding: 12, borderColor: "var(--brand)" }}>
              <b>Bấm vào câu trong bài chứa thông tin cho câu {pinMode}.</b> <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setPinMode(null)}>Huỷ</button>
            </div>
          )}
          <div ref={passageBox} className="st-card" style={{ padding: narrow ? 16 : 22, maxHeight: narrow ? "60vh" : "78vh", overflow: "auto" }}>
            {phase === "skim" && (
              <p className="meta" style={{ marginBottom: 12 }}>
                {skimView ? "Đang hiện câu chủ đề (câu đầu mỗi đoạn). Đọc nhanh để biết mỗi đoạn nói gì, đừng tra từ." : "Lướt nhanh: để ý tên riêng, số, từ lặp lại. Không dịch từng từ."}
              </p>
            )}
            {scanKws.length > 0 && phase !== "skim" && (
              <div className="row-wrap" style={{ gap: 6, marginBottom: 12, alignItems: "center" }}>
                <span className="meta">Đang quét{scanQ != null ? ` câu ${scanQ}` : ""}:</span>
                {scanKws.map((k) => <span key={k.text} style={{ background: KW_BG[k.kind], color: KW_FG[k.kind], borderRadius: 4, padding: "1px 6px", fontSize: 13, fontWeight: 600 }}>{k.text}</span>)}
                {doc.questions.length > 0 && <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setScanQ(null)}>Tắt tô màu</button>}
              </div>
            )}
            <PassageView passage={doc.passage} skim={phase === "skim" && skimView} kws={phase === "skim" ? [] : scanKws}
              pinned={active != null ? pins[active] : null}
              estimate={phase === "review" && active != null ? reviewItem(active)?.est ?? null : null}
              selected={selected} flash={flash} onSentence={onSentence} />
          </div>
          {selSentence && <SentencePanel sentence={selSentence} onClose={() => setSelected(null)} />}
          {!selSentence && phase !== "skim" && <p className="meta">Bấm vào một câu dài trong bài để tách mệnh đề và xem câu lõi.</p>}
        </div>

        {/* Cột phải */}
        <div className="stack" style={{ gap: 12, minWidth: 0 }}>
          {phase === "skim" ? (
            <section className="st-card" style={{ padding: 20 }} aria-labelledby="rd-gist">
              <h2 id="rd-gist" className="sec-title" style={{ marginBottom: 8 }}>Sau khi đọc lướt</h2>
              <p className="ink2" style={{ fontSize: 14.5 }}>Mục tiêu trong khoảng {Math.round(SKIM_TARGET_SEC / 60)} phút: biết bài nói về gì và đoạn nào chứa ý nào. Chưa cần hiểu chi tiết.</p>
              <label className="st-field-label" htmlFor="rd-g" style={{ display: "block", marginTop: 12 }}>Ghi nhanh ý chính của bài (không bắt buộc)</label>
              <textarea id="rd-g" className="input" rows={3} value={gist} onChange={(e) => setGist(e.target.value)} style={{ width: "100%", marginTop: 6 }} placeholder="Bài nói về… Đoạn đầu… Đoạn cuối…" />
              {doc.questions.length > 0 && <p className="meta" style={{ marginTop: 10 }}>{doc.questions.length} câu hỏi đang chờ: {Array.from(new Set(doc.questions.map((q) => KIND_LABEL[kindOf(q)]))).join(", ")}.</p>}
            </section>
          ) : (
            <details className="st-card" style={{ padding: 16 }} open={!doc.questions.length}>
              <summary className="st-field-label" style={{ cursor: "pointer" }}>Bản đồ bài đọc (từ khoá nổi bật mỗi đoạn)</summary>
              <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 6 }}>
                {map.map((m, p) => (
                  <li key={p} className="row" style={{ gap: 8, alignItems: "baseline" }}>
                    <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => goPara(p)} style={{ minWidth: 36 }}>{doc.passage.paras[p].label || p + 1}</button>
                    <span lang="en" style={{ fontSize: 13.5 }}>{m.keywords.join(" · ")}</span>
                  </li>
                ))}
              </ul>
              {gist && <p className="meta" style={{ marginTop: 10 }}>Ý chính bạn ghi: “{gist}”</p>}
            </details>
          )}

          {phase !== "skim" && !doc.questions.length && (
            <section className="st-card" style={{ padding: 20 }} aria-labelledby="rd-cq">
              <h2 id="rd-cq" className="sec-title" style={{ marginBottom: 8 }}>Luyện tìm từ khoá</h2>
              <p className="meta" style={{ marginBottom: 8 }}>Dán một câu hỏi (hoặc tự viết một câu). Studia rút từ khoá và tô chỗ xuất hiện trong bài để bạn tập định vị.</p>
              <textarea className="input" rows={3} value={customQ} onChange={(e) => setCustomQ(e.target.value)} lang="en" style={{ width: "100%" }} placeholder="The WHO considers noise a threat to public health." />
              {customKws.length > 0 && <KwLegend kws={customKws} />}
              {customKws.length > 0 && <ParaHits passage={doc.passage} kws={customKws} onPara={goPara} />}
            </section>
          )}

          {phase !== "skim" && groups.map((g, gi) => (
            <section key={gi} className="st-card" style={{ padding: 18 }} aria-label={KIND_LABEL[g.kind]}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 14 }}>Câu {g.qs[0].number}{g.qs.length > 1 ? `–${g.qs[g.qs.length - 1].number}` : ""} · {KIND_LABEL[g.kind]}</b>
              </div>
              {g.instruction && <p className="meta" style={{ marginTop: 4 }}>{g.instruction.length > 220 ? `${g.instruction.slice(0, 220)}…` : g.instruction}</p>}
              <p className="ink2" style={{ fontSize: 13.5, marginTop: 6, padding: "8px 10px", background: "var(--surface-sunken)", borderRadius: "var(--radius-sm)" }}>{KIND_TIP[g.kind]}</p>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {g.qs.map((q) => (
                  <QuestionCard key={q.number} q={q} phase={phase} active={active === q.number}
                    answer={answers[q.number] || ""} kws={kwFor(q)} pinned={pins[q.number]} scanning={scanQ === q.number}
                    item={reviewItem(q.number)} passage={doc.passage}
                    onActivate={() => activate(q.number)}
                    onAnswer={(v) => setAnswers((a) => ({ ...a, [q.number]: v }))}
                    onToggleKw={(w) => toggleKw(q, w)}
                    onScan={() => { activate(q.number); setScanQ((s) => (s === q.number ? null : q.number)); }}
                    onPin={() => { activate(q.number); setPinMode(q.number); }}
                    onGo={goTo} onPara={goPara}
                    onAnalyze={(r) => { setSelected(r); goTo(r, false); }} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Câu hỏi ---------- */

function QuestionCard({ q, phase, active, answer, kws, pinned, scanning, item, passage, onActivate, onAnswer, onToggleKw, onScan, onPin, onGo, onPara, onAnalyze }: {
  q: Question; phase: Phase; active: boolean; answer: string; kws: Keyword[]; pinned?: Ref; scanning: boolean;
  item?: { ok: boolean; est: (Ref & { found: string[] }) | null; sec: number }; passage: Passage;
  onActivate: () => void; onAnswer: (v: string) => void; onToggleKw: (w: string) => void; onScan: () => void; onPin: () => void;
  onGo: (r: Ref) => void; onPara: (p: number) => void; onAnalyze: (r: Ref) => void;
}) {
  const kind = kindOf(q);
  const done = phase === "review";
  const isKw = (w: string) => kws.some((k) => k.text.toLowerCase().split(/\s+/).includes(w.toLowerCase().replace(/[’']s$/, "")));
  const qText = q.question.replace(/\s*\n\s*/g, " ");
  const opts = kind === "tfng" ? ["TRUE", "FALSE", "NOT GIVEN"] : kind === "ynng" ? ["YES", "NO", "NOT GIVEN"] : null;
  const choiceKeys = kind === "choice" ? (q.option_keys?.length ? q.option_keys : (q.options || []).map((o) => o.match(/^([A-J])\b/)?.[1] || o)) : [];
  const border = done ? (item?.ok ? "var(--success)" : "var(--danger)") : active ? "var(--brand)" : "var(--border, var(--surface-sunken))";

  return (
    <div onClick={onActivate} onFocusCapture={onActivate}
      style={{ border: `1.5px solid ${border}`, borderRadius: "var(--radius-sm)", padding: 12, background: active ? "var(--surface)" : undefined }}>
      <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
        <b style={{ flex: "0 0 auto", minWidth: 24, font: "700 14px/22px var(--font-sans)" }}>{q.number}.</b>
        <p lang="en" style={{ font: "500 15px/1.6 var(--font-reading)", margin: 0, minWidth: 0 }}>
          {/* bấm từ để thêm/bỏ khỏi danh sách từ khoá */}
          {qText.split(/(\s+)/).map((tok, i) => {
            const w = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9’']+$/g, "");
            if (!w || /^\s+$/.test(tok) || done) return <Fragment key={i}>{tok}</Fragment>;
            const on = isKw(w);
            const k = kws.find((x) => x.text.toLowerCase().split(/\s+/).includes(w.toLowerCase()));
            return (
              <span key={i} role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onActivate(); onToggleKw(w); }}
                title={on ? "Bỏ khỏi từ khoá" : "Thêm vào từ khoá"}
                style={{ cursor: "pointer", borderRadius: 3, background: on && k ? KW_BG[k.kind] : undefined, color: on && k ? KW_FG[k.kind] : undefined, fontWeight: on ? 650 : undefined }}>{tok}</span>
            );
          })}
        </p>
      </div>

      {kind === "choice" && q.options && q.options.length > 0 && !/^[A-J]$/.test(q.options[0]) && (
        <ul lang="en" style={{ listStyle: "none", padding: "6px 0 0 32px", margin: 0, fontSize: 14, display: "grid", gap: 2 }}>
          {q.options.map((o) => <li key={o} className="ink2">{o}</li>)}
        </ul>
      )}

      <div style={{ paddingLeft: 32, marginTop: 8 }}>
        {opts || choiceKeys.length ? (
          <div className="seg row-wrap" role="radiogroup" aria-label={`Đáp án câu ${q.number}`}>
            {(opts || choiceKeys).map((o) => (
              <button key={o} type="button" className="seg-btn" role="radio" aria-checked={answer === o} disabled={done}
                onClick={(e) => { e.stopPropagation(); onActivate(); onAnswer(answer === o ? "" : o); }}>{o}</button>
            ))}
          </div>
        ) : (
          <input className="input" value={answer} disabled={done} onChange={(e) => onAnswer(e.target.value)} lang="en"
            aria-label={`Đáp án câu ${q.number}`} placeholder={q.word_limit ? `Tối đa ${q.word_limit} từ, lấy nguyên văn từ bài` : "Từ trong bài"}
            spellCheck={false} autoComplete="off" style={{ width: "100%", maxWidth: 320, height: 38 }} />
        )}
      </div>

      {!done && active && (
        <div style={{ paddingLeft: 32, marginTop: 10 }}>
          <KwLegend kws={kws} />
          <div className="row-wrap" style={{ gap: 6, marginTop: 8 }}>
            <button type="button" className="st-btn st-btn-secondary st-btn-sm" aria-pressed={scanning} disabled={!kws.length} onClick={(e) => { e.stopPropagation(); onScan(); }}>
              {scanning ? "Tắt quét" : "Quét bài theo từ khoá"}
            </button>
            <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={(e) => { e.stopPropagation(); onPin(); }}>
              {pinned ? `Đã ghim: đoạn ${passage.paras[pinned.p].label || pinned.p + 1} · đổi` : "Ghim câu chứa đáp án"}
            </button>
          </div>
          {scanning && <ParaHits passage={passage} kws={kws} onPara={onPara} />}
        </div>
      )}

      {done && item && (
        <div style={{ paddingLeft: 32, marginTop: 10, fontSize: 14 }}>
          <div className="row-wrap" style={{ gap: 12 }}>
            <span style={{ color: item.ok ? "var(--success)" : "var(--danger)", fontWeight: 650 }}>{item.ok ? "Đúng" : answer ? `Sai: “${answer}”` : "Bỏ trống"}</span>
            {!item.ok && <span>Đáp án: <b lang="en">{q.accepted_answers?.length ? q.accepted_answers.join(" / ") : q.correct_answer}</b></span>}
            <span className="meta">{fmtTime(item.sec)}</span>
          </div>
          {item.est && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--surface-sunken)", borderRadius: "var(--radius-sm)" }}>
              <div className="meta" style={{ marginBottom: 4 }}>
                Vị trí Studia ước lượng: đoạn {passage.paras[item.est.p].label || item.est.p + 1}
                {pinned ? (pinned.p === item.est.p ? (pinned.s === item.est.s ? " · bạn ghim đúng câu" : " · bạn ghim đúng đoạn") : ` · bạn ghim đoạn ${passage.paras[pinned.p].label || pinned.p + 1}`) : ""}
              </div>
              <p lang="en" style={{ font: "500 14.5px/1.55 var(--font-reading)", margin: 0 }}>{passage.paras[item.est.p].sentences[item.est.s]}</p>
              <div className="row-wrap" style={{ gap: 6, marginTop: 6 }}>
                <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => onGo(item.est as Ref)}>Xem trong bài</button>
                <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => onAnalyze(item.est as Ref)}>Phân tích câu này</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KwLegend({ kws }: { kws: Keyword[] }) {
  if (!kws.length) return <p className="meta">Chưa có từ khoá. Bấm vào từ trong câu hỏi để thêm.</p>;
  const by: Partial<Record<KwKind, Keyword[]>> = {};
  for (const k of kws) (by[k.kind] ||= []).push(k);
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
      {(Object.keys(by) as KwKind[]).map((kind) => (
        <div key={kind} className="row-wrap" style={{ gap: 6, alignItems: "center" }}>
          <span className="meta" style={{ minWidth: 92 }}>{KW_LABEL[kind]}</span>
          {by[kind]!.map((k) => <span key={k.text} lang="en" style={{ background: KW_BG[kind], color: KW_FG[kind], borderRadius: 4, padding: "1px 6px", fontSize: 13, fontWeight: 600 }}>{k.text}</span>)}
        </div>
      ))}
      <p className="meta">{by.name || by.number ? "Quét tên riêng, số trước: chúng giữ nguyên trong bài." : "Chỉ có từ thường: trong bài có thể dùng từ đồng nghĩa, hãy nghĩ thêm cách diễn đạt khác."} Bấm từ trong câu hỏi để thêm/bỏ.</p>
    </div>
  );
}

function ParaHits({ passage, kws, onPara }: { passage: Passage; kws: Keyword[]; onPara: (p: number) => void }) {
  const hits = paragraphsWith(passage, kws);
  if (!hits.length) return <p className="meta" style={{ marginTop: 6 }}>Không thấy từ khoá nào nguyên văn trong bài: thông tin có thể đã được paraphrase. Thử bỏ bớt từ thường, giữ tên riêng/số.</p>;
  return (
    <div className="row-wrap" style={{ gap: 6, marginTop: 8, alignItems: "center" }}>
      <span className="meta">Có trong đoạn:</span>
      {hits.map((h) => (
        <button key={h.p} type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={(e) => { e.stopPropagation(); onPara(h.p); }}>
          {passage.paras[h.p].label || h.p + 1} <span className="meta" style={{ marginLeft: 4 }}>×{h.n}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Tổng kết ---------- */

function ReviewSummary({ review, elapsed, budget, skimSec, perQ, gist }: {
  review: { items: { q: Question; ok: boolean; kind: QKind; sec: number; ans: string }[]; correct: number; byKind: Map<QKind, { n: number; ok: number }> };
  elapsed: number; budget: number; skimSec: number; perQ: number; gist: string;
}) {
  const total = review.items.length;
  if (!total) return null;
  const band = bandEstimate(review.correct, total);
  const slow = review.items.filter((i) => i.sec > perQ * 1.5).sort((a, b) => b.sec - a.sec);
  const blank = review.items.filter((i) => !i.ans.trim()).length;
  const ngMiss = review.items.filter((i) => (i.kind === "tfng" || i.kind === "ynng") && !i.ok);
  const ngConfusion = ngMiss.filter((i) => /NOT GIVEN/.test(i.q.correct_answer || "") || /NOT GIVEN/.test(i.ans)).length;
  const fillMiss = review.items.filter((i) => i.kind === "fill" && !i.ok && i.ans.trim()).length;

  const tips: string[] = [];
  if (skimSec > SKIM_TARGET_SEC * 1.5) tips.push(`Bạn đọc lướt mất ${fmtTime(skimSec)}. Chỉ đọc câu đầu mỗi đoạn, đừng đọc hiểu cả bài ở bước này.`);
  if (budget && elapsed > budget) tips.push(`Quá giờ ${fmtTime(elapsed - budget)}. Trong phòng thi bạn sẽ bị thiếu thời gian cho passage sau: đặt giới hạn mỗi câu và bỏ qua câu kẹt.`);
  if (slow.length) tips.push(`${slow.length} câu tốn nhiều hơn gấp rưỡi thời gian gợi ý (lâu nhất: câu ${slow[0].q.number}, ${fmtTime(slow[0].sec)}). Quét tên riêng/số để định vị nhanh hơn thay vì đọc lại từ đầu.`);
  if (ngConfusion >= 2) tips.push("Nhầm lẫn NOT GIVEN nhiều: FALSE là bài nói ngược lại; NOT GIVEN là bài không đề cập. Đừng dùng hiểu biết bên ngoài bài.");
  if (fillMiss >= 2) tips.push("Sai nhiều câu điền từ: kiểm tra giới hạn số từ, số ít/số nhiều và chép đúng chính tả từ bài.");
  if (blank) tips.push(`Còn ${blank} câu bỏ trống. Trong bài thi không bị trừ điểm khi sai, luôn điền một đáp án.`);
  if (!tips.length) tips.push("Làm tốt. Thử giảm thời gian xuống 15 phút hoặc bật chế độ thi để luyện áp lực.");

  return (
    <section className="st-card st-enter" style={{ padding: 22, marginBottom: 16 }} aria-labelledby="rd-res">
      <h2 id="rd-res" className="sec-title" style={{ marginBottom: 12 }}>Kết quả</h2>
      <div className="row-wrap" style={{ gap: 28 }}>
        <Stat label="Đúng" value={`${review.correct}/${total}`} sub={band ? `≈ band ${band} (quy đổi)` : ""} />
        <Stat label="Tổng thời gian" value={fmtTime(elapsed)} sub={budget ? `ngân sách ${fmtTime(budget)}` : "không giới hạn"} />
        <Stat label="Đọc lướt" value={fmtTime(skimSec)} sub={`mục tiêu ≤ ${fmtTime(SKIM_TARGET_SEC)}`} />
        <Stat label="Trung bình mỗi câu" value={fmtTime((elapsed - skimSec) / total)} sub={`gợi ý ≤ ${fmtTime(perQ)}`} />
      </div>
      <div className="row-wrap" style={{ gap: 8, marginTop: 14 }}>
        {Array.from(review.byKind.entries()).map(([k, v]) => (
          <span key={k} className={`st-badge ${v.ok / v.n >= 0.7 ? "st-badge-success" : v.ok / v.n >= 0.5 ? "st-badge-warning" : "st-badge-danger"}`}>{KIND_LABEL[k]}: {v.ok}/{v.n}</span>
        ))}
      </div>
      <ul className="ink2" style={{ marginTop: 14, paddingLeft: 20, display: "grid", gap: 6, fontSize: 14.5 }}>
        {tips.map((t) => <li key={t}>{t}</li>)}
      </ul>
      {gist && <p className="meta" style={{ marginTop: 10 }}>Ý chính bạn ghi khi đọc lướt: “{gist}”. So lại với bài xem bạn nắm đúng bố cục chưa.</p>}
      <p className="meta" style={{ marginTop: 10 }}>Bấm một câu hỏi bên dưới để xem vị trí Studia ước lượng (viền xanh) và câu bạn đã ghim (viền tím) trong bài.</p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="meta">{label}</div>
      <div style={{ font: "700 24px/32px var(--font-display)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div className="meta">{sub}</div>}
    </div>
  );
}
