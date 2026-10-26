"use client";

import { Fragment } from "react";
import {
  REL_HINT, REL_LABEL, SKIM_TARGET_SEC, analyzeSentence, fmtTime, matchRanges,
  type Keyword, type KwKind, type Passage, type Ref,
} from "@/lib/reading";

export const KW_BG: Record<KwKind, string> = { name: "var(--brand-tint)", number: "var(--warning-tint)", content: "var(--accent-tint)" };
export const KW_FG: Record<KwKind, string> = { name: "var(--brand)", number: "var(--ink)", content: "var(--accent-strong)" };

/** Câu có tô màu các từ khoá khớp. */
function Marked({ text, kws }: { text: string; kws: Keyword[] }) {
  if (!kws.length) return <>{text}</>;
  const ranges = matchRanges(text, kws);
  if (!ranges.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([a, b, kind], i) => {
    if (a > pos) out.push(text.slice(pos, a));
    out.push(<mark key={i} style={{ background: KW_BG[kind], color: KW_FG[kind], borderRadius: 3, padding: "0 2px", fontWeight: 650 }}>{text.slice(a, b)}</mark>);
    pos = b;
  });
  out.push(text.slice(pos));
  return <>{out}</>;
}

/**
 * Bài đọc chia đoạn/câu. Chế độ đọc lướt làm mờ mọi câu trừ câu đầu mỗi đoạn; câu bấm được (ghim vị trí / phân tích);
 * các câu có từ khoá đang quét được tô màu, câu ghim và câu ước lượng có viền riêng.
 */
export function PassageView({ passage, skim, kws, pinned, estimate, selected, flash, onSentence }: {
  passage: Passage;
  skim: boolean;
  kws: Keyword[];
  pinned?: Ref | null;
  estimate?: Ref | null;
  selected?: Ref | null;
  flash?: Ref | null;
  onSentence: (r: Ref) => void;
}) {
  const same = (a: Ref | null | undefined, p: number, s: number) => !!a && a.p === p && a.s === s;
  return (
    <article lang="en" style={{ font: "500 16.5px/1.75 var(--font-reading)" }}>
      <h2 style={{ font: "700 20px/28px var(--font-reading)", marginBottom: 12 }}>{passage.title}</h2>
      {passage.paras.map((para, p) => (
        <p key={p} id={`rd-p-${p}`} style={{ marginBottom: 14, display: "flex", gap: 10 }}>
          <span aria-hidden="true" style={{ flex: "0 0 22px", font: "700 13px/28px var(--font-sans)", color: "var(--ink-muted)", textAlign: "right" }}>{para.label || p + 1}</span>
          <span>
            {para.sentences.map((s, i) => {
              const faded = skim && i > 0;
              const ring = same(pinned, p, i) ? "var(--brand)" : same(estimate, p, i) ? "var(--success)" : undefined;
              return (
                <Fragment key={i}>
                  <span id={`rd-s-${p}-${i}`} role="button" tabIndex={0}
                    onClick={() => onSentence({ p, s: i })}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSentence({ p, s: i }); } }}
                    style={{
                      cursor: "pointer", borderRadius: 4, transition: "opacity .2s, background .3s",
                      opacity: faded ? 0.32 : 1,
                      fontWeight: skim && i === 0 ? 650 : undefined,
                      background: same(flash, p, i) ? "var(--warning-tint)" : same(selected, p, i) ? "var(--surface-sunken)" : undefined,
                      outline: ring ? `2px solid ${ring}` : undefined, outlineOffset: 2,
                    }}>
                    <Marked text={s} kws={faded ? [] : kws} />
                  </span>{" "}
                </Fragment>
              );
            })}
          </span>
        </p>
      ))}
    </article>
  );
}

