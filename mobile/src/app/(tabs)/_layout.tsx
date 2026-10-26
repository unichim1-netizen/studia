import { Tabs } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { TabBar } from "@/components/TabBar";
import { setBadge } from "@/lib/badges";
import { useConfig } from "@/lib/config";
import { refreshFriendBadge } from "@/lib/friends";
import { useTheme } from "@/lib/theme";

/** Số lời mời đang chờ trên icon tab Bạn bè: làm mới khi mở app và khi quay lại app (kể cả khi người dùng tắt thông báo đẩy). */
function useFriendBadge(enabled: boolean) {
  useEffect(() => {
    if (!enabled) { setBadge("friends", 0); return; }
    refreshFriendBadge();
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") refreshFriendBadge(); });
    return () => sub.remove();
  }, [enabled]);
}

/** Tab dưới cùng (thanh nổi chỉ có icon, xem components/TabBar). Tính năng bị quản lý tắt thì ẩn tab (href: null). */
export default function TabsLayout() {
  const { c } = useTheme();
  const { on } = useConfig();
  useFriendBadge(on("friends"));

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: c.canvas },
        // Đổi tab mờ chéo nhẹ; tab ẩn đi được "đóng băng" để không render lại khi đang ở tab khác
        animation: "fade",
        freezeOnBlur: true,
        lazy: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Hôm nay" }} />
      <Tabs.Screen name="flashcards" options={{ title: "Ôn thẻ", href: on("flashcards") ? undefined : null }} />
      <Tabs.Screen name="schedule" options={{ title: "Lịch học", href: on("plan") ? undefined : null }} />
      <Tabs.Screen name="friends" options={{ title: "Bạn bè", href: on("friends") ? undefined : null }} />
      <Tabs.Screen name="writing" options={{ title: "Chấm Writing", href: on("writing") ? undefined : null }} />
      <Tabs.Screen name="tutor" options={{ title: "Hỏi Coal", href: on("tutor") ? undefined : null }} />
    </Tabs>
  );
}
