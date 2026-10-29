"""
Lịch học chi tiết: khung giờ, khoảnh khắc (ảnh), streak, nhắc email và bảng giá công khai — chạy trên LocalStore tạm.
"""
import io
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.core import accounts, local_db
from app.core.supabase_client import SafeSupabaseWrapper
from app.services import schedule as sched
from main import app

UID = settings.DEFAULT_USER_ID


def _jpeg(size=(40, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 80, 40)).save(buf, format="JPEG")
    return buf.getvalue()


class StreakMathTestCase(unittest.TestCase):
    today = date(2026, 10, 17)

    def days(self, *offsets):
        return [self.today - timedelta(days=o) for o in offsets]

    def test_no_activity(self):
        s = sched.streak_from_days([], self.today)
        self.assertEqual((s["current"], s["longest"], s["at_risk"]), (0, 0, False))

    def test_streak_through_today(self):
        s = sched.streak_from_days(self.days(0, 1, 2, 4), self.today)
        self.assertEqual(s["current"], 3)
        self.assertTrue(s["today_done"])
        self.assertFalse(s["at_risk"])
        self.assertEqual(s["next_milestone"], 7)

    def test_streak_kept_until_day_ends(self):
        s = sched.streak_from_days(self.days(1, 2, 3), self.today)
        self.assertEqual(s["current"], 3)
        self.assertTrue(s["at_risk"])
        self.assertFalse(s["today_done"])

    def test_streak_broken_after_missing_a_day(self):
        s = sched.streak_from_days(self.days(2, 3, 4, 5, 6), self.today)
        self.assertEqual(s["current"], 0)
        self.assertEqual(s["longest"], 5)

    def test_days_since_active(self):
        self.assertEqual(sched.streak_from_days(self.days(0, 1), self.today)["days_since_active"], 0)
        self.assertEqual(sched.streak_from_days(self.days(1, 2), self.today)["days_since_active"], 1)
        self.assertEqual(sched.streak_from_days(self.days(20, 21, 22), self.today)["days_since_active"], 20)
        self.assertIsNone(sched.streak_from_days([], self.today)["days_since_active"])


