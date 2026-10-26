"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";

/** Cấu hình hệ thống do quản lý đặt (công khai, chỉ đọc): tính năng đang bật, banner, nội dung luyện tập, giới hạn upload. */
export type SiteConfig = {
  features: Record<string, boolean>;
  announcement: { enabled: boolean; text: string; level: "info" | "warning" } | null;
  dictation_segments: { id: string; level: "easy" | "mid" | "hard"; topic: string; text: string }[] | null;
  pronunciation_sentences: { group: string; text: string }[] | null;
  limits: Record<string, number>;
};

const EMPTY: SiteConfig = { features: {}, announcement: null, dictation_segments: null, pronunciation_sentences: null, limits: {} };

/** Đường dẫn thuộc mỗi tính năng (khớp id bên backend: app/services/sysconfig.py). */
export const FEATURE_PATHS: Record<string, string[]> = {
  dictation: ["/dictation"],
  pronunciation: ["/pronunciation"],
  scenarios: ["/scenarios"],
  writing: ["/writing"],
  speaking: ["/speaking"],
  tutor: ["/tutor"],
  exam: ["/exam"],
  flashcards: ["/flashcards", "/vocabulary"],
  practice: ["/practice", "/review", "/quiz"],
  plan: ["/plan"],
};

export function featureForPath(pathname: string): string | null {
  for (const [id, paths] of Object.entries(FEATURE_PATHS)) {
    if (paths.some((p) => pathname === p || pathname.startsWith(p + "/"))) return id;
  }
  return null;
}

/** Tính năng chưa được khai báo (hoặc chưa tải xong cấu hình) coi như đang bật. */
export const featureOn = (cfg: SiteConfig, id: string | null) => !id || cfg.features[id] !== false;

let cache: SiteConfig = EMPTY;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(c: SiteConfig) => void>();
const TTL = 60_000;

export function refreshSiteConfig(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && loadedAt && Date.now() - loadedAt < TTL) return Promise.resolve();
  inflight = fetch(`${API}/config/public`, { cache: "no-store" })
    .then(async (r) => {
      if (!r.ok) return;
      cache = { ...EMPTY, ...(await r.json()) };
      loadedAt = Date.now();
      listeners.forEach((l) => l(cache));
    })
    .catch(() => {})
    .then(() => { inflight = null; });
  return inflight;
}

export function useSiteConfig(): SiteConfig {
  const [cfg, setCfg] = useState<SiteConfig>(cache);
  useEffect(() => {
    listeners.add(setCfg);
    setCfg(cache);
    refreshSiteConfig();
    return () => { listeners.delete(setCfg); };
  }, []);
  return cfg;
}
