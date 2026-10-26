/**
 * Mẫu lịch tự học hằng tuần: chọn ngày học, giờ bắt đầu, số phút mỗi kỹ năng (mặc định theo phân bổ gợi ý
 * Listening ~30, Reading ~30, Writing 30–45, Speaking 15–30 phút, tổng 1,5–2 giờ/ngày) và mock test định kỳ.
 * Sinh danh sách khung giờ để thêm vào Lịch học; logic thuần.
 */

import { addDays, daysBetween, fromMin, toMin, weekdayIdx, type Skill, type Slot, type SlotInput } from "@/lib/schedule";

export type CoreSkill = "listening" | "reading" | "writing" | "speaking";
export const CORE: CoreSkill[] = ["listening", "reading", "writing", "speaking"];

export const SKILL_INFO: Record<CoreSkill, { label: string; rec: string; min: number; max: number; path: string; ideas: string[] }> = {
  listening: { label: "Listening", rec: "~30 phút", min: 20, max: 45, path: "/dictation", ideas: ["Nghe chép chính tả 3–4 đoạn rồi Shadowing", "Nghe 1 section đề Cambridge, đối chiếu transcript", "Nghe chép một video YouTube (BBC, TED-Ed) có transcript"] },
  reading: { label: "Reading", rec: "~30 phút", min: 20, max: 45, path: "/reading", ideas: ["Luyện 1 passage trong 20 phút (skim, scan, giữ nhịp)", "Phân tích câu phức và ôn từ khoá của passage hôm trước", "Luyện 1 passage dạng TRUE/FALSE/NOT GIVEN"] },
  writing: { label: "Writing", rec: "30–45 phút", min: 20, max: 60, path: "/writing", ideas: ["Task 2: lập dàn ý 4 đoạn và viết trong 40 phút", "Task 1: viết trong 20 phút, nhớ đoạn tổng quan", "Sửa lại bài cũ theo nhận xét, viết lại các câu sai"] },
  speaking: { label: "Speaking", rec: "15–30 phút", min: 10, max: 40, path: "/speaking", ideas: ["Part 1: trả lời 4–5 câu, ghi âm và tự sửa", "Part 2: 1 phút chuẩn bị + nói 2 phút", "Part 3: trả lời theo I-E-E, nói lại bằng cách khác"] },
};

export type Template = {
  days: number[];                 // 0 = Thứ hai … 6 = Chủ nhật
  start: string;                  // "19:30"
  minutes: Record<CoreSkill, number>;
  order: CoreSkill[];
  breakMin: number;
  mock: { everyWeeks: 0 | 1 | 2 | 4; weekday: number; start: string };
  weeks: 1 | 2 | 4;
  remindFirst: boolean;           // chỉ nhắc email cho buổi đầu mỗi ngày
};

export const DEFAULT_TEMPLATE: Template = {
  days: [0, 1, 2, 3, 4, 5], start: "19:30",
  minutes: { listening: 30, reading: 30, writing: 40, speaking: 20 },
  order: ["listening", "reading", "writing", "speaking"],
  breakMin: 5,
  mock: { everyWeeks: 2, weekday: 6, start: "08:30" },
  weeks: 2,
  remindFirst: true,
};

export const MOCK_MINUTES = 165; // Listening 30 + Reading 60 + Writing 60 + Speaking ~15

export const dailyTotal = (t: Template) => CORE.reduce((s, k) => s + (t.minutes[k] || 0), 0);

/** Nhận xét tổng thời lượng mỗi ngày so với khuyến nghị 1,5–2 giờ. */
export function totalVerdict(min: number): { ok: boolean; text: string } {
  if (min < 60) return { ok: false, text: "Dưới 1 giờ/ngày thì tiến bộ chậm. Nếu bận, giữ ít nhất 60 phút nhưng học đều mỗi ngày." };
  if (min < 90) return { ok: true, text: "Hơi ít so với gợi ý 1,5–2 giờ, nhưng học đều mỗi ngày vẫn tốt hơn học dồn." };
  if (min <= 120) return { ok: true, text: "Đúng khuyến nghị 1,5–2 giờ/ngày." };
  if (min <= 150) return { ok: true, text: "Hơi nhiều. Giữ được lâu dài không? Học ít mà đều hiệu quả hơn học dồn rồi bỏ." };
  return { ok: false, text: "Quá nhiều cho mỗi ngày, dễ quá tải và bỏ giữa chừng. Nên giảm còn khoảng 2 giờ." };
}

