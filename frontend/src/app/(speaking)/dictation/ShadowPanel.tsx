"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { compare, paceVerdict, wordCount, wpm, type Compared } from "@/lib/dictation";
import { Cell } from "./parts";

/** Cách phát câu mẫu do trang cung cấp (giọng máy hoặc audio YouTube). Trả về hàm dừng. */
export type PlayModel = (rate: number, cb: { onStart?: () => void; onWord?: (charIndex: number) => void; onEnd?: (completed: boolean) => void }) => () => void;

type Mode = "shadow" | "echo";
type Phase = "idle" | "model" | "rec" | "busy" | "done";
type Result = { cmp: Compared | null; heard: string; userSec: number; modelSec: number; url: string };

const RATES = [0.5, 0.75, 1] as const;

/** Tiếng bíp ngắn báo đến lượt người học nói (chế độ nghe rồi nhắc lại). */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.12);
    o.onended = () => ctx.close();
  } catch {}
}

/**
 * Shadowing: nghe câu mẫu rồi đọc nhại để khớp tốc độ và ngữ điệu.
 * - Đọc nhại cùng lúc: ghi âm trong khi mẫu đang phát (nên đeo tai nghe để micro không thu tiếng loa).
 * - Nghe rồi nhắc lại: mẫu phát xong, có tiếng bíp, người học nói lại cả đoạn.
 * Sau đó chấm khớp lời (nhận dạng giọng nói của trình duyệt), so nhịp nói với mẫu và cho nghe lại giọng mình cạnh giọng mẫu.
 */
