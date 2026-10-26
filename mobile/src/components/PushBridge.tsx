import * as Notifications from "expo-notifications";
import { router, useRootNavigationState } from "expo-router";
import { useEffect, useRef } from "react";
import { refreshFriendBadge } from "@/lib/friends";
import { routeFor, syncPush } from "@/lib/push";

// Thông báo tới khi app đang mở vẫn hiện thành banner (mặc định hệ điều hành sẽ nuốt mất)
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Cầu nối thông báo đẩy, chỉ gắn khi đã đăng nhập (không dùng trên web):
 *  - mỗi lần mở app: làm mới đăng ký mã thiết bị (nếu người dùng đang bật thông báo);
 *  - thông báo tới lúc đang mở app: cập nhật số lời mời trên tab;
 *  - chạm thông báo (cả khi app đang tắt hẳn): mở đúng màn hình.
 */
export function PushBridge() {
  const handled = useRef<string | null>(null);
  const last = Notifications.useLastNotificationResponse();
  const navReady = !!useRootNavigationState()?.key; // chạm thông báo khi app tắt hẳn: đợi router sẵn sàng rồi mới chuyển màn

  useEffect(() => {
    syncPush();
    const sub = Notifications.addNotificationReceivedListener(() => refreshFriendBadge());
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!last || !navReady) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const route = routeFor(last.notification.request.content.data);
    if (route) router.navigate(route as never);
    refreshFriendBadge();
    Notifications.clearLastNotificationResponse();
  }, [last, navReady]);

  return null;
}