/** Ngày có mock test: tuần thứ 1, 1+N, 1+2N… (tính từ tuần bắt đầu) vào thứ đã chọn. */
function isMockDay(t: Template, day: string, firstDay: string): boolean {
  if (!t.mock.everyWeeks || weekdayIdx(day) !== t.mock.weekday) return false;
  const monday0 = addDays(firstDay, -weekdayIdx(firstDay));
  const week = Math.floor(daysBetween(monday0, day) / 7);
  return week % t.mock.everyWeeks === 0;
}

export type PlannedSlot = SlotInput & { minutes: number; mock?: boolean };

/** Sinh các khung giờ cho `t.weeks` tuần bắt đầu từ `from` (bỏ ngày đã qua). */
export function buildSlots(t: Template, from: string, today: string): PlannedSlot[] {
  const out: PlannedSlot[] = [];
  const days = t.weeks * 7;
  let n = 0; // số ngày học đã xếp, để xoay vòng gợi ý nội dung
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    if (day < today) continue;
    if (isMockDay(t, day, from)) {
      const s = toMin(t.mock.start);
      out.push({
        day, start: t.mock.start, end: fromMin(Math.min(s + MOCK_MINUTES, 23 * 60 + 59)), skill: "review" as Skill, mock: true, minutes: MOCK_MINUTES,
        title: "Mock test: thi thử 4 kỹ năng", remind: true,
        note: "Làm một đề Cambridge bấm giờ như thi thật ở mục Thi thử (/exam). Ghi lại band từng kỹ năng, chọn 1–2 điểm yếu để tập trung tuần tới.",
      });
      continue;
    }
    if (!t.days.includes(weekdayIdx(day))) continue;
    let cur = toMin(t.start);
    let first = true;
    for (const k of t.order) {
      const m = t.minutes[k] || 0;
      if (m <= 0) continue;
      if (cur + m > 24 * 60 - 1) break;
      const info = SKILL_INFO[k];
      out.push({
        day, start: fromMin(cur), end: fromMin(cur + m), skill: k, minutes: m,
        title: `${info.label}: ${info.ideas[n % info.ideas.length]}`.slice(0, 120),
        note: `Luyện tại ${info.path}. Gợi ý ${info.rec}/ngày.`,
        remind: t.remindFirst ? first : true,
      });
      first = false;
      cur += m + t.breakMin;
    }
    n++;
  }
  return out;
}

/** Hai khung giờ có chồng lên nhau không. */
export const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/** Thời gian theo kỹ năng trong một tập khung giờ: đã lên kế hoạch và đã hoàn thành. */
export function skillMinutes(slots: Slot[]): Record<CoreSkill | "mock" | "other", { planned: number; done: number }> {
  const out = { listening: { planned: 0, done: 0 }, reading: { planned: 0, done: 0 }, writing: { planned: 0, done: 0 }, speaking: { planned: 0, done: 0 }, mock: { planned: 0, done: 0 }, other: { planned: 0, done: 0 } };
  for (const s of slots) {
    const key = (CORE as string[]).includes(s.skill) ? (s.skill as CoreSkill) : /mock test/i.test(s.title) ? "mock" : "other";
    const m = s.minutes || Math.max(0, toMin(s.end) - toMin(s.start));
    if (s.status !== "skipped") out[key].planned += m;
    if (s.status === "done") out[key].done += m;
  }
  return out;
}

const KEY = "studia-study-template-v1";
export function loadTemplate(): Template {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s ? { ...DEFAULT_TEMPLATE, ...s, minutes: { ...DEFAULT_TEMPLATE.minutes, ...(s.minutes || {}) }, mock: { ...DEFAULT_TEMPLATE.mock, ...(s.mock || {}) } } : DEFAULT_TEMPLATE;
  } catch { return DEFAULT_TEMPLATE; }
}
export function saveTemplate(t: Template) { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {} }
