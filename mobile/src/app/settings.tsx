import Constants from "expo-constants";
import { useState } from "react";
import { Linking, Switch, View } from "react-native";
import { Coal } from "@/components/Coal";
import { Banner, Button, Card, Chip, Row, Screen, Text } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useConfig } from "@/lib/config";
import { API_URL } from "@/lib/env";
import { usePush } from "@/lib/usePush";
import { space, useTheme, type ThemeMode } from "@/lib/theme";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "Theo máy" },
  { id: "light", label: "Sáng" },
  { id: "dark", label: "Tối" },
];

const FEATURE_NAMES: Record<string, string> = {
  flashcards: "Flashcard", plan: "Lịch học", writing: "Chấm Writing", tutor: "Hỏi Coal",
};

export default function Settings() {
  const { mode, setMode, c } = useTheme();
  const { email, name, signOut } = useAuth();
  const { features, on } = useConfig();
  const push = usePush();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const off = Object.keys(FEATURE_NAMES).filter((k) => features[k] === false);

  const doSignOut = async () => {
    setBusy(true);
    await signOut(); // màn hình đăng nhập tự hiện khi phiên mất
    setBusy(false);
  };

  return (
    <Screen edges={[]}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <Coal sprite="happy-alt" size={64} still />
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>{name}</Text>
          <Text variant="small" tone="muted" numberOfLines={1}>{email}</Text>
        </View>
      </Card>

      <Card>
        <Text variant="heading">Giao diện</Text>
        <Row gap={space[2]}>
          {MODES.map((m) => <Chip key={m.id} label={m.label} active={mode === m.id} onPress={() => setMode(m.id)} />)}
        </Row>
      </Card>

      {on("friends") && push.status ? (
        <Card>
          <Text variant="heading">Thông báo</Text>
          {push.error ? <Banner text={push.error} /> : null}
          {push.status === "unsupported" ? (
            <Text variant="small" tone="secondary">
              Thông báo đẩy chỉ hoạt động trên điện thoại thật, với bản cài Studia hoặc development build. Expo Go trên Android không nhận được thông báo.
            </Text>
          ) : push.status === "needs-setup" ? (
            <>
              <Text variant="small" tone="secondary">Bản app này chưa được cấu hình để nhận thông báo đẩy.</Text>
              <Text variant="caption" tone="muted">Nhà phát triển: chạy `npx eas-cli init` (xem mobile/HUONG_DAN_IOS.md).</Text>
            </>
          ) : push.status === "denied" ? (
            <>
              <Text variant="small" tone="secondary">Studia đang bị tắt quyền thông báo. Bật lại trong Cài đặt của điện thoại để nhận lời mời và ảnh mới của bạn bè.</Text>
              <Button small variant="secondary" title="Mở cài đặt của điện thoại" onPress={() => Linking.openSettings().catch(() => {})} />
            </>
          ) : (
            <Row style={{ justifyContent: "space-between" }} gap={space[3]}>
              <View style={{ flex: 1 }}>
                <Text variant="label">Bạn bè</Text>
                <Text variant="small" tone="secondary">Báo khi có lời mời kết bạn hoặc bạn bè chia sẻ ảnh mới.</Text>
              </View>
              <Switch
                value={push.status === "on"}
                disabled={push.busy}
                onValueChange={(v) => (v ? push.enable() : push.disable())}
                trackColor={{ true: c.brand, false: c.hairline }}
                thumbColor="#ffffff"
                accessibilityLabel="Thông báo từ bạn bè"
              />
            </Row>
          )}
        </Card>
      ) : null}

      {off.length ? (
        <Card tone="sunken">
          <Text variant="label">Đang tạm tắt</Text>
          <Text variant="small" tone="secondary">Quản lý Studia đang tắt: {off.map((k) => FEATURE_NAMES[k]).join(", ")}.</Text>
        </Card>
      ) : null}

      <Card>
        <Text variant="heading">Tài khoản</Text>
        <Text variant="small" tone="secondary">Hồ sơ, mục tiêu band và ngày thi chỉnh trên web Studia, app sẽ tự đồng bộ.</Text>
        {confirm ? (
          <View style={{ gap: space[2] }}>
            <Text>Đăng xuất khỏi Studia trên máy này?</Text>
            <Row gap={space[2]}>
              <Button title="Đăng xuất" variant="danger" onPress={doSignOut} loading={busy} style={{ flex: 1 }} />
              <Button title="Huỷ" variant="ghost" onPress={() => setConfirm(false)} />
            </Row>
          </View>
        ) : (
          <Button title="Đăng xuất" variant="secondary" onPress={() => setConfirm(true)} />
        )}
      </Card>

      <View style={{ gap: 2, alignItems: "center" }}>
        <Text variant="caption" tone="muted">Studia {Constants.expoConfig?.version ?? ""}</Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>Máy chủ: {API_URL}</Text>
      </View>
    </Screen>
  );
}
