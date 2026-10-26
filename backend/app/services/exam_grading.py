"""
Chấm điểm bài thi IELTS: quy đổi band, chấm Writing (AI theo 4 tiêu chí, có phương án heuristic) và phân tích điểm yếu.
"""
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Số câu đúng (trên 40) → band, tra từ trên xuống
LISTENING_TABLE: List[Tuple[int, float]] = [
    (39, 9.0), (37, 8.5), (35, 8.0), (32, 7.5), (30, 7.0), (26, 6.5), (23, 6.0), (18, 5.5), (16, 5.0),
    (13, 4.5), (10, 4.0), (8, 3.5), (6, 3.0), (4, 2.5),
]
READING_ACADEMIC_TABLE: List[Tuple[int, float]] = [
    (39, 9.0), (37, 8.5), (35, 8.0), (33, 7.5), (30, 7.0), (27, 6.5), (23, 6.0), (19, 5.5), (15, 5.0),
    (13, 4.5), (10, 4.0), (8, 3.5), (6, 3.0), (4, 2.5),
]
READING_GENERAL_TABLE: List[Tuple[int, float]] = [
    (40, 9.0), (39, 8.5), (37, 8.0), (36, 7.5), (34, 7.0), (32, 6.5), (30, 6.0), (27, 5.5), (23, 5.0),
    (19, 4.5), (15, 4.0), (12, 3.5), (9, 3.0), (6, 2.5),
]

TYPE_LABELS = {
    "multiple_choice": "Multiple Choice", "multiple_select": "Choose TWO/THREE letters",
    "true_false_ng": "True / False / Not Given", "yes_no_ng": "Yes / No / Not Given",
    "matching_headings": "Matching Headings", "matching_information": "Matching Information",
    "matching_features": "Matching Features / Opinions", "sentence_completion": "Sentence Completion",
    "summary_completion": "Summary Completion", "note_completion": "Note Completion",
    "table_completion": "Table Completion", "form_completion": "Form Completion",
    "flow_chart_completion": "Flow-chart Completion", "diagram_labelling": "Diagram Labelling",
    "map_labelling": "Map Labelling", "short_answer": "Short Answer",
}
TYPE_TIPS = {
    "true_false_ng": "Phân biệt NOT GIVEN (không có thông tin) với FALSE (thông tin trái ngược); gạch chân từ khoá trong câu.",
    "yes_no_ng": "Chú ý quan điểm của tác giả, không phải sự kiện; NOT GIVEN khi tác giả không nói tới.",
    "matching_headings": "Đọc câu đầu và câu cuối mỗi đoạn trước, tìm ý chính thay vì từ khoá riêng lẻ.",
    "matching_information": "Tìm từ đồng nghĩa/paraphrase của thông tin cần tìm, không tìm đúng từ trong đề.",
    "matching_features": "Gạch chân tên riêng/đặc điểm trong câu hỏi trước rồi đối chiếu với từng lựa chọn.",
    "multiple_choice": "Loại trừ lựa chọn sai thay vì chọn ngay lựa chọn quen thuộc; chú ý từ chỉ mức độ (always, only).",
    "multiple_select": "Mỗi lựa chọn đúng phải có căn cứ riêng trong bài; đừng chọn theo cảm giác.",
    "sentence_completion": "Kiểm tra loại từ cần điền (danh từ/động từ/tính từ) và giới hạn số từ.",
    "summary_completion": "Đọc đoạn tóm tắt để đoán loại từ, rồi định vị phần tương ứng trong bài.",
    "note_completion": "Dự đoán loại thông tin (số, tên, thời gian) trước khi nghe; viết đúng chính tả.",
    "table_completion": "Xác định cột/hàng của ô trống để biết cần nghe/đọc thông tin nào.",
    "form_completion": "Chú ý cách đánh vần tên riêng và số điện thoại; ghi lại ngay khi nghe.",
    "flow_chart_completion": "Các bước trong sơ đồ theo đúng thứ tự trong bài; tìm từ chỉ trình tự (first, then).",
    "diagram_labelling": "Nhìn sơ đồ trước khi nghe; xác định vị trí và từ chỉ hướng.",
    "map_labelling": "Làm quen với từ chỉ phương hướng (opposite, next to, to the left of) và theo dõi lộ trình người nói.",
    "short_answer": "Trả lời đúng số từ cho phép; dùng đúng từ trong bài, không paraphrase.",
}


