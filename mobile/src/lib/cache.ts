import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Bộ nhớ đệm "hiện ngay dữ liệu cũ, làm mới phía sau" cho các màn hình.
 * Giữ trong RAM (đọc đồng bộ khi mở màn) và AsyncStorage (mở lại app vẫn có dữ liệu ngay, cả khi mất mạng).
 * Tách theo tài khoản; đăng xuất thì xoá sạch để máy dùng chung không lộ dữ liệu.
 */
const PREFIX = "studia-cache:";
const MAX_AGE = 3 * 24 * 3600_000; // dữ liệu quá 3 ngày thì bỏ
type Entry = { at: number; v: unknown };

const mem = new Map<string, Entry>();
let scope = "";

const full = (key: string) => `${PREFIX}${scope}:${key}`;

export function setCacheScope(userId: string | null) {
  const next = userId || "";
  if (next !== scope) {
    mem.clear();
    scope = next;
  }
}

/** Đọc đồng bộ từ RAM (dùng làm state ban đầu, tránh nháy màn hình tải). */
export function peekCache<T>(key: string): T | null {
  const e = mem.get(full(key));
  return e ? (e.v as T) : null;
}

/** Tuổi (ms) của bản trong RAM, Infinity nếu chưa có. */
export function cacheAge(key: string): number {
  const e = mem.get(full(key));
  return e ? Date.now() - e.at : Infinity;
}

export async function readCache<T>(key: string): Promise<T | null> {
  const k = full(key);
  const hit = mem.get(k);
  if (hit) return hit.v as T;
  try {
    const raw = await AsyncStorage.getItem(k);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry;
    if (!e || typeof e.at !== "number" || Date.now() - e.at > MAX_AGE) return null;
    mem.set(k, e);
    return e.v as T;
  } catch {
    return null;
  }
}

export function writeCache(key: string, v: unknown) {
  const k = full(key);
  const e: Entry = { at: Date.now(), v };
  mem.set(k, e);
  AsyncStorage.setItem(k, JSON.stringify(e)).catch(() => {});
}

/** Tải trước vào bộ đệm nếu bản đang có đã cũ hơn `maxAge` (không báo lỗi). */
export function prefetch(key: string, loader: () => Promise<unknown>, maxAge = 60_000) {
  if (cacheAge(key) < maxAge) return;
  loader().then((v) => writeCache(key, v)).catch(() => {});
}

export async function clearCache() {
  mem.clear();
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {}
}
