"use client";

import { Check } from "lucide-react";
import {
  MAX_MINUTES, MIN_MINUTES, SKILL_ORDER, SKILL_LABEL, STANDARD_MINUTES, activeSections, countLabel, fmtDuration,
  isStandardTiming, totalMinutes, type ExamConfig, type LibraryTest, type RoomMode, type Skill,
} from "@/lib/examConfig";

const MODES: { id: RoomMode; title: string; desc: string }[] = [
  { id: "real", title: "Mô phỏng phòng thi thật", desc: "Giao diện và luật như đi thi: đồng hồ cố định, chỉ có tô sáng và đánh dấu câu. Không từ điển, không ghi chú." },
  { id: "practice", title: "Phòng luyện tập", desc: "Có từ điển, ghi chú, flashcard, được tắt đồng hồ. Sau khi nộp xem giải thích chi tiết từng câu." },
];

const REAL_RULES = [
  "Đồng hồ chạy ngay khi bạn bấm Bắt đầu và không tạm dừng được.",
  "Phần nghe chỉ phát một lần, hãy đeo tai nghe.",
  "Hết giờ, bài được nộp tự động.",
  "Không có từ điển, ghi chú hay đáp án cho tới khi nộp bài.",
];
const PRACTICE_TOOLS = [
  "Bôi đen chữ để tra từ điển, thêm flashcard hoặc nghe phát âm.",
  "Sổ ghi chú riêng cho mỗi lượt làm bài, lưu trên máy bạn.",
  "Chọn không giới hạn thời gian nếu muốn làm thong thả.",
  "Nộp xong: xem lại từng câu kèm giải thích và bằng chứng trong bài.",
];

const PRESETS: { label: string; skills: Skill[] }[] = [
  { label: "Cả đề", skills: ["listening", "reading", "writing", "speaking"] },
  { label: "Nghe + Đọc", skills: ["listening", "reading"] },
  { label: "Viết + Nói", skills: ["writing", "speaking"] },
];

