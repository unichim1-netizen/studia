import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.api.v1 import exam as exam_api
from app.config import settings
from test_exam_sets_api import ExamSetsApiTestCase
from test_uploads import OTHER_USER


class SessionTestCase(ExamSetsApiTestCase):
    def setUp(self):
        super().setUp()
        for target in ("app.api.v1.exam.get_supabase_client",):
            p = patch(target, return_value=self.store)
            p.start()
            self.addCleanup(p.stop)
        # Không gọi Gemini thật khi chấm Writing
        p = patch.object(settings, "GEMINI_API_KEY", None)
        p.start()
        self.addCleanup(p.stop)

    def published_set(self):
        doc_id, set_id = self.built_set()
        self.assertEqual(self.client.post(f"/api/v1/exam-sets/{set_id}/publish").status_code, 200)
        key = self.client.get(f"/api/v1/exam-sets/{set_id}", params={"include_key": "true"}).json()["answer_key"]
        return set_id, key

    def create_session(self, set_id=None, exam_type="full"):
        res = self.client.post("/api/v1/exam/sessions", json={"exam_set_id": set_id, "exam_type": exam_type})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def answer(self, session_id, section, number, value):
        return self.client.post(f"/api/v1/exam/sessions/{session_id}/answer",
                                json={"section": section, "question_number": number, "answer": value})


