"""
Thông báo đẩy qua dịch vụ Expo Push (https://docs.expo.dev/push-notifications/sending-notifications/).

  - App mobile đăng ký mã thiết bị (ExponentPushToken[...]) vào bảng push_tokens.
  - `notify(...)` gửi tới mọi thiết bị của một nhóm người dùng. Không bao giờ ném lỗi: thông báo hỏng
    không được làm hỏng thao tác chính (gửi lời mời, đăng ảnh).
  - Mã thiết bị đã gỡ app (DeviceNotRegistered) được xoá khỏi bảng.
  - Biến môi trường tuỳ chọn EXPO_ACCESS_TOKEN: bật "Enhanced Security" cho push của dự án Expo thì cần.
"""
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

import httpx

logger = logging.getLogger("studia.push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
BATCH = 100  # giới hạn của Expo mỗi lần gửi
MAX_TOKENS_PER_USER = 5
CHANNEL = "friends"  # kênh thông báo trên Android, app tạo cùng tên


def valid_token(token: str) -> bool:
    t = (token or "").strip()
    return len(t) <= 200 and t.endswith("]") and t.startswith(("ExponentPushToken[", "ExpoPushToken["))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def register(db, uid: str, token: str, platform: str) -> None:
    """Gắn mã thiết bị với `uid` (chuyển chủ nếu máy đã đăng nhập tài khoản khác) và giữ tối đa 5 máy mỗi người."""
    token = token.strip()
    rows = db.table("push_tokens").select("*").eq("token", token).limit(1).execute().data or []
    if rows:
        db.table("push_tokens").update({"user_id": uid, "platform": platform, "updated_at": _now()}).eq("token", token).execute()
    else:
        db.table("push_tokens").insert({"token": token, "user_id": uid, "platform": platform, "created_at": _now(), "updated_at": _now()}).execute()
    mine = db.table("push_tokens").select("*").eq("user_id", uid).execute().data or []
    if len(mine) > MAX_TOKENS_PER_USER:
        mine.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
        for old in mine[MAX_TOKENS_PER_USER:]:
            db.table("push_tokens").delete().eq("token", old["token"]).execute()


def unregister(db, uid: str, token: str) -> None:
    db.table("push_tokens").delete().eq("token", token.strip()).eq("user_id", uid).execute()


def _post(messages: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """Gọi Expo Push API; trả danh sách "ticket" theo đúng thứ tự `messages`, hoặc None khi lỗi mạng/dịch vụ."""
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    secret = os.environ.get("EXPO_ACCESS_TOKEN", "").strip()
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    try:
        r = httpx.post(EXPO_PUSH_URL, json=messages, headers=headers, timeout=8.0)
        if r.status_code != 200:
            logger.warning(f"Expo push HTTP {r.status_code}: {r.text[:200]}")
            return None
        data = r.json().get("data")
        return data if isinstance(data, list) else None
    except Exception as e:
        logger.warning(f"Expo push failed: {e}")
        return None


def notify(db, uids: Iterable[str], title: str, body: str, data: Optional[Dict[str, Any]] = None) -> int:
    """Gửi một thông báo tới mọi thiết bị của `uids`. Trả số thông báo đã gửi; không ném lỗi."""
    try:
        ids = sorted({u for u in uids if u})
        if not ids:
            return 0
        rows = db.table("push_tokens").select("*").in_("user_id", ids).execute().data or []
        tokens = [r["token"] for r in rows if valid_token(r.get("token", ""))]
        sent = 0
        for i in range(0, len(tokens), BATCH):
            chunk = tokens[i:i + BATCH]
            messages = [
                {"to": t, "title": title, "body": body, "data": data or {}, "sound": "default",
                 "priority": "high", "channelId": CHANNEL}
                for t in chunk
            ]
            tickets = _post(messages)
            if tickets is None:
                continue
            for t, ticket in zip(chunk, tickets):
                if ticket.get("status") == "ok":
                    sent += 1
                elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    db.table("push_tokens").delete().eq("token", t).execute()  # app đã gỡ, dọn mã chết
        return sent
    except Exception as e:
        logger.warning(f"notify failed: {e}")
        return 0
