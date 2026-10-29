"use client";

import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import GoogleButton from "@/components/GoogleButton";

type Mode = "signin" | "signup";

function LoginForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const err = searchParams?.get("error_description") || searchParams?.get("error");
    if (err) {
      setError(err);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    const { data, error: authError } = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (authError) {
      setError(authError.message);
    } else if (mode === "signup" && !data.session) {
      setNotice("Đã gửi email xác nhận. Hãy mở hộp thư để kích hoạt tài khoản rồi đăng nhập.");
      setMode("signin");
    }
    // Khi có session, AuthGate tự chuyển về trang chính.
    setLoading(false);
  };

  return (
    <div className="login-shell">
      <section className="login-brand" aria-hidden="true">
        <Logo height={34} className="login-logo" />
        <div>
          <h2 className="login-headline">Luyện IELTS mỗi ngày, thấy rõ <span>từng nấc band</span>.</h2>
          <p className="login-sub">Thi thử như phòng thi thật, ôn từ đúng lúc sắp quên và luyện nói với trợ lý AI.</p>
        </div>
        <div className="login-bubbles">
          <div className="chat-bubble chat-bubble-user" style={{ animationDelay: "200ms" }}>It was very beautiful and crowded.</div>
          <div className="chat-bubble chat-bubble-ai" style={{ animationDelay: "500ms" }}>Thử <mark>breathtaking</mark> thay cho &quot;very beautiful&quot; nhé.</div>
        </div>
      </section>

      <main className="login-main">
        <form onSubmit={handleSubmit} className="login-card fade-in-up">
          <Logo height={28} className="login-logo-sm" />
          <div>
            <h1 style={{ fontSize: "1.75rem" }}>{mode === "signin" ? "Chào mừng trở lại" : "Tạo tài khoản"}</h1>
            <p style={{ color: "var(--text-muted)", marginTop: 4 }}>
              {mode === "signin" ? "Đăng nhập để tiếp tục lộ trình của bạn." : "Bắt đầu lộ trình IELTS miễn phí."}
            </p>
          </div>

          <GoogleButton label="Đăng nhập với Google" onError={setError} />
          <div className="row" style={{ gap: 12, color: "var(--ink-muted)", fontSize: 13 }} aria-hidden="true">
            <span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />hoặc dùng email<span style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
          </div>

          <label className="st-field">
            <span className="st-field-label">Email</span>
            <input
              type="email" required autoComplete="email" placeholder="ban@email.com"
              value={email} onChange={(e) => setEmail(e.target.value)} className="st-input"
            />
          </label>
          <label className="st-field">
            <span className="st-field-label">Mật khẩu</span>
            <input
              type="password" required minLength={6} placeholder="Tối thiểu 6 ký tự"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password} onChange={(e) => setPassword(e.target.value)} className="st-input"
            />
          </label>

          {mode === "signin" && (
            <Link href="/forgot-password" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--brand)", textDecoration: "none", alignSelf: "flex-end" }}>Quên mật khẩu?</Link>
          )}

          {error && <p role="alert" className="st-alert st-alert-danger fade-in-up">{error}</p>}
          {notice && <p role="status" className="st-alert st-alert-success fade-in-up">{notice}</p>}

          <button type="submit" disabled={loading} className="st-btn st-btn-primary st-btn-lg st-btn-block" aria-busy={loading || undefined}>
            {loading && <span className="spinner" />}
            {mode === "signin" ? "Đăng nhập" : "Đăng ký"}
          </button>

          <Link href="/signup" className="st-btn st-btn-ghost st-btn-block">
            Chưa có tài khoản? Đăng ký
          </Link>
        </form>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-shell" />}>
      <LoginForm />
    </Suspense>
  );
}
