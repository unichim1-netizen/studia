import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { AuthShell } from "@/components/AuthShell";
import { Banner, Button, Field, Text } from "@/components/ui";
import { WEB_URL } from "@/lib/env";
import { authErrorVi, supabase } from "@/lib/supabase";

/** Gửi email đặt lại mật khẩu. Liên kết trong email mở trang /reset-password của web Studia (đặt EXPO_PUBLIC_WEB_URL). */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async () => {
    if (!supabase || wait > 0) return;
    const e = email.trim();
    if (!e) return setError("Nhập email của tài khoản nhé.");
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(e, WEB_URL ? { redirectTo: `${WEB_URL}/reset-password` } : undefined);
      if (err) setError(authErrorVi(err.message));
      else {
        setSent(true);
        setWait(60);
      }
    } catch (x) {
      setError(authErrorVi(x instanceof Error ? x.message : "network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Quên mật khẩu" sprite="focus" subtitle="Nhập email, Studia sẽ gửi liên kết để bạn đặt mật khẩu mới.">
      {error ? <Banner text={error} /> : null}
      {sent ? <Banner tone="success" text={`Đã gửi email tới ${email.trim()}. Mở liên kết trong email để đặt mật khẩu mới, rồi quay lại đây đăng nhập.`} /> : null}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="ban@vidu.com" onSubmitEditing={submit} />
      <Button title={wait > 0 ? `Gửi lại sau ${wait} giây` : sent ? "Gửi lại" : "Gửi liên kết"} onPress={submit} loading={busy} disabled={wait > 0} />
      <View style={{ alignItems: "center" }}>
        <Link href="/sign-in"><Text variant="label" tone="brand">Về trang đăng nhập</Text></Link>
      </View>
    </AuthShell>
  );
}
