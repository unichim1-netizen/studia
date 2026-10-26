"use client";

import { Fragment, useState } from "react";
import { API, apiFetch } from "@/lib/api";
import { LINK_LABEL, connectedSpeech, type Compared, type LinkNote } from "@/lib/dictation";

/** Một từ trong kết quả; mỗi loại lỗi có kiểu gạch khác nhau để không phụ thuộc vào màu. */
export function Cell({ c }: { c: Compared["cells"][number] }) {
  const gap = { marginRight: 4 } as const;
  switch (c.kind) {
    case "ok":
      return <span style={gap}>{c.ref}</span>;
    case "typo":
      return (
        <span style={{ ...gap, textDecoration: "underline wavy var(--warning)", textUnderlineOffset: 5 }} title={`Bạn gõ “${c.got}”, đúng là “${c.ref}”`}>
          <s style={{ color: "var(--ink-muted)" }}>{c.got}</s>{" "}{c.ref}
        </span>
      );
    case "wrong":
      return (
        <span style={{ ...gap, color: "var(--danger)" }} title={`Bạn gõ “${c.got}”, đúng là “${c.ref}”`}>
          <s style={{ opacity: 0.7 }}>{c.got}</s>{" "}<b>{c.ref}</b>
        </span>
      );
    case "missing":
      return <span style={{ ...gap, color: "var(--danger)", borderBottom: "2px dashed var(--danger)" }} title="Bạn đã bỏ sót từ này">{c.ref}</span>;
    default:
      return <span style={{ ...gap, color: "var(--accent-strong)", textDecoration: "line-through dotted" }} title="Từ thừa, không có trong đoạn nghe">{c.got}</span>;
  }
}

/* ---------- Transcript bấm để tra nghĩa ---------- */

type Card = {
  word: string; word_type?: string; meaning_vi: string; pronunciation?: string;
  example_sentences?: { en: string; vi: string }[]; collocations?: string[]; usage_note?: string;
};
type Look = { phrase: string; state: "busy" | "ok" | "err"; card?: Card; err?: string; saved?: "busy" | "ok" | "err"; saveMsg?: string };

const cardCache = new Map<string, Card>();
const bare = (w: string) => w.replace(/[’‘]/g, "'").replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "");

/** Backend trả bản dịch nhanh khi AI không sẵn sàng: phiên âm và cụm từ khi đó là giả, không hiển thị. */
const isQuick = (c: Card) => (c.usage_note || "").startsWith("Tra cứu nhanh");

/**
 * Câu gốc hiển thị thành từng từ bấm được. Bấm một từ để tra nghĩa; giữ Shift và bấm từ khác để tra cả cụm.
 * Nghĩa lấy từ thẻ từ vựng của Studia, có thể lưu thành thẻ ôn tập.
 */
