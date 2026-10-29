"""
Lịch học chi tiết: tổng quan tháng/năm, chi tiết trong ngày, khung giờ học kèm ghi chú,
khoảnh khắc học (ảnh), chuỗi ngày học liên tiếp và email nhắc trước giờ học.
"""
import io
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.core.auth import current_user_id
from app.core.supabase_client import get_supabase_client
from app.core.uploads import ensure_private_bucket, signed_storage_url
from app.services import mailer, sysconfig
from app.services import schedule as sched

logger = logging.getLogger("studia.schedule.api")

router = APIRouter(prefix="/schedule", tags=["Schedule"])

MOMENTS_BUCKET = "moments"
MAX_PHOTO_BYTES = 10 * 1024 * 1024
MAX_PHOTO_SIDE = 1600
MOMENTS_PER_DAY = 12
MOMENT_URL_TTL = 3600
MAX_RANGE_DAYS = 400
SKILLS = ("listening", "reading", "writing", "speaking", "vocab", "grammar", "review", "other")
SLOT_STATUSES = ("planned", "done", "skipped")


def _db():
    db = get_supabase_client()
    if not db:
        raise HTTPException(status_code=503, detail="Cơ sở dữ liệu không khả dụng")
    return db


def _day(value: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise HTTPException(status_code=422, detail="Ngày không hợp lệ, cần dạng YYYY-MM-DD")


def _hhmm(value: str, label: str) -> str:
    if not sched.TIME_RE.match(value or ""):
        raise HTTPException(status_code=422, detail=f"{label} không hợp lệ, cần dạng HH:MM")
    return value


# ---------------------------------------------------------------- tổng quan
@router.get("/summary")
def summary(start: str, end: str):
    """Tóm tắt từng ngày trong khoảng [start, end] (tối đa ~13 tháng) cho lịch tháng và lịch năm."""
    s, e = _day(start), _day(end)
    if e < s:
        raise HTTPException(status_code=422, detail="Ngày kết thúc phải sau ngày bắt đầu")
    if (e - s).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Chỉ xem được tối đa {MAX_RANGE_DAYS} ngày một lần")
    uid = current_user_id()
    db = _db()
    days = sched.day_stats(db, uid, s, e)
    for st in days.values():
        path = st.pop("cover_path", None)
        st["cover"] = signed_storage_url(db, MOMENTS_BUCKET, path, MOMENT_URL_TTL) if path else None
    return {"start": s.isoformat(), "end": e.isoformat(), "days": days, "today": sched.local_today().isoformat()}


@router.get("/streak")
def get_streak():
    uid = current_user_id()
    db = _db()
    today = sched.local_today()
    stats = sched.day_stats(db, uid, today - timedelta(days=sched.STREAK_LOOKBACK_DAYS), today)
    info = sched.streak(db, uid, today, stats)
    week = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        st = stats.get(d.isoformat()) or {}
        week.append({"date": d.isoformat(), "active": bool(st.get("active")), "minutes": st.get("minutes", 0)})
    return {**info, "week": week, "today": today.isoformat()}


# ---------------------------------------------------------------- chi tiết ngày
def _moment_view(row: Dict[str, Any]) -> Dict[str, Any]:
    url = signed_storage_url(_db(), MOMENTS_BUCKET, row.get("path") or "", MOMENT_URL_TTL) if row.get("path") else None
    return {
        "id": row.get("id"), "day": str(row.get("moment_date"))[:10], "caption": row.get("caption") or "",
        "url": url, "created_at": row.get("created_at"), "meta": row.get("meta") or {},
    }


def _slot_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"), "day": str(row.get("slot_date"))[:10], "start": row.get("start_time"), "end": row.get("end_time"),
        "title": row.get("title") or "", "note": row.get("note") or "", "skill": row.get("skill") or "other",
        "status": row.get("status") or "planned", "remind": row.get("remind") is not False,
        "minutes": sched.slot_minutes(row),
    }


@router.get("/day/{day}")
def day_detail(day: str):
    d = _day(day)
    uid = current_user_id()
    db = _db()
    plans = db.table("daily_learning_plans").select("*").eq("user_id", uid).eq("plan_date", d.isoformat()).execute().data or []
    try:
        slots = db.table("study_slots").select("*").eq("user_id", uid).eq("slot_date", d.isoformat()).execute().data or []
    except Exception:
        slots = []
    try:
        moments = db.table("study_moments").select("*").eq("user_id", uid).eq("moment_date", d.isoformat()).execute().data or []
    except Exception:
        moments = []
    slots.sort(key=lambda s: (s.get("start_time") or "", s.get("end_time") or ""))
    moments.sort(key=lambda m: m.get("created_at") or "")
    stats = sched.day_stats(db, uid, d, d).get(d.isoformat()) or {}
    return {
        "date": d.isoformat(),
        "plan": plans[0] if plans else None,
        "slots": [_slot_view(s) for s in slots],
        "moments": [_moment_view(m) for m in moments],
        "stats": stats,
    }


