import { Link } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AuthShell } from "@/components/AuthShell";
import { GoogleButton } from "@/components/GoogleButton";
import { Banner, Button, Field, Text } from "@/components/ui";
import { authErrorVi, supabase } from "@/lib/supabase";

export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!supabase) return;
    const e = email.trim();
    if (!e || !password) return setError("Nhập email và mật khẩu nhé.");
    if (password.length < 6) return setError("Mật khẩu cần ít nhất 6 ký tự.");
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: e,
        password,
        options: { data: name.trim() ? { full_name: name.trim() } : undefined },
      });
      if (err) setError(authErrorVi(err.message));
      // Dự án bật xác nhận email: chưa có phiên, nhắc mở hộp thư. Không bật: AuthProvider tự đăng nhập.
      else if (!data.session) setSent(true);
    } catch (x) {
      setError(authErrorVi(x instanceof Error ? x.message : "network"));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Kiểm tra hộp thư" sprite="love" subtitle={`Studia vừa gửi liên kết xác nhận tới ${email.trim()}. Bấm vào liên kết rồi quay lại đăng nhập nhé.`}>
        <Link href="/sign-in" asChild><Button title="Về trang đăng nhập" /></Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Tạo tài khoản" subtitle="Miễn phí. Coal sẽ đếm streak và nhắc bạn học mỗi ngày.">
      {error ? <Banner text={error} /> : null}
      <Field label="Tên của bạn" value={name} onChangeText={setName} autoComplete="name" textContentType="name" placeholder="Minh Anh" />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="ban@vidu.com" />
      <Field label="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="Ít nhất 6 ký tự" onSubmitEditing={submit} returnKeyType="go" />
      <Button title="Đăng ký" onPress={submit} loading={busy} />
      <GoogleButton onError={setError} label="Đăng ký bằng Google" />
      <View style={{ alignItems: "center" }}>
        <Text tone="secondary">Đã có tài khoản? <Link href="/sign-in"><Text variant="label" tone="brand">Đăng nhập</Text></Link></Text>
      </View>
    </AuthShell>
  );
}