/** Bảng cấu hình lượt thi cho đề đang chọn: chế độ, phần thi, thời gian từng phần. */
export default function StartPanel({ test, config, onChange, agreed, onAgree, onStart, onSoundTest, starting, error }: {
  test: LibraryTest | null; config: ExamConfig; onChange: (c: ExamConfig) => void;
  agreed: boolean; onAgree: (v: boolean) => void; onStart: () => void; onSoundTest: () => void;
  starting: boolean; error: string | null;
}) {
  const real = config.mode === "real";
  const picked = activeSections(config, test);
  const total = totalMinutes(config, test);
  const standard = isStandardTiming(config, test);
  const invalid = picked.filter((s) => !(config.minutes[s] >= MIN_MINUTES && config.minutes[s] <= MAX_MINUTES));
  const needAgree = real;
  const canStart = !!test && picked.length > 0 && invalid.length === 0 && (!needAgree || agreed) && !starting;
  const patch = (p: Partial<ExamConfig>) => onChange({ ...config, ...p });

  const setPicked = (skills: Skill[]) => patch({ picked: { listening: skills.includes("listening"), reading: skills.includes("reading"), writing: skills.includes("writing"), speaking: skills.includes("speaking") } });

  return (
    <aside id="exam-start-panel" className="st-card el-panel" aria-labelledby="cfg-h">
      <div>
        <div className="el-label">{test ? test.series : "Chưa chọn đề"}</div>
        <h2 id="cfg-h" style={{ font: "700 24px/30px var(--font-display)", letterSpacing: "-0.4px", marginTop: 4 }}>
          {test ? test.title : "Chọn một đề ở danh sách bên trái"}
        </h2>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="el-label" id="mode-l">Chế độ</div>
        <div className="el-modes" role="radiogroup" aria-labelledby="mode-l">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" className="el-mode" aria-checked={config.mode === m.id}
              onClick={() => patch({ mode: m.id, untimed: m.id === "real" ? false : config.untimed })}>
              <b>{m.title}</b><span>{m.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
          <div className="el-label" id="sec-l">Phần thi và thời gian</div>
          <div className="el-presets" aria-label="Chọn nhanh">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className="el-preset" onClick={() => setPicked(p.skills.filter((s) => !test || test.sections.includes(s)))}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="el-secs" role="group" aria-labelledby="sec-l">
          {SKILL_ORDER.map((s) => {
            const has = !test || test.sections.includes(s);
            const on = has && config.picked[s];
            const bad = on && invalid.includes(s);
            return (
              <div key={s} className="el-sec" data-off={!on}>
                <label className="el-sec-pick" aria-disabled={!has}>
                  <span className={`check ${on ? "check-on" : ""}`} aria-hidden="true">{on && <Check size={14} strokeWidth={3} />}</span>
                  <input type="checkbox" className="st-sr" checked={on} disabled={!has}
                    onChange={(e) => patch({ picked: { ...config.picked, [s]: e.target.checked } })} />
                  <span style={{ minWidth: 0 }}>
                    <span className="el-sec-name" style={{ display: "block" }}>{SKILL_LABEL[s]}</span>
                    <span className="el-sec-meta">{has ? (countLabel(s, test?.counts[s]) || "Có trong đề") : "Đề này không có phần này"}</span>
                  </span>
                </label>
                <div className="el-min">
                  <input type="number" inputMode="numeric" min={MIN_MINUTES} max={MAX_MINUTES} step={5} value={Number.isFinite(config.minutes[s]) ? config.minutes[s] : ""}
                    disabled={!on || config.untimed} aria-label={`Số phút ${SKILL_LABEL[s]}`} aria-invalid={bad || undefined}
                    onChange={(e) => patch({ minutes: { ...config.minutes, [s]: e.target.value === "" ? NaN : Math.round(Number(e.target.value)) } })} />
                  <span>phút</span>
                </div>
              </div>
            );
          })}
        </div>
        {!real && (
          <label className="row" style={{ gap: 10, cursor: "pointer", padding: "4px 0" }}>
            <span className={`check ${config.untimed ? "check-on" : ""}`} aria-hidden="true">{config.untimed && <Check size={14} strokeWidth={3} />}</span>
            <input type="checkbox" className="st-sr" checked={config.untimed} onChange={(e) => patch({ untimed: e.target.checked })} />
            <span style={{ color: "var(--ink)", fontSize: 14.5 }}>Không giới hạn thời gian</span>
          </label>
        )}
        {invalid.length > 0 && <p role="alert" className="meta" style={{ color: "var(--danger)" }}>Thời gian mỗi phần phải từ {MIN_MINUTES} đến {MAX_MINUTES} phút.</p>}
        {real && !standard && picked.length > 0 && invalid.length === 0 && (
          <p className="el-note" data-tone="warn">Bạn đã đổi giờ chuẩn ({picked.map((s) => `${SKILL_LABEL[s]} ${STANDARD_MINUTES[s]}’`).join(" · ")}). Điểm vẫn tính nhưng không còn là điều kiện thi thật.</p>
        )}
        <button type="button" className="el-preset" style={{ alignSelf: "flex-start" }} onClick={() => patch({ minutes: { ...STANDARD_MINUTES } })}>Đặt lại giờ chuẩn</button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="el-label" id="kind-l">Loại bài thi</div>
        <div className="seg" role="radiogroup" aria-labelledby="kind-l" style={{ alignSelf: "flex-start" }}>
          {(["academic", "general"] as const).map((k) => (
            <button key={k} className="seg-btn" type="button" role="radio" aria-checked={config.kind === k} aria-pressed={config.kind === k} onClick={() => patch({ kind: k })}>{k === "academic" ? "Academic" : "General Training"}</button>
          ))}
        </div>
      </div>

      <div>
        <div className="el-label" style={{ marginBottom: 6 }}>{real ? "Quy định phòng thi" : "Công cụ hỗ trợ"}</div>
        <ul className="el-list">{(real ? REAL_RULES : PRACTICE_TOOLS).map((r) => <li key={r}>{r}</li>)}</ul>
        {real && (
          <label className="row" style={{ marginTop: 12, padding: 12, borderRadius: "var(--radius-md)", background: agreed ? "var(--brand-tint)" : "var(--surface-sunken)", cursor: "pointer", gap: 10 }}>
            <span className={`check ${agreed ? "check-on" : ""}`} aria-hidden="true">{agreed && <Check size={14} strokeWidth={3} />}</span>
            <input type="checkbox" className="st-sr" checked={agreed} onChange={(e) => onAgree(e.target.checked)} />
            <span style={{ color: "var(--ink)", fontSize: 14.5 }}>Tôi đã đọc và đồng ý với quy định phòng thi</span>
          </label>
        )}
      </div>

      <div className="el-total" style={{ borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
        <span className="ink2">{picked.length} phần · {config.untimed ? "không tính giờ" : "tổng"}</span>
        <b>{config.untimed ? "Tự do" : picked.length ? fmtDuration(total) : "—"}</b>
      </div>
      {error && <div role="alert" className="st-alert st-alert-danger">{error}</div>}
      <button className="st-btn st-btn-primary st-btn-lg st-btn-block" type="button" disabled={!canStart} onClick={onStart}>
        {starting ? <><span className="st-spinner" />Đang chuẩn bị đề…</> : real ? "Bắt đầu thi" : "Bắt đầu luyện tập"}
      </button>
      {!test && <p className="meta" style={{ textAlign: "center" }}>Chọn đề trước khi bắt đầu.</p>}
      {test && picked.length === 0 && <p className="meta" style={{ textAlign: "center" }}>Chọn ít nhất một phần thi.</p>}
      {test && picked.length > 0 && real && !agreed && <p className="meta" style={{ textAlign: "center" }}>Đồng ý quy định phòng thi để bắt đầu.</p>}
      {picked.includes("listening") && (
        <p className="meta" style={{ textAlign: "center" }}>
          Kiểm tra loa trước: <button type="button" onClick={onSoundTest} style={{ background: "none", border: 0, padding: 0, color: "var(--brand)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>phát âm thanh thử</button>
        </p>
      )}
    </aside>
  );
}
