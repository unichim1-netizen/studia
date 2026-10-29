"""Tiến độ xử lý theo trang và chạy tiếp tài liệu bị bỏ dở khi server khởi động lại (migration v14)."""
from unittest.mock import Mock, patch

from app.services import document_pipeline as dp
from app.services.ai_engine import AIEngine
from app.services.rag_engine import RAGEngine
from test_ebook import EbookApiTestCase

OLD = "2020-01-01T00:00:00+00:00"


class ResumeTestCase(EbookApiTestCase):
    """Upload thật (khối được lưu), còn lập chỉ mục bị mock nên tài liệu dừng ở "processing" như lúc server tắt."""

    def setUp(self):
        super().setUp()
        self.embed = Mock(side_effect=lambda texts: [[0.1, 0.2, 0.3] for _ in texts])
        self.topics = Mock(return_value={"topics": [{"name": "Memory", "slug": "memory"}], "relationships": []})
        self.cards = Mock(return_value=[{"front": "Recall", "back": "Nhớ lại"}])
        for p in (
            patch.object(RAGEngine, "generate_embeddings", self.embed),
            patch.object(AIEngine, "extract_topics_and_graph", self.topics),
            patch.object(AIEngine, "generate_flashcards", self.cards),
        ):
            p.start()
            self.addCleanup(p.stop)

    def doc(self, doc_id):
        return self.store.table("documents").select("*").eq("id", doc_id).execute().data[0]

    def blocks_of(self, doc_id):
        return dp.load_all_blocks(self.store, doc_id)

    def abandon(self, doc_id, **extra):
        """Giả lập server tắt giữa chừng: nhịp tim cũ, vẫn ở trạng thái processing."""
        self.store.table("documents").update({"processing_status": "processing", "processing_heartbeat": OLD,
                                              "created_at": OLD, **extra}).eq("id", doc_id).execute()

    def resume_now(self):
        return dp.resume_stalled(self.store, run=lambda fn, *args: fn(*args))


class ProgressTests(ResumeTestCase):
    def test_upload_records_page_progress_and_heartbeat(self):
        doc_id = self.upload_book()
        row = self.doc(doc_id)
        self.assertEqual(row["page_count"], 6)
        self.assertEqual(row["pages_done"], 6)
        self.assertEqual(row["ocr_page_count"], 0)
        self.assertTrue(row["processing_heartbeat"])
        self.assertIsNone(row.get("ingest_error"))

        status = self.client.get(f"/api/v1/documents/{doc_id}/status").json()
        for key in ("page_count", "pages_done", "ocr_page_count", "ingest_error", "block_count", "stalled"):
            self.assertIn(key, status)
        self.assertEqual(status["page_count"], 6)
        self.assertEqual(status["block_count"], len(self.blocks_of(doc_id)))
        self.assertFalse(status["stalled"])  # nhịp tim vừa ghi

    def test_status_reports_stalled_document(self):
        doc_id = self.upload_book()
        self.abandon(doc_id)
        self.assertTrue(self.client.get(f"/api/v1/documents/{doc_id}/status").json()["stalled"])


class StallDetectionTests(ResumeTestCase):
    def test_live_jobs_are_not_considered_stalled(self):
        doc_id = self.upload_book()
        self.assertNotIn(doc_id, [d["id"] for d in dp.find_stalled(self.store)])  # nhịp tim còn mới

        self.abandon(doc_id)
        with dp._running_lock:
            dp._running.add(doc_id)  # đang chạy ở chính tiến trình này
        try:
            self.assertEqual(dp.find_stalled(self.store), [])
        finally:
            with dp._running_lock:
                dp._running.discard(doc_id)
        self.assertEqual([d["id"] for d in dp.find_stalled(self.store)], [doc_id])

    def test_completed_and_failed_documents_are_ignored(self):
        doc_id = self.upload_book()
        for status in ("completed", "failed"):
            self.abandon(doc_id)
            self.store.table("documents").update({"processing_status": status}).eq("id", doc_id).execute()
            self.assertEqual(dp.find_stalled(self.store), [])

    def test_rows_without_heartbeat_column_wait_longer(self):
        now = dp._parse_time("2026-10-29T10:00:00+00:00")
        row = {"id": "x", "processing_status": "processing", "created_at": "2026-10-29T09:55:00+00:00"}
        self.assertFalse(dp.is_stalled(row, now))  # 5 phút: chưa chắc đã bị bỏ dở
        self.assertTrue(dp.is_stalled({**row, "processing_heartbeat": None}, now))  # có cột nhưng không ai ghi
        self.assertTrue(dp.is_stalled({**row, "created_at": "2026-10-29T09:30:00+00:00"}, now))


