"""
Cấu hình hệ thống do quản lý chỉnh trong trang Quản trị, lưu ở bảng app_settings:
  feature_flags            {tính_năng: bool}       bật/tắt tính năng cho học sinh
  limits                   {TÊN: int}              ghi đè giới hạn upload trong .env
  reminders_enabled        bool                    tắt nhắc lịch qua email khi đang chạy
  announcement             {enabled, text, level}  banner thông báo toàn hệ thống
  dictation_segments       [..] | None             ngân hàng đoạn Nghe chép (None = dùng bộ có sẵn trong app)
  pronunciation_sentences  [..] | None             câu luyện Phát âm (None = dùng bộ có sẵn)
  book_meta                {doc_id: {...}}         mô tả, danh mục, thứ tự, nổi bật của sách chung
  ai_grading               {...}                   ngữ cảnh chấm AI Writing/Speaking (xem grading_context)

Đọc có cache ngắn (một tiến trình duy nhất) và KHÔNG BAO GIỜ làm hỏng request: lỗi DB thì dùng mặc định.
"""
import logging
import threading
import time
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger("studia.sysconfig")

# id -> (nhãn, mô tả). Thứ tự hiển thị trong trang Quản trị.
FEATURES: dict[str, tuple[str, str]] = {
    "dictation": ("Nghe chép chính tả", "Nghe đoạn ngắn 10–15 giây và gõ lại"),
    "pronunciation": ("Luyện phát âm", "Đọc theo câu mẫu, chấm từng từ"),
    "scenarios": ("Hội thoại tình huống", "Nói chuyện với trợ lý AI (tốn lượt gọi AI)"),
    "tutor": ("Gia sư AI", "Hỏi đáp và bôi đen chữ để giải thích (tốn lượt gọi AI)"),
    "writing": ("Chấm Writing", "Chấm Task 1/2 theo 4 tiêu chí band, sửa lỗi từng câu (tốn lượt gọi AI)"),
    "speaking": ("Speaking IELTS", "Luyện Part 1–3, ghi âm, tự sửa lỗi; chấm AI theo 4 tiêu chí (tốn lượt gọi AI)"),
    "exam": ("Thi thử IELTS", "Thư viện đề, làm bài và chấm"),
    "flashcards": ("Thẻ & từ vựng", "Flashcard, sổ từ vựng"),
    "practice": ("Ôn luyện", "Câu hỏi ôn tập, ôn theo lịch lặp lại"),
    "plan": ("Lịch học", "Lịch học, nhắc học và thống kê chuỗi ngày"),
    "friends": ("Kết bạn và chia sẻ khoảnh khắc", "Thêm bạn bằng mã, xem và thả cảm xúc cho khoảnh khắc học của bạn bè (app mobile)"),
    "upload": ("Học sinh tải sách lên", "Tắt thì chỉ còn đọc Thư viện Studia; quản lý vẫn tải được"),
}

# Giới hạn có thể ghi đè: tên -> (nhỏ nhất, lớn nhất)
LIMITS: dict[str, tuple[int, int]] = {
    "MAX_PDF_MB": (1, 500),
    "MAX_PDF_PAGES": (1, 3000),
    "MAX_AUDIO_MB": (1, 500),
}

ANNOUNCEMENT_LEVELS = ("info", "warning")
ANNOUNCEMENT_MAX = 300
DICTATION_LEVELS = ("easy", "mid", "hard")
TTL_SECONDS = 10

_lock = threading.Lock()
_cache: dict[str, tuple[float, Any]] = {}


def invalidate() -> None:
    with _lock:
        _cache.clear()


def _raw(key: str) -> Any:
    """Đọc một khoá app_settings (có cache). Không có / lỗi → None."""
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < TTL_SECONDS:
            return hit[1]
    value: Any = None
    try:
        from app.core.supabase_client import get_supabase_client
        db = get_supabase_client()
        if db:
            rows = db.table("app_settings").select("*").eq("key", key).limit(1).execute().data or []
            if rows:
                value = rows[0].get("value")
    except Exception as e:  # DB lỗi thì dùng mặc định, không chặn người dùng
        logger.warning(f"Không đọc được app_settings[{key}]: {e}")
        return None
    with _lock:
        _cache[key] = (now, value)
    return value


def save(key: str, value: Any) -> None:
    from app.services import billing
    billing.set_setting(key, value)
    invalidate()