export function Transcript({ text, onSay }: { text: string; onSay: (s: string) => void }) {
  const words = text.split(/\s+/).filter(Boolean);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [look, setLook] = useState<Look | null>(null);

  const lookup = async (a: number, b: number) => {
    const phrase = words.slice(a, b + 1).map(bare).join(" ").trim();
    if (!phrase) return;
    setRange([a, b]);
    const key = phrase.toLowerCase();
    const hit = cardCache.get(key);
    if (hit) { setLook({ phrase, state: "ok", card: hit }); return; }
    setLook({ phrase, state: "busy" });
    try {
      const r = await apiFetch(`${API}/vocabulary/card`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: phrase, source_sentence: text }),
      });
      if (r.status === 401) throw new Error("Đăng nhập để tra nghĩa ngay trong Studia, hoặc mở từ điển Cambridge bên dưới.");
      if (!r.ok) throw new Error("Chưa tra được nghĩa. Thử lại, hoặc mở từ điển Cambridge bên dưới.");
      const card = (await r.json()) as Card;
      cardCache.set(key, card);
      setLook((l) => (l?.phrase === phrase ? { phrase, state: "ok", card } : l));
    } catch (e) {
      setLook((l) => (l?.phrase === phrase ? { phrase, state: "err", err: (e as Error).message } : l));
    }
  };

  const pick = (i: number, shift: boolean) => {
    if (shift && range) lookup(Math.min(range[0], i), Math.max(range[0], i));
    else lookup(i, i);
  };

  const save = async () => {
    if (!look?.card) return;
    const c = look.card;
    setLook({ ...look, saved: "busy" });
    try {
      const r = await apiFetch(`${API}/vocabulary/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: look.phrase, meaning_vi: c.meaning_vi, source_sentence: text,
          example_sentences: c.example_sentences || [], collocations: isQuick(c) ? [] : c.collocations || [],
          pronunciation: isQuick(c) ? "" : c.pronunciation || "", word_type: c.word_type || "noun",
          source: "dictation", create_flashcard: true,
        }),
      });
      if (r.status === 401) throw new Error("Đăng nhập để lưu thẻ ôn tập.");
      if (!r.ok) throw new Error("Chưa lưu được, thử lại sau.");
      setLook((l) => (l ? { ...l, saved: "ok", saveMsg: "Đã lưu vào Thẻ & từ vựng, sẽ xuất hiện trong lịch ôn." } : l));
    } catch (e) {
      setLook((l) => (l ? { ...l, saved: "err", saveMsg: (e as Error).message } : l));
    }
  };

  const inRange = (i: number) => !!range && i >= range[0] && i <= range[1];
  const c = look?.card;
  const quick = c ? isQuick(c) : false;

  return (
    <div>
      <p style={{ font: "500 19px/1.9 var(--font-reading)" }} lang="en">
        {words.map((w, i) => (
          <Fragment key={i}>
            <button type="button" onClick={(e) => pick(i, e.shiftKey)}
              title="Bấm để tra nghĩa · Shift+bấm để chọn cả cụm"
              style={{ all: "unset", cursor: "pointer", borderRadius: 4, padding: "0 1px", background: inRange(i) ? "var(--brand-tint)" : undefined, textDecoration: "underline dotted var(--ink-muted)", textUnderlineOffset: 5 }}>{w}</button>{" "}
          </Fragment>
        ))}
      </p>
      <p className="meta" style={{ marginTop: 4 }}>Bấm vào từ để tra nghĩa. Giữ Shift rồi bấm từ khác để tra cả cụm (vd. “turn left”).</p>

      {look && (
        <div className="st-card" role="region" aria-live="polite" aria-label={`Nghĩa của ${look.phrase}`} style={{ marginTop: 12, padding: 16, background: "var(--surface-sunken)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <div className="row" style={{ gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <b style={{ font: "650 20px/26px var(--font-reading)" }} lang="en">{look.phrase}</b>
              {c?.word_type && !quick && <span className="meta">{c.word_type}</span>}
              {c?.pronunciation && !quick && <span className="meta">{c.pronunciation}</span>}
            </div>
            <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => { setLook(null); setRange(null); }} aria-label="Đóng">Đóng</button>
          </div>
          {look.state === "busy" && <p className="meta" style={{ marginTop: 8 }}>Đang tra nghĩa…</p>}
          {look.state === "err" && <p style={{ marginTop: 8, color: "var(--danger)" }}>{look.err}</p>}
          {c && (
            <>
              <p style={{ marginTop: 8, fontSize: 16 }}><b>{c.meaning_vi}</b></p>
              {c.example_sentences?.[0] && c.example_sentences[0].en !== text && (
                <p className="ink2" style={{ marginTop: 6, fontSize: 14.5 }}><i lang="en">{c.example_sentences[0].en}</i>{c.example_sentences[0].vi ? <> → {c.example_sentences[0].vi}</> : null}</p>
              )}
              {!quick && !!c.collocations?.length && <p className="meta" style={{ marginTop: 6 }}>Cụm hay gặp: {c.collocations.slice(0, 4).join(" · ")}</p>}
              {!quick && c.usage_note && <p className="meta" style={{ marginTop: 6 }}>{c.usage_note}</p>}
            </>
          )}
          <div className="row-wrap" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
            <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => onSay(look.phrase)}>Nghe phát âm</button>
            {c && (
              <button type="button" className="st-btn st-btn-primary st-btn-sm" disabled={look.saved === "busy" || look.saved === "ok"} onClick={save}>
                {look.saved === "ok" ? "Đã lưu" : look.saved === "busy" ? "Đang lưu…" : "Lưu vào thẻ ôn tập"}
              </button>
            )}
            <a className="st-btn st-btn-ghost st-btn-sm" target="_blank" rel="noopener noreferrer"
              href={`https://dictionary.cambridge.org/dictionary/english-vietnamese/${encodeURIComponent(look.phrase.toLowerCase().replace(/\s+/g, "-"))}`}>
              Mở từ điển Cambridge ↗
            </a>
          </div>
          {look.saveMsg && <p className="meta" style={{ marginTop: 8, color: look.saved === "err" ? "var(--danger)" : undefined }}>{look.saveMsg}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- Nối âm, nuốt âm ---------- */

const KIND_STYLE: Record<LinkNote["kind"], string> = {
  link: "st-badge-success", "link-r": "st-badge-success", elide: "st-badge-danger", assim: "st-badge-warning", reduce: "st-badge-warning", weak: "",
};

/** Các chỗ nối âm, nuốt âm trong đoạn; bấm cụm để nghe chậm. */
export function LinkNotes({ text, onSay }: { text: string; onSay: (s: string) => void }) {
  const notes = connectedSpeech(text);
  if (!notes.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <p className="st-field-label" style={{ marginBottom: 4 }}>Nối âm, nuốt âm trong đoạn này</p>
      <p className="meta" style={{ marginBottom: 10 }}>Đây là những chỗ người bản xứ đọc liền hoặc đọc nhẹ, nguyên nhân phổ biến khiến bạn nghe sót. Bấm cụm để nghe chậm 0.5×.</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {notes.map((n) => (
          <li key={n.phrase + n.kind} className="row" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span className={`st-badge ${KIND_STYLE[n.kind]}`} style={{ minWidth: 76, justifyContent: "center" }}>{LINK_LABEL[n.kind]}</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <button type="button" onClick={() => onSay(n.phrase)} title="Bấm để nghe chậm"
                style={{ all: "unset", cursor: "pointer", font: "600 16px/22px var(--font-reading)", textDecoration: "underline dotted var(--ink-muted)", textUnderlineOffset: 4 }} lang="en">
                {n.phrase}
              </button>
              <span className="meta" style={{ marginLeft: 8 }} lang="en">{n.sound}</span>
              <div className="ink2" style={{ fontSize: 13.5, marginTop: 2 }}>{n.note}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Nguồn luyện tập ---------- */

const SOURCES: { name: string; href: string; level: string; how: string }[] = [
  { name: "BBC Learning English · 6 Minute English", href: "https://www.bbc.co.uk/learningenglish/english/features/6-minute-english", level: "5.0–6.5", how: "Mỗi tập có transcript PDF kèm theo. Chép transcript dán vào mục “Của bạn”." },
  { name: "TED-Ed (YouTube)", href: "https://www.youtube.com/@TEDEd", level: "6.0–7.5", how: "Video 4–6 phút, giọng chuẩn. Mở “Hiện bản chép lời”, chép cả mốc thời gian để nghe audio thật." },
  { name: "BBC Learning English (YouTube)", href: "https://www.youtube.com/@bbclearningenglish", level: "4.5–6.5", how: "Các chuỗi ngắn như News Review, English at Work. Có phụ đề chuẩn, dùng được chế độ YouTube." },
  { name: "VOA Learning English", href: "https://learningenglish.voanews.com/", level: "4.0–5.5", how: "Tin tức đọc chậm, có sẵn bài viết. Hợp để bắt đầu ở 0.75×–1×." },
  { name: "IELTS chính thức · bài nghe mẫu", href: "https://ielts.org/take-a-test/preparation-resources/sample-test-questions/listening-test", level: "Đề thi", how: "Audio và audioscript chính thức. Chép audioscript từng Part vào “Của bạn”." },
  { name: "British Council · Take IELTS", href: "https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/listening", level: "Đề thi", how: "Bài luyện nghe miễn phí có đáp án và transcript." },
];

export function Sources({ onUse }: { onUse: () => void }) {
  return (
    <section className="st-card" style={{ padding: 24 }} aria-labelledby="dc-src">
      <div className="sec-head">
        <h2 id="dc-src" className="sec-title">Nguồn luyện tập</h2>
        <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={onUse}>Dán transcript của bạn</button>
      </div>
      <p className="ink2" style={{ fontSize: 14.5, marginBottom: 12 }}>
        Chọn bài ở các nguồn dưới đây, chép transcript vào mục <b>Của bạn</b>. Nếu là video YouTube, dán thêm link và transcript có mốc thời gian (0:12, 0:15…) để nghe giọng thật thay vì giọng máy.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {SOURCES.map((s) => (
          <li key={s.href}>
            <a href={s.href} target="_blank" rel="noopener noreferrer" style={{ font: "600 15px/22px var(--font-sans)", color: "var(--brand)" }}>{s.name} ↗</a>
            <span className="st-badge" style={{ marginLeft: 8 }}>{s.level}</span>
            <div className="meta">{s.how}</div>
          </li>
        ))}
      </ul>
      <details style={{ marginTop: 14 }}>
        <summary className="st-field-label" style={{ cursor: "pointer" }}>Cách lấy transcript có mốc thời gian từ YouTube</summary>
        <ol className="ink2" style={{ fontSize: 14, paddingLeft: 20, marginTop: 8, display: "grid", gap: 4 }}>
          <li>Mở video trên máy tính, bấm <b>…Thêm</b> trong phần mô tả rồi chọn <b>Hiện bản chép lời</b>.</li>
          <li>Bôi đen toàn bộ bản chép lời ở khung bên phải (giữ nguyên các mốc 0:00, 0:04…) và sao chép.</li>
          <li>Ở mục <b>Của bạn</b>, dán link video vào ô “Link YouTube” và dán bản chép lời vào ô văn bản, rồi bấm tách.</li>
          <li>Ưu tiên video có phụ đề do người làm (không phải “tự động tạo”) để transcript chính xác.</li>
        </ol>
      </details>
    </section>
  );
}
