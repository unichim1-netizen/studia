import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { fetchPublicConfig } from "./studia";

/**
 * Cờ tính năng từ GET /config/public (id khớp backend/app/services/sysconfig.py).
 * Tính năng chưa khai báo hoặc chưa tải được cấu hình thì coi như đang bật, giống web (featureOn).
 */
type Ctx = {
  features: Record<string, boolean>;
  announcement: { text: string; level: string } | null;
  on: (id: string) => boolean;
  refresh: (force?: boolean) => void;
};

const TTL = 60_000;
const ConfigCtx = createContext<Ctx>({ features: {}, announcement: null, on: () => true, refresh: () => {} });

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [announcement, setAnnouncement] = useState<Ctx["announcement"]>(null);

  const lastAt = useRef(0);
  const inflight = useRef(false);

  const refresh = useCallback((force = true) => {
    // Quay lại app nhiều lần liên tiếp (web: mỗi lần đổi tab/cửa sổ) thì tối đa 1 lần mỗi phút, giống TTL của web
    if (inflight.current || (!force && Date.now() - lastAt.current < TTL)) return;
    inflight.current = true;
    fetchPublicConfig()
      .then((cfg) => {
        lastAt.current = Date.now();
        setFeatures((old) => (JSON.stringify(old) === JSON.stringify(cfg.features) ? old : cfg.features));
        setAnnouncement((old) => (JSON.stringify(old) === JSON.stringify(cfg.announcement) ? old : cfg.announcement));
      })
      .catch(() => {}) // giữ cấu hình cũ khi lỗi
      .finally(() => { inflight.current = false; });
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(false); });
    return () => sub.remove();
  }, [refresh]);

  const on = useCallback((id: string) => features[id] !== false, [features]);
  return <ConfigCtx.Provider value={{ features, announcement, on, refresh }}>{children}</ConfigCtx.Provider>;
}

export const useConfig = () => useContext(ConfigCtx);
