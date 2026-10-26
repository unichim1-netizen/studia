import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { View } from "react-native";
import { Button, Row, Text } from "./ui";
import { signInWithGoogle } from "@/lib/googleAuth";
import { space, useTheme } from "@/lib/theme";

/** Nút "Tiếp tục với Google" kèm đường kẻ "hoặc". Lỗi trả về qua onError (hủy giữa chừng thì im lặng). */
export function GoogleButton({ onError, label = "Tiếp tục với Google" }: { onError: (message: string | null) => void; label?: string }) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    onError(null);
    const r = await signInWithGoogle();
    if (!r.ok && !r.cancelled) onError(r.message || "Đăng nhập bằng Google không thành công.");
    setBusy(false);
  };

  return (
    <View style={{ gap: space[3] }}>
      <Row gap={space[3]}>
        <View style={{ flex: 1, height: 1, backgroundColor: c.hairline }} />
        <Text variant="caption" tone="muted">hoặc</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: c.hairline }} />
      </Row>
      <Button variant="secondary" title={label} onPress={go} loading={busy} icon={busy ? undefined : <Ionicons name="logo-google" size={18} color={c.ink} />} />
    </View>
  );
}
