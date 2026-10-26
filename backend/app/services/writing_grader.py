"""
Chấm IELTS Writing Task 1/2 bằng AI theo 4 tiêu chí band, kèm sửa lỗi từng câu.

Bài viết được tách câu ở phía server (đánh số) rồi mới gửi cho AI, để mỗi câu có đúng một mục nhận xét
và kết quả luôn khớp với bài gốc dù AI trả thiếu hay thừa. Điểm tổng được tính ở đây, không để AI tự tính.
Ngữ cảnh chấm (mức chấm, hướng dẫn của trung tâm, band mục tiêu của người học…) lấy từ grading_context.
"""
import re
from typing import Any, Dict, List, Optional

from app.services import grading_context as gc
from app.services.ai_engine import _call_gemini

TASKS = {
    "task1": {"label": "Task 1", "min_words": 150, "criterion": "Task Achievement"},
    "task2": {"label": "Task 2", "min_words": 250, "criterion": "Task Response"},
}
CRITERIA = ("task", "coherence", "lexical", "grammar")
CRITERION_NAMES = {
    "coherence": "Coherence and Cohesion",
    "lexical": "Lexical Resource",
    "grammar": "Grammatical Range and Accuracy",
}
ISSUE_TYPES = ("grammar", "vocabulary", "spelling", "punctuation", "style")
MAX_WORDS = 700
MIN_WORDS_TO_GRADE = 30
MAX_SENTENCES = 60

_SENT_SPLIT = re.compile(r"(?<=[.!?])[\"')\]]*\s+(?=[A-Z0-9\"'(\[])|\n+")


def count_words(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*", text or ""))


def split_sentences(essay: str) -> List[str]:
    parts = [p.strip() for p in _SENT_SPLIT.split(essay.strip()) if p and p.strip()]
    return parts[:MAX_SENTENCES]


def round_band(x: float) -> float:
    """Làm tròn về bước 0.5 như cách IELTS làm tròn điểm tổng (0.25 lên 0.5, 0.75 lên 1.0)."""
    return max(0.0, min(9.0, int(x * 2 + 0.5) / 2))


def _band(value: Any) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round_band(v)


def _strs(value: Any, limit: int = 4) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(x).strip() for x in value if str(x).strip()][:limit]


def _attempt_lines(attempt: Optional[Dict[str, Any]]) -> str:
    """Ngữ cảnh của lần viết: thời gian đã dùng, dàn ý người học lập trước khi viết."""
    if not attempt:
        return ""
    out = []
    try:
        minutes = int(attempt.get("minutes_used") or 0)
    except (TypeError, ValueError):
        minutes = 0
    if 0 < minutes <= 240:
        out.append(f"- Time the candidate spent writing: about {minutes} minutes.")
    outline = gc._text(attempt.get("outline"), 1500)
    if outline:
        out.append("- Outline the candidate planned before writing (information only):")
        out.append(f'  """{outline}"""')
        out.append("  Comment briefly on whether the essay followed a clear plan.")
    return ("\n## This attempt\n" + "\n".join(out) + "\n") if out else ""


REWRITE_SHAPE = ''',
  "model_rewrite": {{"paragraph_index": 1, "text": "The weakest paragraph rewritten at the target band, keeping the candidate's ideas", "notes_vi": ["Vì sao bản viết lại tốt hơn"]}}'''


def build_prompt(task: str, prompt_text: str, sentences: List[str], words: int,
                 cfg: Optional[Dict[str, Any]] = None, learner: Optional[Dict[str, Any]] = None,
                 attempt: Optional[Dict[str, Any]] = None) -> str:
    t = TASKS[task]
    cfg = cfg or gc.DEFAULTS
    sk = cfg["writing"]
    kind = (learner or {}).get("kind") or "Academic"
    target = (learner or {}).get("target") or 7.0
    numbered = "\n".join(f"[{i}] {s}" for i, s in enumerate(sentences))
    if task == "task1":
        task_kind = "Academic report on a visual" if kind == "Academic" else "General Training letter"
    else:
        task_kind = "Essay"
    rewrite_shape = REWRITE_SHAPE.replace("{{", "{").replace("}}", "}") if sk.get("model_rewrite") else ""
    rewrite_rule = (
        f"\n- model_rewrite: pick the paragraph (0-based index in the essay) that most limits the score and rewrite it "
        f"as a band {target:.1f} candidate would, keeping the same ideas. At most 2 notes_vi."
    ) if sk.get("model_rewrite") else ""
    return f"""You are a certified IELTS Writing examiner. Grade the candidate's {t['label']} response using the official IELTS Writing band descriptors (bands 0-9, half bands allowed).

{gc.context_block("writing", cfg, learner)}

## Task
Task type: {t['label']} ({task_kind})
Task prompt given to the candidate:
\"\"\"{prompt_text.strip() or '(not provided - judge the response on its own, and lower the task criterion if the purpose is unclear)'}\"\"\"

Word count: {words} (minimum {t['min_words']}). If the response is under the minimum length, reflect it in {t['criterion']}.
{_attempt_lines(attempt)}
The candidate's response is split into numbered sentences:
{numbered}

Return ONLY valid JSON with this exact shape:
{{
  "criteria": {{
    "task": {{"band": 6.5, "comment_vi": "...", "strengths": ["..."], "improvements": ["..."]}},
    "coherence": {{"band": 6.0, "comment_vi": "...", "strengths": ["..."], "improvements": ["..."]}},
    "lexical": {{"band": 6.0, "comment_vi": "...", "strengths": ["..."], "improvements": ["..."]}},
    "grammar": {{"band": 5.5, "comment_vi": "...", "strengths": ["..."], "improvements": ["..."]}}
  }},
  "summary_vi": "2-3 câu tổng kết và việc nên làm đầu tiên",
  "priorities_vi": ["Ưu tiên sửa 1", "Ưu tiên sửa 2", "Ưu tiên sửa 3"]{rewrite_shape},
  "sentences": [
    {{
      "index": 0,
      "corrected": "The sentence rewritten correctly (identical to the original if it has no problem)",
      "issues": [
        {{"type": "grammar", "text": "exact wrong words copied from the original sentence", "suggestion": "replacement", "explanation_vi": "Giải thích ngắn gọn"}}
      ]
    }}
  ]
}}

Rules:
- "task" is {t['criterion']}; "coherence" is Coherence and Cohesion; "lexical" is Lexical Resource; "grammar" is Grammatical Range and Accuracy.
- Be realistic like a real examiner; never inflate bands because of the candidate's target. Most learners are between 4.5 and 7.0.
- {gc.language_rule(gc.feedback_language(cfg, learner))} "suggestion"{', "corrected" and "model_rewrite.text"' if sk.get("model_rewrite") else ' and "corrected"'} stay in English.
- Include one entry in "sentences" for EVERY numbered sentence, using the same index. Keep the candidate's meaning and voice; only fix real errors or clearly weak wording.
- issue.type is one of: grammar, vocabulary, spelling, punctuation, style.
- issue.text must be copied exactly from that sentence so it can be highlighted. At most {sk.get("max_issues", 4)} issues per sentence.
- At most 3 strengths and 3 improvements per criterion.{rewrite_rule}"""


