"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatVnd } from "@/lib/account";

type Pack = { id: string; name: string; books: number; price_vnd: number; description?: string | null; highlight?: boolean };

/** Danh sách gói lượt upload + nút mua (tạo đơn rồi chuyển sang trang thanh toán QR). */
export default function BuyPacks({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [bankReady, setBankReady] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Gói đã chọn ở trang giới thiệu (?pack= hoặc sessionStorage) được làm nổi bật
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    try {
      setPicked(new URLSearchParams(window.location.search).get("pack") || sessionStorage.getItem("studia-pick-pack"));
    } catch {}
  }, []);

  useEffect(() => {
    apiFetch("/billing/packs").then(async (r) => {
      const d = r.ok ? await r.json() : { packs: [] };
      setPacks(d.packs || []);
      setBankReady(d.bank_configured !== false);
    }).catch(() => setPacks([]));
  }, []);

  const buy = async (pack: Pack) => {
    setBusy(pack.id); setError(null);
    try {
      const res = await apiFetch("/billing/orders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pack_id: pack.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.detail === "string" ? d.detail : "Không tạo được đơn");
      try { sessionStorage.removeItem("studia-pick-pack"); } catch {}
      router.push(`/billing/${d.order.id}`);
    } catch (e: any) {
      setError(e?.message || "Không tạo được đơn");
      setBusy(null);
    }
  };

  if (packs === null) return <div className={compact ? "stack" : "grid-3"} style={{ gap: 10 }}>{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: compact ? 64 : 220 }} />)}</div>;
  if (!packs.length || !bankReady) {
    return (
      <div className="st-card" style={{ textAlign: "center" }}>
        <p className="ink2">Hiện chưa mở bán gói lượt upload. Bạn vẫn học được toàn bộ Thư viện Studia.</p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {error && <div role="alert" className="st-alert st-alert-danger">{error}</div>}
      {compact ? (
        packs.map((p) => (
          <button key={p.id} type="button" className="pack-row" data-hot={p.highlight || undefined} data-picked={p.id === picked || undefined} onClick={() => buy(p)} disabled={!!busy}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>+{p.books} sách</b> {p.highlight && <span className="st-badge st-badge-accent" style={{ marginLeft: 6 }}>Chọn nhiều nhất</span>}
              <span className="meta" style={{ display: "block" }}>{p.description || p.name}</span>
            </span>
            {busy === p.id ? <span className="st-spinner" /> : <b className="num">{formatVnd(p.price_vnd)}</b>}
          </button>
        ))
      ) : (
        <div className="grid-3">
          {packs.map((p) => (
            <div key={p.id} className="pack-card" data-hot={p.highlight || undefined} data-picked={p.id === picked || undefined}>
              <span className="label" style={{ color: p.highlight ? "var(--brand)" : undefined }}>{p.id === picked ? `Bạn đã chọn · ${p.name}` : p.highlight ? "Chọn nhiều nhất" : p.name}</span>
              <div className="pack-n num">+{p.books} <span>sách</span></div>
              <b className="num" style={{ font: "650 20px/24px var(--font-sans)" }}>{formatVnd(p.price_vnd)}</b>
              <p className="meta" style={{ fontSize: 14 }}>
                {p.description || "Mỗi lượt tải lên một cuốn sách."} · khoảng {formatVnd(Math.round(p.price_vnd / p.books))}/sách
              </p>
              <button type="button" className={`st-btn ${p.highlight ? "st-btn-primary" : "st-btn-secondary"} st-btn-block`} onClick={() => buy(p)} disabled={!!busy} style={{ marginTop: "auto" }}>
                {busy === p.id ? <span className="st-spinner" /> : "Chọn gói"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