# ---------------------------------------------------------------- tính năng
def feature_flags() -> dict[str, bool]:
    stored = _raw("feature_flags")
    stored = stored if isinstance(stored, dict) else {}
    return {k: bool(stored.get(k, True)) for k in FEATURES}


def feature_enabled(key: str) -> bool:
    return feature_flags().get(key, True)


# ---------------------------------------------------------------- giới hạn
def limit(name: str) -> int:
    """Giới hạn đang áp dụng: giá trị quản lý đặt, nếu không có thì lấy từ .env."""
    default = int(getattr(settings, name))
    stored = _raw("limits")
    if isinstance(stored, dict):
        try:
            v = int(stored.get(name))
            lo, hi = LIMITS[name]
            if lo <= v <= hi:
                return v
        except (TypeError, ValueError, KeyError):
            pass
    return default


def limits_state() -> dict[str, dict]:
    stored = _raw("limits")
    stored = stored if isinstance(stored, dict) else {}
    out = {}
    for name, (lo, hi) in LIMITS.items():
        out[name] = {"value": limit(name), "default": int(getattr(settings, name)), "min": lo, "max": hi,
                     "overridden": name in stored and stored.get(name) is not None}
    return out


def reminders_enabled() -> bool:
    """`.env` là công tắc tổng; quản lý chỉ có thể tắt thêm khi đang chạy."""
    if not settings.REMINDERS_ENABLED:
        return False
    v = _raw("reminders_enabled")
    return True if v is None else bool(v)


# ---------------------------------------------------------------- thông báo & nội dung
def announcement() -> dict:
    a = _raw("announcement")
    a = a if isinstance(a, dict) else {}
    level = a.get("level") if a.get("level") in ANNOUNCEMENT_LEVELS else "info"
    return {"enabled": bool(a.get("enabled")), "text": str(a.get("text") or "")[:ANNOUNCEMENT_MAX], "level": level}


def custom_list(key: str) -> Optional[list]:
    v = _raw(key)
    return v if isinstance(v, list) and v else None


def book_meta() -> dict:
    v = _raw("book_meta")
    return v if isinstance(v, dict) else {}


def public_config() -> dict:
    """Phần cấu hình mà frontend cần để hiện/ẩn tính năng, banner, nội dung luyện tập."""
    a = announcement()
    return {
        "features": feature_flags(),
        "announcement": a if a["enabled"] and a["text"] else None,
        "dictation_segments": custom_list("dictation_segments"),
        "pronunciation_sentences": custom_list("pronunciation_sentences"),
        "limits": {k: limit(k) for k in LIMITS},
    }


# ---------------------------------------------------------------- kiểm tra dữ liệu quản lý nhập
def clean_dictation(items: Any) -> list[dict]:
    if not isinstance(items, list):
        raise ValueError("Danh sách đoạn nghe không hợp lệ")
    if len(items) > 500:
        raise ValueError("Tối đa 500 đoạn")
    out, seen = [], set()
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            raise ValueError(f"Đoạn #{i + 1} không hợp lệ")
        text = " ".join(str(it.get("text") or "").split())
        words = len(text.split())
        if not 6 <= words <= 80:
            raise ValueError(f"Đoạn #{i + 1} có {words} từ; cần 6–80 từ (khoảng 10–15 giây là 25–35 từ)")
        level = it.get("level")
        if level not in DICTATION_LEVELS:
            raise ValueError(f"Đoạn #{i + 1}: cấp độ phải là easy, mid hoặc hard")
        sid = str(it.get("id") or "").strip()[:40] or f"x{i + 1}"
        while sid in seen:
            sid += "_"
        seen.add(sid)
        out.append({"id": sid, "level": level, "topic": " ".join(str(it.get("topic") or "Khác").split())[:60] or "Khác", "text": text})
    return out


def clean_pronunciation(items: Any) -> list[dict]:
    if not isinstance(items, list):
        raise ValueError("Danh sách câu luyện không hợp lệ")
    if len(items) > 300:
        raise ValueError("Tối đa 300 câu")
    out = []
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            raise ValueError(f"Câu #{i + 1} không hợp lệ")
        text = " ".join(str(it.get("text") or "").split())
        if not 2 <= len(text.split()) <= 60:
            raise ValueError(f"Câu #{i + 1} cần 2–60 từ")
        out.append({"group": " ".join(str(it.get("group") or "Khác").split())[:60] or "Khác", "text": text})
    return out
