"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { API, apiFetch } from "@/lib/api";
import { ChevronLeft, Check } from "lucide-react";

interface CreatedCardSummary {
  id: string;
  front: string;
  back: string;
  topic_name: string;
  card_type: string;
}

export default function FlashcardNewPage() {
  const router = useRouter();

  const [deckName, setDeckName] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [cardType, setCardType] = useState("concept");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [createdSessionCards, setCreatedSessionCards] = useState<CreatedCardSummary[]>([]);

  const submitCard = async (redirectAfter: boolean) => {
    if (!front.trim() || !back.trim()) {
      setMsg({ type: "error", text: "Vui lòng nhập đầy đủ cả Mặt trước và Mặt sau của thẻ." });
      return;
    }

    setLoading(true);
    setMsg(null);

    const finalDeck = deckName.trim() || "Bộ thẻ tùy chỉnh";

    try {
      const res = await apiFetch(`${API}/flashcards/custom-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          front: front.trim(),
          back: back.trim(),
          topic_name: finalDeck,
          card_type: cardType,
          source_chunk: "Tự tạo bởi người dùng"
        })
      });

      const data = await res.json();

      if (res.ok && data.flashcard) {
        const newCard: CreatedCardSummary = {
          id: data.flashcard.id,
          front: data.flashcard.front,
          back: data.flashcard.back,
          topic_name: data.flashcard.topic_name || finalDeck,
          card_type: data.flashcard.card_type || cardType
        };

        setCreatedSessionCards(prev => [newCard, ...prev]);
        setFront("");
        setBack("");
        setMsg({ type: "success", text: `Đã lưu thẻ thành công vào bộ "${newCard.topic_name}"!` });

        if (redirectAfter) {
          setTimeout(() => {
            router.push("/flashcards");
          }, 800);
        }
      } else {
        setMsg({ type: "error", text: data.detail || "Không thể tạo thẻ flashcard. Vui lòng thử lại." });
      }
    } catch {
      setMsg({ type: "error", text: "Không thể kết nối. Vui lòng thử lại sau." });
    } finally {
      setLoading(false);
    }
  };

  const TYPES = [
    { v: "definition", t: "Định nghĩa từ", d: "Từ ↔ nghĩa, ví dụ" },
    { v: "concept", t: "Khái niệm", d: "Một ý cần nhớ" },
    { v: "question", t: "Câu hỏi & đáp án", d: "Hỏi – đáp ngắn" },
    { v: "fill_blank", t: "Điền chỗ trống", d: "Câu có ___ cần điền" },
  ];
  const backLines = back.split("\n");

  return (
    <div className="wrap stagger">
      <header>
        <Link className="crumb" href="/flashcards"><ChevronLeft size={16} strokeWidth={2} />Ôn flashcard</Link>
        <h1 className="page-title">Tạo thẻ mới</h1>
        <p className="page-sub">Thẻ mới vào hàng đợi ôn ngay hôm nay.</p>
      </header>

      {msg && (
        <div role={msg.type === "error" ? "alert" : "status"} className="st-enter row" style={{ fontWeight: 550 }}>
          {msg.type === "success" ? <Check size={18} strokeWidth={2.4} /> : null}{msg.text}
        </div>
      )}

      <div className="split" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(300px, 1fr)" }}>
        <form className="st-card stack" style={{ gap: 20 }} aria-label="Thông tin thẻ" onSubmit={(e) => { e.preventDefault(); submitCard(false); }}>
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="field-label" style={{ marginBottom: 8 }}>Loại thẻ</legend>
            <div role="radiogroup" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              {TYPES.map((t) => {
                const on = cardType === t.v;
                return (
                  <button key={t.v} type="button" role="radio" aria-checked={on} onClick={() => setCardType(t.v)}
                    style={{ display: "flex", flexDirection: "column", gap: 2, padding: "12px 14px", borderRadius: "var(--radius-md)", border: `1.5px solid ${on ? "var(--brand)" : "var(--hairline)"}`, background: on ? "var(--brand-tint)" : "var(--surface)", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", transition: "border-color var(--dur-fast), background-color var(--dur-fast)" }}>
                    <b style={{ font: "600 14.5px/20px var(--font-sans)" }}>{t.t}</b><span className="meta">{t.d}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="field"><span className="field-label">Mặt trước <span style={{ color: "var(--danger)" }} aria-hidden="true">*</span></span>
            <input className="input" value={front} onChange={(e) => setFront(e.target.value)} required placeholder="Ví dụ: resilient" />
            <span className="meta">Từ, cụm từ hoặc câu hỏi.</span>
          </label>
          <label className="field"><span className="field-label">Mặt sau <span style={{ color: "var(--danger)" }} aria-hidden="true">*</span></span>
            <textarea className="input" rows={4} value={back} onChange={(e) => setBack(e.target.value)} required placeholder={"kiên cường, nhanh phục hồi\nCoastal cities must become more resilient to flooding."} />
            <span className="meta">Dòng đầu là nghĩa; các dòng sau là ví dụ.</span>
          </label>
          <label className="field"><span className="field-label">Bộ thẻ</span>
            <input className="input" value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="Để trống = “Bộ thẻ tùy chỉnh”" />
          </label>

          <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
            <button className="st-btn st-btn-ghost" type="button" disabled={loading} onClick={() => submitCard(true)}>Lưu &amp; quay lại ôn</button>
            <button className="st-btn st-btn-primary" type="submit" disabled={loading} aria-busy={loading || undefined}>{loading ? <><span className="st-spinner" /> Đang lưu…</> : "Lưu & tạo thẻ tiếp"}</button>
          </div>
        </form>

        <aside className="stack" style={{ gap: 12 }} aria-label="Xem trước">
          <div className="eyebrow">Xem trước</div>
          <div className="st-card" style={{ minHeight: 150, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 6, boxShadow: "var(--shadow-sm)", borderRadius: "var(--radius-lg)" }}>
            <span className="meta">Mặt trước</span>
            <div style={{ font: "700 32px/1.15 var(--font-display)", letterSpacing: "-0.8px", color: front ? "var(--ink)" : "var(--ink-muted)", wordBreak: "break-word" }}>{front || "resilient"}</div>
          </div>
          <div className="st-card" style={{ minHeight: 150, display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, boxShadow: "var(--shadow-sm)", borderRadius: "var(--radius-lg)" }}>
            <span className="meta">Mặt sau</span>
            <div style={{ font: "650 20px/28px var(--font-display)", color: back ? "var(--ink)" : "var(--ink-muted)" }}>{backLines[0] || "kiên cường, nhanh phục hồi"}</div>
            {backLines.slice(1).filter(Boolean).length > 0 && <div className="passage-sm ink2" style={{ paddingLeft: 14, borderLeft: "2px solid var(--marker)", fontStyle: "italic" }}>{backLines.slice(1).filter(Boolean).join(" ")}</div>}
          </div>
          {createdSessionCards.length > 0 && (
            <section className="st-card" aria-labelledby="made-h">
              <h2 id="made-h" className="heading-3" style={{ marginBottom: 8 }}>Vừa tạo ({createdSessionCards.length})</h2>
              <div className="stack" style={{ gap: 0 }}>
                {createdSessionCards.slice(0, 6).map((c, i) => (
                  <div key={c.id} className="row" style={{ padding: "8px 0", borderTop: i ? "1px solid var(--hairline)" : "none" }}>
                    <b style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.front}</b>
                    <span className="spacer" /><span className="meta" style={{ whiteSpace: "nowrap" }}>{c.topic_name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <p className="meta">Mẹo: bôi đen một từ khi đọc sách để tạo thẻ nhanh hơn, có sẵn câu ví dụ gốc.</p>
        </aside>
      </div>
    </div>
  );
}
