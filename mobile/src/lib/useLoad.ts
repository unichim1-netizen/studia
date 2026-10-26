import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";
import { peekCache, readCache, writeCache } from "./cache";

/**
 * Tải dữ liệu cho một màn hình: trạng thái loading / refreshing / error, tải lại (kéo để làm mới).
 * Có `cacheKey` thì hiện ngay bản đã lưu (RAM rồi đến máy) và làm mới phía sau; lỗi khi làm mới không xoá dữ liệu cũ.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = [], opts: { cacheKey?: string } = {}) {
  const key = opts.cacheKey;
  const [data, setDataState] = useState<T | null>(() => (key ? peekCache<T>(key) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(key && peekCache(key)));
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const keyRef = useRef(key);
  keyRef.current = key;

  const run = useCallback(async (mode: "initial" | "refresh" | "silent") => {
    const id = ++seq.current;
    const k = keyRef.current;
    if (mode === "initial") {
      const cached = k ? peekCache<T>(k) ?? (await readCache<T>(k)) : null;
      if (id !== seq.current) return;
      if (cached) {
        setDataState(cached);
        setLoading(false);
      } else {
        setDataState(null);
        setLoading(true);
      }
    }
    if (mode === "refresh") setRefreshing(true);
    try {
      const v = await loaderRef.current();
      if (id !== seq.current) return;
      setDataState(v);
      setError(null);
      if (k) writeCache(k, v);
    } catch (e) {
      if (id !== seq.current) return;
      setError(errorMessage(e));
    } finally {
      if (id === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    run("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  /** Sửa dữ liệu tại chỗ (vd sau khi tick nhiệm vụ) và lưu luôn vào bộ đệm. */
  const setData = useCallback((fn: (d: T | null) => T | null) => {
    setDataState((d) => {
      const next = fn(d);
      if (keyRef.current && next) writeCache(keyRef.current, next);
      return next;
    });
  }, []);

  return {
    data,
    setData,
    error,
    loading,
    refreshing,
    reload: () => run("initial"),
    refresh: () => run("refresh"),
    silentReload: () => run("silent"),
  };
}
