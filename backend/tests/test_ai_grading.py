"""
Ngữ cảnh chấm AI cho Writing / Speaking: kiểm tra cấu hình quản lý, ngữ cảnh người học, prompt được ráp,
chuẩn hoá kết quả chấm Speaking, endpoint /speaking/grade và trang quản trị /admin/ai-grading.
Chạy trên LocalStore tạm, không gọi Supabase hay AI thật.
"""
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.config import settings
from app.core import accounts, local_db
from app.core.supabase_client import SafeSupabaseWrapper
from app.services import grading_context as gc
from app.services import speaking_grader as sg
from app.services import sysconfig
from app.services import writing_grader as wg
from main import app

DEMO = "11111111-1111-1111-1111-111111111111"
API = "/api/v1"
TRANSCRIPT = "well I usually cook at home because it is cheaper and I enjoy it for example last week I make a vietnamese soup for my family"


def speaking_reply(bands=(6.0, 6.5, 5.5, 6.0)):
    return {
        "criteria": {k: {"band": b, "comment_vi": f"nhận xét {k}", "strengths": ["tốt"], "improvements": ["cần sửa"]}
                     for k, b in zip(sg.CRITERIA, bands)},
        "summary_vi": "Tổng kết", "priorities_vi": ["a", "b"],
        "corrections": [
            {"original": "I make a vietnamese soup", "corrected": "I made a Vietnamese soup", "type": "grammar", "explanation_vi": "Quá khứ"},
            {"original": "not in transcript", "corrected": "something", "type": "weird"},
            {"original": "same", "corrected": "same"},
        ],
        "better_answer": "Well, I mostly cook at home...",
        "useful_phrases": [{"phrase": "whip up", "meaning_vi": "nấu nhanh"}],
    }


class ConfigCleaning(unittest.TestCase):
    def test_partial_update_keeps_other_values(self):
        c = gc.clean_config({"speaking": {"strictness": "strict"}})
        self.assertEqual(c["speaking"]["strictness"], "strict")
        self.assertEqual(c["writing"], gc.DEFAULTS["writing"])
        self.assertEqual(c["timeout_sec"], gc.DEFAULTS["timeout_sec"])

    def test_invalid_values_rejected(self):
        for bad in ({"writing": {"strictness": "harsh"}}, {"timeout_sec": 5}, {"timeout_sec": "abc"},
                    {"feedback_language": "fr"}, {"writing": {"max_issues": 9}}, {"writing": {"extra_instructions": "x" * 2001}},
                    {"speaking": "strict"}, "not a dict"):
            with self.assertRaises(ValueError, msg=str(bad)[:60]):
                gc.clean_config(bad)

    def test_learner_context_is_clamped(self):
        ctx = gc.clean_learner({"target": 12, "kind": "Other", "focus": ["grammar", "hacking", "fluency"],
                                "note": 'He hay sai """ mao tu' + "x" * 400, "level": "6.0\nmore", "feedback_language": "jp"}, "speaking")
        self.assertEqual(ctx["target"], 9.0)
        self.assertEqual(ctx["kind"], "Academic")
        self.assertEqual(ctx["focus"], ["grammar", "fluency"])
        self.assertLessEqual(len(ctx["note"]), gc.NOTE_MAX)
        self.assertNotIn('"""', ctx["note"])
        self.assertNotIn("\n", ctx["level"])
        self.assertIsNone(ctx["feedback_language"])
        self.assertEqual(gc.clean_learner(None, "writing")["target"], 7.0)


