"""
Thông báo đẩy cho lời mời kết bạn và ảnh mới của bạn bè. Expo Push API được thay bằng bản giả (push._post).
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
from app.services import push
from main import app

ALICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
BOB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
CAROL = "cccccccc-cccc-cccc-cccc-cccccccccccc"
REAL_POST = push._post  # bản thật, lấy trước khi các test thay bằng bản giả
TOK = {ALICE: "ExponentPushToken[alice-device]", BOB: "ExponentPushToken[bob-device]", CAROL: "ExponentPushToken[carol-device]"}


def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 80, 40)).save(buf, format="JPEG")
    return buf.getvalue()


class PushTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        db_file = os.path.join(tmp.name, "local_db.json")
        with open(db_file, "w", encoding="utf-8") as f:
            f.write("{}")
        self.store = SafeSupabaseWrapper(None)
        self.sent = []  # mỗi phần tử: danh sách message của một lần gọi Expo
        self.ticket_for = lambda message: {"status": "ok"}

        def fake_post(messages):
            self.sent.append(messages)
            return [self.ticket_for(m) for m in messages]

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
            patch.object(push, "_post", side_effect=fake_post),
        ):
            p.start()
            self.addCleanup(p.stop)
        accounts.invalidate()
        self.client = TestClient(app)
        self.api = settings.API_V1_STR + "/friends"

    def as_user(self, uid):
        settings.DEFAULT_USER_ID = uid
        self.addCleanup(setattr, settings, "DEFAULT_USER_ID", "11111111-1111-1111-1111-111111111111")

    def register(self, uid, token=None, platform="android"):
        self.as_user(uid)
        return self.client.put(f"{self.api}/push-token", json={"token": token or TOK[uid], "platform": platform})

    def code_of(self, uid):
        self.as_user(uid)
        return self.client.get(f"{self.api}/me").json()["code"]

    def befriend(self, a, b):
        code_b = self.code_of(b)
        self.as_user(a)
        self.client.post(f"{self.api}/requests", json={"code": code_b})
        self.as_user(b)
        rid = self.client.get(self.api).json()["incoming"][0]["id"]
        self.client.post(f"{self.api}/requests/{rid}/accept")
        self.sent.clear()

    def share(self, uid, caption=""):
        self.as_user(uid)
        r = self.client.post(f"{self.api}/moments", data={"caption": caption}, files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()["moment"]

    def pushed_to(self):
        return [m["to"] for call in self.sent for m in call]

    # ------------------------------------------------------------ đăng ký mã thiết bị
    def test_register_validates_and_is_idempotent(self):
        self.assertEqual(self.register(ALICE).status_code, 200)
        self.assertEqual(self.register(ALICE).status_code, 200)
        self.assertEqual(len(self.store.table("push_tokens").select("*").execute().data), 1)
        self.assertEqual(self.register(ALICE, token="not-a-token").status_code, 422)
        self.assertEqual(self.register(ALICE, token="ExponentPushToken[x").status_code, 422)

    def test_device_moves_to_the_new_account(self):
        shared = "ExponentPushToken[shared-phone]"
        self.register(ALICE, shared)
        self.register(BOB, shared)  # cùng máy, đăng nhập tài khoản khác
        rows = self.store.table("push_tokens").select("*").execute().data
        self.assertEqual([(r["token"], r["user_id"]) for r in rows], [(shared, BOB)])

    def test_keeps_only_the_five_newest_devices(self):
        for i in range(7):
            self.register(ALICE, f"ExponentPushToken[dev{i}]")
        self.assertEqual(len(self.store.table("push_tokens").select("*").eq("user_id", ALICE).execute().data), 5)

    def test_remove_token_only_removes_own(self):
        self.register(ALICE)
        self.as_user(BOB)
        self.client.delete(f"{self.api}/push-token", params={"token": TOK[ALICE]})
        self.assertEqual(len(self.store.table("push_tokens").select("*").execute().data), 1)
        self.as_user(ALICE)
        self.assertEqual(self.client.delete(f"{self.api}/push-token", params={"token": TOK[ALICE]}).status_code, 200)
        self.assertEqual(self.store.table("push_tokens").select("*").execute().data, [])

    # ------------------------------------------------------------ lời mời
    def test_friend_request_notifies_the_addressee_only(self):
        self.register(ALICE)
        self.register(BOB)
        code_b = self.code_of(BOB)
        self.as_user(ALICE)
        self.client.put(f"{self.api}/me", json={"display_name": "Alice"})
        self.client.post(f"{self.api}/requests", json={"code": code_b})
        self.assertEqual(self.pushed_to(), [TOK[BOB]])
        msg = self.sent[0][0]
        self.assertEqual(msg["title"], "Lời mời kết bạn")
        self.assertIn("Alice", msg["body"])
        self.assertEqual(msg["data"], {"type": "friend_request"})
        self.assertEqual(msg["channelId"], "friends")

    def test_accepting_notifies_the_requester(self):
        self.register(ALICE)
        self.register(BOB)
        code_b = self.code_of(BOB)
        self.as_user(ALICE)
        self.client.post(f"{self.api}/requests", json={"code": code_b})
        self.sent.clear()
        self.as_user(BOB)
        self.client.put(f"{self.api}/me", json={"display_name": "Bob"})
        rid = self.client.get(self.api).json()["incoming"][0]["id"]
        self.client.post(f"{self.api}/requests/{rid}/accept")
        self.assertEqual(self.pushed_to(), [TOK[ALICE]])
        self.assertIn("Bob", self.sent[0][0]["body"])
        self.assertEqual(self.sent[0][0]["data"], {"type": "friend_accepted"})

    def test_mutual_request_notifies_the_first_requester(self):
        self.register(ALICE)
        code_a, code_b = self.code_of(ALICE), self.code_of(BOB)
        self.as_user(ALICE)
        self.client.post(f"{self.api}/requests", json={"code": code_b})
        self.sent.clear()
        self.as_user(BOB)
        self.client.post(f"{self.api}/requests", json={"code": code_a})
        self.assertEqual(self.pushed_to(), [TOK[ALICE]])

    def test_no_devices_means_no_push_call(self):
        code_b = self.code_of(BOB)
        self.as_user(ALICE)
        self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": code_b}).status_code, 200)
        self.assertEqual(self.sent, [])

    # ------------------------------------------------------------ ảnh mới
    def test_new_moment_notifies_friends_not_strangers_or_self(self):
        for u in (ALICE, BOB, CAROL):
            self.register(u)
        self.befriend(ALICE, BOB)
        self.as_user(BOB)
        self.client.put(f"{self.api}/me", json={"display_name": "Bob"})
        moment = self.share(BOB, "Xong Reading")
        self.assertEqual(self.pushed_to(), [TOK[ALICE]])  # không báo cho Bob, không báo cho Carol (người lạ)
        msg = self.sent[0][0]
        self.assertEqual(msg["title"], "Bob vừa chia sẻ khoảnh khắc")
        self.assertEqual(msg["body"], "Xong Reading")
        self.assertEqual(msg["data"], {"type": "moment", "moment_id": moment["id"]})

    def test_second_moment_within_cooldown_is_silent(self):
        self.register(ALICE)
        self.befriend(ALICE, BOB)
        self.share(BOB, "một")
        self.share(BOB, "hai")
        self.assertEqual(len(self.pushed_to()), 1)

    def test_notification_body_has_a_default_when_no_caption(self):
        self.register(ALICE)
        self.befriend(ALICE, BOB)
        self.share(BOB)
        self.assertTrue(self.sent[0][0]["body"])

    # ------------------------------------------------------------ độ bền
    def test_dead_device_token_is_removed(self):
        self.register(ALICE)
        self.register(ALICE, "ExponentPushToken[old-phone]")
        self.ticket_for = lambda m: ({"status": "error", "details": {"error": "DeviceNotRegistered"}} if "old-phone" in m["to"] else {"status": "ok"})
        self.befriend(ALICE, BOB)
        self.share(BOB)
        left = [r["token"] for r in self.store.table("push_tokens").select("*").execute().data]
        self.assertEqual(left, [TOK[ALICE]])

    def test_push_failure_never_breaks_the_action(self):
        self.register(ALICE)
        code_a = self.code_of(ALICE)
        with patch.object(push, "_post", side_effect=RuntimeError("expo down")):
            self.as_user(BOB)
            self.assertEqual(self.client.post(f"{self.api}/requests", json={"code": code_a}).status_code, 200)
        with patch.object(push, "_post", return_value=None):  # dịch vụ trả lỗi
            self.as_user(ALICE)
            rid = self.client.get(self.api).json()["incoming"][0]["id"]
            self.assertEqual(self.client.post(f"{self.api}/requests/{rid}/accept").status_code, 200)

    def test_notify_batches_of_100(self):
        for i in range(250):
            self.store.table("push_tokens").insert({"token": f"ExponentPushToken[t{i}]", "user_id": ALICE, "platform": "android"}).execute()
        self.assertEqual(push.notify(self.store, [ALICE], "t", "b"), 250)
        self.assertEqual([len(c) for c in self.sent], [100, 100, 50])

    def test_http_layer_sends_secret_and_survives_errors(self):
        import httpx
        calls = {}

        class Resp:
            status_code = 200
            text = ""

            def json(self):
                return {"data": [{"status": "ok"}]}

        def fake_httpx_post(url, json, headers, timeout):
            calls.update(url=url, headers=headers, n=len(json))
            return Resp()

        msg = [{"to": "ExponentPushToken[x]"}]
        with patch.object(httpx, "post", fake_httpx_post), patch.dict(os.environ, {"EXPO_ACCESS_TOKEN": "s3cret"}):
            self.assertEqual(REAL_POST(msg), [{"status": "ok"}])
        self.assertEqual(calls["headers"]["Authorization"], "Bearer s3cret")
        self.assertEqual(calls["url"], push.EXPO_PUSH_URL)
        with patch.object(httpx, "post", side_effect=httpx.ConnectError("boom")):
            self.assertIsNone(REAL_POST(msg))  # lỗi mạng: không ném, trả None


if __name__ == "__main__":
    unittest.main()
