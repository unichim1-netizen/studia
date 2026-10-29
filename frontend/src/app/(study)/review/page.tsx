"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";

import { API, apiFetch } from "@/lib/api";

export default function ReviewQueuePage() {
  const [reviewItems, setReviewItems] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);

  const [loadError, setLoadError] = useState("");
  useEffect(() => { fetchQueue(); }, []);

  const fetchStatsOnly = async () => {
    try {
      const r = await apiFetch(`${API}/reviews/stats`);
      if (r.ok) setStats(await r.json());
    } catch {}
  };

  const fetchQueue = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [queueRes, statsRes] = await Promise.all([
        apiFetch(`${API}/reviews/queue`),
        apiFetch(`${API}/reviews/stats`)
      ]);
      if (queueRes.ok) { const d = await queueRes.json(); setReviewItems(d.review_items || []); }
      if (statsRes.ok) setStats(await statsRes.json());
      if (!queueRes.ok) setLoadError("Không tải được danh sách ôn tập.");
    } catch {
      setLoadError("Không kết nối được máy chủ.");
    }
    setLoading(false);
  };

  const completeReview = async (topicId: string, rating: number) => {
    setCompleting(topicId);
    try {
      const res = await apiFetch(`${API}/reviews/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: topicId, rating })
      });
      if (res.ok) {
        setReviewItems(prev => prev.filter(r => r.topic_id !== topicId));
        fetchStatsOnly();
      } else {
        setLoadError("Không lưu được kết quả ôn tập, hãy thử lại.");
      }
    } catch {
      setLoadError("Không kết nối được máy chủ.");
    }
    setCompleting(null);
  };

  const GROUPS = [
    { key: "High", title: "Đã đến hạn", color: "var(--danger)", badge: "st-badge st-badge-danger", bar: "var(--danger)" },
    { key: "Medium", title: "Trong hôm nay", color: "var(--warning)", badge: "st-badge st-badge-warning", bar: "var(--warning)" },
    { key: "Low", title: "Sắp tới", color: "var(--ink-muted)", badge: "st-badge", bar: "var(--brand)" },
  ];
  const first = reviewItems[0];

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Ôn tập</h1>
          <p className="page-sub">Studia dự đoán lúc bạn sắp quên một chủ đề và nhắc ôn đúng lúc đó.</p>
        </div>
        <div className="row" style={{ gap: 14 }}>
          {stats?.avg_retention != null && (
            <div style={{ textAlign: "right" }}><div className="meta">Ghi nhớ trung bình</div><b className="num" style={{ font: "700 28px/32px var(--font-display)" }}>{Number(stats.avg_retention).toFixed(0)}%</b></div>
          )}
          <span style={{ width: 1, height: 40, background: "var(--hairline)" }} />
          <div style={{ textAlign: "right" }}><div className="meta">Đến hạn</div><b className="num" style={{ font: "700 28px/32px var(--font-display)", color: reviewItems.length ? "var(--accent-strong)" : "var(--ink)" }}>{reviewItems.length}</b></div>
          {first && <Link className="st-btn st-btn-primary" href={`/quiz/${first.topic_id}`} style={{ marginLeft: 6 }}>Ôn chủ đề đầu tiên</Link>}
        </div>
      </header>

      {loadError && (
        <div role="alert" className="st-alert st-alert-danger" style={{ justifyContent: "space-between" }}>
          <span>{loadError}</span>
          <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={fetchQueue}>Tải lại</button>
        </div>
      )}

      {loading ? (
        <div className="stack" style={{ gap: 12 }}>{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 76 }} />)}</div>
      ) : reviewItems.length === 0 ? (
        <EmptyState
          title="Chưa có chủ đề nào đến hạn ôn"
          description="Hàng đợi này chỉ hiện chủ đề bạn đã học và sắp quên. Làm thêm quiz để hệ thống có dữ liệu xếp lịch."
          steps={[
            { title: "Học một bài mới", desc: "Chọn tài liệu trong thư viện", href: "/books" },
            { title: "Làm quiz cuối bài", desc: "Điểm quiz quyết định khi nào bạn cần ôn lại" },
          ]}
          primary={{ label: "Mở thư viện", href: "/books" }}
          secondary={{ label: "Về trang chính", href: "/" }}
        />
      ) : (
        <section className="st-card" style={{ padding: 0, overflow: "hidden" }} aria-label="Danh sách chủ đề cần ôn">
          {GROUPS.map(g => {
            const items = reviewItems.filter((it: any) => (it.urgency || "Low") === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key}>
                <div className="eyebrow" style={{ padding: "14px 20px 8px", background: "var(--surface-sunken)", color: g.color }}>{g.title} · {items.length}</div>
                {items.map((item: any, i: number) => {
                  const busy = completing === item.topic_id;
                  return (
                    <div key={item.topic_id || i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(120px,170px) auto", gap: 20, alignItems: "center", padding: "16px 20px", borderTop: i ? "1px solid var(--hairline)" : "none" }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="lrow-title">{item.topic_name}</div>
                        <div className="row-wrap" style={{ marginTop: 4 }}>
                          <span className={g.badge}>{item.scheduled_for}</span>
                          <span className="meta num">Thành thạo {Number(item.mastery_score || 0).toFixed(0)}%</span>
                        </div>
                      </div>
                      <div>
                        <div className="bar"><i style={{ width: `${item.retention_score || 0}%`, background: g.bar }} /></div>
                        <div className="meta num" style={{ marginTop: 4 }}>Ghi nhớ {Number(item.retention_score || 0).toFixed(0)}%</div>
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="st-btn st-btn-ghost st-btn-sm" type="button" disabled={busy} onClick={() => completeReview(item.topic_id, 4)} title="Đánh dấu đã nhớ tốt, không cần quiz">{busy ? <span className="st-spinner" /> : "Đã nhớ"}</button>
                        <Link className={g.key === "High" ? "st-btn st-btn-primary st-btn-sm" : "st-btn st-btn-secondary st-btn-sm"} href={`/quiz/${item.topic_id}`}>Ôn ngay</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>
      )}
      <p className="meta">Ghi nhớ là khả năng bạn còn nhớ chủ đề hôm nay. Dưới 70% là lúc nên ôn: ôn đúng lúc này giúp nhớ lâu nhất với ít thời gian nhất.</p>
    </div>
  );
}
