"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const GSI_SRC = "https://accounts.google.com/gsi/client";

type Gsi = {
  accounts: { id: {
    initialize: (c: Record<string, unknown>) => void;
    renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
  } };
};

let gsiLoading: Promise<Gsi> | null = null;
function loadGsi(): Promise<Gsi> {
  const w = window as unknown as { google?: Gsi };
  if (w.google?.accounts?.id) return Promise.resolve(w.google);
  if (!gsiLoading) {
    gsiLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GSI_SRC; s.async = true; s.defer = true;
      s.onload = () => (w.google ? resolve(w.google) : reject(new Error("gsi")));
      s.onerror = () => { gsiLoading = null; reject(new Error("gsi")); };
      document.head.appendChild(s);
    });
  }
  return gsiLoading;
}

const sha256Hex = async (t: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const GOOGLE_ICON = (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

/**
 * Đăng nhập / đăng ký bằng Google.
 * - Có NEXT_PUBLIC_GOOGLE_CLIENT_ID: dùng Google Identity Services + signInWithIdToken → hộp thoại Google hiện tên ứng dụng
 *   (Studia), không chuyển hướng qua <ref>.supabase.co.
 * - Không có: quay về luồng OAuth chuyển hướng của Supabase.
 */
export default function GoogleButton({ label = "Tiếp tục với Google", onError }: { label?: string; onError?: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [gsiReady, setGsiReady] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  const nonce = useRef<{ raw: string; hashed: string } | null>(null);
  const onErr = useRef(onError);
  onErr.current = onError;

  useEffect(() => {
    if (!CLIENT_ID) return;
    let alive = true;
    (async () => {
      try {
        const raw = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
        nonce.current = { raw, hashed: await sha256Hex(raw) };
        const g = await loadGsi();
        if (!alive || !slot.current) return;
        g.accounts.id.initialize({
          client_id: CLIENT_ID,
          nonce: nonce.current.hashed,
          use_fedcm_for_prompt: true,
          callback: async (resp: { credential?: string }) => {
            if (!resp.credential) return;
            setBusy(true);
            const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: resp.credential, nonce: nonce.current?.raw });
            if (error) { setBusy(false); onErr.current?.(error.message); }
            // Thành công: onAuthStateChange trong AuthGate sẽ chuyển trang
          },
        });
        const width = Math.min(400, slot.current.parentElement?.clientWidth || 320);
        g.accounts.id.renderButton(slot.current, { type: "standard", theme: "outline", size: "large", shape: "pill", text: label.includes("Đăng ký") ? "signup_with" : "signin_with", logo_alignment: "center", width, locale: "vi" });
        setGsiReady(true);
      } catch { if (alive) setGsiReady(false); }
    })();
    return () => { alive = false; };
  }, [label]);

  const redirect = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: "select_account" } },
    });
    if (error) {
      setBusy(false);
      onError?.(error.message.includes("provider is not enabled")
        ? "Đăng nhập Google chưa được bật. Quản trị viên cần bật Google trong Supabase › Authentication › Providers."
        : error.message);
    }
  };

  return (
    <>
      {CLIENT_ID && (
        <div style={{ display: gsiReady ? "flex" : "none", justifyContent: "center", opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>
          <div ref={slot} />
        </div>
      )}
      {!(CLIENT_ID && gsiReady) && (
        <button type="button" onClick={redirect} disabled={busy} aria-busy={busy || undefined} className="st-btn st-btn-secondary st-btn-lg st-btn-block"
          style={{ gap: 12, fontWeight: 600 }}>
          {GOOGLE_ICON}
          {busy ? "Đang chuyển tới Google…" : label}
        </button>
      )}
    </>
  );
}