# ---------------------------------------------------------------- khung giờ học
class SlotIn(BaseModel):
    day: str
    start: str
    end: str
    title: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=4000)
    skill: str = "other"
    remind: bool = True

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Tên khung giờ không được để trống")
        return v


class SlotPatch(BaseModel):
    day: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=4000)
    skill: Optional[str] = None
    remind: Optional[bool] = None
    status: Optional[str] = None


def _check_times(start: str, end: str) -> None:
    _hhmm(start, "Giờ bắt đầu")
    _hhmm(end, "Giờ kết thúc")
    if sched.to_minutes(end) <= sched.to_minutes(start):
        raise HTTPException(status_code=422, detail="Giờ kết thúc phải sau giờ bắt đầu")


def _own_slot(db, uid: str, slot_id: str) -> Dict[str, Any]:
    rows = db.table("study_slots").select("*").eq("id", slot_id).eq("user_id", uid).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy khung giờ")
    return rows[0]


@router.post("/slots")
def create_slot(body: SlotIn):
    uid = current_user_id()
    d = _day(body.day)
    _check_times(body.start, body.end)
    if body.skill not in SKILLS:
        raise HTTPException(status_code=422, detail="Kỹ năng không hợp lệ")
    if d < sched.local_today():
        raise HTTPException(status_code=422, detail="Không thể thêm lịch học vào ngày đã qua")
    db = _db()
    existing = db.table("study_slots").select("id").eq("user_id", uid).eq("slot_date", d.isoformat()).execute().data or []
    if len(existing) >= 48:
        raise HTTPException(status_code=429, detail="Một ngày tối đa 48 khung giờ")
    row = {
        "id": str(uuid.uuid4()), "user_id": uid, "slot_date": d.isoformat(), "start_time": body.start, "end_time": body.end,
        "title": body.title, "note": body.note.strip(), "skill": body.skill, "status": "planned",
        "remind": body.remind, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    db.table("study_slots").insert(row).execute()
    return {"slot": _slot_view(row)}


@router.patch("/slots/{slot_id}")
def update_slot(slot_id: str, body: SlotPatch):
    uid = current_user_id()
    db = _db()
    cur = _own_slot(db, uid, slot_id)
    data = body.model_dump(exclude_unset=True)
    updates: Dict[str, Any] = {}
    if "day" in data and data["day"] is not None:
        updates["slot_date"] = _day(data["day"]).isoformat()
    start = data.get("start") or cur.get("start_time")
    end = data.get("end") or cur.get("end_time")
    if "start" in data or "end" in data:
        _check_times(start, end)
        updates["start_time"], updates["end_time"] = start, end
    if data.get("title") is not None:
        title = data["title"].strip()
        if not title:
            raise HTTPException(status_code=422, detail="Tên khung giờ không được để trống")
        updates["title"] = title
    if data.get("note") is not None:
        updates["note"] = data["note"].strip()
    if data.get("skill") is not None:
        if data["skill"] not in SKILLS:
            raise HTTPException(status_code=422, detail="Kỹ năng không hợp lệ")
        updates["skill"] = data["skill"]
    if data.get("remind") is not None:
        updates["remind"] = data["remind"]
    if "slot_date" in updates and date.fromisoformat(updates["slot_date"]) < sched.local_today():
        raise HTTPException(status_code=422, detail="Không thể dời lịch học sang ngày đã qua")
    if data.get("status") is not None:
        if data["status"] not in SLOT_STATUSES:
            raise HTTPException(status_code=422, detail="Trạng thái không hợp lệ")
        slot_day = date.fromisoformat(str(updates.get("slot_date") or cur.get("slot_date"))[:10])
        if data["status"] == "done" and cur.get("status") != "done" and not sched.can_mark_done(slot_day):
            raise HTTPException(status_code=422, detail="Chỉ đánh dấu xong khung giờ của hôm nay hoặc hôm qua")
        updates["status"] = data["status"]
    if "slot_date" in updates and (updates.get("status") or cur.get("status")) == "done" \
            and not sched.can_mark_done(date.fromisoformat(updates["slot_date"])):
        raise HTTPException(status_code=422, detail="Khung giờ đã xong chỉ dời trong hôm nay hoặc hôm qua")
    if updates:
        db.table("study_slots").update(updates).eq("id", slot_id).eq("user_id", uid).execute()
    return {"slot": _slot_view({**cur, **updates})}


@router.delete("/slots/{slot_id}")
def delete_slot(slot_id: str):
    uid = current_user_id()
    db = _db()
    _own_slot(db, uid, slot_id)
    db.table("study_slots").delete().eq("id", slot_id).eq("user_id", uid).execute()
    return {"deleted": True}


# ---------------------------------------------------------------- khoảnh khắc học (ảnh)
def _normalize_photo(raw: bytes) -> bytes:
    """Mở ảnh, xoay theo EXIF, thu nhỏ và lưu lại JPEG (đồng thời bỏ thông tin vị trí trong EXIF)."""
    from PIL import Image, ImageOps

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise HTTPException(status_code=400, detail="Tệp không phải ảnh hợp lệ")
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
        img = bg
    elif img.mode == "L":
        img = img.convert("RGB")
    img.thumbnail((MAX_PHOTO_SIDE, MAX_PHOTO_SIDE))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue()


@router.post("/moments")
async def add_moment(day: str = Form(...), caption: str = Form(""), file: UploadFile = File(...)):
    uid = current_user_id()
    d = _day(day)
    if d > sched.local_today() + timedelta(days=1):
        raise HTTPException(status_code=422, detail="Chưa thể lưu khoảnh khắc cho ngày trong tương lai")
    raw = await file.read(MAX_PHOTO_BYTES + 1)
    if not raw:
        raise HTTPException(status_code=400, detail="Ảnh rỗng")
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Ảnh quá lớn (tối đa 10 MB)")
    caption = (caption or "").strip()[:500]
    jpeg = await run_in_threadpool(_normalize_photo, raw)

    def store() -> Dict[str, Any]:
        db = _db()
        count = len(db.table("study_moments").select("id").eq("user_id", uid).eq("moment_date", d.isoformat()).execute().data or [])
        if count >= MOMENTS_PER_DAY:
            raise HTTPException(status_code=429, detail=f"Mỗi ngày lưu tối đa {MOMENTS_PER_DAY} khoảnh khắc")
        stats = sched.day_stats(db, uid, d, d).get(d.isoformat()) or {}
        info = sched.streak(db, uid)
        mid = str(uuid.uuid4())
        path = f"{uid}/{d.isoformat()}/{mid}.jpg"
        ensure_private_bucket(db, MOMENTS_BUCKET)
        db.storage.from_(MOMENTS_BUCKET).upload(path, jpeg, {"content-type": "image/jpeg"})
        row = {
            "id": mid, "user_id": uid, "moment_date": d.isoformat(), "path": path, "caption": caption,
            "meta": {  # tiến độ tại thời điểm chụp
                "tasks_done": stats.get("tasks_done", 0), "tasks_total": stats.get("tasks_total", 0),
                "minutes": stats.get("minutes", 0), "slots_done": stats.get("slots_done", 0),
                "streak": max(info.get("current", 0), 1),
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        db.table("study_moments").insert(row).execute()
        return _moment_view(row)

    moment = await run_in_threadpool(store)
    return {"moment": moment}


@router.patch("/moments/{moment_id}")
def edit_moment_caption(moment_id: str, body: Dict[str, Any]):
    uid = current_user_id()
    db = _db()
    rows = db.table("study_moments").select("*").eq("id", moment_id).eq("user_id", uid).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoảnh khắc")
    caption = str(body.get("caption") or "").strip()[:500]
    db.table("study_moments").update({"caption": caption}).eq("id", moment_id).eq("user_id", uid).execute()
    return {"moment": _moment_view({**rows[0], "caption": caption})}


@router.delete("/moments/{moment_id}")
def delete_moment(moment_id: str):
    uid = current_user_id()
    db = _db()
    rows = db.table("study_moments").select("*").eq("id", moment_id).eq("user_id", uid).limit(1).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoảnh khắc")
    path = rows[0].get("path")
    if path:
        try:
            db.storage.from_(MOMENTS_BUCKET).remove([path])
        except Exception as e:
            logger.warning(f"Cannot remove moment file {path}: {e}")
    db.table("study_moments").delete().eq("id", moment_id).eq("user_id", uid).execute()
    return {"deleted": True}


# ---------------------------------------------------------------- nhắc qua email
@router.get("/reminders/status")
def reminder_status():
    uid = current_user_id()
    db = _db()
    return {
        "enabled": sysconfig.reminders_enabled(),
        "smtp_configured": mailer.smtp_configured(),
        "lead_minutes": settings.REMINDER_LEAD_MINUTES,
        "email": sched.user_email(db, uid),
    }


@router.post("/reminders/test")
async def reminder_test():
    """Gửi thử một email nhắc mẫu tới email tài khoản để kiểm tra cấu hình."""
    uid = current_user_id()
    db = _db()
    to = sched.user_email(db, uid)
    if not to:
        raise HTTPException(status_code=400, detail="Tài khoản chưa có email")
    if not mailer.smtp_configured():
        raise HTTPException(status_code=503, detail="Máy chủ chưa cấu hình gửi email (SMTP). Liên hệ quản lý.")
    now = sched.local_now() + timedelta(minutes=settings.REMINDER_LEAD_MINUTES)
    mail = sched.build_reminder_email({
        "slot_date": now.date().isoformat(), "start_time": now.strftime("%H:%M"),
        "end_time": (now + timedelta(minutes=30)).strftime("%H:%M"), "title": "Email nhắc thử từ Studia",
        "note": "Nếu bạn đọc được thư này, nhắc giờ học qua email đã hoạt động.",
    })
    ok, why = await run_in_threadpool(mailer.send_email, to, mail["subject"], mail["html"], mail["text"])
    if not ok:
        raise HTTPException(status_code=502, detail="Không gửi được email. Kiểm tra lại cấu hình SMTP.")
    return {"sent": True, "to": to}
