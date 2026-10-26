/** Ngày dạng YYYY-MM-DD theo giờ máy, giống frontend/src/lib/schedule.ts. */
export const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
};
export const todayIso = () => iso(new Date());
export const isIsoDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const addMonths = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return iso(d);
};
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
/** Thứ Hai = 0 … Chủ nhật = 6 */
export const weekdayIdx = (s: string) => (parse(s).getDay() + 6) % 7;
export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s: string) => addDays(addMonths(monthStart(s), 1), -1);

export const WEEKDAYS_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
export const WEEKDAYS_LONG = ["Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật"];
export const prettyDate = (s: string) => {
  const d = parse(s);
  return `${WEEKDAYS_LONG[weekdayIdx(s)]}, ${d.getDate()} tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
};
export const monthLabel = (s: string) => {
  const d = parse(s);
  return `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
};
export const fmtMinutes = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} giờ${n % 60 ? ` ${n % 60} phút` : ""}` : `${n} phút`);
export const isHHMM = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
