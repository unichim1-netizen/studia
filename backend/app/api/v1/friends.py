"""
Kết bạn và chia sẻ khoảnh khắc học (kiểu Locket) cho app mobile.

  - Mỗi người có một mã kết bạn 6 ký tự; nhập mã của nhau để gửi/nhận lời mời, chấp nhận mới thành bạn.
  - Khoảnh khắc là ảnh học trong ngày (bảng study_moments dùng chung với lịch học); chỉ ảnh có `shared = true`
    mới hiện cho bạn bè. Ảnh nằm trong bucket riêng tư, backend chỉ cấp link tạm cho chủ ảnh và bạn đã chấp nhận.
  - Bạn bè thả một biểu cảm (flame / heart / clap) cho mỗi khoảnh khắc.
"""
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.api.v1.schedule import MAX_PHOTO_BYTES, MOMENT_URL_TTL, MOMENTS_BUCKET, MOMENTS_PER_DAY, _normalize_photo
from app.core.auth import current_user_id
from app.core.supabase_client import get_supabase_client
from app.core.uploads import ensure_private_bucket, signed_storage_url
from app.services import push
from app.services import schedule as sched

logger = logging.getLogger("studia.friends")

router = APIRouter(prefix="/friends", tags=["Friends"])

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # bỏ 0/O, 1/I/L cho dễ đọc
CODE_LEN = 6
MAX_FRIENDS = 50
MAX_PENDING_OUT = 20
FEED_PAGE = 20
FRIEND_STREAK_WINDOW = 90  # ngày nhìn lại khi tính streak của bạn (đủ để hiện số, không quét cả 2 năm)
REACTIONS = ("flame", "heart", "clap")
MOMENT_PUSH_COOLDOWN = timedelta(minutes=5)  # đăng liền mấy ảnh chỉ báo bạn bè một lần


def _db():
    db = get_supabase_client()
    if not db:
        raise HTTPException(status_code=503, detail="Cơ sở dữ liệu không khả dụng")
    return db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_code(raw: str) -> str:
    return "".join(ch for ch in str(raw or "").upper() if ch.isalnum())


def _push(uids: List[str], title: str, body: str, data: Dict[str, Any]) -> None:
    """Chạy nền sau khi trả lời request; lỗi gửi thông báo không ảnh hưởng thao tác chính (push.notify tự nuốt lỗi)."""
    db = get_supabase_client()
    if db:
        push.notify(db, uids, title, body, data)


# ---------------------------------------------------------------- hồ sơ bạn bè
def _profile(db, uid: str) -> Dict[str, Any]:
    """Hồ sơ kết bạn của uid; tạo (kèm mã mới) ở lần đầu."""
    rows = db.table("friend_profiles").select("*").eq("user_id", uid).limit(1).execute().data or []
    if rows:
        return rows[0]
    for _ in range(12):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
        if not (db.table("friend_profiles").select("user_id").eq("code", code).limit(1).execute().data or []):
            row = {"user_id": uid, "code": code, "display_name": "", "created_at": _now()}
            db.table("friend_profiles").insert(row).execute()
            return row
    raise HTTPException(status_code=503, detail="Chưa tạo được mã kết bạn, thử lại sau nhé")


