/**
 * Các endpoint backend dùng trong app, kèm chuẩn hoá dữ liệu (xem backend/app/api/v1/*.py).
 * Mọi hàm normalize* nhận `unknown` và luôn trả đối tượng đầy đủ trường.
 */
import { api } from "./api";
import { isIsoDay, todayIso } from "./dates";
import { arr, bool, num, obj, optNum, str, strs } from "./safe";

// ---------------------------------------------------------------- Streak (/schedule/streak)
export type Streak = {
  current: number;
  days_since_active: number | null | undefined;
  longest: number;
  today_done: boolean;
  at_risk: boolean;
  total_days: number;
  next_milestone: number | null;
  to_next_milestone: number;
  week: { date: string; active: boolean; minutes: number }[];
  today: string;
};

export function normalizeStreak(raw: unknown): Streak {
  const o = obj(raw);
  return {
    current: num(o.current),
    days_since_active: o.days_since_active === undefined ? undefined : optNum(o.days_since_active),
    longest: num(o.longest),
    today_done: bool(o.today_done),
    at_risk: bool(o.at_risk),
    total_days: num(o.total_days),
    next_milestone: optNum(o.next_milestone),
    to_next_milestone: num(o.to_next_milestone),
    week: arr(o.week).map((w) => {
      const x = obj(w);
      return { date: str(x.date), active: bool(x.active), minutes: num(x.minutes) };
    }).filter((w) => isIsoDay(w.date)),
    today: isIsoDay(o.today) ? o.today : todayIso(),
  };
}
export const fetchStreak = async () => normalizeStreak(await api("/schedule/streak"));

// ---------------------------------------------------------------- Kế hoạch hôm nay (/learning-paths/today)
export type PlanTask = {
  type: string;
  topic_name: string;
  duration_min: number;
  status: string;
  question_count?: number;
  card_count?: number;
  current_mastery?: number;
};

export function normalizeTask(raw: unknown): PlanTask {
  const t = obj(raw);
  return {
    type: str(t.type, "review"),
    topic_name: str(t.topic_name) || str(t.title) || "Nhiệm vụ",
    duration_min: num(t.duration_min),
    status: str(t.status, "pending"),
    question_count: optNum(t.question_count) ?? undefined,
    card_count: optNum(t.card_count) ?? undefined,
    current_mastery: optNum(t.current_mastery) ?? undefined,
  };
}

export type TodayPlan = { plan_date: string; tasks: PlanTask[]; total_minutes: number; has_plan: boolean };

export async function fetchToday(): Promise<TodayPlan> {
  const o = obj(await api("/learning-paths/today"));
  return {
    plan_date: isIsoDay(o.plan_date) ? o.plan_date : todayIso(),
    tasks: arr(o.tasks).map(normalizeTask),
    total_minutes: num(o.total_minutes),
    has_plan: bool(o.has_plan, arr(o.tasks).length > 0),
  };
}

export async function setTaskStatus(day: string, idx: number, status: string) {
  const o = obj(await api(`/learning-paths/plans/${day}/tasks/${idx}`, { method: "PATCH", body: { status } }));
  return { tasks: arr(o.tasks).map(normalizeTask), status: str(o.status, "pending") };
}

export const taskDone = (t: PlanTask) => t.status === "completed";
export function taskMeta(t: PlanTask): string {
  const kind =
    t.type === "lesson" ? "Học bài mới"
    : t.type === "quiz" ? `Làm ${t.question_count || 5} câu hỏi`
    : t.type === "flashcard_review" ? `Ôn ${t.card_count || 10} flashcard`
    : "Ôn tập";
  return `${kind}${t.duration_min ? `, ${t.duration_min} phút` : ""}`;
}

// ---------------------------------------------------------------- Hồ sơ (/profile) → ngày thi
export type ProfileInfo = { examDate: string | null; target: number | null };

export async function fetchProfile(): Promise<ProfileInfo> {
  const o = obj(await api("/profile"));
  const p = obj(o.profile);
  const examDate = !bool(p.noExam, true) && isIsoDay(p.examDate) ? (p.examDate as string) : null;
  return { examDate, target: optNum(p.target) };
}

// ---------------------------------------------------------------- Flashcard
export type Flashcard = { id: string; front: string; back: string; topic: string; reviewCount: number };

