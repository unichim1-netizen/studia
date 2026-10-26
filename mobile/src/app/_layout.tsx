import { BeVietnamPro_400Regular, BeVietnamPro_600SemiBold, BeVietnamPro_700Bold } from "@expo-google-fonts/be-vietnam-pro";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque";
import { useFonts } from "expo-font";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppErrorBoundary, CrashView } from "@/components/ErrorBoundary";
import { PushBridge } from "@/components/PushBridge";
import { Coal } from "@/components/Coal";
import { Card, Screen, Text } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ConfigProvider } from "@/lib/config";
import { missingEnv } from "@/lib/env";
import { ThemeProvider, useTheme } from "@/lib/theme";

// Giữ màn hình chờ gốc (navy + Coal, giống icon) tới khi font và phiên đăng nhập sẵn sàng, rồi mờ dần.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 250, fade: true });

/** Lỗi ném ra trong một route: expo-router hiện màn hình này kèm nút thử lại. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <CrashView error={error} retry={retry} />;
}

export default function RootLayout() {
  // 4 tệp font (thay vì 6) để mở app nhanh hơn
  const [fontsLoaded, fontError] = useFonts({
    BeVietnamPro_400Regular, BeVietnamPro_600SemiBold, BeVietnamPro_700Bold, BricolageGrotesque_700Bold,
  });
  // Font tải lỗi hoặc quá lâu thì vẫn chạy app bằng font hệ thống.
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 2500);
    return () => clearTimeout(t);
  }, []);
  const fontsReady = fontsLoaded || !!fontError || fontTimeout;

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ConfigProvider>
              {fontsReady ? <RootNav /> : <Splash />}
            </ConfigProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

/** Trên máy, màn hình chờ gốc đang che nên chỉ cần nền trùng màu; bản web không có màn chờ gốc nên vẽ Coal. */
function Splash() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f1f4d" }}>
      {Platform.OS === "web" ? <Coal sprite="happy" size={140} /> : null}
    </View>
  );
}

function RootNav() {
  const { session, ready } = useAuth();
  const { c, scheme } = useTheme();

  useEffect(() => {
    if (ready || missingEnv.length) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (missingEnv.length) return <SetupNeeded />;
  if (!ready) return <Splash />;

  const header = {
    headerShown: true,
    headerStyle: { backgroundColor: c.surface },
    headerTintColor: c.brand,
    headerTitleStyle: { color: c.ink },
    headerShadowVisible: false,
  } as const;

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {session ? <PushBridge /> : null}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas }, animation: "fade", animationDuration: 220 }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" options={{ ...header, title: "Cài đặt", headerBackTitle: "Quay lại", animation: "slide_from_right" }} />
          <Stack.Screen name="manage-friends" options={{ ...header, title: "Thêm bạn", headerBackTitle: "Bạn bè", animation: "slide_from_right" }} />
          <Stack.Screen name="share-moment" options={{ ...header, title: "Chia sẻ khoảnh khắc", headerBackTitle: "Bạn bè", animation: "slide_from_bottom" }} />
          <Stack.Screen name="day/[day]" options={{ ...header, title: "Chi tiết ngày", headerBackTitle: "Lịch", animation: "slide_from_right" }} />
        </Stack.Protected>
        {/* Trang trung gian sau đăng nhập Google: mở được cả khi chưa có phiên */}
        <Stack.Screen name="auth-callback" />
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="sign-up" />
          <Stack.Screen name="forgot-password" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function SetupNeeded() {
  return (
    <Screen>
      <View style={{ alignItems: "center", gap: 12, paddingTop: 24 }}>
        <Coal sprite="surprised" size={110} still />
        <Text variant="title" style={{ textAlign: "center" }}>Thiếu cấu hình</Text>
      </View>
      <Card>
        <Text>App chưa có thông tin kết nối Supabase. Tạo tệp <Text variant="label">mobile/.env</Text> từ <Text variant="label">.env.example</Text>, điền các biến sau rồi khởi động lại <Text variant="label">npx expo start</Text>:</Text>
        {missingEnv.map((k) => <Text key={k} variant="label" tone="brand">• {k}</Text>)}
      </Card>
    </Screen>
  );
}
