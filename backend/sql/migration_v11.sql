-- ============================================================
-- Studia Migration v11 — Kết bạn và chia sẻ khoảnh khắc học (app mobile)
-- Chạy sau migration_v10.sql, trong Supabase SQL Editor.
--
--   * friend_profiles:  mã kết bạn (6 ký tự) và tên hiển thị của từng người.
--   * friendships:      lời mời và quan hệ bạn bè (pending -> accepted), mỗi cặp một dòng.
--   * moment_reactions: mỗi người thả tối đa một biểu cảm cho mỗi khoảnh khắc.
--   * study_moments.shared: khoảnh khắc nào được chia sẻ cho bạn bè (mặc định không).
-- Ảnh vẫn nằm trong bucket riêng tư `moments`; backend chỉ cấp link tạm cho chủ ảnh và bạn bè đã chấp nhận.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.friend_profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    CHECK (requester_id <> addressee_id),
    UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships(addressee_id, status);

CREATE TABLE IF NOT EXISTS public.moment_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    moment_id UUID NOT NULL REFERENCES public.study_moments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('flame', 'heart', 'clap')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (moment_id, user_id)
);

ALTER TABLE public.study_moments ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_study_moments_shared ON public.study_moments(user_id, created_at DESC) WHERE shared;

-- Chỉ backend (service_role) đọc/ghi; app không truy cập trực tiếp.
ALTER TABLE public.friend_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moment_reactions ENABLE ROW LEVEL SECURITY;