class SessionLifecycleTests(SessionTestCase):
    def test_session_payload_has_no_answers_or_study_materials(self):
        set_id, _key = self.published_set()
        data = self.create_session(set_id)
        text = json.dumps(data)
        for secret in ("accept", "correct_answer", "audioscripts", "WOMAN:", "Hallam", "exam_snapshot", "answer_key"):
            self.assertNotIn(secret, text)
        self.assertEqual(data["session"]["status"], "NOT_STARTED")
        self.assertEqual(data["session"]["sections"], ["listening", "reading", "writing", "speaking"])
        self.assertEqual(len(data["questions"]["listening"]), 40)
        self.assertEqual(len(data["questions"]["reading_passages"]), 3)
        self.assertEqual(data["answers"], {})

    def test_single_skill_session_only_exposes_that_skill(self):
        set_id, _key = self.published_set()
        data = self.create_session(set_id, exam_type="reading")
        self.assertEqual(data["session"]["sections"], ["reading"])
        self.assertEqual((len(data["questions"]["listening"]), len(data["questions"]["reading"])), (0, 40))
        self.assertEqual(data["questions"]["writing_task1"], "")

    def test_reload_restores_answers_and_server_side_clock(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        started = self.client.post(f"/api/v1/exam/sessions/{sid}/start").json()
        self.assertEqual(started["status"], "IN_PROGRESS")
        for number, value in ((1, "25"), (11, "B")):
            self.assertEqual(self.answer(sid, "listening", number, value).status_code, 200)
        self.client.post(f"/api/v1/exam/sessions/{sid}/writing",
                         json={"task": "task2", "content": "My essay text here", "word_count": 0})

        # Tải lại: bắt đầu lại không đặt lại đồng hồ
        again = self.client.post(f"/api/v1/exam/sessions/{sid}/start").json()
        self.assertEqual(again["started_at"], started["started_at"])
        view = self.client.get(f"/api/v1/exam/sessions/{sid}").json()
        self.assertEqual(view["answers"]["listening_1"], "25")
        self.assertEqual(view["answers"]["listening_11"], "B")
        self.assertEqual(view["answers"]["writing_task2"], "My essay text here")
        self.assertEqual(view["answers"]["writing_task2_words"], 4)
        self.assertLessEqual(view["session"]["remaining_seconds"], 1800)
        self.assertGreater(view["session"]["remaining_seconds"], 1700)

    def test_section_clock_starts_when_section_is_entered(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        entered = self.client.post(f"/api/v1/exam/sessions/{sid}/section", json={"section": "reading"}).json()
        self.assertGreater(entered["remaining_seconds"], 3500)
        self.assertEqual(self.client.get(f"/api/v1/exam/sessions/{sid}").json()["session"]["current_section"], "reading")
        self.assertEqual(self.client.post(f"/api/v1/exam/sessions/{sid}/section", json={"section": "nope"}).status_code, 422)

    def test_parallel_answers_are_not_lost(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        with ThreadPoolExecutor(max_workers=10) as pool:
            codes = list(pool.map(lambda n: self.answer(sid, "listening", n, f"a{n}").status_code, range(1, 21)))
        self.assertEqual(set(codes), {200})
        saved = self.client.get(f"/api/v1/exam/sessions/{sid}").json()["answers"]
        self.assertEqual({k: v for k, v in saved.items() if k.startswith("listening_")},
                         {f"listening_{n}": f"a{n}" for n in range(1, 21)})

    def test_validation_and_ownership(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        self.assertEqual(self.answer(sid, "writing", 1, "x").status_code, 422)
        self.assertEqual(self.client.post(f"/api/v1/exam/sessions/{sid}/writing",
                                          json={"task": "task9", "content": "x"}).status_code, 422)
        self.assertEqual(self.client.post("/api/v1/exam/sessions", json={"exam_type": "karaoke"}).status_code, 422)

        foreign_doc = self.upload_pdf(user_id=OTHER_USER)
        with patch.object(settings, "DEFAULT_USER_ID", OTHER_USER):
            foreign_set = self.build(foreign_doc).json()["exam_sets"][0]["id"]
        self.assertEqual(self.client.post("/api/v1/exam/sessions", json={"exam_set_id": foreign_set}).status_code, 404)
        self.store.table("exam_sessions").update({"user_id": OTHER_USER}).eq("id", sid).execute()
        for method, path in (("get", ""), ("post", "/submit"), ("get", "/result"), ("post", "/start")):
            self.assertEqual(self.client.request(method, f"/api/v1/exam/sessions/{sid}{path}").status_code, 404, path)

    def test_sample_session_works_without_a_set_and_is_scored_server_side(self):
        data = self.create_session(None)
        sid = data["session"]["session_id"]
        self.assertNotIn("correct_answer", json.dumps(data))
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        self.answer(sid, "listening", 1, "answer 1")
        result = self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={}).json()
        self.assertEqual(result["section_results"]["listening"]["raw_score"], 1)
        self.assertEqual(result["section_results"]["listening"]["total"], 40)


class ScoringTests(SessionTestCase):
    def submit_with(self, set_id, key, correct_listening=30, correct_reading=0, writing=None):
        sid = self.create_session(set_id)["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        def right_answer(skill, number):
            entry = key[skill][str(number)]
            if entry.get("any_order_with"):  # mỗi câu trong cặp chọn một chữ khác nhau
                return entry["accept"][sorted([number, *entry["any_order_with"]]).index(number)]
            return entry["accept"][0]

        for number in range(1, correct_listening + 1):
            self.answer(sid, "listening", number, right_answer("listening", number))
        for number in range(1, correct_reading + 1):
            self.answer(sid, "reading", number, right_answer("reading", number))
        for task, text in (writing or {}).items():
            self.client.post(f"/api/v1/exam/sessions/{sid}/writing", json={"task": task, "content": text})
        res = self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={"auto_submitted": False})
        self.assertEqual(res.status_code, 200, res.text)
        return sid, res.json()

    def test_scoring_uses_the_exam_set_key_and_band_table(self):
        set_id, key = self.published_set()
        _sid, result = self.submit_with(set_id, key, correct_listening=30, correct_reading=23)
        listening, reading = result["section_results"]["listening"], result["section_results"]["reading"]
        self.assertEqual((listening["raw_score"], listening["total"], listening["band"]), (30, 40, 7.0))
        self.assertEqual((reading["raw_score"], reading["band"]), (23, 6.0))
        self.assertEqual(result["status"], "SUBMITTED")

        review = result["review"]["listening"]
        self.assertEqual(len(review), 40)
        wrong = next(i for i in review if i["number"] == 40)
        self.assertEqual((wrong["is_correct"], wrong["user_answer"], wrong["correct_answers"]),
                         (False, "", key["listening"]["40"]["accept"]))
        self.assertTrue(next(i for i in review if i["number"] == 1)["is_correct"])
        self.assertIn("matching_headings", result["by_type"])
        self.assertIn("Test 1", result["title"])

    def test_either_order_pair_and_duplicate_answers(self):
        set_id, key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        self.answer(sid, "listening", 21, "C")      # đáp án là B, C (thứ tự bất kỳ)
        self.answer(sid, "listening", 22, "B")
        self.answer(sid, "listening", 23, "A")      # câu 23 đáp án khác, trả lời A
        result = self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={}).json()
        flags = {i["number"]: i["is_correct"] for i in result["review"]["listening"]}
        self.assertTrue(flags[21] and flags[22])

        sid2 = self.create_session(set_id)["session"]["session_id"]
        self.answer(sid2, "listening", 21, "B")
        self.answer(sid2, "listening", 22, "B")     # trùng: chỉ một câu được tính
        flags2 = {i["number"]: i["is_correct"] for i in
                  self.client.post(f"/api/v1/exam/sessions/{sid2}/submit", json={}).json()["review"]["listening"]}
        self.assertEqual([flags2[21], flags2[22]], [True, False])

    def test_writing_is_labelled_heuristic_and_speaking_is_not_scored(self):
        set_id, key = self.published_set()
        essay = "The sentence is repeated here to reach a longer length. " * 30
        _sid, result = self.submit_with(set_id, key, correct_listening=0, writing={"task1": essay, "task2": essay})
        writing = result["section_results"]["writing"]
        self.assertEqual(writing["scored_by"], "heuristic")
        self.assertIn("không phản ánh", writing["task1"]["feedback_vi"])
        self.assertIsNone(result["section_results"]["speaking"]["band"])
        self.assertEqual(result["section_results"]["speaking"]["status"], "not_scored")
        bands = [result["section_results"]["listening"]["band"], result["section_results"]["reading"]["band"],
                 writing["band"]]
        self.assertAlmostEqual(result["overall_band"], sum(bands) / 3, delta=0.5)

    def test_ai_writing_scores_are_used_when_available(self):
        set_id, key = self.published_set()

        class FakeLLM:
            def generate_json(self, prompt):
                return {"task_response": 7, "coherence_cohesion": 7, "lexical_resource": 7,
                        "grammatical_range_accuracy": 7, "feedback_vi": "Tốt"}

        with patch.object(exam_api, "GeminiJsonLLM", FakeLLM), patch.object(settings, "GEMINI_API_KEY", "k"):
            essay = "word " * 300
            _sid, result = self.submit_with(set_id, key, correct_listening=0, writing={"task1": essay, "task2": essay})
        writing = result["section_results"]["writing"]
        self.assertEqual((writing["scored_by"], writing["band"]), ("ai", 7.0))
        self.assertEqual(writing["task2"]["criteria"]["lexical_resource"], 7.0)

    def test_submit_is_idempotent_and_blocks_later_answers(self):
        set_id, key = self.published_set()
        sid, first = self.submit_with(set_id, key, correct_listening=5)
        self.assertEqual(self.answer(sid, "listening", 6, "x").status_code, 409)
        second = self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={}).json()
        self.assertEqual(second["submitted_at"], first["submitted_at"])
        self.assertEqual(self.client.get(f"/api/v1/exam/sessions/{sid}/result").json()["overall_band"],
                         first["overall_band"])
        self.assertEqual(self.client.get(f"/api/v1/exam/sessions/{sid}").json()["result"]["session_id"], sid)

    def test_materials_are_returned_only_in_the_result(self):
        set_id, key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        self.assertNotIn("audioscripts", json.dumps(self.client.get(f"/api/v1/exam/sessions/{sid}").json()))
        result = self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={}).json()
        self.assertEqual([m["part"] for m in result["materials"]["audioscripts"]], [1, 2, 3, 4])

    def test_session_keeps_the_key_it_started_with(self):
        set_id, key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        self.answer(sid, "listening", 1, "25")

        self.client.post(f"/api/v1/exam-sets/{set_id}/unpublish")
        edited = json.loads(json.dumps(key))
        edited["listening"]["1"] = {"raw": "99", "accept": ["99"]}
        self.assertEqual(self.client.patch(f"/api/v1/exam-sets/{set_id}", json={"answer_key": edited}).status_code, 200)

        result = self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={}).json()
        self.assertTrue(next(i for i in result["review"]["listening"] if i["number"] == 1)["is_correct"])
        fresh = self.create_session(set_id)["session"]["session_id"]
        self.answer(fresh, "listening", 1, "25")
        again = self.client.post(f"/api/v1/exam/sessions/{fresh}/submit", json={}).json()
        self.assertFalse(next(i for i in again["review"]["listening"] if i["number"] == 1)["is_correct"])

    def test_expired_session_is_auto_submitted_on_next_visit(self):
        set_id, key = self.published_set()
        sid = self.create_session(set_id, exam_type="listening")["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        self.answer(sid, "listening", 1, "25")
        long_ago = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
        self.store.table("exam_sessions").update({"started_at": long_ago}).eq("id", sid).execute()

        view = self.client.get(f"/api/v1/exam/sessions/{sid}").json()
        self.assertEqual(view["session"]["status"], "AUTO_SUBMITTED")
        self.assertEqual(view["result"]["section_results"]["listening"]["raw_score"], 1)

    def test_answers_after_deadline_are_rejected_and_session_auto_submitted(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id, exam_type="listening")["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        self.answer(sid, "listening", 1, "25")
        long_ago = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
        self.store.table("exam_sessions").update({"started_at": long_ago}).eq("id", sid).execute()

        # Không mở lại trang mà gửi thẳng câu trả lời sau giờ: phải bị chặn
        self.assertEqual(self.answer(sid, "listening", 2, "late").status_code, 409)
        result = self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={}).json()
        self.assertEqual(result["status"], "AUTO_SUBMITTED")
        self.assertNotIn("listening_2", self.client.get(f"/api/v1/exam/sessions/{sid}").json()["answers"])

    def test_real_mode_closes_a_section_when_its_clock_runs_out(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        row = self.store.table("exam_sessions").select("*").eq("id", sid).execute().data[0]
        answers = dict(row["answers_json"])
        answers["__meta__"] = {**answers["__meta__"], "section_started": {
            "listening": (datetime.now(timezone.utc) - timedelta(minutes=40)).isoformat()}}
        self.store.table("exam_sessions").update({"answers_json": answers}).eq("id", sid).execute()

        self.assertEqual(self.answer(sid, "listening", 1, "25").status_code, 409)
        self.assertEqual(self.answer(sid, "reading", 1, "TRUE").status_code, 200)

    def test_oversized_list_answer_is_trimmed(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id, exam_type="listening")["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        self.assertEqual(self.answer(sid, "listening", 1, ["x" * 2000] * 50).status_code, 200)
        saved = self.client.get(f"/api/v1/exam/sessions/{sid}").json()["answers"]["listening_1"]
        self.assertEqual((len(saved), len(saved[0])), (10, 500))

    def test_history_lists_sessions_with_bands(self):
        set_id, key = self.published_set()
        sid, result = self.submit_with(set_id, key, correct_listening=10)
        history = self.client.get("/api/v1/exam/sessions").json()["sessions"]
        self.assertEqual([h["session_id"] for h in history], [sid])
        self.assertEqual(history[0]["overall_band"], result["overall_band"])
        self.assertIn("Test 1", history[0]["title"])


class SessionConfigTests(SessionTestCase):
    def create_cfg(self, set_id, **body):
        return self.client.post("/api/v1/exam/sessions", json={"exam_set_id": set_id, **body})

    def test_custom_sections_and_durations(self):
        set_id, _key = self.published_set()
        res = self.create_cfg(set_id, sections=["reading", "listening"], durations={"reading": 20, "listening": 10},
                              session_mode="practice")
        self.assertEqual(res.status_code, 200, res.text)
        session = res.json()["session"]
        self.assertEqual(session["sections"], ["listening", "reading"])  # luôn theo thứ tự L-R-W-S
        self.assertEqual(session["section_durations"], {"listening": 600, "reading": 1200})
        self.assertEqual(session["session_mode"], "practice")
        started = self.client.post(f"/api/v1/exam/sessions/{session['session_id']}/start").json()
        self.assertLessEqual(started["remaining_seconds"], 600)
        self.assertGreater(started["remaining_seconds"], 540)

    def test_invalid_config_is_rejected(self):
        set_id, _key = self.published_set()
        for body in ({"sections": []}, {"sections": ["cooking"]}, {"session_mode": "cheat"},
                     {"sections": ["reading"], "durations": {"reading": 0}},
                     {"sections": ["reading"], "durations": {"reading": 999}}):
            self.assertEqual(self.create_cfg(set_id, **body).status_code, 422, body)

    def test_untimed_only_in_practice_mode(self):
        set_id, _key = self.published_set()
        practice = self.create_cfg(set_id, exam_type="reading", session_mode="practice", untimed=True).json()["session"]
        self.assertTrue(practice["untimed"])
        started = self.client.post(f"/api/v1/exam/sessions/{practice['session_id']}/start").json()
        self.assertIsNone(started["remaining_seconds"])
        real = self.create_cfg(set_id, exam_type="reading", session_mode="real", untimed=True).json()["session"]
        self.assertFalse(real["untimed"])

    def test_untimed_session_never_auto_expires(self):
        set_id, _key = self.published_set()
        sid = self.create_cfg(set_id, exam_type="reading", session_mode="practice",
                              untimed=True).json()["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        long_ago = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        self.store.table("exam_sessions").update({"started_at": long_ago}).eq("id", sid).execute()
        self.assertEqual(self.client.get(f"/api/v1/exam/sessions/{sid}").json()["session"]["status"], "IN_PROGRESS")

    def test_mode_is_in_result_and_history(self):
        set_id, _key = self.published_set()
        sid = self.create_cfg(set_id, exam_type="listening", session_mode="practice").json()["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        result = self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={}).json()
        self.assertEqual(result["session_mode"], "practice")
        self.assertEqual(result["sections"], ["listening"])
        self.assertEqual(self.client.get("/api/v1/exam/sessions").json()["sessions"][0]["session_mode"], "practice")

    def test_old_sessions_default_to_real_mode(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id)["session"]["session_id"]
        row = self.store.table("exam_sessions").select("*").eq("id", sid).execute().data[0]
        snap = dict(row["exam_snapshot"])
        snap.pop("config", None)
        self.store.table("exam_sessions").update({"exam_snapshot": snap}).eq("id", sid).execute()
        session = self.client.get(f"/api/v1/exam/sessions/{sid}").json()["session"]
        self.assertEqual(session["session_mode"], "real")
        self.assertEqual(session["section_durations"]["listening"], 1800)


class ExplainTests(SessionTestCase):
    def submitted(self, set_id):
        sid = self.create_session(set_id, exam_type="reading")["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        self.answer(sid, "reading", 1, "definitely wrong")
        self.client.post(f"/api/v1/exam/sessions/{sid}/submit", json={})
        return sid

    def explain(self, sid, skill="reading", number=1):
        return self.client.post(f"/api/v1/exam/sessions/{sid}/explain", json={"skill": skill, "number": number})

    def test_explanation_needs_a_submitted_session(self):
        set_id, _key = self.published_set()
        sid = self.create_session(set_id, exam_type="reading")["session"]["session_id"]
        self.client.post(f"/api/v1/exam/sessions/{sid}/start")
        self.assertEqual(self.explain(sid).status_code, 409)

    def test_explanation_shape_and_cache(self):
        set_id, _key = self.published_set()
        sid = self.submitted(set_id)
        res = self.explain(sid)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["number"], 1)
        self.assertFalse(body["is_correct"])
        self.assertEqual(body["scored_by"], "rule")
        self.assertTrue(body["correct_answers"])
        self.assertIn("Đáp án đúng", body["explanation_vi"])
        self.assertTrue(body["tip_vi"])
        self.assertEqual(self.explain(sid).json(), body)  # lần hai lấy từ bộ nhớ đệm
        stored = self.client.get(f"/api/v1/exam/sessions/{sid}/result").json()
        self.assertIn("reading_1", stored["explanations"])

    def test_explain_validation_and_ownership(self):
        set_id, _key = self.published_set()
        sid = self.submitted(set_id)
        self.assertEqual(self.explain(sid, skill="writing").status_code, 422)
        self.assertEqual(self.explain(sid, number=199).status_code, 404)
        # require_owned ghi nhớ kết quả đã kiểm tra, nên dùng phiên chưa từng được truy cập
        foreign = self.create_session(set_id, exam_type="reading")["session"]["session_id"]
        self.store.table("exam_sessions").update({"user_id": OTHER_USER}).eq("id", foreign).execute()
        self.assertEqual(self.explain(foreign).status_code, 404)


class ExplainRuleTests(unittest.TestCase):
    CONTENT = {"sections": {"reading": {"passages": [{
        "index": 1, "title": "Sleep",
        "body_markdown": "Researchers found that adults need seven hours of sleep every night. "
                         "Children need considerably more rest than adults do. "
                         "The circadian rhythm is an internal clock that responds to light.",
        "groups": [{"type": "sentence_completion", "questions": [
            {"number": 1, "question": "The ___ is an internal clock that responds to light."}]}]}]}}, "materials": {}}
    KEY = {"reading": {"1": {"accept": ["circadian rhythm"]}}}

    def test_evidence_is_found_by_answer_and_keywords(self):
        from app.services import exam_explain
        res = exam_explain.explain_question(self.CONTENT, self.KEY, {"reading_1": "melatonin"}, "reading", 1)
        self.assertIn("circadian rhythm", res["evidence"])
        self.assertFalse(res["is_correct"])
        self.assertIn("melatonin", res["explanation_vi"])

    def test_ai_evidence_must_be_quoted_from_source(self):
        from app.services import exam_explain

        class FakeLLM:
            def generate_json(self, prompt):
                return {"explanation_vi": "Giải thích AI.", "evidence": "A sentence the passage never says.",
                        "tip_vi": "Mẹo AI"}

        res = exam_explain.explain_question(self.CONTENT, self.KEY, {"reading_1": "circadian rhythm"},
                                            "reading", 1, FakeLLM())
        self.assertEqual(res["scored_by"], "ai")
        self.assertEqual(res["explanation_vi"], "Giải thích AI.")
        self.assertIn("circadian rhythm", res["evidence"])  # bằng chứng bịa bị thay bằng câu thật
        self.assertTrue(res["is_correct"])


if __name__ == "__main__":
    unittest.main()
