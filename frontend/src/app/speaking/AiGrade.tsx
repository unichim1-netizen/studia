"use client";

import { useRef, useState } from "react";
import { API, apiFetch } from "@/lib/api";
import AiContextCard from "@/components/AiContextCard";
import { describeUsed, payload, type AiContext, type UsedContext } from "@/lib/aiContext";
import type { Analysis, Part } from "@/lib/speaking";
import type { Recorded } from "@/lib/useAnswerRecorder";

type Criterion = { name: string; band: number; comment_vi: string; strengths: string[]; improvements: string[] };
export type SpeakingGrade = {
  overall: number; criteria: Record<"fluency" | "lexical" | "grammar" | "pronunciation", Criterion>;
  summary_vi: string; priorities_vi: string[];
  corrections: { original: string; corrected: string; type: string; explanation_vi: string; in_transcript: boolean }[];
  better_answer: string | null; useful_phrases: { phrase: string; meaning_vi: string }[];
  pronunciation_estimated: boolean; context?: UsedContext;
};

const ORDER = ["fluency", "lexical", "grammar", "pronunciation"] as const;
const VI: Record<string, string> = { fluency: "Trôi chảy & mạch lạc", lexical: "Từ vựng", grammar: "Ngữ pháp", pronunciation: "Phát âm" };
const TYPE_VI: Record<string, string> = { grammar: "Ngữ pháp", vocabulary: "Từ vựng", pronunciation: "Phát âm", coherence: "Mạch lạc" };
const color = (b: number) => (b >= 7 ? "var(--success)" : b >= 5.5 ? "var(--brand)" : b >= 4.5 ? "var(--accent-strong)" : "var(--danger)");

/**
 * Chấm chi tiết bằng AI cho một câu trả lời đã ghi âm: gửi lời nhận dạng, số đo nhịp nói, phần tự sửa của người học
 * và ngữ cảnh người học; hiện band 4 tiêu chí, câu cần sửa, câu trả lời mẫu ở band mục tiêu.
 */