export function normalizeCard(raw: unknown): Flashcard | null {
  const c = obj(raw);
  const id = str(c.flashcard_id) || str(c.id); // RPC get_due_flashcards trả flashcard_id; /review cần đúng id này
  const front = str(c.front) || str(c.question) || str(c.term);
  if (!id || !front) return null;
  return {
    id,
    front,
    back: str(c.back) || str(c.answer) || str(c.definition) || "(Thẻ chưa có mặt sau)",
    topic: str(c.topic_name) || str(c.deck_name),
    reviewCount: num(c.review_count),
  };
}

export async function fetchDueCards(limit = 20): Promise<{ count: number; cards: Flashcard[] }> {
  const o = obj(await api(`/flashcards/due?limit=${limit}`));
  const cards = arr(o.flashcards).map(normalizeCard).filter((c): c is Flashcard => !!c);
  return { count: Math.max(num(o.due_count, cards.length), cards.length), cards };
}

export async function reviewCard(id: string, rating: 1 | 2 | 3 | 4, responseMs: number) {
  const o = obj(await api("/flashcards/review", {
    method: "POST",
    body: { flashcard_id: id, rating, response_time_ms: Math.max(0, Math.round(responseMs)) },
  }));
  return { message: str(o.message) };
}

// ---------------------------------------------------------------- Lịch học (/schedule/*)
export type DayStat = {
  tasks_total: number; tasks_done: number; minutes: number; minutes_planned: number;
  slots: number; slots_done: number; moments: number; attempts: number; active: boolean;
};

function normalizeDayStat(raw: unknown): DayStat {
  const s = obj(raw);
  return {
    tasks_total: num(s.tasks_total), tasks_done: num(s.tasks_done), minutes: num(s.minutes),
    minutes_planned: num(s.minutes_planned), slots: num(s.slots), slots_done: num(s.slots_done),
    moments: num(s.moments), attempts: num(s.attempts), active: bool(s.active),
  };
}

export async function fetchSummary(start: string, end: string): Promise<Record<string, DayStat>> {
  const o = obj(await api(`/schedule/summary?start=${start}&end=${end}`));
  const out: Record<string, DayStat> = {};
  for (const [k, v] of Object.entries(obj(o.days))) if (isIsoDay(k)) out[k] = normalizeDayStat(v);
  return out;
}

export type Skill = "listening" | "reading" | "writing" | "speaking" | "vocab" | "grammar" | "review" | "other";
export const SKILLS: { id: Skill; label: string }[] = [
  { id: "reading", label: "Reading" },
  { id: "listening", label: "Listening" },
  { id: "writing", label: "Writing" },
  { id: "speaking", label: "Speaking" },
  { id: "vocab", label: "Từ vựng" },
  { id: "grammar", label: "Ngữ pháp" },
  { id: "review", label: "Ôn tập" },
  { id: "other", label: "Khác" },
];
export const skillLabel = (s: string) => SKILLS.find((x) => x.id === s)?.label ?? "Khác";

export type Slot = {
  id: string; day: string; start: string; end: string; title: string; note: string;
  skill: string; status: "planned" | "done" | "skipped"; minutes: number;
};

function normalizeSlot(raw: unknown): Slot | null {
  const s = obj(raw);
  const id = str(s.id);
  if (!id) return null;
  const status = str(s.status, "planned");
  return {
    id, day: str(s.day), start: str(s.start).slice(0, 5), end: str(s.end).slice(0, 5),
    title: str(s.title) || "Khung giờ học", note: str(s.note), skill: str(s.skill, "other"),
    status: status === "done" || status === "skipped" ? status : "planned", minutes: num(s.minutes),
  };
}

export type Moment = { id: string; caption: string; url: string | null };

export type DayDetail = {
  date: string;
  plan: { tasks: PlanTask[]; status: string; total_minutes: number } | null;
  slots: Slot[];
  moments: Moment[];
  stats: DayStat;
};

export async function fetchDay(day: string): Promise<DayDetail> {
  const o = obj(await api(`/schedule/day/${day}`));
  const plan = o.plan ? obj(o.plan) : null;
  return {
    date: isIsoDay(o.date) ? o.date : day,
    plan: plan ? { tasks: arr(plan.tasks).map(normalizeTask), status: str(plan.status, "pending"), total_minutes: num(plan.total_minutes) } : null,
    slots: arr(o.slots).map(normalizeSlot).filter((s): s is Slot => !!s),
    moments: arr(o.moments).map((m) => {
      const x = obj(m);
      return { id: str(x.id), caption: str(x.caption), url: str(x.url) || null };
    }).filter((m) => m.id),
    stats: normalizeDayStat(o.stats),
  };
}

