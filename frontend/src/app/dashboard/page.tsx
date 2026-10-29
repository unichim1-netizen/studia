"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";

import { API, apiFetch } from "@/lib/api";
import CountUp from "@/components/CountUp";

export default function DashboardPage() {
  const [profile, setProfile] = useState<any>(null);
  const [weakTopics, setWeakTopics] = useState<any[]>([]);
  const [reviewStats, setReviewStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [todayRes, weakRes, statsRes] = await Promise.all([
        apiFetch(`${API}/learning-paths/today`),
        apiFetch(`${API}/quizzes/weak-topics`),
        apiFetch(`${API}/reviews/stats`)
      ]);
      if (todayRes.ok) { const d = await todayRes.json(); setProfile(d.knowledge_profile); }
      if (weakRes.ok) { const d = await weakRes.json(); setWeakTopics(d.weak_topics || []); }
      if (statsRes.ok) setReviewStats(await statsRes.json());
    } catch {}
    setLoading(false);
  };

  const masteredCount = profile?.mastered_count || 0;
  const totalTopics = profile?.total_topics || 0;
  const overallMastery = profile?.overall_mastery || 0;
  const avgRetention = reviewStats?.avg_retention || 0;

  return <ProgressView profile={profile} weakTopics={weakTopics} loading={loading} overallMastery={overallMastery} masteredCount={masteredCount} totalTopics={totalTopics} avgRetention={avgRetention} />;
}

const barColor = (v: number) => v >= 80 ? "var(--success)" : v >= 50 ? "var(--brand)" : v >= 30 ? "var(--accent-strong)" : "var(--danger)";

function ProgressView({ profile, weakTopics, loading, overallMastery, masteredCount, totalTopics, avgRetention }: any) {
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    apiFetch(`${API}/exam/sessions?limit=5`).then(async (r) => {
      if (r.ok) setHistory(((await r.json()).sessions || []).filter((s: any) => s.status === "SUBMITTED" || s.status === "AUTO_SUBMITTED"));
    }).catch(() => {});
  }, []);
  const topics: any[] = [...(profile?.topics || [])].sort((a, b) => a.mastery_score - b.mastery_score);
  const weakest = weakTopics[0];

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Tiến độ của bạn</h1>
          <p className="page-sub">Tổng hợp từ bài học, quiz, flashcard và các lần thi thử.</p>
        </div>
      </header>

      <section className="grid-4" aria-label="Số liệu chính">
        {loading ? [1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 120 }} />) : (
          <>
            <div className="st-stat"><div className="st-stat-top">Mức thành thạo</div><div className="st-stat-value"><CountUp value={overallMastery} /><small>%</small></div><div className="st-stat-hint">Trung bình mọi chủ đề</div></div>
            <div className="st-stat"><div className="st-stat-top">Chủ đề đã vững</div><div className="st-stat-value">{masteredCount}<small>/ {totalTopics}</small></div><div className="st-stat-hint">{Math.max(totalTopics - masteredCount, 0)} chủ đề cần học thêm</div></div>
            <div className="st-stat st-stat-success"><div className="st-stat-top">Tỷ lệ ghi nhớ</div><div className="st-stat-value"><CountUp value={avgRetention} /><small>%</small></div><div className="st-stat-hint">Khả năng còn nhớ hôm nay</div></div>
            <div className="st-stat st-stat-accent"><div className="st-stat-top">Cần ôn tập</div><div className="st-stat-value">{weakTopics.length}</div><div className="st-stat-hint"><Link href="/review">Mở hàng đợi ôn tập</Link></div></div>
          </>
        )}
      </section>

      <div className="split">
        <section aria-labelledby="t-h">
          <div className="sec-head"><h2 id="t-h" className="sec-title">Theo chủ đề</h2><span className="meta">Thành thạo thấp trước</span></div>
          {loading ? <div className="skeleton" style={{ height: 280 }} /> : topics.length === 0 ? (
            <EmptyState compact title="Chưa có dữ liệu thành thạo" description="Học một chủ đề và làm quiz để thấy tiến độ ở đây." primary={{ label: "Thêm tài liệu", href: "/books" }} />
          ) : (
            <div className="table-box">
              <table className="table">
                <thead><tr><th scope="col">Chủ đề</th><th scope="col" style={{ width: "42%" }}>Thành thạo</th><th scope="col">Trạng thái</th></tr></thead>
                <tbody>
                  {topics.map((t, i) => (
                    <tr key={i}>
                      <td style={{ color: "var(--ink)", fontWeight: 600 }}>{t.topic_name}</td>
                      <td><div className="row"><div className="bar" style={{ flex: 1 }}><i style={{ width: `${t.mastery_score}%`, background: barColor(t.mastery_score) }} /></div><b className="num" style={{ color: barColor(t.mastery_score), width: 40, textAlign: "right" }}>{Number(t.mastery_score).toFixed(0)}%</b></div></td>
                      <td>{t.mastery_score >= 80 ? <span className="st-badge st-badge-success">Đã vững</span> : t.mastery_score < 50 ? <span className="st-badge st-badge-warning">Cần ôn</span> : <span className="st-badge">Đang học</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="meta" style={{ marginTop: 10 }}>Thành thạo tính từ điểm quiz và bài tập. Ghi nhớ là khả năng bạn còn nhớ hôm nay, theo lịch ôn lặp lại ngắt quãng.</p>
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="st-card" aria-labelledby="b-h">
            <div className="sec-head" style={{ marginBottom: 12 }}><h2 id="b-h" className="heading-3">Các lần thi thử</h2><Link className="link" href="/exam">Thi đề mới</Link></div>
            {history.length === 0 ? <p className="meta">Chưa có bài thi đã nộp.</p> : (
              <div className="stack" style={{ gap: 0 }}>
                {history.map((h, i) => (
                  <Link key={h.session_id} href={`/exam/${h.session_id}`} className="row" style={{ textDecoration: "none", color: "inherit", padding: "12px 0", borderBottom: i < history.length - 1 ? "1px solid var(--hairline)" : "none" }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="title" style={{ display: "block", fontSize: 15 }}>{h.title || "Bài thi thử"}</span>
                      {h.created_at && <span className="meta">{new Date(h.created_at).toLocaleDateString("vi-VN")}</span>}
                    </span>
                    <b className="num" style={{ font: "700 24px/1 var(--font-display)", color: "var(--ink)" }}>{h.overall_band ?? "—"}</b>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {weakest && (
            <section className="navy-block" aria-labelledby="n-h">
              <h2 id="n-h" className="heading-3" style={{ color: "var(--on-navy)" }}>Ưu tiên tuần này</h2>
              <p style={{ marginTop: 8, opacity: 0.9 }}>“{weakest.topic_name}” đang thấp nhất ({Number(weakest.mastery_score).toFixed(0)}%). Ôn lại chủ đề này trước sẽ kéo điểm trung bình lên nhanh nhất.</p>
              <Link className="st-btn st-btn-accent" href="/review" style={{ marginTop: 16 }}>Ôn ngay</Link>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