export default function ShadowPanel({ text, defaultRate, playModel, stopModel, onScored }: {
  text: string;
  defaultRate: number;
  playModel: PlayModel;
  stopModel: () => void;
  onScored: (score: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("shadow");
  const [rate, setRate] = useState<number>(RATES.includes(defaultRate as (typeof RATES)[number]) ? defaultRate : 0.75);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hideText, setHideText] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [canRecognize, setCanRecognize] = useState(true);
  const [canRecord, setCanRecord] = useState(true);
  const [heardLive, setHeardLive] = useState("");

  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const starts = useMemo(() => {
    const out: number[] = [];
    let pos = 0;
    for (const w of words) { pos = text.indexOf(w, pos); out.push(pos); pos += w.length; }
    return out;
  }, [text, words]);

  // mọi thứ cần dọn khi dừng hoặc rời trang
  const r = useRef<{
    stream?: MediaStream; rec?: MediaRecorder; sr?: any; ctx?: AudioContext; vad?: ReturnType<typeof setInterval>;
    tick?: ReturnType<typeof setInterval>; timers: ReturnType<typeof setTimeout>[]; stopPlay?: () => void;
    parts: Blob[]; finals: string[]; recStart: number; firstVoice: number; lastVoice: number;
    modelStart: number; modelSec: number; gotBoundary: boolean; recording: boolean; url: string;
  }>({ timers: [], parts: [], finals: [], recStart: 0, firstVoice: -1, lastVoice: -1, modelStart: 0, modelSec: 0, gotBoundary: false, recording: false, url: "" });
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const w = window as any;
    setCanRecognize(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    setCanRecord(Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined");
  }, []);

  const teardown = () => {
    const x = r.current;
    x.timers.forEach(clearTimeout); x.timers = [];
    if (x.vad) clearInterval(x.vad);
    if (x.tick) clearInterval(x.tick);
    x.stopPlay?.(); x.stopPlay = undefined;
    x.recording = false;
    try { x.sr?.abort(); } catch {}
    try { if (x.rec?.state === "recording") x.rec.stop(); } catch {}
    x.stream?.getTracks().forEach((t) => t.stop());
    try { x.ctx?.close(); } catch {}
    x.stream = undefined; x.rec = undefined; x.sr = undefined; x.ctx = undefined;
  };

  // đổi đoạn: dọn sạch và xoá kết quả cũ
  useEffect(() => {
    setResult(null); setPhase("idle"); setActive(-1); setError(""); setHeardLive("");
    return () => { teardown(); stopModel(); if (r.current.url) { URL.revokeObjectURL(r.current.url); r.current.url = ""; } };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const wordAt = (charIndex: number) => {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= charIndex) k++;
    return k;
  };

  /** Phát câu mẫu, tô từ đang đọc. Giọng đọc không báo vị trí từ (hoặc audio YouTube) thì ước lượng theo thời gian. */
  const runModel = (onEnd: (completed: boolean) => void) => {
    const x = r.current;
    x.gotBoundary = false;
    const est = (wordCount(text) / 2.6) / rate * 1000;
    x.stopPlay = playModel(rate, {
      onStart: () => {
        x.modelStart = performance.now();
        if (x.tick) clearInterval(x.tick);
        x.tick = setInterval(() => {
          if (x.gotBoundary) return;
          const p = (performance.now() - x.modelStart) / est;
          setActive(Math.min(words.length - 1, Math.floor(p * words.length)));
        }, 120);
      },
      onWord: (ci) => { x.gotBoundary = true; setActive(wordAt(ci)); },
      onEnd: (done) => {
        if (x.tick) clearInterval(x.tick);
        x.modelSec = x.modelStart ? (performance.now() - x.modelStart) / 1000 : 0;
        setActive(-1);
        onEnd(done);
      },
    });
  };

  const startRecording = async (): Promise<boolean> => {
    const x = r.current;
    try {
      x.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Chưa có quyền dùng micro. Hãy cho phép micro trong thanh địa chỉ của trình duyệt rồi thử lại.");
      return false;
    }
    x.parts = []; x.finals = []; x.firstVoice = -1; x.lastVoice = -1;
    setHeardLive("");
    const rec = new MediaRecorder(x.stream);
    rec.ondataavailable = (e) => { if (e.data.size) x.parts.push(e.data); };
    x.rec = rec;

    // dò đoạn có tiếng nói để đo nhịp chính xác (bỏ khoảng lặng đầu và cuối)
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      x.ctx = new Ctx();
      const an = x.ctx.createAnalyser();
      an.fftSize = 1024;
      x.ctx.createMediaStreamSource(x.stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      let floor = 0.01, n = 0;
      x.vad = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let k = 0; k < buf.length; k++) s += buf[k] * buf[k];
        const rms = Math.sqrt(s / buf.length);
        const t = performance.now() - x.recStart;
        if (n < 6) { floor = Math.max(floor, rms); n++; return; } // ~300ms đầu để lấy mức ồn nền
        if (rms > Math.max(0.02, floor * 2.2)) {
          if (x.firstVoice < 0) x.firstVoice = t;
          x.lastVoice = t;
        }
      }, 50);
    } catch {}

    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (SR) {
      const sr = new SR();
      sr.lang = "en-US"; sr.continuous = true; sr.interimResults = true;
      sr.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) x.finals.push(e.results[i][0].transcript);
          else interim += e.results[i][0].transcript;
        }
        setHeardLive(`${x.finals.join(" ")} ${interim}`.trim());
      };
      // Chrome tự ngắt nhận dạng sau một quãng lặng; còn đang ghi thì bật lại
      sr.onend = () => { if (x.recording && x.sr === sr) try { sr.start(); } catch {} };
      sr.onerror = (e: any) => { if (e.error === "not-allowed") setError("Trình duyệt chặn nhận dạng giọng nói. Kiểm tra quyền micro."); };
      x.sr = sr;
      try { sr.start(); } catch {}
    }
    x.recStart = performance.now();
    x.recording = true;
    rec.start();
    setPhase("rec");
    return true;
  };

  const finish = () => {
    const x = r.current;
    if (!x.recording) return;
    x.recording = false;
    x.timers.forEach(clearTimeout); x.timers = [];
    x.stopPlay?.(); x.stopPlay = undefined;
    setPhase("busy");
    const total = (performance.now() - x.recStart) / 1000;
    const rec = x.rec;
    try { x.sr?.stop(); } catch {}
    const done = () => {
      const blob = new Blob(x.parts, { type: rec?.mimeType || "audio/webm" });
      if (x.url) URL.revokeObjectURL(x.url);
      x.url = blob.size ? URL.createObjectURL(blob) : "";
      const voiced = x.firstVoice >= 0 && x.lastVoice > x.firstVoice ? (x.lastVoice - x.firstVoice) / 1000 + 0.2 : total;
      const heard = x.finals.join(" ").trim();
      const cmp = canRecognize && heard ? compare(text, heard) : null;
      teardown();
      setResult({ cmp, heard, userSec: voiced, modelSec: x.modelSec, url: x.url });
      setPhase("done");
      if (cmp) onScored(cmp.score);
    };
    // chờ nhận dạng trả nốt kết quả cuối rồi mới chấm
    if (rec && rec.state === "recording") { rec.onstop = () => setTimeout(done, 500); rec.stop(); }
    else setTimeout(done, 500);
  };

  const start = async () => {
    setError(""); setResult(null);
    stopModel(); teardown();
    const x = r.current;
    if (mode === "shadow") {
      if (!(await startRecording())) return;
      runModel(() => { x.timers.push(setTimeout(finish, 1500)); });
    } else {
      setPhase("model");
      runModel(async (completed) => {
        if (!completed) { setPhase("idle"); return; }
        beep();
        if (!(await startRecording())) { setPhase("idle"); return; }
        // tự dừng nếu người học quên bấm: gấp đôi thời lượng mẫu + 3 giây
        x.timers.push(setTimeout(finish, Math.max(6000, x.modelSec * 2000 + 3000)));
      });
    }
  };

  const cancel = () => { teardown(); stopModel(); setPhase("idle"); setActive(-1); };

  const playMine = () => { const a = audioRef.current; if (a) { a.currentTime = 0; a.play().catch(() => {}); } };
  const playModelOnly = () => { stopModel(); audioRef.current?.pause(); runModel(() => {}); };
  const playAB = () => { stopModel(); audioRef.current?.pause(); runModel((ok) => { if (ok) setTimeout(playMine, 400); }); };

  const modelWpm = result ? wpm(text, result.modelSec || (wordCount(text) / 2.6) / rate) : 0;
  const userWpm = result ? wpm(text, result.userSec) : 0;
  const pace = result ? paceVerdict(userWpm, modelWpm) : null;
  const busy = phase === "model" || phase === "rec" || phase === "busy";

  return (
    <section className="st-card" style={{ padding: 28 }} aria-labelledby="sh-h">
      <div className="sec-head">
        <h2 id="sh-h" className="sec-title">Shadowing: đọc nhại theo mẫu</h2>
      </div>
      <p className="ink2" style={{ fontSize: 14.5 }}>
        Sau khi chép xong và hiểu đoạn, nghe lại và nói theo để khớp tốc độ, ngữ điệu, chỗ nối âm. Bắt đầu ở 0.5× hoặc 0.75×, khi khớp thì tăng lên 1×.
      </p>

      {!canRecord && (
        <p role="alert" style={{ marginTop: 10, color: "var(--danger)" }}>Trình duyệt này không ghi âm được. Hãy dùng Chrome, Edge hoặc Safari bản mới.</p>
      )}

      <div className="row-wrap" style={{ gap: 16, marginTop: 16, alignItems: "end" }}>
        <div>
          <div className="st-field-label" id="sh-mode" style={{ marginBottom: 6 }}>Cách luyện</div>
          <div className="seg" role="radiogroup" aria-labelledby="sh-mode">
            <button type="button" className="seg-btn" role="radio" aria-checked={mode === "shadow"} disabled={busy} onClick={() => setMode("shadow")}>Nói cùng lúc</button>
            <button type="button" className="seg-btn" role="radio" aria-checked={mode === "echo"} disabled={busy} onClick={() => setMode("echo")}>Nghe rồi nhắc lại</button>
          </div>
        </div>
        <div>
          <div className="st-field-label" id="sh-rate" style={{ marginBottom: 6 }}>Tốc độ mẫu</div>
          <div className="seg" role="radiogroup" aria-labelledby="sh-rate">
            {RATES.map((x) => <button key={x} type="button" className="seg-btn" role="radio" aria-checked={rate === x} disabled={busy} onClick={() => setRate(x)}>{x}×</button>)}
          </div>
        </div>
        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={hideText} onChange={(e) => setHideText(e.target.checked)} />
          <span className="ink2" style={{ fontSize: 14 }}>Ẩn chữ (chỉ nghe)</span>
        </label>
      </div>
      <p className="meta" style={{ marginTop: 8 }}>
        {mode === "shadow" ? "Đeo tai nghe để micro chỉ thu giọng bạn. Nói đuổi theo người đọc, chậm hơn nửa nhịp." : "Nghe hết đoạn, khi có tiếng bíp thì nói lại cả đoạn. Bấm “Xong” khi nói hết."}
      </p>

      <p lang="en" aria-label="Câu mẫu" style={{ font: "500 21px/1.9 var(--font-reading)", marginTop: 14, filter: hideText && phase !== "done" ? "blur(7px)" : undefined, transition: "filter .2s" }}>
        {words.map((w, i) => (
          <Fragment key={i}>
            <span style={{ borderRadius: 4, padding: "0 2px", background: i === active ? "var(--brand-tint)" : undefined, color: i === active ? "var(--brand)" : undefined, transition: "background .1s" }}>{w}</span>{" "}
          </Fragment>
        ))}
      </p>

      <div className="row-wrap" style={{ gap: 12, marginTop: 16, alignItems: "center" }}>
        {phase === "rec" ? (
          <button type="button" className="st-btn st-btn-primary" onClick={finish} style={{ background: "var(--danger)" }}>Xong, chấm nhịp</button>
        ) : (
          <button type="button" className="st-btn st-btn-primary" disabled={!canRecord || busy} onClick={start}>
            {phase === "done" ? "Luyện lại" : mode === "shadow" ? "Bắt đầu nói cùng mẫu" : "Nghe mẫu rồi nói"}
          </button>
        )}
        {busy && phase !== "busy" && <button type="button" className="st-btn st-btn-ghost" onClick={cancel}>Huỷ</button>}
        <span className="meta" role="status" aria-live="polite">
          {phase === "model" ? "Đang phát mẫu, chuẩn bị nói sau tiếng bíp…" : phase === "rec" ? "Đang ghi âm…" : phase === "busy" ? "Đang chấm…" : ""}
        </span>
      </div>
      {phase === "rec" && heardLive && <p className="meta" style={{ marginTop: 8 }}>Studia nghe được: “{heardLive}”</p>}
      {error && <p role="alert" style={{ color: "var(--danger)", marginTop: 8 }}>{error}</p>}

      {result && phase === "done" && (
        <div className="st-enter" style={{ marginTop: 18 }}>
          <div className="divider" style={{ margin: "0 0 16px" }} />
          <div className="row-wrap" style={{ gap: 28 }}>
            <div>
              <div className="meta">Khớp lời</div>
              <div style={{ font: "700 24px/32px var(--font-display)" }}>{result.cmp ? `${result.cmp.score}%` : "—"}</div>
              <div className="meta">{result.cmp ? `${result.cmp.counts.ok}/${result.cmp.total} từ nghe rõ` : canRecognize ? "không nghe được lời" : "trình duyệt không nhận dạng giọng"}</div>
            </div>
            <div>
              <div className="meta">Nhịp của bạn</div>
              <div style={{ font: "700 24px/32px var(--font-display)" }}>{userWpm} <span className="meta">từ/phút</span></div>
              <div className="meta">{result.userSec.toFixed(1)} giây</div>
            </div>
            <div>
              <div className="meta">Nhịp mẫu</div>
              <div style={{ font: "700 24px/32px var(--font-display)" }}>{modelWpm} <span className="meta">từ/phút</span></div>
              <div className="meta">{result.modelSec ? `${result.modelSec.toFixed(1)} giây` : "ước lượng"} ở {rate}×</div>
            </div>
          </div>
          {pace && <p style={{ marginTop: 10, color: pace.tone === "ok" ? "var(--success, var(--ink))" : "var(--ink-secondary)" }}>{pace.label}</p>}

          {result.cmp && (
            <>
              <p className="meta" style={{ marginTop: 12, marginBottom: 4 }}>So với câu mẫu (từ đỏ là chỗ Studia không nghe rõ, thường do nuốt âm hoặc đọc sai)</p>
              <p style={{ font: "500 19px/1.9 var(--font-reading)" }} lang="en">
                {result.cmp.cells.map((c, i) => <Fragment key={i}><Cell c={c} />{" "}</Fragment>)}
              </p>
            </>
          )}
          {!result.cmp && result.heard === "" && canRecognize && (
            <p className="meta" style={{ marginTop: 10 }}>Không nhận ra lời nói. Nói to, rõ hơn và đưa micro lại gần.</p>
          )}

          <div className="row-wrap" style={{ gap: 8, marginTop: 14, alignItems: "center" }}>
            <span className="st-field-label">Nghe lại:</span>
            <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={playModelOnly}>Mẫu</button>
            <button type="button" className="st-btn st-btn-secondary st-btn-sm" disabled={!result.url} onClick={playMine}>Giọng bạn</button>
            <button type="button" className="st-btn st-btn-ghost st-btn-sm" disabled={!result.url} onClick={playAB}>Mẫu rồi tới giọng bạn</button>
          </div>
          {result.url && <audio ref={audioRef} src={result.url} controls style={{ width: "100%", marginTop: 10 }} />}
        </div>
      )}
    </section>
  );
}
