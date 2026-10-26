"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Recording } from "@/lib/speaking";

export type Recorded = Recording & { url: string };

/**
 * Ghi âm câu trả lời: MediaRecorder lưu bản ghi để nghe lại, nhận dạng giọng nói của trình duyệt lấy lời và độ tin cậy,
 * và đo năng lượng âm thanh mỗi 50ms để biết khoảng nào có tiếng (dùng tính chỗ ngập ngừng, tốc độ nói).
 */
export function useAnswerRecorder() {
  const [recording, setRecording] = useState(false);
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0); // 0–1, để vẽ thanh âm lượng
  const [supported, setSupported] = useState({ record: true, recognize: true });
  const r = useRef<{
    stream?: MediaStream; rec?: MediaRecorder; sr?: any; ctx?: AudioContext; vad?: ReturnType<typeof setInterval>;
    parts: Blob[]; finals: string[]; confs: number[]; t0: number; voiced: [number, number][]; open: number | null; quiet: number; on: boolean; url: string;
  }>({ parts: [], finals: [], confs: [], t0: 0, voiced: [], open: null, quiet: 0, on: false, url: "" });

  useEffect(() => {
    const w = window as any;
    setSupported({ record: !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined", recognize: !!(w.SpeechRecognition || w.webkitSpeechRecognition) });
    return () => { teardown(); if (r.current.url) URL.revokeObjectURL(r.current.url); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const teardown = () => {
    const x = r.current;
    x.on = false;
    if (x.vad) clearInterval(x.vad);
    try { x.sr?.abort(); } catch {}
    try { if (x.rec?.state === "recording") x.rec.stop(); } catch {}
    x.stream?.getTracks().forEach((t) => t.stop());
    try { x.ctx?.close(); } catch {}
    x.stream = undefined; x.sr = undefined; x.ctx = undefined;
  };

  const start = useCallback(async (): Promise<boolean> => {
    setError(""); setLive("");
    const x = r.current;
    teardown();
    try {
      x.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Chưa có quyền dùng micro. Hãy cho phép micro trong thanh địa chỉ của trình duyệt rồi thử lại.");
      return false;
    }
    x.parts = []; x.finals = []; x.confs = []; x.voiced = []; x.open = null; x.quiet = 0;
    const rec = new MediaRecorder(x.stream);
    rec.ondataavailable = (e) => { if (e.data.size) x.parts.push(e.data); };
    x.rec = rec;

    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      x.ctx = new Ctx();
      const an = x.ctx.createAnalyser();
      an.fftSize = 1024;
      x.ctx.createMediaStreamSource(x.stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      let floor = 0.008, n = 0;
      x.vad = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let k = 0; k < buf.length; k++) s += buf[k] * buf[k];
        const rms = Math.sqrt(s / buf.length);
        const t = (performance.now() - x.t0) / 1000;
        setLevel(Math.min(1, rms * 8));
        if (n < 6) { floor = Math.max(floor, rms); n++; return; } // ~300ms đầu: mức ồn nền
        const voice = rms > Math.max(0.015, floor * 2.2);
        if (voice) { if (x.open == null) x.open = t; x.quiet = 0; }
        else if (x.open != null && ++x.quiet >= 3) { x.voiced.push([x.open, t - 0.15]); x.open = null; }
      }, 50);
    } catch {}

    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (SR) {
      const sr = new SR();
      sr.lang = "en-US"; sr.continuous = true; sr.interimResults = true; sr.maxAlternatives = 1;
      sr.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) { x.finals.push(res[0].transcript.trim()); if (typeof res[0].confidence === "number") x.confs.push(res[0].confidence); }
          else interim += res[0].transcript;
        }
        setLive(`${x.finals.join(" ")} ${interim}`.trim());
      };
      // Chrome tự ngắt sau một quãng lặng: còn đang ghi thì bật lại
      sr.onend = () => { if (x.on && x.sr === sr) try { sr.start(); } catch {} };
      sr.onerror = (e: any) => { if (e.error === "not-allowed") setError("Trình duyệt chặn nhận dạng giọng nói. Kiểm tra quyền micro."); };
      x.sr = sr;
      try { sr.start(); } catch {}
    }
    x.t0 = performance.now();
    x.on = true;
    rec.start();
    setRecording(true);
    return true;
  }, []);

  /** Dừng ghi, chờ nhận dạng trả nốt kết quả cuối rồi trả về bản ghi. */
  const stop = useCallback((): Promise<Recorded | null> => new Promise((resolve) => {
    const x = r.current;
    if (!x.on) { resolve(null); return; }
    x.on = false;
    setRecording(false); setLevel(0);
    const durationSec = (performance.now() - x.t0) / 1000;
    if (x.open != null) { x.voiced.push([x.open, durationSec]); x.open = null; }
    if (x.vad) clearInterval(x.vad);
    try { x.sr?.stop(); } catch {}
    const rec = x.rec;
    const done = () => {
      const blob = new Blob(x.parts, { type: rec?.mimeType || "audio/webm" });
      if (x.url) URL.revokeObjectURL(x.url);
      x.url = blob.size ? URL.createObjectURL(blob) : "";
      const out: Recorded = { url: x.url, transcript: x.finals.join(" ").trim(), confidences: [...x.confs], durationSec, voiced: [...x.voiced] };
      teardown();
      resolve(out);
    };
    if (rec && rec.state === "recording") { rec.onstop = () => setTimeout(done, 600); rec.stop(); }
    else setTimeout(done, 600);
  }), []);

  const cancel = useCallback(() => { teardown(); setRecording(false); setLevel(0); setLive(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { recording, live, error, level, supported, start, stop, cancel };
}
