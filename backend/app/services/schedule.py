"""
Lịch học: thống kê hoạt động theo ngày, chuỗi ngày học liên tiếp (streak) và email nhắc trước giờ học.

Một ngày được tính là "có học" khi có ít nhất một trong:
  - hoàn thành một nhiệm vụ của lịch học (daily_learning_plans),
  - đánh dấu xong một khung giờ học (study_slots),
  - lưu một khoảnh khắc học (study_moments),
  - làm ít nhất một câu hỏi (question_attempts).
"""
from __future__ import annotations

import html
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

from app.config import settings
from app.services import sysconfig

logger = logging.getLogger("studia.schedule")

TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
STREAK_LOOKBACK_DAYS = 730
# Chống bơm streak: chỉ đánh dấu "đã học" cho hôm nay hoặc hôm qua (học khuya qua nửa đêm vẫn kịp ghi)
MARK_DONE_GRACE_DAYS = 1
MILESTONES = (3, 7, 14, 30, 60, 100, 200, 365)


# ---------------------------------------------------------------- thời gian
def tz() -> timezone:
    return timezone(timedelta(hours=settings.TZ_OFFSET_HOURS))


def local_now() -> datetime:
    return datetime.now(tz())


def local_today() -> date:
    return local_now().date()


def parse_day(value: str) -> date:
    return date.fromisoformat(str(value)[:10])


def to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def slot_minutes(slot: Dict[str, Any]) -> int:
    try:
        return max(0, to_minutes(slot["end_time"]) - to_minutes(slot["start_time"]))
    except Exception:
        return 0


def _to_local_date(ts: Any) -> Optional[date]:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz()).date()


def _rows(db, table: str, uid: str, col: str, start: date, end: date) -> List[Dict[str, Any]]:
    try:
        return (db.table(table).select("*").eq("user_id", uid)
                .gte(col, start.isoformat()).lte(col, end.isoformat()).execute().data or [])
    except Exception as e:  # bảng chưa có (chưa chạy migration) thì coi như trống
        logger.debug(f"read {table} failed: {e}")
        return []


def can_mark_done(day: date, today: Optional[date] = None) -> bool:
    """Ngày này còn được đánh dấu là đã học không (không cho ghi bù ngày cũ, không cho ghi trước ngày tương lai)."""
    today = today or local_today()
    return today - timedelta(days=MARK_DONE_GRACE_DAYS) <= day <= today


# ---------------------------------------------------------------- hoạt động theo ngày
def _blank() -> Dict[str, Any]:
    return {"tasks_total": 0, "tasks_done": 0, "plan_status": None, "minutes": 0, "minutes_planned": 0,
            "slots": 0, "slots_done": 0, "moments": 0, "attempts": 0, "active": False, "labels": []}


def day_stats(db, uid: str, start: date, end: date) -> Dict[str, Dict[str, Any]]:
    """Tóm tắt từng ngày trong [start, end]; chỉ trả những ngày có dữ liệu."""
    out: Dict[str, Dict[str, Any]] = {}

    def at(day: str) -> Dict[str, Any]:
        return out.setdefault(day, _blank())

    for plan in _rows(db, "daily_learning_plans", uid, "plan_date", start, end):
        d = at(str(plan.get("plan_date"))[:10])
        tasks = plan.get("tasks") or []
        d["plan_status"] = plan.get("status")
        d["tasks_total"] = len(tasks)
        for t in tasks:
            label = str(t.get("topic_name") or "").strip()
            if label and label not in d["labels"] and len(d["labels"]) < 3:
                d["labels"].append(label)
            if t.get("status") == "completed":
                d["tasks_done"] += 1
                d["minutes"] += int(t.get("duration_min") or 0)
        d["minutes_planned"] = int(plan.get("total_minutes") or sum(int(t.get("duration_min") or 0) for t in tasks))

    for slot in _rows(db, "study_slots", uid, "slot_date", start, end):
        d = at(str(slot.get("slot_date"))[:10])
        d["slots"] += 1
        d["minutes_planned"] += slot_minutes(slot)
        label = str(slot.get("title") or "").strip()
        if label and label not in d["labels"] and len(d["labels"]) < 3:
            d["labels"].append(label)
        if slot.get("status") == "done":
            d["slots_done"] += 1
            d["minutes"] += slot_minutes(slot)

    for m in _rows(db, "study_moments", uid, "moment_date", start, end):
        d = at(str(m.get("moment_date"))[:10])
        d["moments"] += 1
        # Ảnh đăng bù cho ngày cũ vẫn hiện trên lịch nhưng không làm ngày đó thành "có học"
        posted = _to_local_date(m.get("created_at"))
        if posted is None or abs((posted - parse_day(m.get("moment_date"))).days) <= MARK_DONE_GRACE_DAYS:
            d["moments_live"] = d.get("moments_live", 0) + 1
        if m.get("path") and not d.get("cover_path"):
            d["cover_path"] = m["path"]  # ảnh đầu tiên làm hình nền ô lịch

    try:
        attempts = (db.table("question_attempts").select("created_at").eq("user_id", uid)
                    .gte("created_at", (start - timedelta(days=1)).isoformat())
                    .order("created_at", desc=True).limit(1000).execute().data or [])
    except Exception as e:
        logger.debug(f"read question_attempts failed: {e}")
        attempts = []
    for a in attempts:
        day = _to_local_date(a.get("created_at"))
        if day and start <= day <= end:
            at(day.isoformat())["attempts"] += 1

    for d in out.values():
        d["active"] = bool(d["tasks_done"] or d["slots_done"] or d.get("moments_live") or d["attempts"])
    return out


