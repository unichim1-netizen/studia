import { Link } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AuthShell } from "@/components/AuthShell";
import { GoogleButton } from "@/components/GoogleButton";
import { Banner, Button, Field, Text } from "@/components/ui";
import { takeSessionExpired } from "@/lib/api";
import { authErrorVi, supabase } from "@/lib/supabase";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired] = useState(takeSessionExpired);

  const submit = async () => {
    if (!supabase) return;
    const e = email.trim();
    if (!e || !password) return setError("Nhập email và mật khẩu nhé.");
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: e, password });
      if (err) setError(authErrorVi(err.message));
      // Thành công: AuthProvider nhận phiên mới và tự chuyển sang màn hình Hôm nay.
    } catch (x) {
      setError(authErrorVi(x instanceof Error ? x.message : "network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Chào mừng trở lại" subtitle="Đăng nhập để Coal tiếp tục học cùng bạn.">
      {expired && !error ? <Banner tone="warning" text="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." /> : null}
      {error ? <Banner text={error} /> : null}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="ban@vidu.com" />
      <Field label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" placeholder="••••••" onSubmitEditing={submit} returnKeyType="go" />
      <Button title="Đăng nhập" onPress={submit} loading={busy} />
      <GoogleButton onError={setError} />
      <View style={{ alignItems: "center", gap: 10 }}>
        <Link href="/forgot-password"><Text variant="label" tone="brand">Quên mật khẩu?</Text></Link>
        <Text tone="secondary">Chưa có tài khoản? <Link href="/sign-up"><Text variant="label" tone="brand">Đăng ký</Text></Link></Text>
      </View>
    </AuthShell>
  );
}
