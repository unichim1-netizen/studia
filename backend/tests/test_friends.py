"""
Kết bạn và chia sẻ khoảnh khắc học: mã kết bạn, lời mời, bạn bè, feed, quyền xem ảnh, biểu cảm — chạy trên LocalStore tạm.
Hai người dùng được giả lập bằng cách đổi DEFAULT_USER_ID (auth tắt ở môi trường development).
"""
import io
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from app.config import settings
from app.core import accounts, local_db
from app.core.supabase_client import SafeSupabaseWrapper
from main import app

ALICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
BOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
CAROL = "cccccccc-cccc-cccc-cccc-cccccccccccc"


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 80, 40)).save(buf, format="JPEG")
    return buf.getvalue()


class FriendsApiTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        db_file = os.path.join(tmp.name, "local_db.json")
        with open(db_file, "w", encoding="utf-8") as f:
            f.write("{}")
        self.store = SafeSupabaseWrapper(None)
        self.user = ALICE
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
            patch("app.api.v1.friends.get_supabase_client", return_value=self.store),
            patch("app.core.accounts._db", return_value=self.store),
        ):
            p.start()
            self.addCleanup(p.stop)
        accounts.invalidate()
        self.client = TestClient(app)
        self.api = settings.API_V1_STR + "/friends"

    def as_user(self, uid):
        """Các request sau đó chạy với danh nghĩa `uid`."""
        self.user = uid
        settings.DEFAULT_USER_ID = uid
        self.addCleanup(setattr, settings, "DEFAULT_USER_ID", "11111111-1111-1111-1111-111111111111")

    def code_of(self, uid):
        self.as_user(uid)
        return self.client.get(f"{self.api}/me").json()["code"]

    def befriend(self, a, b):
        """a gửi mã của b, b chấp nhận."""
        code_b = self.code_of(b)
        self.as_user(a)
        r = self.client.post(f"{self.api}/requests", json={"code": code_b})
        self.assertEqual(r.status_code, 200, r.text)
        self.as_user(b)
        incoming = self.client.get(self.api).json()["incoming"]
        self.assertEqual(len(incoming), 1)
        r = self.client.post(f"{self.api}/requests/{incoming[0]['id']}/accept")
        self.assertEqual(r.status_code, 200, r.text)

    def share(self, uid, caption="Reading xong"):
        self.as_user(uid)
        r = self.client.post(f"{self.api}/moments", data={"caption": caption}, files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["moment"]

    # ------------------------------------------------------------ mã và lời mời
    def test_code_is_stable_and_name_can_be_set(self):
        self.as_user(ALICE)
        me = self.client.get(f"{self.api}/me").json()
        self.assertEqual(len(me["code"]), 6)
        self.assertEqual(self.client.get(f"{self.api}/me").json()["code"], me["code"])
        r = self.client.put(f"{self.api}/me", json={"display_name": "  Minh   Anh "})
        self.assertEqual(r.json()["display_name"], "Minh Anh")
        self.assertEqual(self.client.put(f"{self.api}/me", json={"display_name": "x" * 41}).status_code, 422)

    def test_codes_are_unique_between_users(self):
        self.assertNotEqual(self.code_of(ALICE), self.code_of(BOB))

    def test_request_accept_and_list(self):
        self.befriend(ALICE, BOB)
        self.as_user(ALICE)
        data = self.client.get(self.api).json()
        self.assertEqual([f["user_id"] for f in data["friends"]], [BOB])
        self.assertEqual((data["incoming"], data["outgoing"]), ([], []))
        self.as_user(BOB)
        self.assertEqual([f["user_id"] for f in self.client.get(self.api).json()["friends"]], [ALICE])

    def test_request_errors(self):
        mine = self.code_of(ALICE)
        self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": mine}).status_code, 422)
        self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": "AB"}).status_code, 422)
        self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": "ZZZZZZ"}).status_code, 404)

        code_b = self.code_of(BOB)
        self.as_user(ALICE)
        self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": code_b}).status_code, 200)
        self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": code_b}).status_code, 409)  # đã gửi

    def test_code_is_case_and_space_insensitive(self):
        code_b = self.code_of(BOB)
        self.as_user(ALICE)
        messy = f" {code_b[:3].lower()}-{code_b[3:].lower()} "
        self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": messy}).status_code, 200)

    def test_mutual_request_becomes_friends(self):
        code_a, code_b = self.code_of(ALICE), self.code_of(BOB)
        self.as_user(ALICE)
        self.client.post(f"{self.api}/requests", json={"code": code_b})
        self.as_user(BOB)
        r = self.client.post(f"{self.api}/requests", json={"code": code_a})
        self.assertEqual(r.json()["status"], "accepted")
        self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": code_a}).status_code, 409)

    def test_only_addressee_accepts_and_either_side_can_drop(self):
        code_b = self.code_of(BOB)
        self.as_user(ALICE)
        rid = self.client.post(f"{self.api}/requests", json={"code": code_b}).json()["friendship_id"]
        self.assertEqual(self.client.post(f"{self.api}/requests/{rid}/accept").status_code, 403)
        self.as_user(CAROL)
        self.assertEqual(self.client.post(f"{self.api}/requests/{rid}/accept").status_code, 404)
        self.assertEqual(self.client.delete(f"{self.api}/requests/{rid}").status_code, 404)
        self.as_user(ALICE)  # người gửi huỷ được
        self.assertEqual(self.client.delete(f"{self.api}/requests/{rid}").status_code, 200)
        self.assertEqual(self.client.get(self.api).json()["outgoing"], [])

    def test_unfriend(self):
        self.befriend(ALICE, BOB)
        self.as_user(BOB)
        self.assertEqual(self.client.delete(f"{self.api}/{ALICE}").status_code, 200)
        self.assertEqual(self.client.get(self.api).json()["friends"], [])
        self.assertEqual(self.client.delete(f"{self.api}/{ALICE}").status_code, 404)

    # ------------------------------------------------------------ khoảnh khắc và feed
    def test_feed_shows_friends_not_strangers(self):
        self.befriend(ALICE, BOB)
        self.client.put(f"{self.api}/me", json={"display_name": "Bob"})
        m_bob = self.share(BOB, "Bob học Listening")
        m_carol = self.share(CAROL, "Carol là người lạ")
        m_alice = self.share(ALICE, "Alice học Reading")

        self.as_user(ALICE)
        items = self.client.get(f"{self.api}/feed").json()["items"]
        ids = [i["id"] for i in items]
        self.assertIn(m_bob["id"], ids)
        self.assertIn(m_alice["id"], ids)
        self.assertNotIn(m_carol["id"], ids)
        bob_item = next(i for i in items if i["id"] == m_bob["id"])
        self.assertEqual((bob_item["name"], bob_item["is_me"], bob_item["caption"]), ("Bob", False, "Bob học Listening"))
        self.assertTrue(bob_item["url"])
        self.assertGreaterEqual(bob_item["meta"]["streak"], 1)

    def test_unshared_and_unfriended_moments_disappear(self):
        self.befriend(ALICE, BOB)
        m = self.share(BOB)
        self.as_user(ALICE)
        self.assertEqual(len(self.client.get(f"{self.api}/feed").json()["items"]), 1)

        self.as_user(BOB)  # tắt chia sẻ
        self.assertEqual(self.client.patch(f"{self.api}/moments/{m['id']}", json={"shared": False}).status_code, 200)
        self.as_user(ALICE)
        self.assertEqual(self.client.get(f"{self.api}/feed").json()["items"], [])

        self.as_user(BOB)  # bật lại rồi bỏ kết bạn
        self.client.patch(f"{self.api}/moments/{m['id']}", json={"shared": True})
        self.client.delete(f"{self.api}/{ALICE}")
        self.as_user(ALICE)
        self.assertEqual(self.client.get(f"{self.api}/feed").json()["items"], [])

    def test_only_owner_changes_sharing(self):
        self.befriend(ALICE, BOB)
        m = self.share(BOB)
        self.as_user(ALICE)
        self.assertEqual(self.client.patch(f"{self.api}/moments/{m['id']}", json={"shared": False}).status_code, 404)

    def test_feed_paginates(self):
        for i in range(3):
            self.share(ALICE, f"ảnh {i}")
        first = self.client.get(f"{self.api}/feed", params={"limit": 2}).json()
        self.assertEqual(len(first["items"]), 2)
        self.assertTrue(first["next_before"])
        second = self.client.get(f"{self.api}/feed", params={"limit": 2, "before": first["next_before"]}).json()
        self.assertEqual(len(second["items"]), 1)
        self.assertIsNone(second["next_before"])
        self.assertEqual(len({i["id"] for i in first["items"] + second["items"]}), 3)

    def test_shared_moment_counts_for_streak_and_shows_in_schedule(self):
        self.as_user(ALICE)
        self.assertEqual(self.client.get(f"{settings.API_V1_STR}/schedule/streak").json()["current"], 0)
        m = self.share(ALICE)
        self.assertEqual(self.client.get(f"{settings.API_V1_STR}/schedule/streak").json()["current"], 1)
        day = self.client.get(f"{settings.API_V1_STR}/schedule/day/{m['day']}").json()
        self.assertEqual([x["id"] for x in day["moments"]], [m["id"]])

    def test_photo_validation(self):
        self.as_user(ALICE)
        r = self.client.post(f"{self.api}/moments", data={"caption": "x"}, files={"file": ("a.jpg", b"khong phai anh", "image/jpeg")})
        self.assertEqual(r.status_code, 400)
        r = self.client.post(f"{self.api}/moments", data={"caption": "x"}, files={"file": ("a.jpg", b"", "image/jpeg")})
        self.assertEqual(r.status_code, 400)

    # ------------------------------------------------------------ biểu cảm
    def test_reactions(self):
        self.befriend(ALICE, BOB)
        m = self.share(BOB)
        self.as_user(ALICE)
        self.assertEqual(self.client.put(f"{self.api}/moments/{m['id']}/reaction", json={"kind": "flame"}).status_code, 200)
        self.assertEqual(self.client.put(f"{self.api}/moments/{m['id']}/reaction", json={"kind": "heart"}).status_code, 200)  # đổi, không cộng dồn
        self.assertEqual(self.client.put(f"{self.api}/moments/{m['id']}/reaction", json={"kind": "poop"}).status_code, 422)
        item = self.client.get(f"{self.api}/feed").json()["items"][0]
        self.assertEqual((item["reactions"], item["my_reaction"]), ({"flame": 0, "heart": 1, "clap": 0}, "heart"))

        self.as_user(BOB)
        item = self.client.get(f"{self.api}/feed").json()["items"][0]
        self.assertEqual((item["reactions"]["heart"], item["my_reaction"]), (1, None))

        self.as_user(ALICE)
        self.assertEqual(self.client.delete(f"{self.api}/moments/{m['id']}/reaction").status_code, 200)
        self.assertEqual(self.client.get(f"{self.api}/feed").json()["items"][0]["reactions"]["heart"], 0)

    def test_cannot_react_to_strangers_moment(self):
        m = self.share(CAROL)
        self.as_user(ALICE)
        self.assertEqual(self.client.put(f"{self.api}/moments/{m['id']}/reaction", json={"kind": "flame"}).status_code, 404)
        self.assertEqual(self.client.put(f"{self.api}/moments/nope/reaction", json={"kind": "flame"}).status_code, 404)

    # ------------------------------------------------------------ tiến độ bạn bè, cờ tính năng
    def test_friend_progress_in_list(self):
        self.befriend(ALICE, BOB)
        self.share(BOB)
        self.as_user(ALICE)
        friend = self.client.get(self.api).json()["friends"][0]
        self.assertTrue(friend["today_done"])
        self.assertEqual(friend["streak"], 1)

    def test_feature_flag_can_turn_friends_off(self):
        from app.services import sysconfig
        self.as_user(ALICE)
        self.assertEqual(self.client.get(f"{self.api}/me").status_code, 200)
        with patch.object(sysconfig, "feature_enabled", lambda key: key != "friends"):
            self.assertEqual(self.client.get(f"{self.api}/me").status_code, 403)


if __name__ == "__main__":
    unittest.main()
