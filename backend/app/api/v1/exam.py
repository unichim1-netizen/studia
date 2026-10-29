"""
IELTS Mock Exam API — Studia

Phiên thi dựng trên một đề (exam set đã publish, hoặc đề mẫu):
- nội dung + đáp án được CHỤP (snapshot) vào phiên lúc bắt đầu nên sửa đề về sau không làm sai bài đã thi;
- dữ liệu gửi cho trình duyệt không bao giờ chứa đáp án; chấm điểm hoàn toàn ở server;
- tải lại trang vẫn thi tiếp được: câu trả lời lưu từng câu, đồng hồ do server tính theo thời điểm vào từng phần.
"""
import json
import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.config import settings
from app.core.auth import current_user_id, require_owned
from app.core.supabase_client import get_supabase_client
from app.core.uploads import signed_storage_url
from app.services import exam_explain
from app.services import exam_grading as grading
from app.services.exam_builder.answer_key import score_answers
from app.services.exam_builder.extractor import GeminiJsonLLM
from app.services.exam_builder.sample import sample_exam
from app.services.exam_builder.schema import iter_groups, question_numbers, strip_answers, to_exam_room_payload
from app.services.exam_builder.service import resolve_media

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/exam", tags=["IELTS Mock Exam"])

AUDIO_BUCKET = "exam-audio"
MEDIA_BUCKET = "exam-media"
META_KEY = "__meta__"

SECTION_DURATIONS = {"listening": 30 * 60, "reading": 60 * 60, "writing": 60 * 60, "speaking": 15 * 60}
SECTIONS_BY_TYPE = {
    "full": ["listening", "reading", "writing", "speaking"],
    "listening": ["listening"], "reading": ["reading"], "writing": ["writing"], "speaking": ["speaking"],
}
SKILL_ORDER = ["listening", "reading", "writing", "speaking"]
SESSION_MODES = ("real", "practice")
MIN_SECTION_MINUTES, MAX_SECTION_MINUTES = 1, 240
EXPIRY_GRACE_SECONDS = 180   # thời gian chuyển giữa các phần/mạng chậm

_answer_locks: Dict[str, threading.Lock] = {}
_answer_locks_guard = threading.Lock()


# ============================================================
# Mô hình yêu cầu
# ============================================================

class CreateExamSessionRequest(BaseModel):
    exam_type: str = "full"              # full | listening | reading | writing | speaking
    exam_mode: str = "academic"          # academic | general
    exam_set_id: Optional[str] = None    # None = đề mẫu
    sections: Optional[List[str]] = None  # tự chọn các phần thi (ghi đè exam_type); giữ đúng thứ tự L-R-W-S
    session_mode: str = "real"           # real = mô phỏng phòng thi thật | practice = luyện tập có công cụ hỗ trợ
    durations: Optional[Dict[str, int]] = None  # phút cho từng phần (ghi đè mặc định)
    untimed: bool = False                # chỉ chế độ practice: không đếm ngược
    user_id: Optional[str] = None        # bỏ qua: luôn lấy từ token


class SaveAnswerRequest(BaseModel):
    section: str                         # listening | reading
    question_number: int = Field(..., ge=1, le=200)
    answer: Any = ""
    session_id: Optional[str] = None
    user_id: Optional[str] = None


class SaveWritingRequest(BaseModel):
    task: str                            # task1 | task2
    content: str = Field("", max_length=30000)
    word_count: int = 0
    session_id: Optional[str] = None
    user_id: Optional[str] = None


class SectionRequest(BaseModel):
    section: str


class ExplainRequest(BaseModel):
    skill: str                           # listening | reading
    number: int = Field(..., ge=1, le=200)


class SubmitExamRequest(BaseModel):
    auto_submitted: bool = False
    session_id: Optional[str] = None
    user_id: Optional[str] = None


# ============================================================
# Tiện ích phiên
# ============================================================