def _band(raw: int, table: List[Tuple[int, float]]) -> float:
    for threshold, band in table:
        if raw >= threshold:
            return band
    return 1.0


def scale_to_40(raw: int, total: int) -> int:
    """Đề không đủ 40 câu thì quy đổi tỉ lệ về thang 40 để tra bảng band."""
    if total <= 0:
        return 0
    return raw if total == 40 else round(raw * 40 / total)


def listening_band(raw: int, total: int = 40) -> float:
    return _band(scale_to_40(raw, total), LISTENING_TABLE)


def reading_band(raw: int, total: int = 40, mode: str = "academic") -> float:
    table = READING_GENERAL_TABLE if mode == "general" else READING_ACADEMIC_TABLE
    return _band(scale_to_40(raw, total), table)


def round_ielts(value: float) -> float:
    """Làm tròn theo quy ước IELTS: phần lẻ <0.25 xuống số nguyên, 0.25–0.74 → .5, ≥0.75 lên số nguyên kế tiếp."""
    whole = int(value)
    fraction = value - whole
    if fraction < 0.25:
        return float(whole)
    if fraction < 0.75:
        return whole + 0.5
    return float(whole + 1)


def overall_band(scores: List[float]) -> float:
    """Trung bình các band đã chấm, làm tròn theo quy ước IELTS."""
    scores = [s for s in scores if s is not None]
    if not scores:
        return 0.0
    return round_ielts(sum(scores) / len(scores))


# ============================================================
# Writing
# ============================================================

def count_words(text: str) -> int:
    return len(re.findall(r"\b[\w'’-]+\b", text or ""))


def length_cap(words: int, min_words: int) -> Optional[float]:
    """IELTS trừ điểm Task Response khi bài ngắn: giới hạn band trần."""
    if words <= 0:
        return 0.0
    if words < 0.5 * min_words:
        return 4.0
    if words < 0.8 * min_words:
        return 5.5
    return None


def heuristic_writing_band(words: int, min_words: int) -> float:
    """Phương án dự phòng khi không có AI: chỉ dựa trên độ dài. Phải được ghi rõ là 'heuristic'."""
    if words < 50:
        return 0.0
    if words < 0.6 * min_words:
        return 4.0
    if words < min_words:
        return 5.0
    base = 6.0
    if words >= 1.5 * min_words:
        base += 0.5
    return min(base, 6.5)


WRITING_PROMPT = """You are an experienced IELTS Writing examiner. Assess the candidate's Writing Task {task} response
using the four official band descriptors. Be strict and realistic; do not inflate scores.

Task prompt:
{prompt}

Candidate response ({words} words; minimum {min_words}):
\"\"\"
{text}
\"\"\"

Return ONLY JSON:
{{
  "task_response": 6.0,
  "coherence_cohesion": 6.0,
  "lexical_resource": 6.0,
  "grammatical_range_accuracy": 6.0,
  "strengths": ["..."],
  "improvements": ["..."],
  "feedback_vi": "Nhận xét tổng quát bằng tiếng Việt, 3-5 câu, nêu rõ điểm cần sửa"
}}
Scores are IELTS bands from 0 to 9 in 0.5 steps.
"""

CRITERIA = ("task_response", "coherence_cohesion", "lexical_resource", "grammatical_range_accuracy")


def _exam_calibration() -> str:
    """Mức chấm, hướng dẫn của trung tâm và ngôn ngữ nhận xét từ cấu hình chấm AI. Phòng thi không dùng ngữ cảnh người học
    để điểm thi thử luôn theo một chuẩn. Lỗi đọc cấu hình thì bỏ qua, giữ prompt gốc."""
    try:
        from app.services import grading_context as gc
        cfg = gc.config()
        return "\n" + gc.context_block("writing", cfg, None) + "\n" + gc.language_rule(gc.feedback_language(cfg, None)) + "\n"
    except Exception as e:
        logger.warning(f"Không đọc được cấu hình chấm AI cho phòng thi: {e}")
        return ""


