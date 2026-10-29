"use client";

import { useMemo, useState } from "react";
import Mascot from "@/components/mascot/Mascot";
import JournalForm from "@/components/journal/JournalForm";
import { FEELINGS, lastSevenDays, useJournal } from "@/lib/journal";
import { WEEKDAYS_LONG, WEEKDAYS_SHORT, parse, prettyDate, todayIso, weekdayIdx } from "@/lib/schedule";
import "@/components/journal/journal.css";

const moodOf = (v: number) => FEELINGS.find((f) => f.value === v)!;

export default function JournalPage() {
  const { entries, ready, save, remove } = useJournal();
  const today = todayIso();
  const [day, setDay] = useState(today);

  const week = useMemo(() => lastSevenDays(entries), [entries]);
  const list = useMemo(() => Object.values(entries).sort((a, b) => b.day.localeCompare(a.day)), [entries]);
  const avg = list.length ? list.slice(0, 14).reduce((s, e) => s + e.feeling, 0) / Math.min(list.length, 14) : 0;
  const avgMood = avg ? FEELINGS[Math.min(4, Math.max(0, Math.round(avg) - 1))] : null;
  const label = day === today ? "Hôm nay" : `${WEEKDAYS_LONG[weekdayIdx(day)]}, ${prettyDate(day)}`;

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Nhật ký học tập</h1>
          <p className="page-sub">Ghi lại cảm xúc sau mỗi ngày học. Nhìn lại để biết lúc nào bạn học tốt nhất. Dữ liệu lưu trên thiết bị này.</p>
        </div>
      </header>

      <div className="jn-grid">
        <section className="st-card" aria-labelledby="jn-form-h">
          <h2 id="jn-form-h" className="sec-title" style={{ marginBottom: 12 }}>{label}</h2>
          {ready ? <JournalForm day={day} entry={entries[day]} onSave={save} onDelete={() => remove(day)} /> : <div className="skeleton" style={{ height: 320 }} />}
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="st-card" aria-labelledby="jn-week-h">
            <div className="sec-head"><h2 id="jn-week-h" className="sec-title">7 ngày gần nhất</h2></div>
            <div className="jn-week">
              {week.map(({ day: d, entry }) => (
                <button key={d} type="button" aria-pressed={d === day} onClick={() => setDay(d)} aria-label={`${prettyDate(d)}: ${entry ? moodOf(entry.feeling).label : "chưa ghi"}`}>
                  {entry ? <Mascot mood={moodOf(entry.feeling).mood} size={38} still label="" /> : <i className="empty" />}
                  <span>{d === today ? "Nay" : WEEKDAYS_SHORT[weekdayIdx(d)]}</span>
                </button>
              ))}
            </div>
            {avgMood && (
              <div className="jn-sum" style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
                <Mascot mood={avgMood.mood} size={52} label="" />
                <div><b>{avg.toFixed(1)}/5</b><p className="meta">Tâm trạng trung bình ({Math.min(list.length, 14)} mục gần nhất): {avgMood.label.toLowerCase()}</p></div>
              </div>
            )}
          </section>

          <section className="st-card" aria-labelledby="jn-list-h">
            <div className="sec-head"><h2 id="jn-list-h" className="sec-title">Các ngày đã ghi</h2><span className="meta num">{list.length}</span></div>
            {list.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <Mascot mood="hello" size={64} label="" />
                <p className="meta">Chưa có mục nào. Chọn một sticker cảm xúc bên trái và lưu mục đầu tiên nhé.</p>
              </div>
            ) : (
              <div className="jn-list">
                {list.map((e) => (
                  <button key={e.day} type="button" className="jn-item" onClick={() => setDay(e.day)}>
                    <Mascot mood={moodOf(e.feeling).mood} size={48} still label="" />
                    <div>
                      <b>{parse(e.day).getDate()}/{parse(e.day).getMonth() + 1} · {moodOf(e.feeling).label}</b>
                      {e.text && <p>{e.text}</p>}
                      {e.tags.length > 0 && <div className="jn-chips">{e.tags.map((t) => <span key={t}>{t}</span>)}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
