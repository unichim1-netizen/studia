/**
 * Đọc kết quả đăng nhập OAuth (Supabase) từ URL mà trình duyệt trả về app.
 * Supabase (luồng mặc định) trả token trong phần sau dấu # (`#access_token=...&refresh_token=...`);
 * lỗi có thể nằm ở phần ? hoặc #. Hàm thuần, không phụ thuộc thư viện nên kiểm tra được bằng Node.
 */
export type OAuthParams = { access_token?: string; refresh_token?: string; error?: string; error_description?: string };

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

export function parseAuthUrl(url: string): OAuthParams {
  const out: OAuthParams = {};
  const hash = url.indexOf("#");
  const query = url.indexOf("?");
  const chunks: string[] = [];
  if (query >= 0) chunks.push(url.slice(query + 1, hash > query ? hash : undefined));
  if (hash >= 0) chunks.push(url.slice(hash + 1));
  for (const chunk of chunks) {
    for (const pair of chunk.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = decode(eq >= 0 ? pair.slice(0, eq) : pair);
      const value = decode(eq >= 0 ? pair.slice(eq + 1) : "");
      if (key === "access_token" || key === "refresh_token" || key === "error" || key === "error_description") out[key] = value;
    }
  }
  return out;
}

/** Câu thông báo tiếng Việt cho lỗi OAuth trả về. */
export function oauthErrorVi(p: OAuthParams): string {
  if (p.error === "access_denied") return "Bạn đã huỷ đăng nhập bằng Google.";
  const d = (p.error_description || p.error || "").toLowerCase();
  if (d.includes("redirect")) return "Studia chưa được phép nhận kết quả đăng nhập Google. Nhờ quản trị thêm địa chỉ chuyển hướng của app vào Supabase (xem mobile/README.md).";
  if (d.includes("provider is not enabled") || d.includes("unsupported provider")) return "Đăng nhập bằng Google chưa được bật cho Studia. Hãy đăng nhập bằng email.";
  return `Đăng nhập bằng Google không thành công${p.error_description ? `: ${p.error_description}` : ""}.`;
}
