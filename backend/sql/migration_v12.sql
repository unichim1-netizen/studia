-- ============================================================
-- Studia Migration v12 — Thông báo đẩy cho app mobile (lời mời kết bạn, ảnh mới của bạn bè)
-- Chạy sau migration_v11.sql, trong Supabase SQL Editor.
--
--   * push_tokens: mã thông báo Expo của từng thiết bị. Một thiết bị chỉ thuộc một tài khoản
--     (đăng nhập tài khoản khác trên cùng máy thì backend chuyển mã sang tài khoản mới).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_tokens (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens(user_id);

-- Chỉ backend (service_role) đọc/ghi; app không truy cập trực tiếp.
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