# ---------------------------------------------------------------- streak
def streak_from_days(active: Iterable[date], today: date) -> Dict[str, Any]:
    days: Set[date] = set(active)
    # Hôm nay chưa học thì chuỗi vẫn còn nguyên đến hết ngày: tính lùi từ hôm qua
    cursor = today if today in days else today - timedelta(days=1)
    current = 0
    while cursor in days:
        current += 1
        cursor -= timedelta(days=1)

    longest = run = 0
    prev: Optional[date] = None
    for d in sorted(days):
        run = run + 1 if prev is not None and (d - prev).days == 1 else 1
        longest = max(longest, run)
        prev = d

    next_milestone = next((m for m in MILESTONES if m > current), None)
    # Số ngày kể từ lần học gần nhất (0 = hôm nay). None = chưa có ngày học nào trong khoảng đã xét.
    past = [d for d in days if d <= today]
    days_since_active = (today - max(past)).days if past else None
    return {
        "current": current,
        "days_since_active": days_since_active,
        "longest": max(longest, current),
        "today_done": today in days,
        "at_risk": current > 0 and today not in days,
        "total_days": len(days),
        "next_milestone": next_milestone,
        "to_next_milestone": (next_milestone - current) if next_milestone else 0,
    }


def streak(db, uid: str, today: Optional[date] = None, stats: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    today = today or local_today()
    if stats is None:
        stats = day_stats(db, uid, today - timedelta(days=STREAK_LOOKBACK_DAYS), today)
    active = [parse_day(k) for k, v in stats.items() if v.get("active")]
    return streak_from_days(active, today)


def streak_days(db, uid: str) -> int:
    """Chỉ số streak hiện tại (dùng cho màn hình tổng quan)."""
    try:
        return streak(db, uid)["current"]
    except Exception as e:
        logger.warning(f"streak failed: {e}")
        return 0


# ---------------------------------------------------------------- email nhắc giờ học
def _slot_start(slot: Dict[str, Any]) -> Optional[datetime]:
    try:
        d = parse_day(slot["slot_date"])
        h, m = slot["start_time"].split(":")
        return datetime(d.year, d.month, d.day, int(h), int(m), tzinfo=tz())
    except Exception:
        return None


def _ref(slot: Dict[str, Any]) -> str:
    # Đổi ngày/giờ của khung giờ thì được nhắc lại một lần nữa
    return f"slot:{slot.get('id')}:{str(slot.get('slot_date'))[:10]}:{slot.get('start_time')}"


def due_slots(db, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Khung giờ chưa học, bật nhắc, sẽ bắt đầu trong vòng REMINDER_LEAD_MINUTES phút tới."""
    now = now or local_now()
    lead = max(1, settings.REMINDER_LEAD_MINUTES)
    today = now.date()
    try:
        rows = (db.table("study_slots").select("*")
                .gte("slot_date", today.isoformat())
                .lte("slot_date", (today + timedelta(days=1)).isoformat()).execute().data or [])
    except Exception as e:
        logger.debug(f"read study_slots failed: {e}")
        return []
    out = []
    for s in rows:
        if s.get("status", "planned") != "planned" or s.get("remind") is False:
            continue
        start = _slot_start(s)
        if not start:
            continue
        minutes_left = (start - now).total_seconds() / 60
        # Vòng quét chạy mỗi ~30 giây; chừa 1 phút trễ để không sót khi máy chủ bận
        if -1 <= minutes_left <= lead:
            out.append(s)
    return out


def _already_sent(db, ref: str) -> bool:
    try:
        return bool(db.table("reminder_log").select("id").eq("ref", ref).limit(1).execute().data)
    except Exception:
        return False


def _log(db, uid: str, ref: str, status: str) -> None:
    try:
        db.table("reminder_log").insert({
            "user_id": uid, "kind": "slot", "ref": ref, "status": status,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        logger.warning(f"reminder_log insert failed: {e}")


def user_email(db, uid: str) -> Optional[str]:
    try:
        rows = db.table("user_accounts").select("email").eq("id", uid).limit(1).execute().data or []
        return (rows[0].get("email") or None) if rows else None
    except Exception:
        return None


def build_reminder_email(slot: Dict[str, Any], streak_info: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    title = str(slot.get("title") or "Giờ học")
    day = parse_day(slot["slot_date"])
    when = f"{slot.get('start_time')} – {slot.get('end_time')} · {day.day}/{day.month}/{day.year}"
    lead = max(1, settings.REMINDER_LEAD_MINUTES)
    note = str(slot.get("note") or "").strip()
    link = f"{settings.FRONTEND_URL.rstrip('/')}/plan?view=day&date={day.isoformat()}"
    cur = (streak_info or {}).get("current", 0)
    streak_line = (f"Bạn đang có chuỗi {cur} ngày học liên tiếp. Học hôm nay để giữ chuỗi nhé."
                   if cur and not (streak_info or {}).get("today_done") else "")

    note_html = (f'<div style="margin:14px 0;padding:12px 14px;border-radius:10px;background:#f1eee8;'
                 f'color:#3a4260;white-space:pre-wrap;font-size:15px;line-height:22px">{html.escape(note)}</div>') if note else ""
    streak_html = f'<p style="color:#a15c00;font-size:14px;margin:12px 0 0">{html.escape(streak_line)}</p>' if streak_line else ""
    body = f"""<!doctype html><html><body style="margin:0;background:#f8f6f2;font-family:Segoe UI,Arial,sans-serif;color:#0e1630">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
  <div style="font-weight:800;font-size:20px;color:#0f1f4d;margin-bottom:18px">Studia</div>
  <div style="background:#fff;border:1px solid #e5e0d8;border-radius:16px;padding:24px">
    <div style="font-size:13px;letter-spacing:.6px;text-transform:uppercase;color:#5e6480;font-weight:650">Sắp đến giờ học · còn {lead} phút</div>
    <h1 style="font-size:22px;line-height:30px;margin:6px 0 4px">{html.escape(title)}</h1>
    <div style="color:#3a4260;font-size:15px">{html.escape(when)}</div>
    {note_html}{streak_html}
    <a href="{html.escape(link)}" style="display:inline-block;margin-top:18px;padding:12px 20px;border-radius:10px;background:#2344c9;color:#fff;text-decoration:none;font-weight:600">Mở lịch học</a>
  </div>
  <p style="color:#5e6480;font-size:12.5px;margin-top:16px">Bạn nhận email này vì đã bật nhắc cho khung giờ học trên Studia. Tắt nhắc ở từng khung giờ trong trang Lịch học.</p>
</div></body></html>"""
    text = f"Sắp đến giờ học (còn {lead} phút)\n\n{title}\n{when}\n" + (f"\n{note}\n" if note else "") \
        + (f"\n{streak_line}\n" if streak_line else "") + f"\nMở lịch học: {link}\n"
    return {"subject": f"Còn {lead} phút nữa: {title} ({slot.get('start_time')})", "html": body, "text": text}


def run_reminder_cycle(db=None, now: Optional[datetime] = None, send=None) -> Dict[str, int]:
    """Quét một lượt: gửi email cho mọi khung giờ sắp bắt đầu mà chưa được nhắc."""
    from app.services import mailer

    counts = {"due": 0, "sent": 0, "skipped": 0, "failed": 0}
    if not sysconfig.reminders_enabled():
        return counts
    send = send or mailer.send_email
    if db is None:
        from app.core.supabase_client import get_supabase_client
        db = get_supabase_client()
    if not db or (send is mailer.send_email and not mailer.smtp_configured()):
        return counts

    emails: Dict[str, Optional[str]] = {}
    streaks: Dict[str, Dict[str, Any]] = {}
    for slot in due_slots(db, now):
        counts["due"] += 1
        ref = _ref(slot)
        if _already_sent(db, ref):
            continue
        uid = str(slot.get("user_id"))
        if uid not in emails:
            emails[uid] = user_email(db, uid)
        to = emails[uid]
        if not to:
            _log(db, uid, ref, "no_email")
            counts["skipped"] += 1
            continue
        # Ghi nhật ký trước khi gửi: nếu có hai vòng quét chồng nhau cũng không gửi trùng
        _log(db, uid, ref, "sending")
        if uid not in streaks:
            try:
                streaks[uid] = streak(db, uid)
            except Exception:
                streaks[uid] = {}
        mail = build_reminder_email(slot, streaks[uid])
        ok, why = send(to, mail["subject"], mail["html"], mail["text"])
        try:
            db.table("reminder_log").update({"status": "sent" if ok else why}).eq("ref", ref).execute()
        except Exception:
            pass
        counts["sent" if ok else "failed"] += 1
    return counts
