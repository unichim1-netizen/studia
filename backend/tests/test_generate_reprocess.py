import json
import unittest
from unittest.mock import patch

from app.config import settings
from app.services.exam_builder.generate import GenerationError, build_practice_exam
from test_ebook import EbookApiTestCase
from test_exam_sets_api import ExamSetsApiTestCase

TEXT = ("Spaced repetition is a learning method in which reviews are separated by gradually increasing intervals "
        "of time. Researchers found that two short reviews on different days protect a memory better than one long "
        "session on a single day. The forgetting curve shows that most of the loss happens during the first day. "
        "Active recall means answering from memory instead of rereading the page, and it strengthens the memory more "
        "than reading again. Mixed practice forces the learner to decide which idea applies before using it.") * 2


class FakeLLM:
    def __init__(self, questions=None, error=None):
        self.questions, self.error = questions, error

    def generate_json(self, prompt):
        if self.error:
            raise self.error
        return {"questions": self.questions}


def good_questions():
    return [
        {"type": "multiple_choice", "question": "Which method separates reviews by increasing intervals?",
         "options": ["Spaced repetition", "Blocked practice", "Cramming", "Shadowing"], "answer": "A",
         "evidence": "Spaced repetition is a learning method in which reviews are separated by gradually increasing "
                     "intervals of time."},
        {"type": "true_false_ng", "question": "Most forgetting happens during the first day.", "options": None,
         "answer": "TRUE", "evidence": "The forgetting curve shows that most of the loss happens during the first day."},
        {"type": "true_false_ng", "question": "Sleep improves every kind of memory.", "options": None,
         "answer": "NOT GIVEN", "evidence": ""},
        {"type": "sentence_completion", "question": "Active recall means answering from ___ instead of rereading.",
         "options": None, "answer": "memory",
         "evidence": "Active recall means answering from memory instead of rereading the page"},
    ]


class PracticeExamGenerationTests(unittest.TestCase):
    def test_valid_questions_are_grouped_numbered_and_keyed(self):
        content, key, report = build_practice_exam("Kiểm tra: Memory", TEXT, 4, FakeLLM(good_questions()))
        groups = content["sections"]["reading"]["passages"][0]["groups"]
        self.assertEqual([g["type"] for g in groups], ["multiple_choice", "true_false_ng", "sentence_completion"])
        self.assertEqual([g["range"] for g in groups], [[1, 1], [2, 3], [4, 4]])
        self.assertEqual(key["reading"]["1"]["accept"], ["A"])
        self.assertEqual(key["reading"]["3"]["accept"], ["NOT GIVEN"])
        self.assertEqual(key["reading"]["4"]["accept"], ["memory"])
        self.assertEqual((report["generated"], content["family"]), (4, "generic"))

    def test_ungrounded_questions_are_dropped(self):
        bad = good_questions() + [
            {"type": "multiple_choice", "question": "Who invented the printing press?",
             "options": ["Gutenberg", "Newton", "Tesla", "Curie"], "answer": "A",
             "evidence": "Gutenberg invented the printing press in the fifteenth century."},
            {"type": "sentence_completion", "question": "Memory is stored in the ___ lobe.", "options": None,
             "answer": "temporal", "evidence": "Memory is stored in the temporal lobe of the brain somewhere."},
            {"type": "multiple_choice", "question": "Pick one of these options please?", "options": ["a", "b"],
             "answer": "Z", "evidence": "Spaced repetition is a learning method in which reviews are separated"},
        ]
        _content, key, report = build_practice_exam("t", TEXT, 10, FakeLLM(bad))
        self.assertEqual(report["generated"], 4)
        self.assertEqual(len(key["reading"]), 4)

    def test_refuses_instead_of_inventing_questions(self):
        with self.assertRaises(GenerationError):
            build_practice_exam("t", TEXT, 5, None)                      # không có AI
        with self.assertRaises(GenerationError):
            build_practice_exam("t", "Too short.", 5, FakeLLM(good_questions()))
        with self.assertRaises(GenerationError):
            build_practice_exam("t", TEXT, 5, FakeLLM(good_questions()[:2]))   # dưới 3 câu đạt
        with self.assertRaises(GenerationError):
            build_practice_exam("t", TEXT, 5, FakeLLM(error=RuntimeError("quota")))


