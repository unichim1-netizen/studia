"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import { API, apiFetch } from "@/lib/api";

type Mistake = {
  id: string;
  topic_id?: string | null;
  error_type?: string;
  error_detail?: string;
  user_input?: string | null;
  correct_form?: string | null;
  context_sentence?: string | null;
  source?: string;
  occurrence_count?: number;
  last_seen_at?: string;
};

const TYPES: Record<string, { label: string; badge: string }> = {
  grammar: { label: "Ngữ pháp", badge: "st-badge st-badge-accent" },
  vocabulary: { label: "Từ vựng", badge: "st-badge st-badge-brand" },
  comprehension: { label: "Hiểu bài", badge: "st-badge st-badge-warning" },
  pronunciation: { label: "Phát âm", badge: "st-badge" },
  sentence_structure: { label: "Cấu trúc câu", badge: "st-badge st-badge-success" },
};
const SOURCES: Record<string, string> = { quiz: "Quiz", scenario: "Hội thoại", flashcard: "Flashcard", speech: "Luyện phát âm" };

function ago(iso?: string) {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "Hôm nay";
  if (d === 1) return "Hôm qua";
  if (d < 7) return `${d} ngày trước`;
  return `${Math.floor(d / 7)} tuần trước`;
}

export default function MistakesPage() {
  const [items, setItems] = useState<Mistake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [type, setType] = useState("all");
  const [source, setSource] = useState("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API}/quizzes/recurring-mistakes?min_occurrences=1&limit=100`);
      if (res.ok) setItems(((await res.json()).top_errors as Mistake[]) || []);
      else setError("Không tải được sổ lỗi sai.");
    } catch {
      setError("Không kết nối được máy chủ.");
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    items.forEach((m) => { const k = m.error_type || "other"; c[k] = (c[k] || 0) + 1; });
    return c;
  }, [items]);

  const shown = items.filter((m) => (type === "all" || m.error_type === type) && (source === "all" || m.source === source));
  const repeating = items.filter((m) => (m.occurrence_count || 1) >= 2).length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const firstTopic = items.find((m) => picked.has(m.id) && m.topic_id)?.topic_id;

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Sổ lỗi sai</h1>
          <p className="page-sub">Mọi lỗi từ quiz, hội thoại và luyện phát âm, gom lại để bạn luyện đúng chỗ hay sai.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="meta">Đang lặp lại</div>
          <b className="num" style={{ font: "700 28px/32px var(--font-display)", color: "var(--accent-strong)" }}>{repeating}</b>
        </div>
      </header>

      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 12 }}>
        <div className="row-wrap" role="group" aria-label="Lọc theo loại" style={{ gap: 6 }}>
          <button className="st-chip" type="button" aria-pressed={type === "all"} onClick={() => setType("all")}>
            Tất cả <span className="st-chip-count">{items.length}</span>
          </button>
          {Object.keys(counts).map((k) => (
            <button key={k} className="st-chip" type="button" aria-pressed={type === k} onClick={() => setType(k)}>
              {TYPES[k]?.label || k} <span className="st-chip-count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <select className="input" style={{ width: 170, height: 40 }} aria-label="Nguồn" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">Mọi nguồn</option>
          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {error && (
        <div role="alert" className="st-alert st-alert-danger" style={{ justifyContent: "space-between" }}>
          <span>{error}</span>
          <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={load}>Tải lại</button>
        </div>
      )}

      {loading ? (
        <div className="stack">{[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState
          title="Chưa có lỗi nào được ghi lại"
          description="Khi bạn làm quiz hoặc luyện hội thoại, các lỗi sai sẽ được lưu ở đây."
          primary={{ label: "Luyện hội thoại", href: "/scenarios" }}
          secondary={{ label: "Về trang chính", href: "/" }}
        />
      ) : (
        <div className="table-box">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 44 }}><span className="st-sr">Chọn</span></th>
                <th scope="col">Lỗi và cách sửa</th>
                <th scope="col">Loại</th>
                <th scope="col">Nguồn</th>
                <th scope="col">Số lần</th>
                <th scope="col">Gần nhất</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td><input type="checkbox" aria-label="Chọn lỗi" checked={picked.has(m.id)} onChange={() => toggle(m.id)} /></td>
                  <td style={{ color: "var(--ink)" }}>
                    {m.user_input || m.correct_form ? (
                      <div style={{ fontFamily: "var(--font-reading)", fontSize: 15.5 }}>
                        {m.user_input && <s style={{ color: "var(--danger)", textDecorationThickness: 2 }}>{m.user_input}</s>}{" "}
                        {m.correct_form && <ins style={{ color: "var(--success)", textDecoration: "none", fontWeight: 600, background: "var(--success-tint)", padding: "0 4px", borderRadius: 3 }}>{m.correct_form}</ins>}
                      </div>
                    ) : null}
                    <div className="meta">{m.error_detail}</div>
                  </td>
                  <td><span className={TYPES[m.error_type || ""]?.badge || "st-badge"}>{TYPES[m.error_type || ""]?.label || "Khác"}</span></td>
                  <td>{SOURCES[m.source || ""] || m.source}</td>
                  <td className="num"><b style={{ color: "var(--ink)" }}>{m.occurrence_count || 1}</b></td>
                  <td>{ago(m.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picked.size > 0 && (
        <div role="region" aria-label="Thao tác với lỗi đã chọn" className="row"
          style={{ position: "sticky", bottom: 16, padding: "12px 16px 12px 20px", borderRadius: "var(--radius-lg)", background: "var(--navy)", color: "var(--on-navy)", boxShadow: "var(--shadow-lg)" }}>
          <b className="num" style={{ fontWeight: 600 }}>Đã chọn {picked.size} lỗi</b>
          <span className="spacer" />
          <button className="st-btn st-btn-ghost st-btn-sm" type="button" style={{ color: "var(--on-navy)" }} onClick={() => setPicked(new Set())}>Bỏ chọn</button>
          <Link className="st-btn st-btn-accent st-btn-sm" href={firstTopic ? `/quiz/${firstTopic}` : "/feedback"}>Tạo bài tập từ {picked.size} lỗi</Link>
        </div>
      )}
    </div>
  );
}