def grade_writing(task: int, prompt: str, text: str, min_words: int, llm: Any = None) -> Dict[str, Any]:
    """
    Chấm một bài Writing. `llm` có `.generate_json(prompt) -> dict|None`; không có/lỗi → heuristic.
    Kết quả luôn có "scored_by": "ai" | "heuristic" để giao diện không mạo nhận điểm AI.
    """
    words = count_words(text)
    base = {"task": task, "words": words, "min_words": min_words}
    if words == 0:
        return {**base, "band": 0.0, "scored_by": "none", "feedback_vi": "Chưa có bài viết."}

    if llm is not None:
        try:
            result = llm.generate_json(WRITING_PROMPT.format(
                task=task, prompt=(prompt or "")[:2500], words=words, min_words=min_words, text=text[:6000]) + _exam_calibration())
            if isinstance(result, dict) and all(isinstance(result.get(c), (int, float)) for c in CRITERIA):
                criteria = {c: round_ielts(max(0.0, min(9.0, float(result[c])))) for c in CRITERIA}
                band = round_ielts(sum(criteria.values()) / 4)
                cap = length_cap(words, min_words)
                if cap is not None:
                    band = min(band, cap)
                return {**base, "band": band, "criteria": criteria, "scored_by": "ai",
                        "strengths": [str(x) for x in (result.get("strengths") or [])][:5],
                        "improvements": [str(x) for x in (result.get("improvements") or [])][:5],
                        "feedback_vi": str(result.get("feedback_vi") or "")}
        except Exception as e:
            logger.warning(f"Writing AI grading failed: {e}")

    return {**base, "band": heuristic_writing_band(words, min_words), "scored_by": "heuristic",
            "feedback_vi": "Chưa chấm được bằng AI: điểm này chỉ ước lượng theo độ dài bài viết, "
                           "không phản ánh chất lượng nội dung."}


def combine_writing(task1: Dict[str, Any], task2: Dict[str, Any]) -> Optional[float]:
    """Task 2 chiếm 2/3 điểm Writing. Thiếu một task thì tính task còn lại với trọng số tương ứng (thiếu = 0)."""
    if task1.get("scored_by") == "none" and task2.get("scored_by") == "none":
        return None
    return round_ielts((task1.get("band", 0.0) + 2 * task2.get("band", 0.0)) / 3)


# ============================================================
# Phân tích sau bài thi
# ============================================================

def analyze(by_type: Dict[str, Dict[str, int]], writing: Optional[Dict[str, Any]], overall: float) -> Dict[str, Any]:
    strengths: List[str] = []
    weaknesses: List[Dict[str, Any]] = []
    for qtype, stat in sorted(by_type.items(), key=lambda kv: kv[1]["correct"] / max(kv[1]["total"], 1)):
        total, correct = stat["total"], stat["correct"]
        if total < 2:
            continue
        accuracy = correct / total
        label = TYPE_LABELS.get(qtype, qtype)
        if accuracy < 0.6:
            weaknesses.append({"type": qtype, "label": label, "correct": correct, "total": total,
                               "advice": TYPE_TIPS.get(qtype, "")})
        elif accuracy >= 0.8:
            strengths.append(f"{label}: {correct}/{total} câu đúng")

    writing_notes: List[str] = []
    if writing:
        for key in ("task1", "task2"):
            task = writing.get(key) or {}
            if task.get("scored_by") == "none":
                writing_notes.append(f"Chưa làm Writing {key.replace('task', 'Task ')}.")
            elif task.get("words", 0) < task.get("min_words", 0):
                writing_notes.append(f"Writing {key.replace('task', 'Task ')} chưa đủ {task['min_words']} từ "
                                     f"({task['words']} từ).")

    target = min(9.0, overall + 0.5) if overall else 5.0
    plan: Dict[str, List[str]] = {}
    top = weaknesses[:3]
    for week, focus in enumerate(top, start=1):
        plan[f"week{week}"] = [
            f"Ôn dạng {focus['label']}: {focus['advice']}" if focus["advice"] else f"Ôn dạng {focus['label']}",
            "Làm 1 bộ câu hỏi cùng dạng, chấm và ghi lại lỗi sai",
        ]
    if writing_notes:
        plan.setdefault("writing", []).extend(writing_notes)
    if not plan:
        plan["week1"] = ["Tiếp tục duy trì phong độ: làm thêm một đề đầy đủ và đối chiếu từng câu sai"]

    return {
        "current_band": overall,
        "target_band": target,
        "strengths": strengths or ["Hoàn thành trọn vẹn bài thi"],
        "weaknesses": [f"{w['label']}: {w['correct']}/{w['total']} câu đúng" for w in weaknesses]
                      + writing_notes or ["Chưa phát hiện dạng câu hỏi nào yếu rõ rệt"],
        "weak_types": weaknesses,
        "priority_areas": [{"area": w["label"], "action": w["advice"] or "Luyện thêm dạng này"} for w in top],
        "study_plan": plan,
    }
