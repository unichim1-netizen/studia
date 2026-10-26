/**
 * Ngữ cảnh người học gửi kèm khi nhờ AI chấm Writing / Speaking: band mục tiêu, Academic/General, trình độ,
 * tiêu chí muốn AI nhận xét kỹ, ghi chú cho giám khảo và ngôn ngữ nhận xét. Lưu ở trình duyệt; mặc định lấy từ hồ sơ.
 */
import { loadProfile } from "@/lib/placement";

export type AiSkill = "writing" | "speaking";
export type AiContext = {
  target: number;
  kind: "Academic" | "General Training";
  level: string;
  note: string;
  feedback_language: "" | "vi" | "en";   // "" = theo mặc định của trung tâm
  focus: Record<AiSkill, string[]>;
};

export const FOCUS_OPTIONS: Record<AiSkill, { id: string; label: string }[]> = {
  writing: [
    { id: "task", label: "Trả lời đúng đề" }, { id: "coherence", label: "Mạch lạc, liên kết" },
    { id: "lexical", label: "Từ vựng" }, { id: "grammar", label: "Ngữ pháp" },
  ],
  speaking: [
    { id: "fluency", label: "Trôi chảy, mạch lạc" }, { id: "lexical", label: "Từ vựng" },
    { id: "grammar", label: "Ngữ pháp" }, { id: "pronunciation", label: "Phát âm" },
  ],
};

export const NOTE_MAX = 300;
export const BANDS = [4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9];

const KEY = "studia-ai-context";

export function defaultContext(): AiContext {
  const p = loadProfile();
  return { target: p.target || 7, kind: p.kind || "Academic", level: p.level || "", note: "", feedback_language: "", focus: { writing: [], speaking: [] } };
}

export function loadContext(): AiContext {
  const d = defaultContext();
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s ? { ...d, ...s, focus: { ...d.focus, ...(s.focus || {}) } } : d;
  } catch { return d; }
}

export function saveContext(c: AiContext) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} }

/** Phần gửi lên API cho một kỹ năng. */
export function payload(c: AiContext, skill: AiSkill) {
  return {
    target: c.target, kind: c.kind, level: c.level.trim(), note: c.note.trim().slice(0, NOTE_MAX),
    focus: c.focus[skill] || [], ...(c.feedback_language ? { feedback_language: c.feedback_language } : {}),
  };
}

/** Ngữ cảnh mà server báo đã dùng khi chấm. */
export type UsedContext = {
  strictness: string; strictness_label: string; feedback_language: string; learner_context: boolean;
  target: number | null; kind: string | null; focus: string[]; school_instructions: boolean;
};

export function describeUsed(u: UsedContext | undefined): string {
  if (!u) return "";
  const parts = [`Mức chấm: ${u.strictness_label}`];
  if (u.learner_context && u.target) parts.push(`mục tiêu band ${u.target.toFixed(1)}`, u.kind || "");
  if (u.focus.length) parts.push(`tập trung: ${u.focus.join(", ")}`);
  if (u.school_instructions) parts.push("theo hướng dẫn của trung tâm");
  if (!u.learner_context) parts.push("không dùng hồ sơ người học");
  return parts.filter(Boolean).join(" · ");
}
