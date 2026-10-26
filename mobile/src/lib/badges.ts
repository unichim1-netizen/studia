import { useSyncExternalStore } from "react";

/** Số nhỏ trên thanh điều hướng (vd thẻ đến hạn), vì thanh chỉ có icon nên cần thêm tín hiệu này. */
const values: Record<string, number> = {};
const listeners = new Set<() => void>();

export function setBadge(tab: string, n: number) {
  const v = Math.max(0, Math.floor(n || 0));
  if (values[tab] === v) return;
  values[tab] = v;
  listeners.forEach((l) => l());
}

export function useBadge(tab: string): number {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => values[tab] ?? 0,
    () => 0,
  );
}
