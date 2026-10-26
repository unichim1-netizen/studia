import { clearCache } from "./cache";
import { API_URL } from "./env";
import { supabase } from "./supabase";

/**
 * Gọi backend Studia (FastAPI, /api/v1) kèm `Authorization: Bearer <access_token>` của phiên Supabase,
 * giống frontend/src/lib/api.ts. Mọi lỗi được gom thành ApiError có câu thông báo tiếng Việt:
 *  - network: mất mạng / không tới được máy chủ
 *  - timeout: máy chủ trả lời quá lâu
 *  - auth:    401, đã thử làm mới token mà vẫn hỏng → đăng xuất để màn hình đăng nhập hiện ra
 *  - http:    402/403/404/422/429/5xx… dùng `detail` tiếng Việt của backend nếu có
 */
export type ApiErrorKind = "network" | "timeout" | "auth" | "http";

export class ApiError extends Error {
  status: number;
  kind: ApiErrorKind;
  constructor(message: string, kind: ApiErrorKind, status = 0) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT = 20_000;

/** Bật khi API trả 401 và app tự đăng xuất; màn hình đăng nhập đọc một lần để báo "phiên đã hết hạn". */
let sessionExpired = false;
export function takeSessionExpired(): boolean {
  const v = sessionExpired;
  sessionExpired = false;
  return v;
}

const STATUS_FALLBACK: Record<number, string> = {
  400: "Yêu cầu chưa hợp lệ.",
  401: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  402: "Bạn đã dùng hết lượt của gói hiện tại.",
  403: "Bạn không có quyền thực hiện thao tác này.",
  404: "Không tìm thấy dữ liệu.",
  409: "Dữ liệu vừa thay đổi ở nơi khác. Tải lại rồi thử lại nhé.",
  413: "Dữ liệu gửi lên quá lớn.",
  422: "Dữ liệu chưa hợp lệ. Kiểm tra lại rồi thử lại.",
  429: "Bạn thao tác quá nhanh. Đợi một chút rồi thử lại.",
  500: "Máy chủ gặp lỗi. Thử lại sau ít phút.",
  502: "Máy chủ đang bận hoặc đang khởi động lại. Thử lại sau ít phút.",
  503: "Dịch vụ tạm thời không khả dụng. Thử lại sau nhé.",
  504: "Máy chủ phản hồi quá lâu. Thử lại sau nhé.",
};

/** Lấy câu thông báo từ `detail` (chuỗi, hoặc mảng lỗi kiểm tra dữ liệu của FastAPI). */
function detailMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (Array.isArray(d)) {
    const msgs = d
      .map((x) => (x && typeof x === "object" && typeof (x as { msg?: unknown }).msg === "string" ? (x as { msg: string }).msg : null))
      .filter(Boolean);
    if (msgs.length) return `Dữ liệu chưa hợp lệ: ${msgs.slice(0, 2).join("; ")}`;
  }
  return null;
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  /** Không gắn token (vd /config/public). */
  anonymous?: boolean;
};

async function token(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function send(path: string, opts: RequestOptions, accessToken: string | null): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  // FormData (tải ảnh): để fetch tự đặt Content-Type kèm boundary
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (accessToken && !opts.anonymous) headers.Authorization = `Bearer ${accessToken}`;

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    return await fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
  } catch {
    if (timedOut) throw new ApiError("Máy chủ phản hồi quá lâu. Kiểm tra mạng rồi thử lại nhé.", "timeout");
    throw new ApiError("Không kết nối được máy chủ Studia. Kiểm tra mạng (hoặc backend đã chạy chưa) rồi thử lại.", "network");
  } finally {
    clearTimeout(timer);
  }
}

/** Gọi API và trả JSON (đã kiểm tra lỗi). Kết quả là `unknown`-an-toàn: luôn chuẩn hoá trước khi dùng. */
export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts, opts.anonymous ? null : await token());

  // 401: token có thể vừa hết hạn, thử làm mới một lần rồi gửi lại.
  if (res.status === 401 && supabase && !opts.anonymous) {
    let fresh: string | null = null;
    try {
      const { data } = await supabase.auth.refreshSession();
      fresh = data.session?.access_token ?? null;
    } catch {
      fresh = null;
    }
    if (fresh) res = await send(path, opts, fresh);
    if (res.status === 401) {
      // Đăng xuất: AuthProvider nghe sự kiện và đưa người dùng về màn hình đăng nhập (có lời nhắn hết phiên).
      sessionExpired = true;
      await clearCache();
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {}
      throw new ApiError(STATUS_FALLBACK[401], "auth", 401);
    }
  }

  const text = await res.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const msg = detailMessage(body) || STATUS_FALLBACK[res.status] || (res.status >= 500 ? STATUS_FALLBACK[500] : `Có lỗi xảy ra (mã ${res.status}).`);
    throw new ApiError(msg, "http", res.status);
  }
  return (body ?? {}) as T;
}

/** Câu thông báo hiển thị được cho mọi loại lỗi. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return "Có lỗi xảy ra. Thử lại nhé.";
}
