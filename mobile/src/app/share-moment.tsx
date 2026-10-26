import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Reveal } from "@/components/motion";
import { Banner, Button, Field, Row, Screen, Text } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { postMoment } from "@/lib/friends";
import { radius, space, useTheme } from "@/lib/theme";

const PICK = {
  mediaTypes: ["images"] as ImagePicker.MediaType[],
  allowsEditing: true,
  aspect: [1, 1] as [number, number],
  quality: 0.7,
};

/** Chụp (hoặc chọn) một tấm ảnh học, thêm lời nhắn, gửi cho bạn bè. Ảnh cũng lưu vào lịch học và tính vào chuỗi ngày. */
export default function ShareMoment() {
  const { c } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async (fromCamera: boolean) => {
    setError(null);
    try {
      const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError(fromCamera
          ? "Studia chưa được dùng máy ảnh. Vào Cài đặt của điện thoại, bật quyền Máy ảnh cho Studia (hoặc Expo Go) rồi thử lại."
          : "Studia chưa được xem ảnh trong máy. Vào Cài đặt của điện thoại, bật quyền Ảnh rồi thử lại.");
        return;
      }
      const res = fromCamera ? await ImagePicker.launchCameraAsync(PICK) : await ImagePicker.launchImageLibraryAsync(PICK);
      if (!res.canceled && res.assets[0]?.uri) setUri(res.assets[0].uri);
    } catch (e) {
      setError(`Không mở được ${fromCamera ? "máy ảnh" : "thư viện ảnh"}: ${errorMessage(e)}`);
    }
  };

  const send = async () => {
    if (!uri || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postMoment(uri, caption.trim());
      // Bảng tin tự làm mới khi quay lại; mở thẳng vào màn này (không có lịch sử) thì về tab Bạn bè
      if (router.canGoBack()) router.back();
      else router.replace("/friends");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen edges={[]}>
        <Reveal index={0}>
          <View style={[styles.frame, { backgroundColor: c.surfaceSunken }]}>
            {uri ? (
              <>
                <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityLabel="Ảnh sắp gửi" />
                {caption.trim() ? (
                  <View style={styles.captionOnPhoto}>
                    <Text variant="label" style={{ color: "#f8f6f2" }} numberOfLines={3}>{caption.trim()}</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="camera-outline" size={44} color={c.inkMuted} />
                <Text tone="secondary" style={{ textAlign: "center", maxWidth: 240 }}>Chụp góc học của bạn: sách đang mở, bài vừa làm, ly cà phê…</Text>
              </View>
            )}
          </View>
        </Reveal>

        {error ? <Banner text={error} /> : null}

        {uri ? (
          <>
            <Field label="Lời nhắn (không bắt buộc)" value={caption} onChangeText={setCaption} maxLength={200} placeholder="Xong 2 bài Reading rồi" />
            <Text variant="small" tone="muted">Chỉ bạn bè đã chấp nhận mới xem được ảnh này. Bạn có thể ngừng chia sẻ bất cứ lúc nào.</Text>
            <Button title="Gửi cho bạn bè" onPress={send} loading={busy} icon={busy ? undefined : <Ionicons name="paper-plane" size={18} color={c.onBrand} />} />
            <Row gap={space[2]}>
              <Button small variant="secondary" title="Chụp lại" onPress={() => take(true)} disabled={busy} style={{ flex: 1 }} />
              <Button small variant="secondary" title="Chọn ảnh khác" onPress={() => take(false)} disabled={busy} style={{ flex: 1 }} />
            </Row>
          </>
        ) : (
          <>
            <Button title="Chụp ảnh" onPress={() => take(true)} icon={<Ionicons name="camera" size={20} color={c.onBrand} />} />
            <Button title="Chọn từ thư viện" variant="secondary" onPress={() => take(false)} icon={<Ionicons name="images-outline" size={20} color={c.ink} />} />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 1, borderRadius: radius.xl, overflow: "hidden" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3], padding: space[6] },
  captionOnPhoto: { position: "absolute", left: space[3], right: space[3], bottom: space[3], borderRadius: radius.lg, paddingHorizontal: space[4], paddingVertical: space[3], backgroundColor: "rgba(15,31,77,0.72)" },
});
