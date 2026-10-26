"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { WEEKDAYS_LONG, WEEKDAYS_SHORT, addDays, createSlot, fetchDay, fmtMinutes, todayIso, weekdayIdx, type Slot } from "@/lib/schedule";
import {
  CORE, DEFAULT_TEMPLATE, MOCK_MINUTES, SKILL_INFO,
  buildSlots, dailyTotal, loadTemplate, overlaps, saveTemplate, skillMinutes, totalVerdict,
  type CoreSkill, type Template,
} from "@/lib/studyTemplate";

const SKILL_COLOR: Record<CoreSkill, string> = { listening: "var(--brand)", reading: "var(--success)", writing: "var(--accent-strong)", speaking: "var(--warning)" };

/**
 * Lịch tự học hằng tuần: người học tự chọn ngày, giờ, số phút từng kỹ năng (mặc định theo phân bổ gợi ý) và mock test định kỳ,
 * xem trước rồi thêm vào Lịch học. Kèm bảng cân đối thời gian từng kỹ năng của tuần này.
 */
export default function WeeklyPlanner({ onChanged, version }: { onChanged: () => void; version: number }) {
  const [t, setT] = useState<Template>(DEFAULT_TEMPLATE);
  const [open, setOpen] = useState(false);
  const [fromNext, setFromNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [week, setWeek] = useState<Slot[] | null>(null);
  const [weekDays, setWeekDays] = useState(0);

  useEffect(() => { setT(loadTemplate()); }, []);
  const set = (patch: Partial<Template>) => setT((x) => { const n = { ...x, ...patch }; saveTemplate(n); return n; });

  const today = todayIso();
  const monday = addDays(today, -weekdayIdx(today));
  const from = fromNext ? addDays(monday, 7) : today;
  const planned = useMemo(() => buildSlots(t, from, today), [t, from, today]);
  const total = dailyTotal(t);
  const verdict = totalVerdict(total);

  // tuần này: thời gian từng kỹ năng (lên kế hoạch / đã xong) và số ngày có học
  useEffect(() => {
    let stale = false;
    Promise.all(Array.from({ length: 7 }, (_, i) => fetchDay(addDays(monday, i)).catch(() => null)))
      .then((ds) => {
        if (stale) return;
        setWeek(ds.flatMap((d) => d?.slots || []));
        setWeekDays(ds.filter((d) => (d?.stats?.minutes || 0) > 0 || (d?.slots || []).some((s) => s.status === "done")).length);
      });
    return () => { stale = true; };
  }, [monday, version]);
  const bal = week ? skillMinutes(week) : null;
  const weekTarget = (k: CoreSkill) => t.minutes[k] * t.days.length;

  const apply = async () => {
    if (!planned.length) return;
    setBusy(true); setMsg(null);
    let added = 0, skipped = 0, failed = 0;
    const byDay = new Map<string, typeof planned>();
    for (const p of planned) byDay.set(p.day, [...(byDay.get(p.day) || []), p]);
    let i = 0;
    for (const [day, items] of Array.from(byDay.entries())) {
      setProgress(`Đang thêm ${++i}/${byDay.size} ngày…`);
      const existing = (await fetchDay(day).catch(() => null))?.slots || [];
      for (const p of items) {
        // không đè lên khung giờ đã có
        if (existing.some((e) => e.status !== "skipped" && overlaps(e, p))) { skipped++; continue; }
        try {
          await createSlot({ day: p.day, start: p.start, end: p.end, title: p.title, note: p.note, skill: p.skill, remind: p.remind });
          added++;
        } catch { failed++; }
      }
    }
    setProgress(""); setBusy(false);
    setMsg({ ok: failed === 0, text: `Đã thêm ${added} khung giờ${skipped ? `, bỏ qua ${skipped} khung trùng giờ đã có` : ""}${failed ? `, ${failed} khung lỗi (thử lại sau)` : ""}.` });
    if (added) onChanged();
  };

  const firstWeek = planned.filter((p) => p.day < addDays(from, 7));
  const days = Array.from(new Set(firstWeek.map((p) => p.day)));

  return (
    <section className="st-card" style={{ padding: 20 }} aria-labelledby="wp-h">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 id="wp-h" className="sec-title">Lịch tự học hằng tuần</h2>
        <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Thu gọn" : "Tạo / chỉnh lịch tuần"}</button>
      </div>

      {/* Cân đối tuần này */}
      <div style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <b style={{ fontSize: 14.5 }}>Tuần này</b>
          <span className="meta">{weekDays}/7 ngày có học · mục tiêu {t.days.length} ngày</span>
        </div>
        {bal ? (
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {CORE.map((k) => {
              const target = weekTarget(k);
              const pct = target ? Math.min(100, (bal[k].done / target) * 100) : 0;
              const plannedPct = target ? Math.min(100, (bal[k].planned / target) * 100) : 0;
              return (
                <div key={k}>
                  <div className="row" style={{ justifyContent: "space-between", fontSize: 13.5 }}>
                    <span>{SKILL_INFO[k].label}</span>
                    <span className="meta">{fmtMinutes(bal[k].done)} xong · {fmtMinutes(bal[k].planned)} đã xếp / mục tiêu {fmtMinutes(target)}</span>
                  </div>
                  <div style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--surface-sunken)", marginTop: 4, overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: 0, width: `${plannedPct}%`, background: SKILL_COLOR[k], opacity: 0.25 }} />
                    <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: SKILL_COLOR[k] }} />
                  </div>
                </div>
              );
            })}
            {bal.mock.planned > 0 && <p className="meta">Mock test tuần này: {bal.mock.done ? "đã làm" : "đã lên lịch"}.</p>}
            {CORE.some((k) => bal[k].planned === 0) && (
              <p className="meta">Chưa xếp lịch cho {CORE.filter((k) => bal[k].planned === 0).map((k) => SKILL_INFO[k].label).join(", ")} tuần này. Học đủ 4 kỹ năng mỗi ngày, mỗi kỹ năng một ít, tốt hơn dồn một kỹ năng.</p>
            )}
          </div>
        ) : <p className="meta" style={{ marginTop: 6 }}>Đang tải…</p>}
      </div>

      {open && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
          <ul className="ink2" style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: "grid", gap: 4 }}>
            <li><b>Học đều mỗi ngày</b> khoảng 1,5–2 giờ hiệu quả hơn học dồn rồi bỏ quãng.</li>
            <li><b>Chia thời gian</b>: Listening ~30′, Reading ~30′, Writing 30–45′, Speaking 15–30′. Bạn chỉnh theo điểm yếu của mình.</li>
            <li><b>Mock test định kỳ</b> (thi thử bấm giờ) sau mỗi giai đoạn để đo tiến độ và điều chỉnh.</li>
          </ul>

          <div style={{ marginTop: 16 }}>
            <span className="st-field-label">Ngày học</span>
            <div className="row-wrap" style={{ gap: 6, marginTop: 6 }} role="group" aria-label="Ngày học">
              {WEEKDAYS_SHORT.map((d, i) => (
                <button key={d} type="button" className="seg-btn" aria-pressed={t.days.includes(i)} style={{ minWidth: 44, border: "1px solid var(--hairline)", background: t.days.includes(i) ? "var(--brand-tint)" : undefined, fontWeight: t.days.includes(i) ? 700 : 500 }}
                  onClick={() => set({ days: t.days.includes(i) ? t.days.filter((x) => x !== i) : [...t.days, i].sort() })}>{d}</button>
              ))}
            </div>
            {t.days.length < 5 && <p className="meta" style={{ marginTop: 4 }}>Nên học ít nhất 5–6 ngày/tuần để giữ nhịp.</p>}
          </div>

          <div className="row-wrap" style={{ gap: 16, marginTop: 14, alignItems: "end" }}>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Bắt đầu lúc</span>
              <input type="time" className="input" value={t.start} onChange={(e) => set({ start: e.target.value || "19:30" })} style={{ height: 40 }} />
            </label>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Nghỉ giữa các phần</span>
              <select className="input" style={{ height: 40 }} value={t.breakMin} onChange={(e) => set({ breakMin: Number(e.target.value) })}>
                {[0, 5, 10].map((m) => <option key={m} value={m}>{m ? `${m} phút` : "Không nghỉ"}</option>)}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 14 }}>
            <span className="st-field-label">Phút mỗi kỹ năng / ngày (↑↓ để đổi thứ tự học)</span>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {t.order.map((k, idx) => (
                <div key={k} className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: SKILL_COLOR[k], flexShrink: 0 }} />
                  <span style={{ minWidth: 86, fontWeight: 600 }}>{SKILL_INFO[k].label}</span>
                  <input type="range" min={0} max={SKILL_INFO[k].max} step={5} value={t.minutes[k]} aria-label={`Số phút ${SKILL_INFO[k].label}`}
                    onChange={(e) => set({ minutes: { ...t.minutes, [k]: Number(e.target.value) } })} style={{ flex: 1, minWidth: 120 }} />
                  <span className="num" style={{ minWidth: 54, textAlign: "right" }}>{t.minutes[k]} phút</span>
                  <span className="meta" style={{ minWidth: 80 }}>gợi ý {SKILL_INFO[k].rec}</span>
                  <span className="row" style={{ gap: 2 }}>
                    <button type="button" className="st-btn st-btn-ghost st-btn-sm" aria-label="Lên" disabled={idx === 0} onClick={() => { const o = [...t.order]; [o[idx - 1], o[idx]] = [o[idx], o[idx - 1]]; set({ order: o }); }}>↑</button>
                    <button type="button" className="st-btn st-btn-ghost st-btn-sm" aria-label="Xuống" disabled={idx === t.order.length - 1} onClick={() => { const o = [...t.order]; [o[idx + 1], o[idx]] = [o[idx], o[idx + 1]]; set({ order: o }); }}>↓</button>
                  </span>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 8, fontSize: 14, color: verdict.ok ? "var(--ink-secondary)" : "var(--warning)" }}>
              Tổng <b>{fmtMinutes(total)}</b>/ngày. {verdict.text}
            </p>
            <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => set({ minutes: DEFAULT_TEMPLATE.minutes, order: DEFAULT_TEMPLATE.order })}>Về phân bổ gợi ý</button>
          </div>

          <div className="row-wrap" style={{ gap: 16, marginTop: 14, alignItems: "end" }}>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Mock test</span>
              <select className="input" style={{ height: 40 }} value={t.mock.everyWeeks} onChange={(e) => set({ mock: { ...t.mock, everyWeeks: Number(e.target.value) as Template["mock"]["everyWeeks"] } })}>
                <option value={0}>Không xếp</option><option value={1}>Mỗi tuần</option><option value={2}>2 tuần một lần</option><option value={4}>4 tuần một lần</option>
              </select>
            </label>
            {t.mock.everyWeeks > 0 && (
              <>
                <label className="st-field" style={{ minWidth: 0 }}>
                  <span className="st-field-label">Vào</span>
                  <select className="input" style={{ height: 40 }} value={t.mock.weekday} onChange={(e) => set({ mock: { ...t.mock, weekday: Number(e.target.value) } })}>
                    {WEEKDAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}
                  </select>
                </label>
                <label className="st-field" style={{ minWidth: 0 }}>
                  <span className="st-field-label">Lúc</span>
                  <input type="time" className="input" value={t.mock.start} onChange={(e) => set({ mock: { ...t.mock, start: e.target.value || "08:30" } })} style={{ height: 40 }} />
                </label>
              </>
            )}
          </div>
          {t.mock.everyWeeks > 0 && <p className="meta" style={{ marginTop: 4 }}>Mỗi lần {fmtMinutes(MOCK_MINUTES)}, làm đề ở <Link href="/exam">Thi thử</Link>. Ngày có mock test sẽ không xếp bài luyện thường.</p>}

          <div className="row-wrap" style={{ gap: 16, marginTop: 14, alignItems: "end" }}>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Áp dụng trong</span>
              <select className="input" style={{ height: 40 }} value={t.weeks} onChange={(e) => set({ weeks: Number(e.target.value) as Template["weeks"] })}>
                <option value={1}>1 tuần</option><option value={2}>2 tuần</option><option value={4}>4 tuần</option>
              </select>
            </label>
            <label className="st-field" style={{ minWidth: 0 }}>
              <span className="st-field-label">Bắt đầu từ</span>
              <select className="input" style={{ height: 40 }} value={fromNext ? "next" : "today"} onChange={(e) => setFromNext(e.target.value === "next")}>
                <option value="today">Hôm nay</option><option value="next">Thứ hai tuần sau</option>
              </select>
            </label>
            <label className="row" style={{ gap: 6, cursor: "pointer", fontSize: 13.5 }}>
              <input type="checkbox" checked={t.remindFirst} onChange={(e) => set({ remindFirst: e.target.checked })} /> Chỉ nhắc email cho buổi đầu mỗi ngày
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <b style={{ fontSize: 14.5 }}>Xem trước tuần đầu</b>
            {days.length ? (
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 8 }}>
                {days.map((d) => (
                  <li key={d}>
                    <div className="meta" style={{ fontWeight: 600 }}>{WEEKDAYS_LONG[weekdayIdx(d)]} {d.slice(8)}/{d.slice(5, 7)}</div>
                    <div className="row-wrap" style={{ gap: 4, marginTop: 4 }}>
                      {firstWeek.filter((p) => p.day === d).map((p) => (
                        <span key={p.start} title={p.title} style={{ fontSize: 12.5, padding: "2px 8px", borderRadius: 4, background: "var(--surface-sunken)", borderLeft: `3px solid ${p.mock ? "var(--danger)" : SKILL_COLOR[p.skill as CoreSkill] || "var(--ink-muted)"}` }}>
                          <b className="num">{p.start}–{p.end}</b> {p.mock ? "Mock test" : SKILL_INFO[p.skill as CoreSkill]?.label}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="meta" style={{ marginTop: 6 }}>Chưa có buổi nào. Chọn ngày học và số phút.</p>}
          </div>

          <div className="row-wrap" style={{ gap: 10, marginTop: 16, alignItems: "center" }}>
            <button type="button" className="st-btn st-btn-primary" disabled={busy || !planned.length} onClick={apply}>
              {busy ? progress || "Đang thêm…" : `Thêm ${planned.length} khung giờ vào lịch`}
            </button>
            <span className="meta">Khung nào trùng giờ với lịch đã có sẽ được bỏ qua. Bạn sửa hoặc xoá từng khung trong lịch ngày.</span>
          </div>
          {msg && <p role="status" style={{ marginTop: 8, color: msg.ok ? "var(--success)" : "var(--warning)" }}>{msg.text}</p>}
        </div>
      )}
    </section>
  );
}
