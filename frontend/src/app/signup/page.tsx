"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import GoogleButton from "@/components/GoogleButton";
import { supabase } from "@/lib/supabase";

function strength(pw: string): number {
  let n = 0;
  if (pw.length >= 8) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw)) n++;
  return n;
}
const HINTS = ["Quá ngắn", "Yếu · thêm độ dài và chữ hoa", "Tạm ổn", "Khá mạnh · thêm một ký tự đặc biệt để an toàn hơn", "Mạnh"];

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [agree, setAgree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const score = strength(pw);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!agree || pw.length < 8) return;
    setBusy(true); setError("");
    const { data, error: err } = await supabase.auth.signUp({
      email, password: pw,
      options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/onboarding` },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    // Có session ngay (tắt xác nhận email): AuthGate tự chuyển; đưa người mới vào thiết lập.
    if (data.session) { window.location.href = "/onboarding"; return; }
    setSent(true); setWait(60);
  };

  return (
    <div className="login-shell">
      <section className="login-brand">
        <Logo height={34} className="login-logo" />
        <div>
          <h2 className="login-headline">Ba phút thiết lập, <span>một lộ trình của riêng bạn</span>.</h2>
          <ol style={{ listStyle: "none", margin: "32px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 18, maxWidth: 520 }}>
            {[
              ["Cho biết band mục tiêu và ngày thi", "Studia chia lộ trình thành từng tuần vừa sức."],
              ["Làm bài kiểm tra trình độ ngắn", "Khoảng 12 phút, không tính giờ, bỏ qua được."],
              ["Bắt đầu ngày học đầu tiên", "Mỗi ngày một danh sách nhiệm vụ rõ ràng."],
            ].map(([t, d], n) => (
              <li key={t} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <b style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, font: "650 13px/1 var(--font-sans)", background: "color-mix(in srgb, var(--on-navy) 12%, transparent)" }}>{n + 1}</b>
                <div><b style={{ fontWeight: 600 }}>{t}</b><p style={{ opacity: 0.8, fontSize: 14.5 }}>{d}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <p style={{ fontSize: 13.5, opacity: 0.7 }}>Miễn phí trong thời gian thử nghiệm.</p>
      </section>

      <main className="login-main">
        {!sent ? (
          <form onSubmit={submit} className="login-card fade-in-up" aria-labelledby="su-h">
            <Logo height={28} className="login-logo-sm" />
            <div>
              <h1 id="su-h" style={{ fontSize: "1.75rem" }}>Tạo tài khoản</h1>
              <p style={{ color: "var(--text-muted)", marginTop: 4 }}>Đã có tài khoản? <Link href="/login" style={{ fontWeight: 600, textDecoration: "none", color: "var(--brand)" }}>Đăng nhập</Link></p>
            </div>
            <GoogleButton label="Đăng ký với Google" onError={setError} />
            <div className="row" style={{ gap: 12, color: "var(--ink-muted)", fontSize: 13 }} aria-hidden="true">
              <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />hoặc đăng ký bằng email<span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
            </div>
            <label className="st-field"><span className="st-field-label">Tên gọi</span>
              <input className="st-input" type="text" autoComplete="given-name" placeholder="Studia sẽ gọi bạn là…" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="st-field"><span className="st-field-label">Email</span>
              <input className="st-input" type="email" required autoComplete="email" placeholder="ban@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="st-field"><span className="st-field-label">Mật khẩu</span>
              <input className="st-input" type="password" required minLength={8} autoComplete="new-password" aria-describedby="pw-hint" placeholder="Tối thiểu 8 ký tự" value={pw} onChange={(e) => setPw(e.target.value)} />
              <span aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 4, marginTop: 8 }}>
                {[0, 1, 2, 3].map((n) => <i key={n} style={{ height: 4, borderRadius: 2, background: n < score ? "var(--success)" : "var(--surface-sunken)" }} />)}
              </span>
              <span id="pw-hint" className="meta">{pw ? HINTS[score] : "Dùng chữ hoa, số và ký tự đặc biệt để mạnh hơn"}</span>
            </label>
            <label className="row" style={{ gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 4 }} />
              <span className="ink2" style={{ fontSize: 14, lineHeight: "21px" }}>Tôi đồng ý với Điều khoản và Chính sách quyền riêng tư.</span>
            </label>
            {error && <p role="alert" className="st-alert st-alert-danger">{error}</p>}
            <button type="submit" disabled={busy || !agree || pw.length < 8} className="st-btn st-btn-primary st-btn-lg st-btn-block" aria-busy={busy || undefined}>
              {busy && <span className="spinner" />}Tạo tài khoản
            </button>
          </form>
        ) : (
          <div className="login-card fade-in-up" role="status">
            <h1 style={{ fontSize: "1.75rem" }}>Kiểm tra hộp thư</h1>
            <p className="ink2">Studia vừa gửi đường dẫn xác nhận tới <b style={{ color: "var(--ink)" }}>{email}</b>. Mở thư và bấm đường dẫn để kích hoạt tài khoản.</p>
            <div style={{ padding: "14px 16px", borderRadius: "var(--radius-md)", background: "var(--surface-sunken)", fontSize: 14 }} className="ink2">
              Không thấy thư? Xem trong mục Quảng cáo hoặc Spam. Thư có thể đến chậm 1–2 phút.
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="st-btn st-btn-secondary" type="button" disabled={wait > 0 || busy} onClick={() => submit()}>
                {wait > 0 ? `Gửi lại sau 0:${String(wait).padStart(2, "0")}` : "Gửi lại"}
              </button>
              <button className="st-btn st-btn-ghost" type="button" onClick={() => setSent(false)}>Đổi email</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
