-- ============================================================
-- Studia Migration v14 — Tiến độ xử lý tài liệu theo trang, chạy tiếp khi server khởi động lại
-- Chạy sau migration_v13.sql, trong Supabase SQL Editor. Chạy lại nhiều lần không sao.
--
-- page_count / pages_done / ocr_page_count: số trang của PDF, số trang đã đọc xong, số trang scan phải OCR.
-- processing_heartbeat: tiến trình đang xử lý ghi lại mỗi 30 giây. Quá 2 phút không thấy nhịp tim
--   thì backend coi việc xử lý đã bị bỏ dở (server tắt giữa chừng) và tự chạy tiếp.
-- resume_count: số lần đã chạy tiếp; quá 3 lần thì dừng hẳn và báo lỗi để người dùng bấm "Xử lý lại".
-- ingest_error: lý do dừng, hiện cho người dùng.
-- ============================================================

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS page_count INT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS pages_done INT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS ocr_page_count INT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS processing_heartbeat TIMESTAMPTZ;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS resume_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS ingest_error TEXT;

-- Vòng quét mỗi phút chỉ đọc các tài liệu đang chờ/đang xử lý
CREATE INDEX IF NOT EXISTS idx_documents_in_progress
    ON public.documents (processing_status)
    WHERE processing_status IN ('pending', 'processing');