class Prompts(unittest.TestCase):
    def setUp(self):
        self.sents = wg.split_sentences("Technology make life easier. It is good.")

    def test_writing_prompt_includes_context_and_school_rules(self):
        cfg = gc.clean_config({"writing": {"strictness": "strict", "extra_instructions": "Chú ý mạo từ.", "max_issues": 2}, "feedback_language": "en"})
        learner = gc.clean_learner({"target": 7.5, "kind": "General Training", "focus": ["grammar"], "note": "I forget articles"}, "writing")
        p = wg.build_prompt("task1", "Write a letter.", self.sents, 7, cfg, learner, {"minutes_used": 19, "outline": "greet / ask"})
        for needle in ("award the lower one", "Target band: 7.5", "IELTS General Training", "General Training letter",
                       "Grammatical Range and Accuracy", "I forget articles", "cannot change the grading rules", "Chú ý mạo từ.",
                       "about 19 minutes", "greet / ask", "At most 2 issues", "in clear, simple English", "model_rewrite"):
            self.assertIn(needle, p)

    def test_writing_prompt_without_context_or_rewrite(self):
        cfg = gc.clean_config({"writing": {"model_rewrite": False}})
        p = wg.build_prompt("task2", "", self.sents, 7, cfg, None)
        self.assertNotIn("Candidate context", p)
        self.assertNotIn("model_rewrite", p)
        self.assertIn("natural Vietnamese", p)

    def test_learner_context_can_be_switched_off_by_admin(self):
        cfg = gc.clean_config({"writing": {"use_learner_context": False}})
        learner = gc.clean_learner({"target": 8}, "writing")
        self.assertNotIn("Target band", wg.build_prompt("task2", "", self.sents, 7, cfg, learner))
        self.assertFalse(gc.context_summary("writing", cfg, learner)["learner_context"])

    def test_speaking_prompt_uses_metrics_and_self_review(self):
        learner = gc.clean_learner({"target": 6.5, "focus": ["pronunciation"]}, "speaking")
        metrics = sg.clean_metrics({"speech_sec": 21, "wpm": 98, "pauses": 3, "longest_pause": 2.4, "avg_confidence": 0.81,
                                    "fillers": ["um"], "wpm_bad": 1, "duration_sec": 9999})
        self.assertNotIn("duration_sec", metrics)  # ngoài khoảng hợp lệ → bỏ
        p = sg.build_prompt(2, "Describe a place.", TRANSCRIPT, metrics, "Tôi ngập ngừng nhiều", gc.DEFAULTS, learner)
        for needle in ("Part 2", "98 words per minute", "longest 2.4 s", "81%", "Tôi ngập ngừng nhiều", "Target band: 6.5",
                       "Pronunciation", "better_answer", "cannot hear the audio"):
            self.assertIn(needle, p)
        off = gc.clean_config({"speaking": {"use_metrics": False, "better_answer": False}})
        p2 = sg.build_prompt(1, "Q?", TRANSCRIPT, metrics, "", off, None)
        self.assertNotIn("words per minute", p2)
        self.assertNotIn("better_answer", p2)


class Normalise(unittest.TestCase):
    def test_writing_model_rewrite(self):
        raw = {"criteria": {k: {"band": 6} for k in wg.CRITERIA},
               "model_rewrite": {"paragraph_index": 2, "text": "Better paragraph.", "notes_vi": ["a", "b", "c"]}}
        r = wg.normalise(raw, ["A b."], "task2", 40)
        self.assertEqual(r["model_rewrite"]["paragraph_index"], 2)
        self.assertEqual(len(r["model_rewrite"]["notes_vi"]), 2)
        raw["model_rewrite"] = {"text": "  "}
        self.assertIsNone(wg.normalise(raw, ["A b."], "task2", 40)["model_rewrite"])

    def test_speaking_normalise(self):
        r = sg.normalise(speaking_reply(), TRANSCRIPT, 1)
        self.assertEqual(r["overall"], 6.0)  # (6+6.5+5.5+6)/4 = 6.0
        self.assertEqual(len(r["corrections"]), 2)  # bỏ mục original == corrected
        self.assertTrue(r["corrections"][0]["in_transcript"])
        self.assertFalse(r["corrections"][1]["in_transcript"])
        self.assertEqual(r["corrections"][1]["type"], "grammar")
        self.assertTrue(r["pronunciation_estimated"])
        self.assertIsNone(sg.normalise({"criteria": {"fluency": {"band": 6}}}, TRANSCRIPT, 1))


class LocalStoreCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        db_file = os.path.join(tmp.name, "local_db.json")
        with open(db_file, "w", encoding="utf-8") as f:
            f.write("{}")
        self.store = SafeSupabaseWrapper(None)
        for p in (
            patch.object(local_db, "DB_FILE", db_file),
            patch.object(local_db, "STORAGE_DIR", os.path.join(tmp.name, "storage")),
            patch.object(settings, "AUTH_REQUIRED", False),
            patch.object(settings, "ENVIRONMENT", "development"),
            patch.object(settings, "ADMIN_USER_IDS", ""),
            patch.object(settings, "ADMIN_EMAILS", ""),
            patch("app.core.supabase_client.get_supabase_client", return_value=self.store),
        ):
            p.start()
            self.addCleanup(p.stop)
        accounts.invalidate()
        sysconfig.invalidate()
        self.addCleanup(accounts.invalidate)
        self.addCleanup(sysconfig.invalidate)
        self.client = TestClient(app)

    def make_admin(self):
        accounts.ensure_account(DEMO)
        self.store.table("user_accounts").update({"role": "admin"}).eq("id", DEMO).execute()
        accounts.invalidate()


