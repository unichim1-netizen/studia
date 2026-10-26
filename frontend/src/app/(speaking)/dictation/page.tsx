"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_STORE, EXAM_MAX_PLAYS, LEVELS, SEGMENTS, SPEEDS,
  chunkSpans, chunksOf, compare, dayKey, estimateSeconds, ladderRounds, listVoices, loadStore, maskText, missedWords,
  parseTimedTranscript, play, recordResult, recordShadow, saveStore, segmentsFromTimed,
  speechSupported, splitIntoSegments, stopSpeech, watchVoices, wordCount, youtubeId,
  type Compared, type Ladder, type Level, type Round, type Segment, type Settings, type Store,
} from "@/lib/dictation";
import { createPlayer, playYT, stopYT, type YTPlayer } from "@/lib/ytPlayer";
import { useSiteConfig } from "@/lib/siteConfig";
import { Cell, LinkNotes, Sources, Transcript } from "./parts";
import ShadowPanel, { type PlayModel } from "./ShadowPanel";

type Mode = Level | "mine";
/** start/end (giây) có khi đoạn lấy từ transcript YouTube có mốc thời gian: phát audio thật thay vì giọng máy. */
type Item = { id: string; topic: string; text: string; start?: number; end?: number };
type Result = { cmp: Compared; gaveUp: boolean };
type Cbs = { onRound?: (n: number) => void; onStart?: () => void; onWord?: (ci: number) => void; onEnd?: (completed: boolean) => void };

const MODES: { id: Mode; label: string }[] = [
  { id: "easy", label: "Cơ bản" }, { id: "mid", label: "Trung bình" }, { id: "hard", label: "Nâng cao" }, { id: "mine", label: "Của bạn" },
];

const LADDERS: { id: Ladder; label: string }[] = [
  { id: "off", label: "Tắt" },
  { id: "speed", label: "Theo tốc độ: 25→50→75→100%" },
  { id: "content", label: "Theo nội dung: 25→50→75→100% đoạn" },
];

const STEPS = ["Nghe và chép", "Đối chiếu transcript", "Shadowing"];