export type SlotInput = { day: string; start: string; end: string; title: string; note: string; skill: Skill; remind: boolean };
export async function createSlot(body: SlotInput) {
  return normalizeSlot(obj(await api("/schedule/slots", { method: "POST", body })).slot);
}
export async function updateSlotStatus(id: string, status: Slot["status"]) {
  return normalizeSlot(obj(await api(`/schedule/slots/${id}`, { method: "PATCH", body: { status } })).slot);
}
export async function deleteSlot(id: string) {
  await api(`/schedule/slots/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------- Chấm Writing (/writing/grade)
export type CriterionKey = "task" | "coherence" | "lexical" | "grammar";
export const CRIT_ORDER: CriterionKey[] = ["task", "coherence", "lexical", "grammar"];
export const CRIT_VI: Record<CriterionKey, string> = {
  task: "Hoàn thành yêu cầu đề", coherence: "Mạch lạc và liên kết", lexical: "Vốn từ", grammar: "Ngữ pháp",
};
export const ISSUE_LABEL: Record<string, string> = {
  grammar: "Ngữ pháp", vocabulary: "Từ vựng", spelling: "Chính tả", punctuation: "Dấu câu", style: "Diễn đạt",
};

export type Criterion = { name: string; band: number; comment_vi: string; strengths: string[]; improvements: string[] };
export type Issue = { type: string; text: string; suggestion: string; explanation_vi: string };
export type GradedSentence = { index: number; original: string; corrected: string; changed: boolean; issues: Issue[] };
export type GradeResult = {
  task: string; words: number; min_words: number; under_length: boolean; overall: number;
  criteria: Record<CriterionKey, Criterion>; summary_vi: string; priorities_vi: string[];
  sentences: GradedSentence[]; issue_count: number;
};

export function normalizeGrade(raw: unknown): GradeResult {
  const o = obj(raw);
  const c = obj(o.criteria);
  const criteria = {} as Record<CriterionKey, Criterion>;
  for (const k of CRIT_ORDER) {
    const x = obj(c[k]);
    criteria[k] = {
      name: str(x.name), band: num(x.band), comment_vi: str(x.comment_vi),
      strengths: strs(x.strengths), improvements: strs(x.improvements),
    };
  }
  const sentences = arr(o.sentences).map((s, i) => {
    const x = obj(s);
    const original = str(x.original);
    const corrected = str(x.corrected) || original;
    const issues = arr(x.issues).map((it) => {
      const y = obj(it);
      return { type: str(y.type, "grammar"), text: str(y.text), suggestion: str(y.suggestion), explanation_vi: str(y.explanation_vi) };
    });
    return { index: num(x.index, i), original, corrected, changed: bool(x.changed, corrected !== original || issues.length > 0), issues };
  });
  return {
    task: str(o.task, "task2"), words: num(o.words), min_words: num(o.min_words),
    under_length: bool(o.under_length), overall: num(o.overall), criteria,
    summary_vi: str(o.summary_vi), priorities_vi: strs(o.priorities_vi), sentences,
    issue_count: num(o.issue_count, sentences.reduce((n, s) => n + s.issues.length, 0)),
  };
}

export async function gradeWriting(task: "task1" | "task2", prompt: string, essay: string) {
  // AI chấm bài có thể mất 30–60 giây
  return normalizeGrade(await api("/writing/grade", { method: "POST", body: { task, prompt, essay }, timeoutMs: 120_000 }));
}

export const countWords = (text: string) => (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;

// ---------------------------------------------------------------- Gia sư Coal (/tutor/ask)
export type TutorAnswer = { session_id: string | null; answer: string; follow_ups: string[] };

export async function askTutor(question: string, sessionId: string | null): Promise<TutorAnswer> {
  const o = obj(await api("/tutor/ask", { method: "POST", body: { question, session_id: sessionId }, timeoutMs: 90_000 }));
  return {
    session_id: str(o.session_id) || sessionId,
    answer: str(o.answer).trim() || "Mình chưa trả lời được câu này. Bạn thử hỏi lại theo cách khác nhé.",
    follow_ups: strs(o.follow_up_suggestions).slice(0, 3),
  };
}

// ---------------------------------------------------------------- Cấu hình công khai (/config/public)
export async function fetchPublicConfig(): Promise<{ features: Record<string, boolean>; announcement: { text: string; level: string } | null }> {
  const o = obj(await api("/config/public", { anonymous: true, timeoutMs: 10_000 }));
  const features: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(obj(o.features))) if (typeof v === "boolean") features[k] = v;
  const a = obj(o.announcement);
  const announcement = bool(a.enabled) && str(a.text).trim() ? { text: str(a.text).trim(), level: str(a.level, "info") } : null;
  return { features, announcement };
}