def _db():
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")
    return supabase


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_time(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _json_field(value: Any, default: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value:
        try:
            return json.loads(value)
        except ValueError:
            return default
    return default


def _get_session(supabase, session_id: str) -> Dict[str, Any]:
    require_owned("exam_sessions", session_id)
    return supabase.table("exam_sessions").select("*").eq("id", session_id).execute().data[0]


def _answers_of(row: Dict[str, Any]) -> Dict[str, Any]:
    answers = row.get("answers_json")
    if isinstance(answers, dict) and answers:
        return answers
    return _json_field(row.get("answers"), {})


def _write_answers(supabase, session_id: str, answers: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> None:
    update = {"answers_json": answers, "answers": json.dumps(answers, ensure_ascii=False), **(extra or {})}
    supabase.table("exam_sessions").update(update).eq("id", session_id).execute()


def _locked_update(session_id: str, supabase, mutate) -> Dict[str, Any]:
    """Đọc-sửa-ghi các câu trả lời dưới khoá theo phiên để hai câu trả lời đến gần nhau không ghi đè nhau."""
    with _answer_locks_guard:
        lock = _answer_locks.setdefault(session_id, threading.Lock())
    with lock:
        row = supabase.table("exam_sessions").select("*").eq("id", session_id).execute().data[0]
        answers = dict(_answers_of(row))
        extra = mutate(answers, row) or {}
        _write_answers(supabase, session_id, answers, extra)
        return answers


def _snapshot(row: Dict[str, Any]) -> Dict[str, Any]:
    snap = row.get("exam_snapshot")
    if isinstance(snap, str):
        snap = _json_field(snap, {})
    if not snap or "content" not in snap:
        raise HTTPException(status_code=409, detail="Phiên thi không có dữ liệu đề (tạo trước khi nâng cấp). "
                                                    "Hãy tạo phiên thi mới.")
    return snap


def _sections_of(row: Dict[str, Any]) -> List[str]:
    return _json_field(row.get("sections"), [])


def _config(row: Dict[str, Any]) -> Dict[str, Any]:
    """Cấu hình phiên (chế độ, thời gian từng phần) chụp trong exam_snapshot; phiên cũ không có → mặc định."""
    snap = row.get("exam_snapshot")
    if isinstance(snap, str):
        snap = _json_field(snap, {})
    cfg = snap.get("config") if isinstance(snap, dict) else None
    cfg = cfg if isinstance(cfg, dict) else {}
    return {"mode": cfg.get("mode") if cfg.get("mode") in SESSION_MODES else "real",
            "untimed": bool(cfg.get("untimed")),
            "durations": cfg.get("durations") if isinstance(cfg.get("durations"), dict) else {}}


def _durations(sections: List[str], row: Optional[Dict[str, Any]] = None) -> Dict[str, int]:
    custom = _config(row)["durations"] if row else {}
    out: Dict[str, int] = {}
    for s in sections:
        seconds = custom.get(s)
        out[s] = int(seconds) if isinstance(seconds, (int, float)) and seconds > 0 else SECTION_DURATIONS[s]
    return out


def _deadline(row: Dict[str, Any], meta: Dict[str, Any]) -> Optional[datetime]:
    if _config(row)["untimed"]:
        return None
    started = _parse_time(row.get("started_at") or meta.get("started_at"))
    if not started:
        return None
    total = sum(_durations(_sections_of(row), row).values())
    return started + timedelta(seconds=total + EXPIRY_GRACE_SECONDS)


def _remaining(row: Dict[str, Any], meta: Dict[str, Any], section: Optional[str]) -> Optional[int]:
    if not section or _config(row)["untimed"]:
        return None
    started = _parse_time((meta.get("section_started") or {}).get(section))
    duration = _durations([section], row).get(section, 0)
    if not started:
        return duration
    return max(0, int(duration - (_now() - started).total_seconds()))


def _section_closed(row: Dict[str, Any], section: str) -> bool:
    """Phòng thi thật: hết giờ của một phần (cộng thời gian dự phòng) thì không nhận thêm câu trả lời cho phần đó."""
    cfg = _config(row)
    if cfg["mode"] != "real" or cfg["untimed"]:
        return False
    meta = _answers_of(row).get(META_KEY) or {}
    started = _parse_time((meta.get("section_started") or {}).get(section))
    if not started:
        return False
    duration = _durations([section], row).get(section, 0)
    return _now() > started + timedelta(seconds=duration + EXPIRY_GRACE_SECONDS)


def _open_for_writes(supabase, session_id: str, section: str) -> Dict[str, Any]:
    """Phiên còn nhận bài: tự nộp nếu đã quá hạn tổng, chặn khi đã nộp hoặc phần thi đã hết giờ."""
    row = _auto_submit_if_expired(supabase, _get_session(supabase, session_id))
    if row.get("status") in ("SUBMITTED", "AUTO_SUBMITTED"):
        raise HTTPException(status_code=409, detail="Phiên thi đã nộp bài")
    if _section_closed(row, section):
        raise HTTPException(status_code=409, detail="Phần thi này đã hết giờ")
    return row


def _signed(supabase, bucket: str, path: Optional[str]) -> Optional[str]:
    return signed_storage_url(supabase, bucket, path, settings.SIGNED_URL_TTL_SECONDS) if path else None


def _room_payload(supabase, snapshot: Dict[str, Any], sections: List[str]) -> Dict[str, Any]:
    content = resolve_media(strip_answers(snapshot["content"]), lambda p: _signed(supabase, MEDIA_BUCKET, p))
    payload = to_exam_room_payload(content, _signed(supabase, AUDIO_BUCKET, snapshot.get("listening_audio_path")))
    if "listening" not in sections:
        payload["listening"], payload["listening_audio"] = [], None
    if "reading" not in sections:
        payload["reading"], payload["reading_passage"], payload["reading_passages"] = [], "", []
    if "writing" not in sections:
        payload["writing_task1"] = payload["writing_task2"] = ""
        payload["writing_task1_image"] = None
    if "speaking" not in sections:
        payload["speaking"] = {}
    return payload


def _session_view(supabase, row: Dict[str, Any], include_questions: bool = True) -> Dict[str, Any]:
    snapshot = _snapshot(row)
    sections = _sections_of(row)
    answers = _answers_of(row)
    meta = answers.get(META_KEY) or {}
    current = meta.get("current_section") or row.get("current_section") or (sections[0] if sections else None)
    audio_url = _signed(supabase, AUDIO_BUCKET, snapshot.get("listening_audio_path"))
    session = {
        "session_id": row["id"],
        "exam_set_id": row.get("exam_set_id"),
        "title": snapshot.get("title"),
        "exam_type": row.get("exam_type"),
        "exam_mode": row.get("exam_mode"),
        "session_mode": _config(row)["mode"],
        "untimed": _config(row)["untimed"],
        "status": row.get("status"),
        "sections": sections,
        "section_order": sections,
        "section_durations": _durations(sections, row),
        "current_section": current,
        "remaining_seconds": _remaining(row, meta, current) if row.get("status") == "IN_PROGRESS" else None,
        "started_at": row.get("started_at"),
        "audio_url": audio_url,
        "server_time": _now().isoformat(),
    }
    view: Dict[str, Any] = {
        "session": session,
        "answers": {k: v for k, v in answers.items() if k != META_KEY},
    }
    if include_questions:
        view["questions"] = _room_payload(supabase, snapshot, sections)
    return view


# ============================================================
# Chấm điểm
# ============================================================

def _review_items(content: Dict[str, Any], skill: str, scored: Dict[int, Dict[str, Any]]) -> List[Dict[str, Any]]:
    items = []
    for label, group in iter_groups(content, skill):
        for q in group.get("questions", []):
            result = scored.get(q["number"], {})
            items.append({
                "number": q["number"],
                "type": group.get("type"),
                "section": label,
                "group_title": group.get("context_title"),
                "question": q.get("question", ""),
                "user_answer": result.get("user_answer", ""),
                "correct_answers": result.get("correct_answers", []),
                "is_correct": bool(result.get("correct")),
            })
    return sorted(items, key=lambda i: i["number"])


def _score_skill(content: Dict[str, Any], key: Dict[str, Any], answers: Dict[str, Any], skill: str,
                 mode: str) -> Dict[str, Any]:
    numbers = sorted(set(question_numbers(content, skill)))
    given = {str(n): answers.get(f"{skill}_{n}", "") for n in numbers}
    scored = score_answers(key.get(skill, {}), given, numbers)
    raw = sum(1 for r in scored.values() if r["correct"])
    total = len(numbers)
    by_type: Dict[str, Dict[str, int]] = {}
    for _label, group in iter_groups(content, skill):
        for q in group.get("questions", []):
            stat = by_type.setdefault(group.get("type", "unknown"), {"correct": 0, "total": 0})
            stat["total"] += 1
            stat["correct"] += 1 if scored.get(q["number"], {}).get("correct") else 0
    band = grading.listening_band(raw, total) if skill == "listening" else grading.reading_band(raw, total, mode)
    return {
        "raw_score": raw, "total": total, "band": band if total else None,
        "answered": sum(1 for v in given.values() if str(v).strip()),
        "by_type": by_type, "review": _review_items(content, skill, scored),
    }


def _writing_prompt(content: Dict[str, Any], task: str) -> Dict[str, Any]:
    return ((content.get("sections") or {}).get("writing") or {}).get(task) or {}


def _compute_result(row: Dict[str, Any], auto_submitted: bool) -> Dict[str, Any]:
    snapshot = _snapshot(row)
    content, key = snapshot["content"], snapshot.get("answer_key") or {}
    sections = _sections_of(row)
    answers = _answers_of(row)
    mode = row.get("exam_mode") or "academic"

    results: Dict[str, Any] = {}
    review: Dict[str, Any] = {}
    by_type: Dict[str, Dict[str, int]] = {}
    for skill in ("listening", "reading"):
        if skill in sections and question_numbers(content, skill):
            scored = _score_skill(content, key, answers, skill, mode)
            review[skill] = scored.pop("review")
            for qtype, stat in scored["by_type"].items():
                agg = by_type.setdefault(qtype, {"correct": 0, "total": 0})
                agg["correct"] += stat["correct"]
                agg["total"] += stat["total"]
            results[skill] = scored

    writing_detail: Optional[Dict[str, Any]] = None
    if "writing" in sections:
        llm = GeminiJsonLLM() if settings.GEMINI_API_KEY else None
        tasks = {}
        for number, name in ((1, "task1"), (2, "task2")):
            spec = _writing_prompt(content, name)
            default_min = 150 if number == 1 else 250
            tasks[name] = grading.grade_writing(
                number, spec.get("prompt", ""), str(answers.get(f"writing_{name}", "")),
                int(spec.get("min_words") or default_min), llm)
        band = grading.combine_writing(tasks["task1"], tasks["task2"])
        writing_detail = {"band": band, **tasks,
                          "scored_by": tasks["task2"]["scored_by"] if tasks["task2"]["scored_by"] != "none"
                          else tasks["task1"]["scored_by"]}
        results["writing"] = writing_detail

    if "speaking" in sections:
        results["speaking"] = {"band": None, "status": "not_scored",
                               "note": "Speaking chưa được chấm tự động; điểm này không tính vào Overall."}

    component_bands = [r["band"] for r in results.values() if r.get("band") is not None]
    overall = grading.overall_band(component_bands)
    analysis = grading.analyze(by_type, writing_detail, overall)

    materials = (content.get("materials") or {})
    return {
        "session_id": row["id"],
        "exam_set_id": row.get("exam_set_id"),
        "title": snapshot.get("title"),
        "exam_type": row.get("exam_type"),
        "session_mode": _config(row)["mode"],
        "sections": sections,
        "status": "AUTO_SUBMITTED" if auto_submitted else "SUBMITTED",
        "overall_band": overall,
        "section_results": results,
        "review": review,
        "by_type": by_type,
        "ai_analysis": analysis,
        "materials": {"audioscripts": materials.get("audioscripts", []),
                      "sample_answers": materials.get("sample_answers", [])},
        "answered_count": sum(r.get("answered", 0) for r in results.values() if "answered" in r),
        "submitted_at": _now().isoformat(),
    }


def _finalize(supabase, row: Dict[str, Any], auto: bool) -> Dict[str, Any]:
    """Chấm và lưu kết quả; nộp lần hai trả về kết quả đã lưu."""
    if row.get("status") in ("SUBMITTED", "AUTO_SUBMITTED"):
        stored = _json_field(row.get("result_json"), None)
        if stored:
            return stored
    result = _compute_result(row, auto)
    update = {
        "status": result["status"],
        "submitted_at": result["submitted_at"],
        "overall_band": result["overall_band"],
        "section_scores": json.dumps({k: {x: y for x, y in v.items() if x != "by_type"}
                                      for k, v in result["section_results"].items()}, ensure_ascii=False),
        "ai_analysis": json.dumps(result["ai_analysis"], ensure_ascii=False),
        "result_json": result,
    }
    try:
        supabase.table("exam_sessions").update(update).eq("id", row["id"]).execute()
    except Exception as e:
        logger.warning(f"[{row['id']}] Could not store exam result: {e}")
    with _answer_locks_guard:
        _answer_locks.pop(row["id"], None)
    return result


def _auto_submit_if_expired(supabase, row: Dict[str, Any]) -> Dict[str, Any]:
    if row.get("status") != "IN_PROGRESS":
        return row
    meta = (_answers_of(row).get(META_KEY) or {})
    deadline = _deadline(row, meta)
    if deadline and _now() > deadline:
        _finalize(supabase, row, auto=True)
        return supabase.table("exam_sessions").select("*").eq("id", row["id"]).execute().data[0]
    return row


# ============================================================
# Endpoints
# ============================================================

def _load_exam_source(supabase, req: CreateExamSessionRequest) -> Dict[str, Any]:
    if req.exam_set_id:
        require_owned("exam_sets", req.exam_set_id)
        row = supabase.table("exam_sets").select("*").eq("id", req.exam_set_id).execute().data[0]
        if row.get("status") == "archived":
            raise HTTPException(status_code=404, detail="Đề này đã bị lưu trữ")
        return {"content": row["content"], "answer_key": row.get("answer_key") or {},
                "title": row.get("title"), "listening_audio_path": row.get("listening_audio_path"),
                "mode": row.get("mode") or req.exam_mode}
    content, key = sample_exam()
    return {"content": content, "answer_key": key, "title": content["title"],
            "listening_audio_path": None, "mode": req.exam_mode}


@router.post("/sessions")
def create_exam_session(req: CreateExamSessionRequest):
    """Tạo phiên thi mới từ một đề (hoặc đề mẫu). Nội dung và đáp án được chụp vào phiên."""
    user_id = current_user_id()
    supabase = _db()
    source = _load_exam_source(supabase, req)

    if req.session_mode not in SESSION_MODES:
        raise HTTPException(status_code=422, detail="session_mode phải là real hoặc practice")
    if req.sections is not None:
        bad = [s for s in req.sections if s not in SKILL_ORDER]
        if bad or not req.sections:
            raise HTTPException(status_code=422, detail=f"Phần thi không hợp lệ: {', '.join(bad) or '(trống)'}")
        wanted = [s for s in SKILL_ORDER if s in req.sections]
    else:
        wanted = SECTIONS_BY_TYPE.get(req.exam_type)
        if wanted is None:
            raise HTTPException(status_code=422, detail=f"exam_type không hợp lệ: {req.exam_type}")
    available = source["content"].get("sections") or {}
    sections = [s for s in wanted if s in available]
    if not sections:
        raise HTTPException(status_code=422, detail="Đề này không có phần thi bạn chọn.")

    durations: Dict[str, int] = {}
    for skill, minutes in (req.durations or {}).items():
        if skill in sections:
            if not MIN_SECTION_MINUTES <= int(minutes) <= MAX_SECTION_MINUTES:
                raise HTTPException(status_code=422, detail=f"Thời gian {skill} phải từ {MIN_SECTION_MINUTES} đến "
                                                           f"{MAX_SECTION_MINUTES} phút")
            durations[skill] = int(minutes) * 60
    # Phòng thi thật luôn có đồng hồ; chỉ luyện tập mới được tắt giờ
    untimed = bool(req.untimed) and req.session_mode == "practice"

    session_id = str(uuid.uuid4())
    snapshot = {
        "title": source["title"],
        "content": source["content"],
        "answer_key": source["answer_key"],
        "listening_audio_path": source["listening_audio_path"],
        "config": {"mode": req.session_mode, "untimed": untimed, "durations": durations},
    }
    row = {
        "id": session_id,
        "user_id": user_id,
        "exam_type": req.exam_type,
        "exam_mode": req.exam_mode,
        "sections": json.dumps(sections),
        "status": "NOT_STARTED",
        "current_section": sections[0],
        "answers": "{}",
        "answers_json": {},
        "exam_set_id": req.exam_set_id,
        "exam_snapshot": snapshot,
    }
    supabase.table("exam_sessions").insert(row).execute()
    return _session_view(supabase, row)


@router.get("/sessions")
def list_exam_sessions(limit: int = Query(20, ge=1, le=100)):
    """Lịch sử các phiên thi gần đây của người dùng."""
    supabase = _db()
    rows = supabase.table("exam_sessions").select("*").eq("user_id", current_user_id()) \
        .order("created_at", desc=True).limit(limit).execute().data or []
    return {"sessions": [{
        "session_id": r["id"],
        "title": r["exam_snapshot"].get("title") if isinstance(r.get("exam_snapshot"), dict) else None,
        "exam_type": r.get("exam_type"),
        "session_mode": _config(r)["mode"],
        "sections": _sections_of(r),
        "status": r.get("status"),
        "overall_band": r.get("overall_band"),
        "created_at": r.get("created_at"),
        "submitted_at": r.get("submitted_at"),
    } for r in rows]}


@router.get("/sessions/{session_id}")
def get_exam_session(session_id: str):
    """Nạp lại phiên thi (tiếp tục sau khi tải lại trang): đề, câu trả lời đã lưu, thời gian còn lại."""
    supabase = _db()
    row = _auto_submit_if_expired(supabase, _get_session(supabase, session_id))
    view = _session_view(supabase, row)
    if row.get("status") in ("SUBMITTED", "AUTO_SUBMITTED"):
        view["result"] = _json_field(row.get("result_json"), None)
    return view


@router.post("/sessions/{session_id}/start")
def start_exam_session(session_id: str):
    """Bắt đầu thi: ghi thời điểm bắt đầu và phần đầu tiên. Gọi lại không đặt lại đồng hồ."""
    supabase = _db()
    row = _get_session(supabase, session_id)
    if row.get("status") in ("SUBMITTED", "AUTO_SUBMITTED"):
        raise HTTPException(status_code=409, detail="Phiên thi đã nộp bài")
    sections = _sections_of(row)

    def mutate(answers, current):
        meta = answers.setdefault(META_KEY, {})
        if current.get("status") == "IN_PROGRESS" and meta.get("started_at"):
            return {}
        started = _now().isoformat()
        meta.update({"started_at": started, "current_section": sections[0],
                     "section_started": {sections[0]: started}})
        return {"status": "IN_PROGRESS", "started_at": started, "current_section": sections[0]}

    _locked_update(session_id, supabase, mutate)
    fresh = supabase.table("exam_sessions").select("*").eq("id", session_id).execute().data[0]
    return _session_view(supabase, fresh, include_questions=False)["session"]


@router.post("/sessions/{session_id}/section")
def enter_section(session_id: str, req: SectionRequest):
    """Ghi lại việc vào một phần thi (khởi động đồng hồ của phần đó trên server)."""
    supabase = _db()
    row = _auto_submit_if_expired(supabase, _get_session(supabase, session_id))
    if req.section not in _sections_of(row):
        raise HTTPException(status_code=422, detail="Phần thi không thuộc phiên này")
    if row.get("status") != "IN_PROGRESS":
        raise HTTPException(status_code=409, detail="Phiên thi chưa bắt đầu hoặc đã nộp bài")

    def mutate(answers, current):
        meta = answers.setdefault(META_KEY, {})
        started = meta.setdefault("section_started", {})
        started.setdefault(req.section, _now().isoformat())
        meta["current_section"] = req.section
        return {"current_section": req.section}

    answers = _locked_update(session_id, supabase, mutate)
    meta = answers.get(META_KEY) or {}
    return {"section": req.section, "remaining_seconds": _remaining(row, meta, req.section)}


@router.post("/sessions/{session_id}/answer")
def save_answer(session_id: str, req: SaveAnswerRequest):
    """Lưu một câu trả lời (ghi nguyên tử theo từng câu)."""
    if req.section not in ("listening", "reading"):
        raise HTTPException(status_code=422, detail="section phải là listening hoặc reading")
    supabase = _db()
    _open_for_writes(supabase, session_id, req.section)
    value = req.answer if isinstance(req.answer, (str, int, float, list)) else str(req.answer)
    if isinstance(value, str):
        value = value[:500]
    elif isinstance(value, list):
        value = [str(v)[:500] for v in value[:10]]

    def mutate(answers, current):
        answers[f"{req.section}_{req.question_number}"] = value

    _locked_update(session_id, supabase, mutate)
    return {"saved": True, "section": req.section, "question_number": req.question_number}


@router.post("/sessions/{session_id}/writing")
def save_writing(session_id: str, req: SaveWritingRequest):
    """Tự động lưu bài viết (task1 / task2)."""
    if req.task not in ("task1", "task2"):
        raise HTTPException(status_code=422, detail="task phải là task1 hoặc task2")
    supabase = _db()
    _open_for_writes(supabase, session_id, "writing")
    words = grading.count_words(req.content)

    def mutate(answers, current):
        answers[f"writing_{req.task}"] = req.content
        answers[f"writing_{req.task}_words"] = words

    _locked_update(session_id, supabase, mutate)
    return {"saved": True, "task": req.task, "word_count": words}


@router.post("/sessions/{session_id}/submit")
def submit_exam(session_id: str, req: Optional[SubmitExamRequest] = None):
    """Nộp bài → chấm điểm theo đáp án của đề → kết quả đầy đủ kèm bảng xem lại từng câu."""
    supabase = _db()
    row = _auto_submit_if_expired(supabase, _get_session(supabase, session_id))
    return _finalize(supabase, row, auto=bool(req and req.auto_submitted))


@router.get("/sessions/{session_id}/result")
def get_exam_result(session_id: str):
    """Kết quả của phiên thi đã nộp."""
    supabase = _db()
    row = _auto_submit_if_expired(supabase, _get_session(supabase, session_id))
    result = _json_field(row.get("result_json"), None)
    if not result:
        raise HTTPException(status_code=404, detail="Phiên thi chưa nộp bài hoặc chưa có kết quả")
    return result


@router.post("/sessions/{session_id}/explain")
def explain_answer(session_id: str, req: ExplainRequest):
    """Giải thích chi tiết một câu sau khi nộp bài: vì sao đáp án đúng, bằng chứng trong bài. Kết quả được lưu lại."""
    if req.skill not in ("listening", "reading"):
        raise HTTPException(status_code=422, detail="skill phải là listening hoặc reading")
    supabase = _db()
    row = _auto_submit_if_expired(supabase, _get_session(supabase, session_id))
    if row.get("status") not in ("SUBMITTED", "AUTO_SUBMITTED"):
        raise HTTPException(status_code=409, detail="Chỉ xem giải thích sau khi đã nộp bài")
    stored = _json_field(row.get("result_json"), None) or {}
    cache_key = f"{req.skill}_{req.number}"
    cached = (stored.get("explanations") or {}).get(cache_key)
    if cached:
        return cached
    snapshot = _snapshot(row)
    llm = GeminiJsonLLM() if settings.GEMINI_API_KEY else None
    explained = exam_explain.explain_question(snapshot["content"], snapshot.get("answer_key") or {},
                                              _answers_of(row), req.skill, req.number, llm)
    if not explained:
        raise HTTPException(status_code=404, detail="Không tìm thấy câu hỏi này trong đề")
    if stored:
        stored.setdefault("explanations", {})[cache_key] = explained
        try:
            supabase.table("exam_sessions").update({"result_json": stored}).eq("id", session_id).execute()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[{session_id}] Could not cache explanation: {e}")
    return explained


@router.get("/sample-data")
def get_sample_data():
    """Dữ liệu đề mẫu (không đáp án) để thử giao diện phòng thi."""
    content, _key = sample_exam()
    return to_exam_room_payload(strip_answers(content))
