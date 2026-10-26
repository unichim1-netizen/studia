/** Biến môi trường (Expo chỉ nhúng biến bắt đầu bằng EXPO_PUBLIC_ và phải đọc trực tiếp từng tên). */
const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const API_URL = trimSlash(process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000/api/v1");
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
export const WEB_URL = trimSlash(process.env.EXPO_PUBLIC_WEB_URL || "");

/** Thiếu cấu hình Supabase thì app hiện màn hình hướng dẫn thay vì crash. */
export const missingEnv = [
  !SUPABASE_URL && "EXPO_PUBLIC_SUPABASE_URL",
  !SUPABASE_ANON_KEY && "EXPO_PUBLIC_SUPABASE_ANON_KEY",
].filter(Boolean) as string[];
