/**
 * Thông báo đẩy (lời mời kết bạn, ảnh mới của bạn bè) qua expo-notifications và dịch vụ Expo Push.
 *
 * Điều kiện để nhận được thông báo thật:
 *  - chạy trên điện thoại thật (không phải máy ảo hay web);
 *  - Android: phải dùng development build hoặc bản cài của Studia, Expo Go trên Android không nhận push từ SDK 53;
 *  - có EAS project ID (do `npx eas-cli init` ghi vào app.json, hoặc biến EXPO_PUBLIC_EAS_PROJECT_ID).
 * Thiếu điều kiện nào thì `pushStatus()` trả đúng lý do để Cài đặt hiện hướng dẫn thay vì báo lỗi khó hiểu.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isRunningInExpoGo } from "expo";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

/** `npx eas-cli init` ghi ID dự án vào app.json (extra.eas.projectId); biến môi trường dùng khi chưa chạy lệnh đó. */
const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || fromConfig || "";
export const CHANNEL_ID = "friends"; // trùng defaultChannel trong app.json và CHANNEL ở backend/app/services/push.py

const PREF_KEY = "studia-push-pref"; // "off" khi người dùng tự tắt
const TOKEN_KEY = "studia-push-token";
const DISMISS_KEY = "studia-push-prompt-dismissed";

export type PushStatus =
  | "unsupported" // web, máy ảo, hoặc Expo Go trên Android
  | "needs-setup" // thiếu EAS project ID
  | "denied" // hệ điều hành đã chặn, chỉ bật lại được trong Cài đặt máy
  | "ask" // chưa hỏi quyền
  | "off" // có quyền nhưng người dùng tắt trong app
  | "on";

const read = async (k: string) => { try { return await AsyncStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => AsyncStorage.setItem(k, v).catch(() => {});

export function pushSupported(): { ok: boolean; reason?: "unsupported" | "needs-setup" } {
  if (Platform.OS === "web" || !Device.isDevice) return { ok: false, reason: "unsupported" };
  if (Platform.OS === "android" && isRunningInExpoGo()) return { ok: false, reason: "unsupported" };
  if (!EAS_PROJECT_ID) return { ok: false, reason: "needs-setup" };
  return { ok: true };
}

export async function pushStatus(): Promise<PushStatus> {
  const s = pushSupported();
  if (!s.ok) return s.reason!;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return perm.canAskAgain ? "ask" : "denied";
  } catch {
    return "unsupported";
  }
  return (await read(PREF_KEY)) === "off" ? "off" : "on";
}

async function ensureChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Bạn bè",
    description: "Lời mời kết bạn và ảnh mới của bạn bè",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: "#2344c9",
  });
}

/** Lấy mã thiết bị và gửi lên backend (gọi lại mỗi lần mở app để làm mới và đổi chủ khi đổi tài khoản). */
async function registerToken(): Promise<string> {
  await ensureChannel();
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  await api("/friends/push-token", { method: "PUT", body: { token: data, platform: Platform.OS === "ios" ? "ios" : "android" }, timeoutMs: 10_000 });
  await write(TOKEN_KEY, data);
  return data;
}

/** Bật thông báo: xin quyền nếu cần rồi đăng ký. Trả trạng thái sau cùng; ném lỗi tiếng Việt khi đăng ký hỏng. */
export async function enablePush(): Promise<PushStatus> {
  const s = pushSupported();
  if (!s.ok) return s.reason!;
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return perm.canAskAgain ? "ask" : "denied";
  try {
    await registerToken();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    throw new Error(/network|fetch|kết nối|timeout|quá lâu/i.test(msg)
      ? "Chưa bật được thông báo vì mất kết nối. Kiểm tra mạng rồi thử lại."
      : `Chưa bật được thông báo: ${msg || "lỗi không rõ"}`);
  }
  await write(PREF_KEY, "on");
  return "on";
}

/** Tắt thông báo trên máy này: gỡ mã khỏi backend và nhớ lựa chọn. */
export async function disablePush(): Promise<void> {
  await write(PREF_KEY, "off");
  await unregisterDevice();
}

/** Gỡ mã thiết bị khỏi backend (tắt công tắc hoặc đăng xuất) để máy dùng chung không nhận thông báo của người trước. */
export async function unregisterDevice(): Promise<void> {
  const token = await read(TOKEN_KEY);
  if (!token) return;
  try {
    await api(`/friends/push-token?token=${encodeURIComponent(token)}`, { method: "DELETE", timeoutMs: 4000 });
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  } catch {
    // Mất mạng: không chặn đăng xuất; backend sẽ chuyển mã sang tài khoản kế tiếp khi họ đăng ký
  }
}

/** Mỗi lần mở app khi đã bật: làm mới đăng ký. Im lặng khi lỗi. */
export async function syncPush(): Promise<void> {
  try {
    if ((await pushStatus()) === "on") await registerToken();
  } catch {}
}

// ---- thẻ mời bật thông báo ở tab Bạn bè (hiện một lần, "Để sau" thì không hỏi lại)
export const promptDismissed = async () => (await read(DISMISS_KEY)) === "1";
export const dismissPrompt = () => write(DISMISS_KEY, "1");

/** Đích mở khi chạm thông báo, theo `data.type` backend gửi. */
export function routeFor(data: unknown): string | null {
  const t = data && typeof data === "object" ? (data as { type?: unknown }).type : null;
  if (t === "friend_request") return "/manage-friends";
  if (t === "friend_accepted" || t === "moment") return "/friends";
  return null;
}