def _profiles(db, ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not ids:
        return {}
    rows = db.table("friend_profiles").select("*").in_("user_id", list(set(ids))).execute().data or []
    return {r["user_id"]: r for r in rows}


def _label(p: Optional[Dict[str, Any]]) -> str:
    if not p:
        return "Bạn học"
    return (p.get("display_name") or "").strip() or f"Bạn học {p.get('code', '')}"


def _relations(db, uid: str) -> List[Dict[str, Any]]:
    sent = db.table("friendships").select("*").eq("requester_id", uid).execute().data or []
    got = db.table("friendships").select("*").eq("addressee_id", uid).execute().data or []
    return sent + got


def _friend_ids(db, uid: str) -> List[str]:
    out = []
    for r in _relations(db, uid):
        if r.get("status") == "accepted":
            out.append(r["addressee_id"] if r["requester_id"] == uid else r["requester_id"])
    return out


def _progress(db, friend_id: str, today) -> Dict[str, Any]:
    try:
        stats = sched.day_stats(db, friend_id, today - timedelta(days=FRIEND_STREAK_WINDOW), today)
        info = sched.streak(db, friend_id, today, stats)
        return {
            "streak": info.get("current", 0),
            "today_done": bool(info.get("today_done")),
            "minutes_today": (stats.get(today.isoformat()) or {}).get("minutes", 0),
        }
    except Exception as e:
        logger.warning(f"friend progress failed: {e}")
        return {"streak": 0, "today_done": False, "minutes_today": 0}


# ---------------------------------------------------------------- hồ sơ của tôi
class NameIn(BaseModel):
    display_name: str = Field(default="", max_length=40)


@router.get("/me")
def my_profile():
    uid = current_user_id()
    p = _profile(_db(), uid)
    return {"user_id": uid, "code": p["code"], "display_name": p.get("display_name") or ""}


@router.put("/me")
def set_my_name(body: NameIn):
    uid = current_user_id()
    db = _db()
    p = _profile(db, uid)
    name = " ".join(body.display_name.split())[:40]
    db.table("friend_profiles").update({"display_name": name}).eq("user_id", uid).execute()
    return {"user_id": uid, "code": p["code"], "display_name": name}


# ---------------------------------------------------------------- danh sách bạn, lời mời
@router.get("")
def list_friends():
    uid = current_user_id()
    db = _db()
    me = _profile(db, uid)
    rels = _relations(db, uid)
    other = lambda r: r["addressee_id"] if r["requester_id"] == uid else r["requester_id"]  # noqa: E731
    people = _profiles(db, [other(r) for r in rels])
    today = sched.local_today()

    friends, incoming, outgoing = [], [], []
    for r in rels:
        oid = other(r)
        p = people.get(oid)
        base = {"id": r["id"], "user_id": oid, "name": _label(p), "code": (p or {}).get("code", "")}
        if r.get("status") == "accepted":
            friends.append({**base, "since": r.get("accepted_at") or r.get("created_at"), **_progress(db, oid, today)})
        elif r["addressee_id"] == uid:
            incoming.append({**base, "created_at": r.get("created_at")})
        else:
            outgoing.append({**base, "created_at": r.get("created_at")})
    friends.sort(key=lambda f: (not f["today_done"], -f["streak"], f["name"].lower()))
    incoming.sort(key=lambda f: f["created_at"] or "", reverse=True)
    outgoing.sort(key=lambda f: f["created_at"] or "", reverse=True)
    return {
        "me": {"user_id": uid, "code": me["code"], "display_name": me.get("display_name") or ""},
        "friends": friends, "incoming": incoming, "outgoing": outgoing,
        "limits": {"max_friends": MAX_FRIENDS},
    }


class CodeIn(BaseModel):
    code: str = Field(max_length=32)


@router.post("/requests")
def send_request(body: CodeIn, background: BackgroundTasks):
    uid = current_user_id()
    db = _db()
    code = _clean_code(body.code)
    if len(code) != CODE_LEN:
        raise HTTPException(status_code=422, detail=f"Mã kết bạn gồm {CODE_LEN} ký tự, kiểm tra lại nhé")
    found = db.table("friend_profiles").select("*").eq("code", code).limit(1).execute().data or []
    if not found:
        raise HTTPException(status_code=404, detail="Không tìm thấy mã này. Nhờ bạn của bạn gửi lại mã nhé")
    target = found[0]["user_id"]
    if target == uid:
        raise HTTPException(status_code=422, detail="Đây là mã của chính bạn. Hãy gửi mã này cho bạn bè")

    rels = _relations(db, uid)
    existing = next((r for r in rels if target in (r["requester_id"], r["addressee_id"])), None)
    if existing:
        if existing.get("status") == "accepted":
            raise HTTPException(status_code=409, detail="Hai bạn đã là bạn bè rồi")
        if existing["requester_id"] == uid:
            raise HTTPException(status_code=409, detail="Bạn đã gửi lời mời cho người này, chờ họ chấp nhận nhé")
        # Họ đã mời bạn từ trước: nhập mã của nhau coi như đồng ý
        return _accept(db, uid, existing, rels, background)

    if sum(1 for r in rels if r.get("status") == "accepted") >= MAX_FRIENDS:
        raise HTTPException(status_code=429, detail=f"Danh sách bạn bè đã đủ {MAX_FRIENDS} người")
    if sum(1 for r in rels if r.get("status") == "pending" and r["requester_id"] == uid) >= MAX_PENDING_OUT:
        raise HTTPException(status_code=429, detail="Bạn đang chờ quá nhiều lời mời. Huỷ bớt hoặc đợi bạn bè phản hồi")
    row = {"id": str(uuid.uuid4()), "requester_id": uid, "addressee_id": target, "status": "pending", "created_at": _now()}
    db.table("friendships").insert(row).execute()
    background.add_task(_push, [target], "Lời mời kết bạn", f"{_label(_profile(db, uid))} muốn kết bạn với bạn.", {"type": "friend_request"})
    return {"status": "pending", "friendship_id": row["id"], "name": _label(found[0])}


def _accept(db, uid: str, rel: Dict[str, Any], rels: List[Dict[str, Any]], background: BackgroundTasks) -> Dict[str, Any]:
    if sum(1 for r in rels if r.get("status") == "accepted") >= MAX_FRIENDS:
        raise HTTPException(status_code=429, detail=f"Danh sách bạn bè đã đủ {MAX_FRIENDS} người")
    db.table("friendships").update({"status": "accepted", "accepted_at": _now()}).eq("id", rel["id"]).execute()
    other = rel["requester_id"]
    background.add_task(_push, [other], "Đã thành bạn bè", f"{_label(_profile(db, uid))} đã chấp nhận lời mời của bạn.", {"type": "friend_accepted"})
    return {"status": "accepted", "friendship_id": rel["id"], "name": _label(_profiles(db, [other]).get(other))}


def _own_pending(db, uid: str, request_id: str) -> Dict[str, Any]:
    rows = db.table("friendships").select("*").eq("id", request_id).limit(1).execute().data or []
    r = rows[0] if rows else None
    if not r or uid not in (r["requester_id"], r["addressee_id"]):
        raise HTTPException(status_code=404, detail="Không tìm thấy lời mời")
    return r


@router.post("/requests/{request_id}/accept")
def accept_request(request_id: str, background: BackgroundTasks):
    uid = current_user_id()
    db = _db()
    r = _own_pending(db, uid, request_id)
    if r.get("status") == "accepted":
        return {"status": "accepted", "friendship_id": r["id"]}
    if r["addressee_id"] != uid:
        raise HTTPException(status_code=403, detail="Chỉ người nhận lời mời mới chấp nhận được")
    return _accept(db, uid, r, _relations(db, uid), background)


@router.delete("/requests/{request_id}")
def drop_request(request_id: str):
    """Từ chối lời mời nhận được, hoặc huỷ lời mời đã gửi."""
    uid = current_user_id()
    db = _db()
    r = _own_pending(db, uid, request_id)
    if r.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Lời mời này đã được chấp nhận. Muốn xoá thì bỏ kết bạn")
    db.table("friendships").delete().eq("id", request_id).execute()
    return {"deleted": True}


# ---------------------------------------------------------------- mã thiết bị nhận thông báo đẩy
class PushTokenIn(BaseModel):
    token: str = Field(max_length=200)
    platform: Literal["ios", "android"] = "android"


@router.put("/push-token")
def register_push_token(body: PushTokenIn):
    """App đăng ký (hoặc làm mới) mã thiết bị. Máy đã đăng nhập tài khoản khác thì mã được chuyển sang tài khoản này."""
    uid = current_user_id()
    if not push.valid_token(body.token):
        raise HTTPException(status_code=422, detail="Mã thông báo của thiết bị không hợp lệ")
    push.register(_db(), uid, body.token, body.platform)
    return {"registered": True}


@router.delete("/push-token")
def remove_push_token(token: str):
    """Tắt thông báo trên thiết bị này (tắt công tắc hoặc đăng xuất)."""
    uid = current_user_id()
    push.unregister(_db(), uid, token)
    return {"registered": False}


# Khai báo trước "/{friend_id}" để DELETE /friends/push-token không bị route đó nuốt.
@router.delete("/{friend_id}")
def unfriend(friend_id: str):
    uid = current_user_id()
    db = _db()
    rel = next((r for r in _relations(db, uid) if friend_id in (r["requester_id"], r["addressee_id"]) and r.get("status") == "accepted"), None)
    if not rel:
        raise HTTPException(status_code=404, detail="Người này không có trong danh sách bạn bè")
    db.table("friendships").delete().eq("id", rel["id"]).execute()
    return {"deleted": True}


# ---------------------------------------------------------------- khoảnh khắc chia sẻ
def _view(db, row: Dict[str, Any], uid: str, names: Dict[str, Dict[str, Any]], reactions: List[Dict[str, Any]]) -> Dict[str, Any]:
    mine = [r for r in reactions if r["moment_id"] == row["id"]]
    counts = {k: sum(1 for r in mine if r.get("kind") == k) for k in REACTIONS}
    my = next((r.get("kind") for r in mine if r["user_id"] == uid), None)
    meta = row.get("meta") or {}
    return {
        "id": row["id"], "user_id": row["user_id"], "is_me": row["user_id"] == uid,
        "name": _label(names.get(row["user_id"])), "caption": row.get("caption") or "",
        "url": signed_storage_url(db, MOMENTS_BUCKET, row.get("path") or "", MOMENT_URL_TTL) if row.get("path") else None,
        "day": str(row.get("moment_date"))[:10], "created_at": row.get("created_at"),
        "shared": bool(row.get("shared")),
        "meta": {"streak": meta.get("streak", 0), "minutes": meta.get("minutes", 0),
                 "tasks_done": meta.get("tasks_done", 0), "tasks_total": meta.get("tasks_total", 0)},
        "reactions": counts, "my_reaction": my,
    }


@router.get("/feed")
def feed(before: Optional[str] = None, limit: int = FEED_PAGE):
    """Khoảnh khắc đã chia sẻ của bạn bè và của chính bạn, mới nhất trước. `before` = created_at của mục cuối trang trước."""
    uid = current_user_id()
    db = _db()
    limit = max(1, min(int(limit), 50))
    ids = [uid] + _friend_ids(db, uid)
    q = db.table("study_moments").select("*").in_("user_id", ids).eq("shared", True)
    if before:
        q = q.lt("created_at", before)
    rows = q.order("created_at", desc=True).limit(limit).execute().data or []
    names = _profiles(db, [r["user_id"] for r in rows])
    mids = [r["id"] for r in rows]
    reactions = (db.table("moment_reactions").select("*").in_("moment_id", mids).execute().data or []) if mids else []
    items = [_view(db, r, uid, names, reactions) for r in rows]
    return {"items": items, "next_before": rows[-1].get("created_at") if len(rows) == limit else None}


@router.post("/moments")
async def post_moment(background: BackgroundTasks, caption: str = Form(""), file: UploadFile = File(...)):
    """Chụp xong gửi luôn: lưu khoảnh khắc hôm nay và chia sẻ cho bạn bè (cũng hiện trong lịch học của bạn)."""
    uid = current_user_id()
    raw = await file.read(MAX_PHOTO_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=400, detail="Ảnh rỗng")
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Ảnh quá lớn (tối đa 10 MB)")
    caption = " ".join((caption or "").split())[:200]
    jpeg = await run_in_threadpool(_normalize_photo, raw)
    notify_ids: List[str] = []

    def store() -> Dict[str, Any]:
        db = _db()
        today = sched.local_today()
        count = len(db.table("study_moments").select("id").eq("user_id", uid).eq("moment_date", today.isoformat()).execute().data or [])
        if count >= MOMENTS_PER_DAY:
            raise HTTPException(status_code=429, detail=f"Mỗi ngày lưu tối đa {MOMENTS_PER_DAY} khoảnh khắc")
        stats = sched.day_stats(db, uid, today, today).get(today.isoformat()) or {}
        info = sched.streak(db, uid)
        mid = str(uuid.uuid4())
        path = f"{uid}/{today.isoformat()}/{mid}.jpg"
        ensure_private_bucket(db, MOMENTS_BUCKET)
        db.storage.from_(MOMENTS_BUCKET).upload(path, jpeg, {"content-type": "image/jpeg"})
        row = {
            "id": mid, "user_id": uid, "moment_date": today.isoformat(), "path": path, "caption": caption, "shared": True,
            "meta": {"tasks_done": stats.get("tasks_done", 0), "tasks_total": stats.get("tasks_total", 0),
                     "minutes": stats.get("minutes", 0), "slots_done": stats.get("slots_done", 0),
                     "streak": max(info.get("current", 0), 1)},
            "created_at": _now(),
        }
        recent = (db.table("study_moments").select("id").eq("user_id", uid).eq("shared", True)
                  .gte("created_at", (datetime.now(timezone.utc) - MOMENT_PUSH_COOLDOWN).isoformat()).execute().data or [])
        db.table("study_moments").insert(row).execute()
        if not recent:
            notify_ids.extend(_friend_ids(db, uid))
        return _view(db, row, uid, _profiles(db, [uid]), [])

    moment = await run_in_threadpool(store)
    if notify_ids:
        background.add_task(_push, notify_ids, f"{moment['name']} vừa chia sẻ khoảnh khắc",
                            caption or "Mở Studia để xem và thả cảm xúc.", {"type": "moment", "moment_id": moment["id"]})
    return {"moment": moment}


class ShareIn(BaseModel):
    shared: bool


@router.patch("/moments/{moment_id}")
def set_shared(moment_id: str, body: ShareIn):
    """Bật/tắt chia sẻ một khoảnh khắc của chính bạn (tắt thì bạn bè không còn thấy)."""
    uid = current_user_id()
    db = _db()
    rows = db.table("study_moments").select("*").eq("id", moment_id).eq("user_id", uid).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoảnh khắc")
    db.table("study_moments").update({"shared": body.shared}).eq("id", moment_id).eq("user_id", uid).execute()
    return {"moment": _view(db, {**rows[0], "shared": body.shared}, uid, _profiles(db, [uid]), [])}


class ReactionIn(BaseModel):
    kind: Literal["flame", "heart", "clap"]


def _visible_moment(db, uid: str, moment_id: str) -> Dict[str, Any]:
    rows = db.table("study_moments").select("*").eq("id", moment_id).limit(1).execute().data or []
    row = rows[0] if rows else None
    if not row or not row.get("shared") or (row["user_id"] != uid and row["user_id"] not in _friend_ids(db, uid)):
        raise HTTPException(status_code=404, detail="Không tìm thấy khoảnh khắc")  # không lộ ảnh của người lạ
    return row


@router.put("/moments/{moment_id}/reaction")
def react(moment_id: str, body: ReactionIn):
    uid = current_user_id()
    db = _db()
    _visible_moment(db, uid, moment_id)
    mine = db.table("moment_reactions").select("*").eq("moment_id", moment_id).eq("user_id", uid).limit(1).execute().data or []
    if mine:
        db.table("moment_reactions").update({"kind": body.kind}).eq("id", mine[0]["id"]).execute()
    else:
        db.table("moment_reactions").insert({"id": str(uuid.uuid4()), "moment_id": moment_id, "user_id": uid, "kind": body.kind, "created_at": _now()}).execute()
    return {"my_reaction": body.kind}


@router.delete("/moments/{moment_id}/reaction")
def unreact(moment_id: str):
    uid = current_user_id()
    db = _db()
    _visible_moment(db, uid, moment_id)
    db.table("moment_reactions").delete().eq("moment_id", moment_id).eq("user_id", uid).execute()
    return {"my_reaction": None}
