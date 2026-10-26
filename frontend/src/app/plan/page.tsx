"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

import { API, apiFetch } from "@/lib/api";
import { type Profile, type PlacementResult, fetchServerProfile } from "@/lib/placement";
import {
  type DayDetail, type DayStat, type ReminderStatus, type Streak,
  MONTHS, WEEKDAYS_LONG, addDays, addMonths, fetchDay, fetchReminderStatus, fetchStreak, fetchSummary,
  fmtMinutes, iso, parse, prettyDate, todayIso, weekdayIdx,
} from "@/lib/schedule";
import TargetCard from "@/components/plan/TargetCard";
import StreakCard from "@/components/plan/StreakCard";
import MonthView, { monthGrid } from "@/components/plan/MonthView";
import YearView from "@/components/plan/YearView";
import DayView from "@/components/plan/DayView";
import GoalsPanel from "@/components/plan/GoalsPanel";
import WeeklyPlanner from "@/components/plan/WeeklyPlanner";
import "./plan.css";

type View = "day" | "month" | "year";
const VIEWS: { id: View; label: string }[] = [{ id: "day", label: "Ngày" }, { id: "month", label: "Tháng" }, { id: "year", label: "Năm" }];

/** Xem nhanh một ngày ngay bên cạnh lịch tháng. */
function DayPreview({ day, detail, onOpen }: { day: string; detail: DayDetail | null; onOpen: () => void }) {
  const today = todayIso();
  const tasks = detail?.plan?.tasks || [];
  const slots = detail?.slots || [];
  const moments = detail?.moments || [];
  const s = detail?.stats || {};
  const empty = !tasks.length && !slots.length && !moments.length;
  return (
    <section className="st-card dp" aria-labelledby="dp-h">
      <div className="eyebrow">{day === today ? "Hôm nay · " : ""}{WEEKDAYS_LONG[weekdayIdx(day)]}</div>
      <h2 id="dp-h" className="sec-title" style={{ marginTop: 2 }}>{prettyDate(day)}</h2>
      <div className="dp-line">
        <span><b className="num">{fmtMinutes(s.minutes || 0)}</b> đã học</span>
        <span><b className="num">{s.tasks_done || 0}/{s.tasks_total || 0}</b> nhiệm vụ</span>
        <span><b className="num">{s.slots || 0}</b> khung giờ</span>
      </div>

      {empty && <p className="meta" style={{ marginTop: 12 }}>{day < today ? "Ngày này không có gì được ghi lại." : "Ngày này chưa có gì. Mở chi tiết để thêm khung giờ học hoặc lưu một khoảnh khắc."}</p>}

      {slots.length > 0 && (
        <ul className="dp-list" aria-label="Khung giờ">
          {slots.map((x) => (
            <li key={x.id} data-skill={x.skill} data-done={x.status === "done" || undefined}>
              <b className="num">{x.start}</b>
              <div><span>{x.title}</span>{x.note && <small>{x.note}</small>}</div>
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 0 && (
        <ul className="dp-list tasks" aria-label="Nhiệm vụ của lộ trình">
          {tasks.map((t, i) => (
            <li key={i} data-done={t.status === "completed" || undefined}>
              <b className="num">{t.duration_min}&prime;</b>
              <div><span>{t.topic_name}</span></div>
            </li>
          ))}
        </ul>
      )}
      {moments.length > 0 && (
        <div className="dp-photos" aria-label="Khoảnh khắc học">
          {moments.slice(0, 4).map((m) => m.url ? <img key={m.id} src={m.url} alt={m.caption || "Khoảnh khắc học"} loading="lazy" /> : null)}
          {moments.length > 4 && <span className="meta">+{moments.length - 4}</span>}
        </div>
      )}
      <button type="button" className="st-btn st-btn-primary st-btn-block" style={{ marginTop: 16 }} onClick={onOpen}>{day < today ? "Xem lại ngày này" : "Mở chi tiết ngày"}</button>
    </section>
  );
}

export default function PlanPage() {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(todayIso());
  const [stats, setStats] = useState<Record<string, DayStat>>({});
  const [statsKey, setStatsKey] = useState("");
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [detailDay, setDetailDay] = useState("");
  const [streak, setStreak] = useState<Streak | null>(null);
  const [reminder, setReminder] = useState<ReminderStatus | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [placement, setPlacement] = useState<PlacementResult | null>(null);
  const [profLoading, setProfLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [init, setInit] = useState(false);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const today = todayIso();
  const year = parse(anchor).getFullYear();
  const key = view === "year" ? `y${year}` : `m${anchor.slice(0, 7)}`;

  // Mở thẳng một ngày từ đường dẫn (vd. liên kết trong email nhắc): /plan?view=day&date=2026-10-17
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const v = q.get("view") as View | null;
    const d = q.get("date");
    if (v && VIEWS.some((x) => x.id === v)) setView(v);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setAnchor(d);
    setInit(true);
    fetchServerProfile().then(({ profile, placement }) => { setProfile(profile); setPlacement(placement); }).finally(() => setProfLoading(false));
    fetchReminderStatus().then(setReminder).catch(() => {});
  }, []);

  useEffect(() => {
    if (!init) return;
    window.history.replaceState(null, "", `/plan?view=${view}&date=${anchor}`);
  }, [init, view, anchor]);

  useEffect(() => { fetchStreak().then(setStreak).catch(() => {}); }, [version]);

  useEffect(() => {
    if (view === "day") return;
    let stale = false;
    const [start, end] = view === "year" ? [`${year}-01-01`, `${year}-12-31`] : (() => { const g = monthGrid(anchor); return [g.start, g.end]; })();
    fetchSummary(start, end)
      .then((d) => { if (!stale) { setStats(d); setStatsKey(key); setError(""); } })
      .catch((e) => { if (!stale) setError(e.message || "Không tải được lịch"); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, key, version]);

  useEffect(() => {
    if (view === "year") return;
    let stale = false;
    fetchDay(anchor)
      .then((d) => { if (!stale) { setDetail(d); setDetailDay(anchor); setError(""); } })
      .catch((e) => { if (!stale) setError(e.message || "Không tải được ngày này"); });
    return () => { stale = true; };
  }, [view, anchor, version]);

  const last7 = useMemo(() => (streak?.week || []).reduce((a, d) => a + d.minutes, 0), [streak]);

  const go = (dir: -1 | 1) => {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "month") {
      const next = addMonths(anchor, dir);
      setAnchor(next.slice(0, 7) === today.slice(0, 7) ? today : next);
    } else {
      const next = `${year + dir}-01-01`;
      setAnchor(next.slice(0, 4) === today.slice(0, 4) ? today : next);
    }
  };

  const title = view === "day" ? `${WEEKDAYS_LONG[weekdayIdx(anchor)]}, ${prettyDate(anchor)}` : view === "month" ? `${MONTHS[parse(anchor).getMonth()]}, ${year}` : `Năm ${year}`;

  const downloadIcal = async () => {
    try {
      const res = await apiFetch(`${API}/export/schedule/ical`);
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = "studia_study_schedule.ics";
      a.click();
      URL.revokeObjectURL(url);
    } catch { setError("Không tải được tệp lịch (.ics)"); }
  };

  const openDay = (d: string) => { setAnchor(d); setView("day"); };

  return (
    <div className="wrap stagger plan">
      <header className="page-head">
        <div>
          <h1 className="page-title">Lịch học</h1>
          <p className="page-sub">Lập lịch theo giờ, ghi chú từng buổi, lưu khoảnh khắc học và giữ chuỗi ngày học liên tiếp.</p>
        </div>
        <button type="button" className="st-btn st-btn-ghost" onClick={downloadIcal} title="Đồng bộ với Google Calendar / Outlook">
          <Download size={18} strokeWidth={1.75} /> Thêm vào lịch (.ics)
        </button>
      </header>

      {error && <div role="alert" className="gp-msg">{error}</div>}

      <div className="plan-top">
        <TargetCard profile={profile} placement={placement} last7Minutes={last7} loading={profLoading} />
        <StreakCard streak={streak} loading={!streak} />
      </div>

      <div className="plan-bar">
        <div className="seg" role="tablist" aria-label="Chế độ xem lịch">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" className="seg-btn" aria-selected={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
          ))}
        </div>
        <div className="plan-nav">
          <button className="icon-btn" type="button" aria-label="Trước" onClick={() => go(-1)}><ChevronLeft size={20} strokeWidth={2} /></button>
          <h2 className="heading-3 plan-title" aria-live="polite">{title}</h2>
          <button className="icon-btn" type="button" aria-label="Sau" onClick={() => go(1)}><ChevronRight size={20} strokeWidth={2} /></button>
        </div>
        <button type="button" className="st-btn st-btn-secondary st-btn-sm" onClick={() => setAnchor(today)} disabled={anchor === today && view !== "year"}>Hôm nay</button>
      </div>

      {view === "month" && (
        <div className="split plan-split">
          <section className="st-card" aria-label="Lịch tháng">
            <MonthView anchor={anchor} stats={stats} loading={statsKey !== key} onSelect={setAnchor} onOpen={openDay} />
          </section>
          <DayPreview day={anchor} detail={detailDay === anchor ? detail : null} onOpen={() => openDay(anchor)} />
        </div>
      )}

      {view === "year" && (
        <section className="st-card" aria-label="Lịch năm">
          <YearView year={year} stats={stats} streak={streak} loading={statsKey !== key}
            onPickDay={openDay} onPickMonth={(m) => { setAnchor(iso(new Date(year, m, 1)) .slice(0, 7) === today.slice(0, 7) ? today : iso(new Date(year, m, 1))); setView("month"); }} />
        </section>
      )}

      {view === "day" && (
        <DayView day={anchor} detail={detailDay === anchor ? detail : null} loading={detailDay !== anchor}
          reminder={reminder} defaultStart={profile?.remindAt || "19:00"} onChanged={reload} />
      )}

      <WeeklyPlanner onChanged={reload} version={version} />
      <GoalsPanel onChanged={reload} />
    </div>
  );
}