export default function DictationPage() {
  const [store, setStore] = useState<Store>(EMPTY_STORE);
  const [mode, setMode] = useState<Mode>("easy");
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [playing, setPlaying] = useState<string | null>(null); // "all" | "c<i>" | "w" | "sh"
  const [round, setRound] = useState(0);
  const [plays, setPlays] = useState(0);
  const [hint, setHint] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supported, setSupported] = useState(true);
  const [draft, setDraft] = useState("");
  const [draftVideo, setDraftVideo] = useState("");
  const [yt, setYt] = useState<YTPlayer | null>(null);
  const [ytErr, setYtErr] = useState("");
  const [showVideo, setShowVideo] = useState(false);
  const [shadowed, setShadowed] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ytBox = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const S = store.settings;
  const site = useSiteConfig();
  // Quản lý có thể thay cả ngân hàng đoạn nghe; chưa đặt thì dùng bộ có sẵn trong app
  const bank: Segment[] = site.dictation_segments?.length ? site.dictation_segments : SEGMENTS;

  useEffect(() => {
    const s = loadStore();
    setStore(s); setDraft(s.custom); setDraftVideo(s.customVideo);
    setSupported(speechSupported());
    setVoices(listVoices());
    const off = watchVoices(() => setVoices(listVoices()));
    return () => { off(); stopSpeech(); stopYT(); };
  }, []);

  const videoId = mode === "mine" ? youtubeId(store.customVideo) : null;
  const timed = useMemo(() => parseTimedTranscript(store.custom), [store.custom]);

  const list: Item[] = useMemo(() => {
    if (mode === "mine") {
      if (timed && videoId) return segmentsFromTimed(timed).map((s, i) => ({ id: `c${i}`, topic: `Đoạn ${i + 1}`, ...s }));
      // có mốc thời gian nhưng không có video: bỏ mốc, đọc bằng giọng máy
      const plain = timed ? timed.map((c) => c.text).join(" ") : store.custom;
      return splitIntoSegments(plain).map((text, i) => ({ id: `c${i}`, topic: `Đoạn ${i + 1}`, text }));
    }
    return bank.filter((s) => s.level === mode);
  }, [mode, store.custom, timed, videoId, bank]);
  const seg: Item | undefined = list[Math.min(idx, list.length - 1)];
  const chunks = useMemo(() => (seg ? chunksOf(seg.text) : []), [seg]);
  const spans = useMemo(() => (seg ? chunkSpans(seg.text) : []), [seg]);
  const real = !!(yt && seg && seg.start != null && seg.end != null); // phát audio thật từ YouTube

  // trình phát YouTube cho mục “Của bạn”
  useEffect(() => {
    if (!videoId || !ytBox.current) return;
    setYtErr(""); setYt(null);
    const host = document.createElement("div");
    ytBox.current.replaceChildren(host);
    return createPlayer(host, videoId, setYt, setYtErr);
  }, [videoId]);

  const stopAll = () => { stopSpeech(); stopYT(yt); };

  useEffect(() => {
    stopAll();
    setAnswer(""); setResult(null); setPlays(0); setHint(false); setPlaying(null); setRound(0); setShadowed(false);
  }, [mode, seg?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<Settings>) => setStore((s) => {
    const n = { ...s, settings: { ...s.settings, ...patch } };
    saveStore(n);
    return n;
  });

  const exam = S.examMode && !result;
  const outOfPlays = exam && plays >= EXAM_MAX_PLAYS;

  /** Phát các lượt bằng audio YouTube (nếu đoạn có mốc thời gian) hoặc giọng đọc của trình duyệt. */
  const runRounds = (rounds: Round[], cb: Cbs): (() => void) => {
    if (!seg) return () => {};
    stopAll();
    if (real && yt) {
      const a = seg.start as number, len = (seg.end as number) - a;
      return playYT(yt, rounds.map((r) => ({ start: a + (r.from ?? 0) * len, end: a + r.share * len, rate: r.rate })), {
        gapMs: S.gapSec * 1000, onRound: cb.onRound, onStartRound: cb.onStart, onEnd: cb.onEnd,
      });
    }
    return play({
      text: seg.text, rate: S.rate, rounds, voiceURI: S.voiceURI, gapMs: S.gapSec * 1000,
      onRound: cb.onRound, onStartRound: cb.onStart, onWord: cb.onWord, onEnd: cb.onEnd,
    });
  };

  const rounds = seg ? (exam ? ladderRounds(seg.text, "off", S.rate, 1) : ladderRounds(seg.text, S.ladder, S.rate, S.times)) : [];

  const playAll = () => {
    if (!seg) return;
    if (playing === "all") { stopAll(); setPlaying(null); return; }
    if (outOfPlays) return;
    setPlaying("all"); setRound(0); setPlays((p) => p + 1);
    runRounds(rounds, { onRound: setRound, onEnd: () => setPlaying(null) });
    if (!result) taRef.current?.focus();
  };

  const playPart = (key: string, i: number, rate = S.rate) => {
    if (playing === key) { stopAll(); setPlaying(null); return; }
    setPlaying(key);
    runRounds([{ text: chunks[i], rate, from: spans[i].from, share: spans[i].to }], { onEnd: () => setPlaying(null) });
    if (!result) taRef.current?.focus();
  };

  const playWhole = (rate: number) => {
    if (!seg) return;
    if (playing === "all") { stopAll(); setPlaying(null); return; }
    setPlaying("all");
    runRounds([{ text: seg.text, rate, share: 1 }], { onEnd: () => setPlaying(null) });
  };

  /** Từ, cụm ngắn: luôn đọc bằng giọng máy cho rõ từng âm. */
  const say = (text: string, rate = 0.8) => {
    stopAll();
    setPlaying("w");
    play({ text, rate, voiceURI: S.voiceURI, onEnd: () => setPlaying(null) });
  };

  const playModel: PlayModel = (rate, cb) => {
    setPlaying("sh");
    return runRounds(seg ? [{ text: seg.text, rate, share: 1 }] : [], {
      ...cb, onEnd: (ok) => { setPlaying(null); cb.onEnd?.(ok); },
    });
  };

  const check = (gaveUp = false) => {
    if (!seg || (!gaveUp && !answer.trim())) return;
    stopAll(); setPlaying(null);
    const cmp = compare(seg.text, gaveUp ? "" : answer);
    setResult({ cmp, gaveUp });
    if (!gaveUp) {
      const next = recordResult(store, seg.id.startsWith("c") ? null : seg.id, cmp.score, missedWords(cmp));
      setStore(next); saveStore(next);
    }
  };

  const onShadow = (score: number) => {
    if (!seg) return;
    setShadowed(true);
    setStore((s) => { const n = recordShadow(s, seg.id.startsWith("c") ? `mine:${seg.text.slice(0, 40)}` : seg.id, score); saveStore(n); return n; });
  };

  const retry = () => { stopAll(); setAnswer(""); setResult(null); setPlays(0); setHint(false); setPlaying(null); taRef.current?.focus(); };
  const next = () => { if (list.length) setIdx((i) => (Math.min(i, list.length - 1) + 1) % list.length); };
  const stepSpeed = (d: number) => {
    const i = SPEEDS.indexOf(S.rate as (typeof SPEEDS)[number]);
    update({ rate: SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + d))] });
  };

  const saveMine = () => {
    const n = { ...store, custom: draft, customVideo: draftVideo.trim() };
    setStore(n); saveStore(n); setIdx(0);
  };

  // Phím tắt dùng bản mới nhất của các hàm ở trên
  const act = useRef({ playAll, check, next, stepSpeed, hasResult: false });
  act.current = { playAll, check, next, stepSpeed, hasResult: !!result };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = act.current;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); a.hasResult ? a.next() : a.check(); }
      else if (e.altKey && e.code === "KeyP") { e.preventDefault(); a.playAll(); }
      else if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); a.stepSpeed(-1); }
      else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); a.stepSpeed(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const typed = wordCount(answer);
  const total = seg ? wordCount(seg.text) : 0;
  const secs = seg ? Math.round(seg.start != null && seg.end != null ? (seg.end - seg.start) / S.rate : estimateSeconds(seg.text, S.rate)) : 0;
  const today = store.days[dayKey()];
  const shadowToday = store.shadowDays[dayKey()] || 0;
  const week = useMemo(() => {
    let n = 0, sum = 0;
    for (let d = 0; d < 7; d++) {
      const t = new Date(); t.setDate(t.getDate() - d);
      const x = store.days[dayKey(t)];
      if (x) { n += x.n; sum += x.sum; }
    }
    return { n, avg: n ? Math.round(sum / n) : 0 };
  }, [store.days]);
  const weak = useMemo(() => Object.entries(store.weak).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14), [store.weak]);
  const missed = result ? missedWords(result.cmp) : [];
  const step = !result ? 0 : shadowed ? 3 : 1;
  const curRate = playing === "all" && rounds[round - 1] ? rounds[round - 1].rate : S.rate;
  const draftVid = youtubeId(draftVideo);
  const draftTimed = useMemo(() => !!parseTimedTranscript(draft), [draft]);

  return (
    <div className="wrap stagger">
      <header className="page-head" ref={topRef}>
        <div>
          <h1 className="page-title">Nghe chép chính tả</h1>
          <p className="page-sub">Nghe từng đoạn ngắn 10–15 giây, gõ lại những gì nghe được, đối chiếu transcript để thấy từ nào nghe sót, rồi đọc nhại theo (shadowing) để khớp tốc độ và ngữ điệu.</p>
        </div>
      </header>

      <ol aria-label="Các bước luyện" className="row-wrap" style={{ listStyle: "none", padding: 0, margin: "0 0 16px", gap: 8 }}>
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}
            className={`st-badge ${i < step ? "st-badge-success" : ""}`}
            style={{ padding: "6px 12px", fontSize: 13.5, outline: i === step ? "2px solid var(--brand)" : undefined, outlineOffset: 1 }}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {!supported && (
        <div className="st-card" role="alert" style={{ padding: 16, marginBottom: 16, borderColor: "var(--warning)" }}>
          <b>Trình duyệt chưa hỗ trợ giọng đọc.</b> <span className="ink2">Hãy dùng Chrome, Edge hoặc Safari để nghe chép chính tả, hoặc dùng video YouTube ở mục “Của bạn”.</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
        <aside className="st-card" style={{ padding: 12 }} aria-label="Chọn đoạn nghe">
          <div className="seg row-wrap" role="radiogroup" aria-label="Cấp độ" style={{ margin: 2 }}>
            {MODES.map((m) => (
              <button key={m.id} type="button" className="seg-btn" role="radio" aria-checked={mode === m.id}
                title={LEVELS.find((l) => l.id === m.id)?.hint}
                onClick={() => { setMode(m.id); setIdx(0); }}>{m.label}</button>
            ))}
          </div>

          {mode === "mine" && (
            <div style={{ padding: "12px 6px 4px" }}>
              <label className="st-field-label" htmlFor="dc-video">Link YouTube (không bắt buộc)</label>
              <input id="dc-video" className="input" value={draftVideo} onChange={(e) => setDraftVideo(e.target.value)} inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…" style={{ width: "100%", marginTop: 6 }} />
              <label className="st-field-label" htmlFor="dc-draft" style={{ display: "block", marginTop: 12 }}>Transcript hoặc văn bản tiếng Anh</label>
              <textarea id="dc-draft" className="input" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder={"Dán audioscript, bài đọc… Studia tự cắt thành các đoạn 10–15 giây.\nCó link YouTube thì dán transcript kèm mốc thời gian:\n0:00\nHello and welcome to…"} style={{ width: "100%", marginTop: 6 }} />
              {draftVideo.trim() && !draftVid && <p className="meta" style={{ color: "var(--danger)", marginTop: 6 }}>Link YouTube chưa đúng.</p>}
              {draftVid && draft.trim() && !draftTimed && <p className="meta" style={{ marginTop: 6 }}>Transcript chưa có mốc thời gian (0:12…) nên sẽ đọc bằng giọng máy. Xem hướng dẫn ở mục Nguồn luyện tập.</p>}
              <button type="button" className="st-btn st-btn-secondary st-btn-sm" style={{ marginTop: 8 }} onClick={saveMine}>Tách thành các đoạn</button>
              {store.custom && <p className="meta" style={{ marginTop: 8 }}>{list.length} đoạn{videoId && timed ? " · nghe audio thật từ video" : ""}</p>}
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            {list.map((s, i) => {
              const d = store.done[s.id];
              const on = seg?.id === s.id;
              const dur = s.start != null && s.end != null ? s.end - s.start : estimateSeconds(s.text, 1);
              return (
                <button key={s.id} type="button" aria-current={on} onClick={() => setIdx(i)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "11px 14px", border: 0, borderRadius: "var(--radius-sm)", background: on ? "var(--brand-tint)" : "transparent", color: "var(--ink)", font: "550 14.5px/21px var(--font-sans)", cursor: "pointer" }}>
                  <span>{s.topic}<span className="meta" style={{ marginLeft: 8 }}>~{Math.round(dur)}s</span></span>
                  <span className="row" style={{ gap: 4 }}>
                    {d && <span className={`st-badge ${d.best >= 80 ? "st-badge-success" : "st-badge-warning"}`} title="Điểm chép tốt nhất">{d.best}%</span>}
                    {store.shadow[s.id] && <span className="st-badge" title="Điểm shadowing tốt nhất">🗣 {store.shadow[s.id].best}%</span>}
                  </span>
                </button>
              );
            })}
            {mode === "mine" && !list.length && <p className="meta" style={{ padding: "10px 14px" }}>Chưa có đoạn nào. Dán văn bản rồi bấm tách.</p>}
          </div>
        </aside>

        <div className="stack" style={{ gap: 16 }}>
          {videoId && (
            <section className="st-card" style={{ padding: 16 }} aria-label="Video YouTube">
              <div style={{ position: "relative", aspectRatio: "16 / 9", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "#000" }}>
                <div ref={ytBox} style={{ position: "absolute", inset: 0 }} />
                {!showVideo && (
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "var(--surface-sunken)", color: "var(--ink-secondary)", textAlign: "center", padding: 16 }}>
                    <span>Hình đang được che để bạn chỉ nghe, không đọc phụ đề.<br /><span className="meta">Dùng các nút nghe bên dưới để phát từng đoạn.</span></span>
                  </div>
                )}
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 8, gap: 8, flexWrap: "wrap" }}>
                <span className="meta">{ytErr ? <span style={{ color: "var(--danger)" }}>{ytErr}</span> : yt ? (timed ? "Đang dùng audio thật của video." : "Transcript chưa có mốc thời gian, đang đọc bằng giọng máy.") : "Đang tải video…"}</span>
                <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setShowVideo((v) => !v)}>{showVideo ? "Che hình" : "Hiện hình"}</button>
              </div>
            </section>
          )}

          {!seg ? (
            <section className="st-card" style={{ padding: 32 }}><p className="ink2">Chọn một đoạn ở bên trái, hoặc dán văn bản của bạn ở mục “Của bạn”.</p></section>
          ) : (
            <>
              <section className="st-card" style={{ padding: 28 }} aria-labelledby="dc-listen">
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span id="dc-listen" className="eyebrow" style={{ color: "var(--ink-muted)" }}>
                    {seg.topic} · Đoạn {Math.min(idx, list.length - 1) + 1}/{list.length}{real ? " · audio thật" : ""}
                  </span>
                  <span className="meta">{total} từ · khoảng {secs} giây ở tốc độ {S.rate}×</span>
                </div>

                <div className="row-wrap" style={{ gap: 24, marginTop: 18, alignItems: "center" }}>
                  <button type="button" onClick={playAll} disabled={(!supported && !real) || outOfPlays}
                    aria-label={playing === "all" ? "Dừng" : "Nghe đoạn"} aria-pressed={playing === "all"}
                    style={{ width: 88, height: 88, borderRadius: "50%", border: 0, display: "grid", placeItems: "center", cursor: "pointer", background: "var(--brand)", color: "var(--on-brand)", boxShadow: "0 0 0 8px var(--brand-tint)", opacity: outOfPlays ? 0.5 : 1 }}>
                    {playing === "all" ? (
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
                    )}
                  </button>
                  <div style={{ flex: 1, minWidth: 220 }} role="status" aria-live="polite">
                    <b style={{ font: "650 18px/24px var(--font-sans)" }}>
                      {playing === "all"
                        ? `Đang ${real ? "phát" : "đọc"}${rounds.length > 1 ? ` · lượt ${round}/${rounds.length}` : ""}${!exam && S.ladder !== "off" ? ` · ${S.ladder === "speed" ? `${Math.round(curRate * 100)}% tốc độ` : `${Math.round((rounds[round - 1]?.share ?? 1) * 100)}% đoạn`}` : ""}…`
                        : plays ? "Nghe lại" : "Bấm để nghe"}
                    </b>
                    <p className="meta">
                      {exam ? `Chế độ thi: còn ${Math.max(0, EXAM_MAX_PLAYS - plays)}/${EXAM_MAX_PLAYS} lượt nghe` : plays ? `Đã nghe ${plays} lượt` : S.ladder !== "off" ? "Nghe tăng dần: chép những gì nghe được ở mỗi lượt, lượt sau bổ sung chỗ còn thiếu." : "Nghe xong gõ lại ngay, không cần chờ hết đoạn."}
                    </p>
                  </div>
                </div>

                <div className="row-wrap" style={{ gap: 16, marginTop: 22, alignItems: "end" }}>
                  <div>
                    <div className="st-field-label" id="dc-speed" style={{ marginBottom: 6 }}>Tốc độ đọc</div>
                    <div className="seg" role="radiogroup" aria-labelledby="dc-speed">
                      {SPEEDS.map((r) => (
                        <button key={r} className="seg-btn" type="button" role="radio" aria-checked={S.rate === r} aria-pressed={S.rate === r}
                          disabled={S.ladder === "speed" && !S.examMode} onClick={() => update({ rate: r })}>{r}×</button>
                      ))}
                    </div>
                  </div>
                  <label className="st-field" style={{ minWidth: 0 }}>
                    <span className="st-field-label">Nghe tăng dần</span>
                    <select className="input" style={{ height: 40, maxWidth: 280 }} value={S.ladder} disabled={S.examMode} onChange={(e) => update({ ladder: e.target.value as Ladder })}>
                      {LADDERS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  </label>
                  <label className="st-field" style={{ minWidth: 0 }}>
                    <span className="st-field-label">Tự lặp lại</span>
                    <select className="input" style={{ height: 40 }} value={S.times} disabled={S.examMode || S.ladder !== "off"} onChange={(e) => update({ times: Number(e.target.value) })}>
                      <option value={1}>1 lần</option><option value={2}>2 lần</option><option value={3}>3 lần</option>
                    </select>
                  </label>
                  <label className="st-field" style={{ minWidth: 0 }}>
                    <span className="st-field-label">Nghỉ giữa các lần</span>
                    <select className="input" style={{ height: 40 }} value={S.gapSec} disabled={(S.times === 1 && S.ladder === "off") || S.examMode} onChange={(e) => update({ gapSec: Number(e.target.value) })}>
                      <option value={2}>2 giây</option><option value={3}>3 giây</option><option value={5}>5 giây</option><option value={8}>8 giây</option>
                    </select>
                  </label>
                  {!real && (
                    <label className="st-field" style={{ minWidth: 0 }}>
                      <span className="st-field-label">Giọng đọc</span>
                      <select className="input" style={{ height: 40, maxWidth: 220 }} value={S.voiceURI} onChange={(e) => update({ voiceURI: e.target.value })}>
                        <option value="">Tự động (Anh-Anh)</option>
                        {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name.replace(/^(Microsoft|Google)\s+/, "")} ({v.lang})</option>)}
                      </select>
                    </label>
                  )}
                </div>

                <div className="row-wrap" style={{ gap: 8, marginTop: 18, alignItems: "center" }}>
                  <span className="st-field-label">Nghe từng cụm</span>
                  {chunks.map((_, i) => (
                    <button key={i} type="button" className="st-btn st-btn-ghost st-btn-sm" aria-pressed={playing === `c${i}`}
                      disabled={(!supported && !real) || exam} onClick={() => playPart(`c${i}`, i)}>
                      {playing === `c${i}` ? "Dừng" : `Cụm ${i + 1}`}
                    </button>
                  ))}
                  {exam && <span className="meta">Tắt trong chế độ thi</span>}
                </div>

                <label className="row" style={{ gap: 8, marginTop: 16, cursor: "pointer", width: "fit-content" }}>
                  <input type="checkbox" checked={S.examMode} onChange={(e) => update({ examMode: e.target.checked })} />
                  <span className="ink2" style={{ fontSize: 14 }}>Chế độ thi: chỉ được nghe {EXAM_MAX_PLAYS} lượt ở tốc độ đang chọn, không nghe từng cụm, không gợi ý</span>
                </label>
              </section>

              <section className="st-card" style={{ padding: 28 }} aria-labelledby="dc-type">
                <div className="sec-head">
                  <h2 id="dc-type" className="sec-title">Gõ lại những gì bạn nghe</h2>
                  <span className="meta" aria-live="polite">{typed} / {total} từ</span>
                </div>
                <textarea ref={taRef} className="input" rows={5} value={answer} disabled={!!result}
                  onChange={(e) => setAnswer(e.target.value)}
                  spellCheck={false} autoCorrect="off" autoCapitalize="off" autoComplete="off" lang="en"
                  aria-label="Nhập lại đoạn vừa nghe"
                  placeholder="Gõ vào đây. Không cần viết hoa hay dấu câu, Studia bỏ qua hai thứ đó khi chấm."
                  style={{ width: "100%", height: "auto", padding: 14, font: "500 19px/1.7 var(--font-reading)", resize: "vertical" }} />
                {hint && !result && (
                  <p style={{ font: "500 17px/1.8 var(--font-reading)", letterSpacing: 1, marginTop: 12, color: "var(--ink-secondary)" }} aria-label="Gợi ý chữ cái đầu">{maskText(seg.text)}</p>
                )}
                {!result ? (
                  <div className="row-wrap" style={{ gap: 8, marginTop: 16, alignItems: "center" }}>
                    <button className="st-btn st-btn-primary" type="button" disabled={!answer.trim()} onClick={() => check()}>Chấm bài</button>
                    <button className="st-btn st-btn-secondary" type="button" disabled={exam} onClick={() => setHint((h) => !h)} aria-pressed={hint}>{hint ? "Ẩn gợi ý" : "Gợi ý chữ cái đầu"}</button>
                    <button className="st-btn st-btn-ghost" type="button" onClick={() => check(true)}>Xem đáp án</button>
                    <span className="meta" style={{ marginLeft: "auto" }}>Ctrl+Enter chấm · Alt+P nghe · Alt+↑/↓ tốc độ</span>
                  </div>
                ) : null}
              </section>

              {result && (
                <section className="st-card st-enter" aria-labelledby="dc-res">
                  <div className="sec-head">
                    <h2 id="dc-res" className="sec-title">{result.gaveUp ? "Đáp án" : "Kết quả"}</h2>
                    {!result.gaveUp && (
                      <span className={`st-badge ${result.cmp.score >= 80 ? "st-badge-success" : result.cmp.score >= 50 ? "st-badge-warning" : "st-badge-danger"}`}>Chính xác {result.cmp.score}%</span>
                    )}
                  </div>

                  {!result.gaveUp && (
                    <>
                      <p style={{ font: "500 21px/2 var(--font-reading)" }}>
                        {result.cmp.cells.map((c, i) => <Fragment key={i}><Cell c={c} />{" "}</Fragment>)}
                      </p>
                      <div className="row-wrap" style={{ gap: 16, marginTop: 8, fontSize: 13.5 }}>
                        <span><b>{result.cmp.counts.ok}</b> đúng</span>
                        <span style={{ textDecoration: "underline wavy var(--warning)", textUnderlineOffset: 4 }}><b>{result.cmp.counts.typo}</b> sai chính tả</span>
                        <span style={{ color: "var(--danger)" }}><s>sai</s> → <b>đúng</b>: {result.cmp.counts.wrong} nghe nhầm</span>
                        <span style={{ color: "var(--danger)", borderBottom: "2px dashed var(--danger)" }}>{result.cmp.counts.missing} bỏ sót</span>
                        <span style={{ color: "var(--accent-strong)", textDecoration: "line-through dotted" }}>{result.cmp.counts.extra} thừa</span>
                      </div>
                      <p className="ink2" style={{ marginTop: 12 }}>{tip(result.cmp)}</p>
                      <div className="divider" style={{ margin: "16px 0" }} />
                    </>
                  )}

                  <p className="meta" style={{ marginBottom: 4 }}>Transcript</p>
                  <Transcript text={seg.text} onSay={(s) => say(s)} />

                  <div className="row-wrap" style={{ gap: 8, marginTop: 16, alignItems: "center" }}>
                    <span className="st-field-label">Nghe lại:</span>
                    <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => playWhole(0.75)} aria-pressed={playing === "all"}>
                      {playing === "all" ? "Dừng" : "Cả đoạn (chậm 0.75×)"}
                    </button>
                    {chunks.map((c, i) => (
                      <button key={i} type="button" className="st-btn st-btn-ghost st-btn-sm" title={c} onClick={() => playPart(`c${i}`, i, 0.75)}>
                        {playing === `c${i}` ? "Dừng" : `Cụm ${i + 1}`}
                      </button>
                    ))}
                  </div>

                  <LinkNotes text={seg.text} onSay={(s) => say(s, 0.5)} />

                  {!result.gaveUp && missed.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <p className="st-field-label" style={{ marginBottom: 8 }}>Từ cần ôn (bấm để nghe) — đã lưu vào danh sách “hay nghe sai”</p>
                      <div className="row-wrap" style={{ gap: 8 }}>
                        {missed.map((w) => <button key={w} type="button" className="st-badge st-badge-danger" style={{ cursor: "pointer", border: 0 }} onClick={() => say(w)}>{w}</button>)}
                      </div>
                    </div>
                  )}

                  <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
                    <button className="st-btn st-btn-secondary" type="button" onClick={retry}>Làm lại đoạn này</button>
                    <button className="st-btn st-btn-secondary" type="button" onClick={() => document.getElementById("sh-h")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Sang bước Shadowing</button>
                    <button className="st-btn st-btn-primary" type="button" onClick={next}>Đoạn tiếp theo</button>
                  </div>
                </section>
              )}

              {result && (
                <ShadowPanel text={seg.text} defaultRate={S.rate} playModel={playModel} stopModel={stopAll} onScored={onShadow} />
              )}
            </>
          )}

          <section className="st-card" style={{ padding: 24 }} aria-labelledby="dc-stat">
            <div className="sec-head">
              <h2 id="dc-stat" className="sec-title">Tiến độ của bạn</h2>
            </div>
            <div className="row-wrap" style={{ gap: 28 }}>
              <Stat label="Hôm nay" value={today ? `${today.n} lượt` : "0 lượt"} sub={today ? `trung bình ${Math.round(today.sum / today.n)}%` : "chưa luyện"} />
              <Stat label="7 ngày qua" value={`${week.n} lượt`} sub={week.n ? `trung bình ${week.avg}%` : "—"} />
              <Stat label="Shadowing hôm nay" value={`${shadowToday} lượt`} sub={`${Object.keys(store.shadow).length} đoạn đã luyện`} />
              <Stat label="Đã hoàn thành" value={`${bank.filter((s) => store.done[s.id]).length}/${bank.length}`} sub="đoạn có sẵn" />
            </div>
            <div className="divider" style={{ margin: "16px 0" }} />
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <p className="st-field-label">Từ bạn hay nghe sai</p>
              {weak.length > 0 && (
                <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={() => { const n = { ...store, weak: {} }; setStore(n); saveStore(n); }}>Xoá danh sách</button>
              )}
            </div>
            {weak.length ? (
              <div className="row-wrap" style={{ gap: 8, marginTop: 10 }}>
                {weak.map(([w, n]) => (
                  <button key={w} type="button" className="st-badge" style={{ cursor: "pointer", border: 0 }} onClick={() => say(w)} title="Bấm để nghe">{w} ×{n}</button>
                ))}
              </div>
            ) : <p className="meta" style={{ marginTop: 8 }}>Chưa có. Sau mỗi lần chấm, những từ bạn nghe sót hoặc viết sai sẽ được ghi lại ở đây để ôn.</p>}
          </section>

          <Sources onUse={() => { setMode("mine"); setIdx(0); topRef.current?.scrollIntoView({ behavior: "smooth" }); }} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="meta">{label}</div>
      <div style={{ font: "700 24px/32px var(--font-display)" }}>{value}</div>
      <div className="meta">{sub}</div>
    </div>
  );
}

/** Lời khuyên theo kiểu lỗi chiếm nhiều nhất. */
function tip(c: Compared): string {
  const { ok, typo, wrong, missing, extra } = c.counts;
  if (c.score >= 95) return "Gần như hoàn hảo. Sang bước Shadowing, hoặc tăng tốc độ / chuyển cấp độ cao hơn.";
  const worst = Math.max(typo, wrong, missing, extra);
  if (worst === 0) return "";
  if (worst === missing) return "Bạn hay bỏ sót từ, thường là từ nối hoặc từ ngắn như a, the, of. Xem mục nối âm, nuốt âm bên dưới và nghe lại từng cụm.";
  if (worst === wrong) return "Nhiều từ bị nghe nhầm thành từ khác. Bấm nghe lại từng cụm ở tốc độ 0.75× và chú ý âm cuối, âm nối.";
  if (worst === typo) return `Bạn nghe đúng nhưng viết sai chính tả ${typo} từ. Xem lại các từ gạch lượn sóng ở trên.`;
  return ok ? "Bạn gõ thêm một số từ không có trong đoạn. Chỉ gõ đúng những gì nghe được." : "";
}