/** Phân tích một câu: các mệnh đề và quan hệ giữa chúng, cùng câu lõi sau khi rút gọn. */
export function SentencePanel({ sentence, onClose }: { sentence: string; onClose: () => void }) {
  const { clauses, core } = analyzeSentence(sentence);
  const words = sentence.split(/\s+/).length;
  return (
    <section className="st-card st-enter" aria-labelledby="rd-an" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <h3 id="rd-an" className="sec-title" style={{ fontSize: 16 }}>Phân tích câu</h3>
        <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={onClose}>Đóng</button>
      </div>
      <p lang="en" className="ink2" style={{ font: "500 15px/1.6 var(--font-reading)", marginTop: 6 }}>{sentence}</p>
      <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
        {clauses.map((c, i) => (
          <li key={i} className="row" style={{ gap: 10, alignItems: "flex-start", paddingLeft: c.main ? 0 : 18 }}>
            <span className={`st-badge ${c.main ? "st-badge-success" : c.rel === "aside" || c.rel === "example" || c.rel === "relative" ? "" : "st-badge-warning"}`} style={{ minWidth: 92, justifyContent: "center", flexShrink: 0 }}>
              {c.main ? "Mệnh đề chính" : REL_LABEL[c.rel || "aside"]}
            </span>
            <div style={{ minWidth: 0 }}>
              <div lang="en" style={{ font: `${c.main ? 600 : 500} 15px/1.5 var(--font-reading)`, opacity: c.main ? 1 : 0.85 }}>
                {c.marker ? <><b style={{ color: "var(--accent-strong)" }}>{c.text.slice(0, c.marker.length)}</b>{c.text.slice(c.marker.length)}</> : c.text}
              </div>
              {c.rel && <div className="meta" style={{ marginTop: 2 }}>{c.main ? `${REL_LABEL[c.rel]}: ` : ""}{REL_HINT[c.rel]}</div>}
            </div>
          </li>
        ))}
      </ol>
      <div className="divider" style={{ margin: "14px 0 10px" }} />
      <p className="st-field-label" style={{ marginBottom: 4 }}>Câu lõi (bỏ chú thích, ví dụ, mệnh đề bổ nghĩa)</p>
      <p lang="en" style={{ font: "650 16px/1.6 var(--font-reading)" }}>{core}</p>
      <p className="meta" style={{ marginTop: 8 }}>
        {words} từ → {core.split(/\s+/).length} từ. Đọc câu lõi trước để nắm ai làm gì, rồi mới xem các vế phụ. Phân tích tự động theo từ nối và dấu câu nên chỉ gần đúng.
      </p>
    </section>
  );
}

/** Thanh thời gian: đã dùng / ngân sách, mốc đọc lướt và mốc cảnh báo. */
export function TimeBar({ elapsed, budget, skimSec, phase }: { elapsed: number; budget: number; skimSec: number | null; phase: string }) {
  const unlimited = !budget;
  const total = unlimited ? Math.max(elapsed, 1200) : budget;
  const pct = Math.min(100, (elapsed / total) * 100);
  const over = !unlimited && elapsed > budget;
  const warn = !unlimited && elapsed > budget * 0.75;
  const color = over ? "var(--danger)" : warn ? "var(--warning)" : "var(--brand)";
  const skimMark = (SKIM_TARGET_SEC / total) * 100;
  return (
    <div role="timer" aria-live="off" aria-label={`Đã dùng ${fmtTime(elapsed)}${unlimited ? "" : ` trên ${fmtTime(budget)}`}`}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <b style={{ font: "700 26px/1 var(--font-display)", fontVariantNumeric: "tabular-nums", color: over ? "var(--danger)" : undefined }}>
          {unlimited ? fmtTime(elapsed) : over ? `+${fmtTime(elapsed - budget)}` : fmtTime(budget - elapsed)}
        </b>
        <span className="meta">
          {unlimited ? "không giới hạn" : over ? "quá giờ" : "còn lại"}
          {skimSec != null ? ` · đọc lướt ${fmtTime(skimSec)}` : phase === "skim" ? ` · mục tiêu đọc lướt ≤ ${fmtTime(SKIM_TARGET_SEC)}` : ""}
        </span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--surface-sunken)", marginTop: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 1s linear" }} />
        <i aria-hidden="true" style={{ position: "absolute", left: `${skimMark}%`, top: 0, bottom: 0, width: 2, background: "var(--ink-muted)", opacity: 0.6 }} title="Mốc đọc lướt 3 phút" />
      </div>
    </div>
  );
}