class ScheduleApiTestCase(unittest.TestCase):
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
            patch.object(settings, "SMTP_HOST", ""),
            patch("app.core.supabase_client.get_supabase_client", return_value=self.store),
            patch("app.api.v1.schedule.get_supabase_client", return_value=self.store),
            patch("app.api.v1.billing.billing._db", return_value=self.store),
            patch("app.core.accounts._db", return_value=self.store),
        ):
            p.start()
            self.addCleanup(p.stop)
        accounts.invalidate()
        self.client = TestClient(app)
        self.api = settings.API_V1_STR
        self.today = sched.local_today().isoformat()

    def slot(self, **kw):
        body = {"day": self.today, "start": "08:00", "end": "09:00", "title": "Reading Passage 1",
                "note": "Matching headings, làm 13 câu", "skill": "reading", "remind": True}
        body.update(kw)
        return self.client.post(f"{self.api}/schedule/slots", json=body)

    def test_slot_lifecycle_and_hourly_note(self):
        r = self.slot()
        self.assertEqual(r.status_code, 200, r.text)
        slot = r.json()["slot"]
        self.assertEqual(slot["minutes"], 60)
        self.assertEqual(slot["note"], "Matching headings, làm 13 câu")

        r = self.client.patch(f"{self.api}/schedule/slots/{slot['id']}", json={"note": "Đã làm xong, sai 2 câu", "end": "09:30"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["slot"]["minutes"], 90)

        day = self.client.get(f"{self.api}/schedule/day/{self.today}").json()
        self.assertEqual(len(day["slots"]), 1)
        self.assertEqual(day["slots"][0]["note"], "Đã làm xong, sai 2 câu")

        self.assertEqual(self.client.delete(f"{self.api}/schedule/slots/{slot['id']}").status_code, 200)
        self.assertEqual(self.client.get(f"{self.api}/schedule/day/{self.today}").json()["slots"], [])

    def test_slot_validation(self):
        self.assertEqual(self.slot(start="10:00", end="09:00").status_code, 422)
        self.assertEqual(self.slot(start="25:00").status_code, 422)
        self.assertEqual(self.slot(title="   ").status_code, 422)
        self.assertEqual(self.slot(skill="cooking").status_code, 422)
        self.assertEqual(self.slot(day="17/10/2026").status_code, 422)

    def test_cannot_add_slot_to_past_day(self):
        yesterday = (sched.local_today() - timedelta(days=1)).isoformat()
        self.assertEqual(self.slot(day=yesterday).status_code, 422)

    def test_other_users_slot_is_hidden(self):
        slot = self.slot().json()["slot"]
        self.store.table("study_slots").update({"user_id": "someone-else"}).eq("id", slot["id"]).execute()
        self.assertEqual(self.client.patch(f"{self.api}/schedule/slots/{slot['id']}", json={"note": "x"}).status_code, 404)
        self.assertEqual(self.client.delete(f"{self.api}/schedule/slots/{slot['id']}").status_code, 404)

    def test_done_slot_and_moment_build_streak(self):
        self.assertEqual(self.client.get(f"{self.api}/schedule/streak").json()["current"], 0)

        slot = self.slot().json()["slot"]
        self.client.patch(f"{self.api}/schedule/slots/{slot['id']}", json={"status": "done"})
        s = self.client.get(f"{self.api}/schedule/streak").json()
        self.assertEqual(s["current"], 1)
        self.assertTrue(s["today_done"])

        yesterday = (sched.local_today() - timedelta(days=1)).isoformat()
        r = self.client.post(f"{self.api}/schedule/moments", data={"day": yesterday, "caption": "Góc học"},
                             files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.client.get(f"{self.api}/schedule/streak").json()["current"], 2)

    def test_cannot_backfill_streak_by_moving_slot_to_the_past(self):
        slot = self.slot().json()["slot"]
        old = (sched.local_today() - timedelta(days=10)).isoformat()
        r = self.client.patch(f"{self.api}/schedule/slots/{slot['id']}", json={"day": old, "status": "done"})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(self.client.get(f"{self.api}/schedule/streak").json()["current"], 0)

    def test_cannot_mark_future_slot_done_or_move_done_slot_ahead(self):
        tomorrow = (sched.local_today() + timedelta(days=1)).isoformat()
        future = self.slot(day=tomorrow).json()["slot"]
        r = self.client.patch(f"{self.api}/schedule/slots/{future['id']}", json={"status": "done"})
        self.assertEqual(r.status_code, 422)

        slot = self.slot().json()["slot"]
        self.assertEqual(self.client.patch(f"{self.api}/schedule/slots/{slot['id']}", json={"status": "done"}).status_code, 200)
        r = self.client.patch(f"{self.api}/schedule/slots/{slot['id']}", json={"day": tomorrow})
        self.assertEqual(r.status_code, 422)

    def test_old_day_slot_cannot_be_marked_done_later(self):
        slot = self.slot().json()["slot"]
        old = (sched.local_today() - timedelta(days=5)).isoformat()
        self.store.table("study_slots").update({"slot_date": old}).eq("id", slot["id"]).execute()
        r = self.client.patch(f"{self.api}/schedule/slots/{slot['id']}", json={"status": "done"})
        self.assertEqual(r.status_code, 422)

    def test_backdated_moment_shows_but_does_not_count_for_streak(self):
        old = (sched.local_today() - timedelta(days=30)).isoformat()
        r = self.client.post(f"{self.api}/schedule/moments", data={"day": old},
                             files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(len(self.client.get(f"{self.api}/schedule/day/{old}").json()["moments"]), 1)
        stats = sched.day_stats(self.store, UID, date.fromisoformat(old), date.fromisoformat(old))
        self.assertFalse(stats[old]["active"])

    def test_can_mark_done_window(self):
        today = date(2026, 10, 17)
        self.assertTrue(sched.can_mark_done(today, today))
        self.assertTrue(sched.can_mark_done(today - timedelta(days=1), today))
        self.assertFalse(sched.can_mark_done(today - timedelta(days=2), today))
        self.assertFalse(sched.can_mark_done(today + timedelta(days=1), today))

    def test_moment_upload_and_delete(self):
        r = self.client.post(f"{self.api}/schedule/moments", data={"day": self.today, "caption": "Hôm nay học Reading"},
                             files={"file": ("big.png", _jpeg((3000, 2000)), "image/png")})
        self.assertEqual(r.status_code, 200, r.text)
        m = r.json()["moment"]
        self.assertTrue(m["url"])
        self.assertIn("streak", m["meta"])
        stored = self.store.storage.from_("moments").download(f"{UID}/{self.today}/{m['id']}.jpg")
        self.assertLessEqual(max(Image.open(io.BytesIO(stored)).size), 1600)

        day = self.client.get(f"{self.api}/schedule/day/{self.today}").json()
        self.assertEqual(len(day["moments"]), 1)
        self.assertEqual(self.client.delete(f"{self.api}/schedule/moments/{m['id']}").status_code, 200)
        self.assertEqual(self.client.get(f"{self.api}/schedule/day/{self.today}").json()["moments"], [])
        self.assertFalse(os.path.exists(local_db.resolve_storage_path("moments", f"{UID}/{self.today}/{m['id']}.jpg")))

    def test_moment_rejects_non_image_and_future(self):
        r = self.client.post(f"{self.api}/schedule/moments", data={"day": self.today},
                             files={"file": ("x.jpg", b"not an image", "image/jpeg")})
        self.assertEqual(r.status_code, 400)
        future = (sched.local_today() + timedelta(days=5)).isoformat()
        r = self.client.post(f"{self.api}/schedule/moments", data={"day": future},
                             files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
        self.assertEqual(r.status_code, 422)

    def test_summary_range(self):
        self.slot()
        d = self.client.get(f"{self.api}/schedule/summary", params={"start": self.today, "end": self.today}).json()
        self.assertEqual(d["days"][self.today]["slots"], 1)
        self.assertEqual(d["days"][self.today]["minutes_planned"], 60)
        bad = self.client.get(f"{self.api}/schedule/summary", params={"start": "2020-01-01", "end": "2026-01-01"})
        self.assertEqual(bad.status_code, 422)

    def test_reminder_sent_once_ten_minutes_before(self):
        now = sched.local_now().replace(second=0, microsecond=0)
        start = now + timedelta(minutes=8)
        self.store.table("user_accounts").insert({"id": UID, "email": "hoc@example.com", "role": "student", "status": "active"}).execute()
        self.slot(day=start.date().isoformat(), start=start.strftime("%H:%M"),
                  end=(start + timedelta(minutes=30)).strftime("%H:%M"), title="Listening Section 2")
        far = now + timedelta(minutes=45)
        self.slot(day=far.date().isoformat(), start=far.strftime("%H:%M"),
                  end=(far + timedelta(minutes=30)).strftime("%H:%M"), title="Quá xa")
        sent = []
        send = lambda to, subject, html, text: (sent.append((to, subject, html)) or (True, "sent"))

        with patch.object(settings, "REMINDERS_ENABLED", True):
            c1 = sched.run_reminder_cycle(self.store, now, send)
            c2 = sched.run_reminder_cycle(self.store, now + timedelta(minutes=1), send)
        self.assertEqual(c1["sent"], 1)
        self.assertEqual(c2["sent"], 0)
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][0], "hoc@example.com")
        self.assertIn("Listening Section 2", sent[0][1])
        self.assertEqual(self.store.table("reminder_log").select("*").execute().data[0]["status"], "sent")

    def test_reminder_skips_done_or_muted_slots(self):
        now = sched.local_now().replace(second=0, microsecond=0)
        start = now + timedelta(minutes=5)
        self.store.table("user_accounts").insert({"id": UID, "email": "hoc@example.com", "role": "student", "status": "active"}).execute()
        a = self.slot(day=start.date().isoformat(), start=start.strftime("%H:%M"), end=(start + timedelta(minutes=30)).strftime("%H:%M"), title="A").json()["slot"]
        self.slot(day=start.date().isoformat(), start=start.strftime("%H:%M"), end=(start + timedelta(minutes=30)).strftime("%H:%M"), title="B", remind=False)
        self.client.patch(f"{self.api}/schedule/slots/{a['id']}", json={"status": "done"})
        sent = []
        send = lambda *a: (sent.append(a) or (True, "sent"))
        self.assertEqual(sched.run_reminder_cycle(self.store, now, send)["sent"], 0)
        self.assertEqual(sent, [])

    def test_reminder_status_and_test_mail_need_smtp(self):
        st = self.client.get(f"{self.api}/schedule/reminders/status").json()
        self.assertFalse(st["smtp_configured"])
        self.assertEqual(st["lead_minutes"], 10)
        self.store.table("user_accounts").update({"email": "hoc@example.com"}).eq("id", UID).execute()
        self.assertEqual(self.client.post(f"{self.api}/schedule/reminders/test").status_code, 503)

    def test_public_packs_show_prices_without_login(self):
        self.store.table("credit_packs").insert([
            {"id": "p1", "name": "Gói nhỏ", "books": 3, "price_vnd": 99000, "active": True, "highlight": False, "sort_order": 1},
            {"id": "p2", "name": "Gói lớn", "books": 30, "price_vnd": 0, "active": False, "highlight": False, "sort_order": 2},
        ]).execute()
        with patch.object(settings, "AUTH_REQUIRED", True):
            r = TestClient(app).get(f"{self.api}/billing/public-packs")
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual([p["name"] for p in d["packs"]], ["Gói nhỏ"])
        self.assertEqual(d["packs"][0]["price_vnd"], 99000)
        self.assertEqual([p["name"] for p in d["upcoming"]], ["Gói lớn"])
        self.assertNotIn("price_vnd", d["upcoming"][0])


if __name__ == "__main__":
    unittest.main()
