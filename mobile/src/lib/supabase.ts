import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { SUPABASE_ANON_KEY, SUPABASE_URL, missingEnv } from "./env";

/**
 * Client Supabase dùng chung. Phiên đăng nhập lưu trong AsyncStorage (SecureStore giới hạn ~2KB, không đủ cho phiên Supabase).
 * null khi thiếu biến môi trường: màn hình gốc sẽ hiện hướng dẫn cấu hình.
 */
export const supabase: SupabaseClient | null = missingEnv.length
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Trên web dùng localStorage mặc định; trên máy dùng AsyncStorage
        ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });

// Chỉ tự làm mới token khi app đang mở (hướng dẫn chính thức của Supabase cho React Native).
if (supabase && Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Đổi thông báo lỗi tiếng Anh của Supabase Auth sang tiếng Việt. */
export function authErrorVi(message: string | undefined | null): string {
  const m = (message || "").toLowerCase();
  if (!m) return "Có lỗi xảy ra, thử lại sau nhé.";
  if (m.includes("invalid login credentials")) return "Email hoặc mật khẩu không đúng.";
  if (m.includes("email not confirmed")) return "Email chưa được xác nhận. Mở hộp thư và bấm vào liên kết xác nhận trước nhé.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Email này đã có tài khoản. Hãy đăng nhập.";
  if (m.includes("password should be") || m.includes("at least 6")) return "Mật khẩu cần ít nhất 6 ký tự.";
  if (m.includes("weak password")) return "Mật khẩu quá yếu, hãy thêm chữ số hoặc ký tự đặc biệt.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("for security purposes")) return "Bạn thao tác quá nhanh. Đợi một chút rồi thử lại.";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "Email không hợp lệ.";
  if (m.includes("network") || m.includes("fetch")) return "Không kết nối được máy chủ đăng nhập. Kiểm tra mạng rồi thử lại.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "Hiện chưa mở đăng ký tài khoản mới.";
  return message || "Có lỗi xảy ra, thử lại sau nhé.";
}
