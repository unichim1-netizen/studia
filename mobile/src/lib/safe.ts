/** Đọc dữ liệu API một cách phòng thủ: trường thiếu hoặc sai kiểu thì dùng giá trị mặc định, không bao giờ crash. */
export type Obj = Record<string, unknown>;

export const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
export const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
export const bool = (v: unknown, d = false): boolean => (typeof v === "boolean" ? v : d);
export const strs = (v: unknown): string[] => arr(v).map((x) => str(x)).filter(Boolean);
export const optNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
};