class GenerateApiTests(ExamSetsApiTestCase):
    def setUp(self):
        super().setUp()
        p = patch("app.api.v1.exam.get_supabase_client", return_value=self.store)
        p.start()
        self.addCleanup(p.stop)

    def upload_text_book(self):
        doc = self.upload_pdf("text_book", title="Learning")
        return doc

    def outline(self, doc_id):
        return self.client.get(f"/api/v1/documents/{doc_id}/outline").json()["outline"]

    def test_generate_for_one_chapter_creates_a_playable_generic_set(self):
        doc_id = self.upload_text_book()
        chapter = next(o for o in self.outline(doc_id) if o["text"].startswith("Chapter 2"))
        long_text = {"Spaced repetition": TEXT}
        with patch("app.api.v1.exam_sets.build_practice_exam") as build:
            from app.services.exam_builder.generate import build_practice_exam as real
            build.side_effect = lambda title, text, count, llm: real(title, TEXT, count, FakeLLM(good_questions()))
            with patch.object(settings, "GEMINI_API_KEY", "key"):
                res = self.client.post(f"/api/v1/documents/{doc_id}/exam-sets/generate",
                                       json={"heading_block_id": chapter["block_id"], "question_count": 4})
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["exam_set"]["title"], "Kiểm tra: Chapter 2: Spaced Repetition")
        self.assertEqual(data["exam_set"]["errors"], 0)
        # văn bản gửi cho AI chỉ là chương 2, không phải cả sách
        passed_text = build.call_args.args[1]
        self.assertIn("The intervals in the table below", passed_text)
        self.assertNotIn("Chapter 3", passed_text)
        self.assertNotIn("New information enters memory", passed_text)

        set_id = data["exam_set"]["id"]
        self.assertEqual(self.client.post(f"/api/v1/exam-sets/{set_id}/publish").status_code, 200)
        session = self.client.post("/api/v1/exam/sessions", json={"exam_set_id": set_id, "exam_type": "reading"})
        self.assertEqual(session.status_code, 200, session.text)
        self.assertEqual(len(session.json()["questions"]["reading"]), 4)
        self.assertEqual(session.json()["questions"]["reading_passages"][0]["title"],
                         "Kiểm tra: Chapter 2: Spaced Repetition")

    def test_generate_reports_clear_errors(self):
        doc_id = self.upload_text_book()
        with patch.object(settings, "GEMINI_API_KEY", None):
            res = self.client.post(f"/api/v1/documents/{doc_id}/exam-sets/generate", json={"question_count": 5})
        self.assertEqual(res.status_code, 422)
        self.assertIn("GEMINI_API_KEY", res.json()["detail"])
        self.assertEqual(self.client.post(f"/api/v1/documents/{doc_id}/exam-sets/generate",
                                          json={"heading_block_id": "nope"}).status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/documents/{doc_id}/exam-sets/generate",
                                          json={"question_count": 1}).status_code, 422)


class ReprocessTests(EbookApiTestCase):
    def finish(self, doc_id):
        # index_document bị mock nên trạng thái kẹt ở "processing"; đặt như một tài liệu đã xử lý xong
        self.store.table("documents").update({"processing_status": "completed"}).eq("id", doc_id).execute()

    def test_reprocess_rebuilds_blocks_and_keeps_topics(self):
        doc_id = self.upload_book()
        self.finish(doc_id)
        self.store.table("topics").insert({"id": "t1", "document_id": doc_id, "name": "Memory", "slug": "m"}).execute()
        first_ids = {b["id"] for b in self.all_blocks(doc_id)}
        res = self.client.post(f"/api/v1/documents/{doc_id}/reprocess")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["kept_topics"])
        rebuilt = self.all_blocks(doc_id)
        self.assertEqual(len(rebuilt), 32)
        self.assertTrue(first_ids.isdisjoint({b["id"] for b in rebuilt}))
        self.assertEqual(len(self.rows("topics")), 1)
        # chỉ mục không bị nhân đôi: index_document được gọi lại một lần với enrich=False
        self.assertEqual(self.index.call_args.kwargs.get("enrich"), False)

    def test_reprocess_waits_for_running_jobs_but_not_for_stuck_ones(self):
        doc_id = self.upload_book()
        self.assertEqual(self.client.post(f"/api/v1/documents/{doc_id}/reprocess").status_code, 409)
        # Bị bỏ dở: không còn nhịp tim mới (server tắt giữa chừng) thì xử lý lại được ngay
        old = "2020-01-01T00:00:00+00:00"
        self.store.table("documents").update({"created_at": old, "processing_heartbeat": old}).eq("id", doc_id).execute()
        self.assertEqual(self.client.post(f"/api/v1/documents/{doc_id}/reprocess").status_code, 200)

    def test_reprocess_protects_user_edits(self):
        doc_id = self.upload_book()
        self.finish(doc_id)
        block = self.all_blocks(doc_id)[2]
        self.client.patch(f"/api/v1/documents/{doc_id}/blocks/{block['id']}", json={"text": "My edit."})
        res = self.client.post(f"/api/v1/documents/{doc_id}/reprocess")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"]["requires"], "discard_edits")
        self.assertEqual(self.all_blocks(doc_id)[2]["text"], "My edit.")
        ok = self.client.post(f"/api/v1/documents/{doc_id}/reprocess", params={"discard_edits": "true"})
        self.assertEqual(ok.status_code, 200)
        self.assertNotEqual(self.all_blocks(doc_id)[2]["text"], "My edit.")

    def test_reprocess_text_documents_and_foreign_documents_are_refused(self):
        text_doc = self.client.post("/api/v1/documents/upload", json={"title": "N", "raw_content": "Hello.\n\nWorld."})
        self.assertEqual(self.client.post(f"/api/v1/documents/{text_doc.json()['document_id']}/reprocess").status_code, 409)
        self.assertEqual(self.client.post("/api/v1/documents/nope/reprocess").status_code, 404)


if __name__ == "__main__":
    unittest.main()