class ResumeTests(ResumeTestCase):
    def test_resume_reads_only_missing_pages_then_finishes(self):
        doc_id = self.upload_book()
        before = self.blocks_of(doc_id)
        kept = [b for b in before if b["page_number"] <= 3]
        lost = [b["id"] for b in before if b["page_number"] > 3]
        self.assertTrue(kept and lost)
        # Server tắt khi mới lưu xong 3 trang đầu
        self.store.table("document_blocks").delete().in_("id", lost).execute()
        self.abandon(doc_id, pages_done=3)
        self.index.reset_mock()  # lần gọi lúc upload không tính

        self.assertEqual(self.resume_now(), [doc_id])

        after = self.blocks_of(doc_id)
        self.assertEqual(len(after), len(before))  # không nhân đôi trang đã có
        self.assertEqual([b["text"] for b in after], [b["text"] for b in before])  # đúng thứ tự đọc
        self.assertTrue({b["id"] for b in kept} <= {b["id"] for b in after})  # khối cũ (có thể đã có highlight) giữ nguyên
        row = self.doc(doc_id)
        self.assertEqual(row["processing_status"], "completed")
        self.assertEqual(row["pages_done"], 6)
        self.assertEqual(row["resume_count"], 1)
        self.assertIsNone(row.get("ingest_error"))
        self.assertTrue(self.rows("document_chunks"))
        self.assertEqual(len(self.rows("topics")), 1)
        self.assertEqual(len(self.rows("flashcards")), 1)
        self.index.assert_not_called()  # không chạy lại pipeline từ đầu

    def test_resume_reuses_existing_index_and_topics(self):
        doc_id = self.upload_book()
        dp.reindex_document(self.store, doc_id)  # chỉ mục đã xong trước khi server tắt
        self.store.table("topics").insert({"id": "t1", "document_id": doc_id, "name": "Memory", "slug": "m"}).execute()
        self.store.table("flashcards").insert({"id": "f1", "topic_id": "t1", "document_id": doc_id,
                                               "front": "a", "back": "b"}).execute()
        self.abandon(doc_id)
        self.embed.reset_mock()

        self.resume_now()

        self.assertEqual(self.doc(doc_id)["processing_status"], "completed")
        self.assertEqual(self.embed.call_count, 0)  # không embedding lại chunk đã có
        self.topics.assert_not_called()
        self.cards.assert_not_called()
        self.assertEqual(len(self.rows("topics")), 1)
        self.assertEqual(len(self.rows("flashcards")), 1)

    def test_topics_without_flashcards_get_flashcards(self):
        doc_id = self.upload_book()
        self.store.table("topics").insert({"id": "t1", "document_id": doc_id, "name": "Memory", "slug": "m"}).execute()
        self.abandon(doc_id)
        self.resume_now()
        self.topics.assert_not_called()
        cards = self.rows("flashcards")
        self.assertEqual([c["topic_id"] for c in cards], ["t1"])

    def test_missing_original_file_fails_with_clear_message(self):
        doc_id = self.upload_book()
        path = self.doc(doc_id)["file_path"]
        self.store.storage.from_("documents").remove([path])
        self.abandon(doc_id)
        self.resume_now()
        row = self.doc(doc_id)
        self.assertEqual(row["processing_status"], "failed")
        self.assertIn("tải tệp lên lại", row["ingest_error"])

    def test_gives_up_after_max_resumes(self):
        doc_id = self.upload_book()
        self.abandon(doc_id, resume_count=dp.MAX_RESUMES)
        self.assertEqual(self.resume_now(), [])
        row = self.doc(doc_id)
        self.assertEqual(row["processing_status"], "failed")
        self.assertIn("Xử lý lại", row["ingest_error"])

    def test_fresh_upload_resets_resume_state(self):
        doc_id = self.upload_book()
        self.abandon(doc_id, resume_count=2, ingest_error="old")
        self.store.table("documents").update({"processing_status": "completed"}).eq("id", doc_id).execute()
        self.assertEqual(self.client.post(f"/api/v1/documents/{doc_id}/reprocess").status_code, 200)
        row = self.doc(doc_id)
        self.assertEqual(row["resume_count"], 0)
        self.assertIsNone(row["ingest_error"])
