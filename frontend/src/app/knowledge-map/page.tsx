"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import { API, apiFetch } from "@/lib/api";

type GNode = { id: string; name: string; description?: string; mastery: number; retention: number };
type GEdge = { source: string; target: string };

const W = 720;
const H = 520;

function tone(m: number, started: boolean) {
  if (!started) return { fill: "var(--surface)", stroke: "var(--border-control)", dash: "4 4", color: "var(--ink-muted)" };
  if (m >= 80) return { fill: "var(--success-tint)", stroke: "var(--success)", dash: undefined, color: "var(--success)" };
  if (m < 50) return { fill: "var(--accent-tint)", stroke: "var(--accent-strong)", dash: undefined, color: "var(--accent-strong)" };
  return { fill: "var(--brand-tint)", stroke: "var(--brand)", dash: undefined, color: "var(--brand)" };
}

export default function KnowledgeMapPage() {
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`${API}/learning-paths/graph`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const d = await r.json();
        setNodes(d.nodes || []);
        setEdges(d.edges || []);
      })
      .catch(() => setError("Không tải được bản đồ kiến thức."))
      .finally(() => setLoading(false));
  }, []);

  // Xếp tầng theo độ sâu tiền đề: cột trái là gốc, cột phải là chủ đề phụ thuộc.
  const layout = useMemo(() => {
    const depth: Record<string, number> = {};
    nodes.forEach((n) => (depth[n.id] = 0));
    for (let pass = 0; pass < nodes.length; pass++) {
      let changed = false;
      edges.forEach((e) => {
        if (depth[e.source] != null && depth[e.target] != null && depth[e.target] < depth[e.source] + 1 && depth[e.source] < nodes.length) {
          depth[e.target] = depth[e.source] + 1; changed = true;
        }
      });
      if (!changed) break;
    }
    const cols = Math.max(1, Math.max(0, ...Object.values(depth)) + 1);
    const byCol: Record<number, GNode[]> = {};
    nodes.forEach((n) => (byCol[depth[n.id]] ||= []).push(n));
    const pos: Record<string, { x: number; y: number }> = {};
    Object.entries(byCol).forEach(([c, list]) => {
      list.forEach((n, i) => {
        pos[n.id] = {
          x: cols === 1 ? W / 2 : 70 + (Number(c) * (W - 140)) / (cols - 1),
          y: ((i + 1) * H) / (list.length + 1),
        };
      });
    });
    return pos;
  }, [nodes, edges]);

  const selected = nodes.find((n) => n.id === sel) || nodes[0];
  const before = selected ? edges.filter((e) => e.target === selected.id).map((e) => nodes.find((n) => n.id === e.source)).filter(Boolean) as GNode[] : [];
  const after = selected ? edges.filter((e) => e.source === selected.id).map((e) => nodes.find((n) => n.id === e.target)).filter(Boolean) as GNode[] : [];
  const counts = {
    strong: nodes.filter((n) => n.mastery >= 80).length,
    weak: nodes.filter((n) => n.mastery > 0 && n.mastery < 50).length,
    fresh: nodes.filter((n) => n.mastery === 0).length,
  };

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Tiến độ của bạn</h1>
          <p className="page-sub">Mỗi chấm là một chủ đề. Mũi tên chỉ chủ đề nên học trước.</p>
        </div>
      </header>

      {error && <div role="alert" className="st-alert st-alert-danger">{error}</div>}

      {loading ? (
        <div className="skeleton" style={{ height: 420 }} />
      ) : nodes.length === 0 ? (
        <EmptyState title="Chưa có chủ đề nào" description="Tải một cuốn sách lên thư viện, Studia sẽ tự tách chủ đề và dựng bản đồ."
          primary={{ label: "Mở thư viện", href: "/books" }} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" }}>
          <section className="st-card" style={{ padding: 16, gridColumn: "span 2" }} aria-label="Bản đồ chủ đề">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: "100%", height: "auto", display: "block" }}
              aria-label={`Bản đồ ${nodes.length} chủ đề: ${counts.strong} đã vững, ${counts.weak} cần củng cố, ${counts.fresh} chưa học`}>
              <defs>
                <marker id="km-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--border-control)" /></marker>
              </defs>
              {edges.map((e, i) => {
                const a = layout[e.source], b = layout[e.target];
                if (!a || !b) return null;
                const mx = (a.x + b.x) / 2;
                return <path key={i} d={`M${a.x + 38} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - 40} ${b.y}`} fill="none" stroke="var(--border-control)" strokeWidth={2} markerEnd="url(#km-ah)" />;
              })}
              {nodes.map((n) => {
                const p = layout[n.id]; if (!p) return null;
                const t = tone(n.mastery, n.mastery > 0);
                const on = selected?.id === n.id;
                return (
                  <g key={n.id} tabIndex={0} role="button" aria-label={`${n.name}, ${Math.round(n.mastery)}%`} style={{ cursor: "pointer", outline: "none" }}
                    onClick={() => setSel(n.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(n.id)}>
                    <circle cx={p.x} cy={p.y} r={34} fill={t.fill} stroke={t.stroke} strokeWidth={on ? 4 : 2} strokeDasharray={t.dash} />
                    <text x={p.x} y={p.y + 5} textAnchor="middle" style={{ font: "650 12px var(--font-sans)", fill: "var(--ink-muted)" }}>
                      {n.mastery > 0 ? `${Math.round(n.mastery)}%` : "—"}
                    </text>
                    <text x={p.x} y={p.y - 44} textAnchor="middle" style={{ font: "600 13px var(--font-sans)", fill: "var(--ink)" }}>
                      {n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="row-wrap" style={{ gap: 18, padding: "8px 8px 4px", fontSize: 13, color: "var(--ink-secondary)" }}>
              {[
                ["var(--success-tint)", "var(--success)", "Đã vững ≥ 80%"],
                ["var(--brand-tint)", "var(--brand)", "Đang học"],
                ["var(--accent-tint)", "var(--accent-strong)", "Cần củng cố < 50%"],
                ["var(--surface)", "var(--border-control)", "Chưa học"],
              ].map(([bg, bd, label]) => (
                <span key={label} className="row" style={{ gap: 6 }}>
                  <i style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${bd}`, background: bg }} />{label}
                </span>
              ))}
            </div>
          </section>

          {selected && (
            <aside className="st-card stack" style={{ gap: 14, position: "sticky", top: 24 }} aria-labelledby="nd-h">
              <div className="eyebrow" style={{ color: "var(--brand)" }}>Chủ đề đang chọn</div>
              <h2 id="nd-h" className="heading-3">{selected.name}</h2>
              {selected.description && <p className="ink2" style={{ fontSize: 14.5 }}>{selected.description}</p>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ padding: 12, borderRadius: "var(--radius-md)", background: "var(--surface-sunken)" }}>
                  <div className="meta">Thành thạo</div><b className="num" style={{ font: "700 22px/28px var(--font-display)" }}>{Math.round(selected.mastery)}%</b>
                </div>
                <div style={{ padding: 12, borderRadius: "var(--radius-md)", background: "var(--surface-sunken)" }}>
                  <div className="meta">Ghi nhớ</div><b className="num" style={{ font: "700 22px/28px var(--font-display)" }}>{Math.round(selected.retention * (selected.retention <= 1 ? 100 : 1))}%</b>
                </div>
              </div>
              {[["Nên học trước", before], ["Mở đường cho", after]].map(([title, list]) => (
                (list as GNode[]).length > 0 && (
                  <div key={title as string}>
                    <div className="label" style={{ marginBottom: 4 }}>{title as string}</div>
                    {(list as GNode[]).map((n) => (
                      <button key={n.id} type="button" onClick={() => setSel(n.id)} className="row"
                        style={{ width: "100%", padding: "10px 0", border: 0, borderTop: "1px solid var(--hairline)", background: "transparent", cursor: "pointer", fontSize: 14.5, color: "var(--ink)" }}>
                        <span className="dot" style={{ background: tone(n.mastery, n.mastery > 0).stroke }} />{n.name}
                        <span className="spacer" /><span className="meta num">{Math.round(n.mastery)}%</span>
                      </button>
                    ))}
                  </div>
                )
              ))}
              <div className="row" style={{ gap: 8 }}>
                <Link className="st-btn st-btn-primary" href={`/lesson/${selected.id}`} style={{ flex: 1 }}>Học bài</Link>
                <Link className="st-btn st-btn-secondary" href={`/quiz/${selected.id}`} style={{ flex: 1 }}>Làm quiz</Link>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