export default function AiGrade({ part, question, rec, analysis, selfReview, onGraded }: {
  part: Part; question: string; rec: Recorded; analysis: Analysis; selfReview: string; onGraded: (band: number) => void;
}) {
  const ctx = useRef<AiContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<SpeakingGrade | null>(null);

  const words = rec.transcript.trim() ? rec.transcript.trim().split(/\s+/).length : 0;
  const confs = rec.confidences.filter((c) => c > 0);

  const grade = async () => {
    setBusy(true); setError("");
    try {
      const r = await apiFetch(`${API}/speaking/grade`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part, question, transcript: rec.transcript, self_review: selfReview,
          context: ctx.current ? payload(ctx.current, "speaking") : undefined,
          metrics: {
            duration_sec: rec.durationSec, speech_sec: analysis.speechSec, wpm: analysis.wpm,
            pauses: analysis.pauses.length, longest_pause: analysis.longestPause, start_delay: analysis.startDelay,
            fillers: analysis.fillers.map((f) => f.word),
            ...(confs.length ? { avg_confidence: confs.reduce((a, b) => a + b, 0) / confs.length } : {}),
            bullets_missed: analysis.bullets.filter((b) => !b.covered).map((b) => b.text),
          },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Chưa chấm được, thử lại sau.");
      setRes(d); onGraded(d.overall);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <AiContextCard skill="speaking" onChange={(c) => { ctx.current = c; }} />
      {!res && (
        <section className="st-card" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <b>Chấm chi tiết bằng AI</b>
              <div className="meta">Coal chấm band 4 tiêu chí, sửa câu sai và nói lại câu trả lời ở band mục tiêu. Nên tự sửa lỗi ở trên trước để so với nhận xét của AI.</div>
            </div>
            <button type="button" className="st-btn st-btn-primary" disabled={busy || words < 8} onClick={grade}>{busy ? "Coal đang chấm…" : "Chấm bằng AI"}</button>
          </div>
          {words < 8 && <p className="meta" style={{ marginTop: 6 }}>Cần ít nhất 8 từ nhận dạng được để chấm.</p>}
          {error && <p role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>{error}</p>}
        </section>
      )}

      {res && (
        <section className="st-card st-enter" style={{ padding: 20 }} aria-labelledby="sp-ai">
          <div className="row" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center", border: `6px solid ${color(res.overall)}`, flexShrink: 0 }}>
              <b style={{ font: "750 24px/1 var(--font-display)" }}>{res.overall.toFixed(1)}</b>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h2 id="sp-ai" className="sec-title" style={{ fontSize: 17 }}>Kết quả chấm AI · Part {part}</h2>
              <p style={{ marginTop: 4, fontSize: 14.5 }}>{res.summary_vi}</p>
              {res.context && <p className="meta" style={{ marginTop: 4 }}>{describeUsed(res.context)}</p>}
            </div>
          </div>
          {res.priorities_vi.length > 0 && (
            <ol className="ink2" style={{ margin: "12px 0 0", paddingLeft: 20, fontSize: 14, display: "grid", gap: 2 }}>{res.priorities_vi.map((p, i) => <li key={i}>{p}</li>)}</ol>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 14 }}>
            {ORDER.map((k) => {
              const c = res.criteria[k];
              return (
                <div key={k} style={{ padding: 12, borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <div><b style={{ fontSize: 14 }}>{c.name}</b><div className="meta">{VI[k]}{k === "pronunciation" && res.pronunciation_estimated ? " · ước lượng" : ""}</div></div>
                    <b style={{ font: "750 24px/1 var(--font-display)", color: color(c.band) }}>{c.band.toFixed(1)}</b>
                  </div>
                  <p className="ink2" style={{ fontSize: 13.5, marginTop: 6 }}>{c.comment_vi}</p>
                  {c.improvements.length > 0 && <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>{c.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                </div>
              );
            })}
          </div>
          {res.pronunciation_estimated && <p className="meta" style={{ marginTop: 8 }}>AI không nghe trực tiếp giọng bạn: điểm Phát âm ước lượng từ lời nhận dạng và độ tin cậy của máy. Hãy nghe lại bản ghi và luyện ở mục Shadowing.</p>}

          {res.corrections.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <b>Câu nên sửa</b>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 8 }}>
                {res.corrections.map((c, i) => (
                  <li key={i} style={{ fontSize: 14 }}>
                    <span className="st-badge" style={{ marginRight: 6 }}>{TYPE_VI[c.type] || c.type}</span>
                    <s lang="en" style={{ opacity: 0.7 }}>{c.original}</s> → <b lang="en" style={{ color: "var(--success)" }}>{c.corrected}</b>
                    {c.explanation_vi && <div className="meta">{c.explanation_vi}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.better_answer && (
            <div style={{ marginTop: 14 }}>
              <b>Câu trả lời mẫu ở band mục tiêu (giữ ý của bạn)</b>
              <p lang="en" style={{ marginTop: 6, padding: "10px 12px", borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)", font: "500 15.5px/1.7 var(--font-reading)" }}>{res.better_answer}</p>
              <p className="meta">Đọc to vài lần theo nhịp tự nhiên rồi tắt đi, tự nói lại bằng lời của bạn. Đừng học thuộc.</p>
            </div>
          )}
          {res.useful_phrases.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b>Cụm từ nên dùng</b>
              <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 4, fontSize: 14 }}>
                {res.useful_phrases.map((p) => <li key={p.phrase}><b lang="en">{p.phrase}</b>{p.meaning_vi ? <span className="meta"> · {p.meaning_vi}</span> : null}</li>)}
              </ul>
            </div>
          )}
          <button type="button" className="st-btn st-btn-ghost st-btn-sm" style={{ marginTop: 12 }} onClick={() => setRes(null)}>Chấm lại với ngữ cảnh khác</button>
        </section>
      )}
    </div>
  );
}
