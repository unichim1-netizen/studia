/**
 * Đăng nhập bằng Google qua Supabase OAuth: mở trang đăng nhập Google trong trình duyệt hệ thống,
 * Supabase chuyển về `studia://auth-callback` (Expo Go: `exp://.../--/auth-callback`) kèm token, app đặt phiên.
 * Không cần module Google riêng nên chạy được trong Expo Go lẫn bản cài.
 *
 * Cần cấu hình một lần trong Supabase (xem mobile/README.md): bật provider Google và thêm địa chỉ chuyển hướng của app.
 */
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { oauthErrorVi, parseAuthUrl } from "./oauthUrl";
import { authErrorVi, supabase } from "./supabase";

// Trên web: đóng cửa sổ đăng nhập khi nó quay về trang auth-callback
WebBrowser.maybeCompleteAuthSession();

export type GoogleResult = { ok: true } | { ok: false; cancelled?: boolean; message?: string };

export async function signInWithGoogle(): Promise<GoogleResult> {
  if (!supabase) return { ok: false, message: "App chưa có cấu hình đăng nhập." };
  const redirectTo = Linking.createURL("auth-callback");
  if (__DEV__) console.log(`[auth] Địa chỉ chuyển hướng Google: ${redirectTo} (thêm vào Supabase > Authentication > URL Configuration)`);
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
    if (error || !data?.url) return { ok: false, message: authErrorVi(error?.message) };

    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== "success") return { ok: false, cancelled: true }; // đóng trình duyệt giữa chừng, không phải lỗi

    const p = parseAuthUrl(res.url);
    if (p.error || p.error_description) return { ok: false, message: oauthErrorVi(p) };
    if (!p.access_token || !p.refresh_token) return { ok: false, message: "Không nhận được phiên đăng nhập từ Google. Thử lại nhé." };

    const { error: e2 } = await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
    if (e2) return { ok: false, message: authErrorVi(e2.message) };
    return { ok: true }; // AuthProvider nhận phiên mới và tự chuyển sang màn hình Hôm nay
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (/popup/i.test(m)) return { ok: false, message: "Trình duyệt đã chặn cửa sổ đăng nhập Google. Cho phép cửa sổ bật lên cho trang này rồi thử lại." };
    if (/network|fetch|timed? ?out/i.test(m)) return { ok: false, message: authErrorVi("network") };
    return { ok: false, message: "Đăng nhập bằng Google không thành công. Thử lại nhé, hoặc đăng nhập bằng email." };
  }
}