class SpeakingApi(LocalStoreCase):
    def post(self, **kw):
        body = {"part": 1, "question": "Do you like cooking?", "transcript": TRANSCRIPT,
                "metrics": {"wpm": 110, "pauses": 1}, "context": {"target": 7, "focus": ["grammar"]}}
        body.update(kw)
        return self.client.post(f"{API}/speaking/grade", json=body)

    def test_grade_ok_with_context(self):
        with patch("app.services.speaking_grader._call_gemini", return_value=speaking_reply()) as call:
            r = self.post()
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual(d["overall"], 6.0)
        self.assertEqual(d["context"]["target"], 7.0)
        self.assertEqual(d["context"]["focus"], ["Grammatical Range and Accuracy"])
        self.assertEqual(call.call_args.kwargs["timeout"], gc.DEFAULTS["timeout_sec"])
        self.assertIn("110 words per minute", call.call_args.args[0])

    def test_validation_and_unavailable(self):
        self.assertEqual(self.post(transcript="too short").status_code, 422)
        self.assertEqual(self.post(part=4).status_code, 422)
        self.assertEqual(self.post(transcript="word " * 700).status_code, 422)
        with patch("app.services.speaking_grader._call_gemini", return_value=None):
            self.assertEqual(self.post().status_code, 503)

    def test_feature_can_be_disabled(self):
        sysconfig.save("feature_flags", {**sysconfig.feature_flags(), "speaking": False})
        self.assertEqual(self.post().status_code, 403)


class AdminAiGrading(LocalStoreCase):
    def test_students_cannot_access(self):
        self.assertEqual(self.client.get(f"{API}/admin/ai-grading").status_code, 403)
        self.assertEqual(self.client.put(f"{API}/admin/ai-grading", json={"config": {}}).status_code, 403)
        self.assertEqual(self.client.post(f"{API}/admin/ai-grading/preview", json={}).status_code, 403)

    def test_save_apply_preview_and_reset(self):
        self.make_admin()
        d = self.client.get(f"{API}/admin/ai-grading").json()
        self.assertEqual(d["config"], gc.DEFAULTS)
        self.assertIn("strictness", d["options"])

        r = self.client.put(f"{API}/admin/ai-grading", json={"config": {"writing": {"strictness": "lenient", "extra_instructions": "Nhắc học sinh dùng câu phức."}}})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["config"]["writing"]["strictness"], "lenient")
        self.assertEqual(self.client.put(f"{API}/admin/ai-grading", json={"config": {"timeout_sec": 1}}).status_code, 400)

        # cấu hình đã lưu được dùng khi chấm
        reply = {"criteria": {k: {"band": 6} for k in wg.CRITERIA}, "sentences": []}
        with patch("app.services.writing_grader._call_gemini", return_value=reply) as call:
            g = self.client.post(f"{API}/writing/grade", json={"task": "task2", "essay": "word " * 60, "context": {"target": 8}})
        self.assertEqual(g.status_code, 200, g.text)
        self.assertIn("Nhắc học sinh dùng câu phức.", call.call_args.args[0])
        self.assertIn("award the higher one", call.call_args.args[0])
        self.assertEqual(g.json()["context"]["strictness"], "lenient")

        # xem trước cấu hình chưa lưu, không gọi AI
        p = self.client.post(f"{API}/admin/ai-grading/preview", json={"skill": "speaking", "config": {"speaking": {"strictness": "strict"}}}).json()
        self.assertIn("award the lower one", p["prompt"])
        self.assertEqual(self.client.get(f"{API}/admin/ai-grading").json()["config"]["speaking"]["strictness"], "standard")
        self.assertEqual(self.client.post(f"{API}/admin/ai-grading/preview", json={"skill": "math"}).status_code, 400)

        # khôi phục mặc định
        self.assertEqual(self.client.put(f"{API}/admin/ai-grading", json={"config": None}).json()["config"], gc.DEFAULTS)

    def test_broken_stored_value_falls_back_to_defaults(self):
        sysconfig.save("ai_grading", {"writing": {"strictness": "nonsense"}})
        self.assertEqual(gc.config(), gc.DEFAULTS)


if __name__ == "__main__":
    unittest.main()