def normalise(raw: Dict[str, Any], sentences: List[str], task: str, words: int, max_issues: int = 4) -> Optional[Dict[str, Any]]:
    """Chuẩn hoá phản hồi của AI: kẹp band, ghép câu theo chỉ số, tính điểm tổng."""
    crit_in = raw.get("criteria") if isinstance(raw, dict) else None
    if not isinstance(crit_in, dict):
        return None
    criteria: Dict[str, Any] = {}
    for key in CRITERIA:
        c = crit_in.get(key)
        if not isinstance(c, dict) or "band" not in c:
            return None
        criteria[key] = {
            "name": TASKS[task]["criterion"] if key == "task" else CRITERION_NAMES[key],
            "band": _band(c.get("band")),
            "comment_vi": str(c.get("comment_vi") or "").strip(),
            "strengths": _strs(c.get("strengths"), 3),
            "improvements": _strs(c.get("improvements"), 3),
        }

    by_index: Dict[int, Dict[str, Any]] = {}
    for item in raw.get("sentences") or []:
        if isinstance(item, dict) and isinstance(item.get("index"), int):
            by_index.setdefault(item["index"], item)

    out_sentences: List[Dict[str, Any]] = []
    for i, original in enumerate(sentences):
        item = by_index.get(i, {})
        issues = []
        for iss in (item.get("issues") or [])[:max_issues]:
            if not isinstance(iss, dict):
                continue
            text = str(iss.get("text") or "").strip()
            suggestion = str(iss.get("suggestion") or "").strip()
            if not text and not suggestion:
                continue
            kind = str(iss.get("type") or "grammar").lower()
            issues.append({
                "type": kind if kind in ISSUE_TYPES else "grammar",
                "text": text if text and text in original else "",
                "suggestion": suggestion,
                "explanation_vi": str(iss.get("explanation_vi") or "").strip(),
            })
        corrected = str(item.get("corrected") or "").strip() or original
        out_sentences.append({"index": i, "original": original, "corrected": corrected,
                              "changed": corrected != original or bool(issues), "issues": issues})

    overall = round_band(sum(c["band"] for c in criteria.values()) / 4)
    rewrite = None
    mr = raw.get("model_rewrite")
    if isinstance(mr, dict) and str(mr.get("text") or "").strip():
        idx = mr.get("paragraph_index")
        rewrite = {
            "paragraph_index": idx if isinstance(idx, int) and 0 <= idx < 20 else None,
            "text": str(mr.get("text")).strip()[:3000],
            "notes_vi": _strs(mr.get("notes_vi"), 2),
        }
    return {
        "task": task,
        "words": words,
        "min_words": TASKS[task]["min_words"],
        "under_length": words < TASKS[task]["min_words"],
        "overall": overall,
        "criteria": criteria,
        "summary_vi": str(raw.get("summary_vi") or "").strip(),
        "priorities_vi": _strs(raw.get("priorities_vi"), 3),
        "sentences": out_sentences,
        "issue_count": sum(len(s["issues"]) for s in out_sentences),
        "model_rewrite": rewrite,
    }


def grade(task: str, prompt_text: str, essay: str, learner: Optional[Dict[str, Any]] = None,
          attempt: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Trả về kết quả đã chuẩn hoá, hoặc None khi AI không khả dụng / trả sai định dạng.
    `learner` là ngữ cảnh người học đã qua grading_context.clean_learner; cấu hình hệ thống đọc từ app_settings."""
    cfg = gc.config()
    sentences = split_sentences(essay)
    words = count_words(essay)
    prompt = build_prompt(task, prompt_text, sentences, words, cfg, learner, attempt)
    raw = _call_gemini(prompt, expect_json=True, timeout=cfg["timeout_sec"])
    if not isinstance(raw, dict):
        return None
    result = normalise(raw, sentences, task, words, cfg["writing"]["max_issues"])
    if result is not None:
        if not cfg["writing"].get("model_rewrite"):
            result["model_rewrite"] = None
        result["context"] = gc.context_summary("writing", cfg, learner)
    return result
