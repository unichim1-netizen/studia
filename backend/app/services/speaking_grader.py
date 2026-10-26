"""
Chấm IELTS Speaking Part 1/2/3 bằng AI theo 4 tiêu chí band từ lời nói đã nhận dạng (transcript) và số đo nhịp nói.

AI không nghe được âm thanh: Pronunciation chỉ được ước lượng thận trọng từ độ tin cậy nhận dạng và những từ bị nhận
sai rõ ràng; kết quả luôn gắn cờ `pronunciation_estimated`. Điểm tổng tính ở đây (trung bình 4 tiêu chí, làm tròn IELTS).
"""
from typing import Any, Dict, List, Optional

from app.services import grading_context as gc
from app.services.ai_engine import _call_gemini
from app.services.writing_grader import _band, _strs, count_words, round_band

PARTS = {
    1: "Part 1 (introduction and interview: short, natural answers about familiar topics)",
    2: "Part 2 (individual long turn: about 1-2 minutes on a cue card after 1 minute of preparation)",
    3: "Part 3 (two-way discussion: abstract questions that need opinions, reasons and examples)",
}
CRITERIA = ("fluency", "lexical", "grammar", "pronunciation")
CRITERION_NAMES = {
    "fluency": "Fluency and Coherence",
    "lexical": "Lexical Resource",
    "grammar": "Grammatical Range and Accuracy",
    "pronunciation": "Pronunciation",
}
CORRECTION_TYPES = ("grammar", "vocabulary", "pronunciation", "coherence")
MIN_WORDS = 8
MAX_WORDS = 600
QUESTION_MAX = 800


def _num(v: Any, lo: float, hi: float) -> Optional[float]:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if lo <= x <= hi else None


def clean_metrics(m: Any) -> Dict[str, Any]:
    """Số đo từ trình duyệt: chỉ giữ giá trị hợp lệ trong khoảng hợp lý."""
    m = m if isinstance(m, dict) else {}
    out: Dict[str, Any] = {}
    for key, lo, hi in (("duration_sec", 0, 600), ("speech_sec", 0, 600), ("wpm", 0, 400), ("pauses", 0, 200),
                        ("longest_pause", 0, 120), ("start_delay", 0, 120), ("avg_confidence", 0, 1)):
        v = _num(m.get(key), lo, hi)
        if v is not None:
            out[key] = round(v, 2)
    fillers = m.get("fillers")
    if isinstance(fillers, list):
        out["fillers"] = [gc._text(f, 20) for f in fillers if isinstance(f, str)][:8]
    bullets = m.get("bullets_missed")
    if isinstance(bullets, list):
        out["bullets_missed"] = [gc._text(b, 160) for b in bullets if isinstance(b, str)][:5]
    return out


def _metrics_lines(metrics: Dict[str, Any]) -> str:
    if not metrics:
        return ""
    lines = []
    if "speech_sec" in metrics:
        lines.append(f"- Speaking time: {metrics['speech_sec']:.0f} s" + (f" (recording {metrics['duration_sec']:.0f} s)" if "duration_sec" in metrics else ""))
    if "wpm" in metrics:
        lines.append(f"- Speech rate: {metrics['wpm']:.0f} words per minute")
    if "pauses" in metrics:
        lines.append(f"- Silent pauses of 1.2 s or longer: {metrics['pauses']:.0f}" + (f" (longest {metrics['longest_pause']:.1f} s)" if "longest_pause" in metrics else ""))
    if metrics.get("start_delay", 0) >= 2:
        lines.append(f"- Took {metrics['start_delay']:.1f} s before starting to answer")
    if metrics.get("fillers"):
        lines.append("- Filler words detected: " + ", ".join(metrics["fillers"]))
    if "avg_confidence" in metrics:
        lines.append(f"- Speech recogniser confidence: {metrics['avg_confidence'] * 100:.0f}% (low values often mean unclear pronunciation)")
    if metrics.get("bullets_missed"):
        lines.append("- Cue-card points the candidate seems not to have covered: " + "; ".join(metrics["bullets_missed"]))
    return "\n## Measured delivery (from the recording)\n" + "\n".join(lines) + "\n" if lines else ""


def build_prompt(part: int, question: str, transcript: str, metrics: Optional[Dict[str, Any]] = None,
                 self_review: str = "", cfg: Optional[Dict[str, Any]] = None, learner: Optional[Dict[str, Any]] = None) -> str:
    cfg = cfg or gc.DEFAULTS
    sk = cfg["speaking"]
    target = (learner or {}).get("target") or 7.0
    words = count_words(transcript)
    metrics_block = _metrics_lines(metrics or {}) if sk.get("use_metrics", True) else ""
    review_block = (
        "\n## What the candidate noticed when listening back (information only)\n"
        f'"""{gc._text(self_review, 600)}"""\nAcknowledge what they noticed correctly and add what they missed.\n'
    ) if self_review.strip() else ""
    better_shape = (
        ',\n  "better_answer": "A natural spoken answer at the target band that keeps the candidate\'s own ideas",'
        '\n  "useful_phrases": [{"phrase": "a phrase they could reuse", "meaning_vi": "nghĩa / khi nào dùng"}]'
    ) if sk.get("better_answer") else ""
    better_rule = (
        f"\n- better_answer: rewrite the answer as a band {target:.1f} candidate would SAY it (spoken style, contractions, natural "
        f"linking), keeping the candidate's ideas and roughly the right length for {('Part ' + str(part))}. Up to 5 useful_phrases."
    ) if sk.get("better_answer") else ""
    return f"""You are a certified IELTS Speaking examiner. Grade one answer using the official IELTS Speaking band descriptors (bands 0-9, half bands allowed).

{gc.context_block("speaking", cfg, learner)}

## The question
{PARTS.get(part, PARTS[1])}
Question: \"\"\"{gc._text(question, QUESTION_MAX)}\"\"\"

## The candidate's answer
It was transcribed automatically by a browser speech recogniser ({words} words). The recogniser drops most fillers (um, uh),
adds no punctuation and may silently correct some grammar or mishear words, so:
- do not penalise missing punctuation or capitalisation;
- judge fluency mainly from the measured delivery below, not from the transcript's smoothness;
- you cannot hear the audio: estimate Pronunciation conservatively from recogniser confidence and obviously misrecognised
  words, and say in its comment that it is an estimate.
Transcript:
\"\"\"{transcript.strip()}\"\"\"
{metrics_block}{review_block}
Return ONLY valid JSON with this exact shape:
{{
  "criteria": {{
    "fluency": {{"band": 6.0, "comment_vi": "...", "strengths": ["..."], "improvements": ["..."]}},
    "lexical": {{"band": 6.0, "comment_vi": "...", "strengths": ["..."], "improvements": ["..."]}},
    "grammar": {{"band": 5.5, "comment_vi": "...", "strengths": ["..."], "improvements": ["..."]}},
    "pronunciation": {{"band": 6.0, "comment_vi": "...", "strengths": ["..."], "improvements": ["..."]}}
  }},
  "summary_vi": "2-3 câu tổng kết và việc nên luyện đầu tiên",
  "priorities_vi": ["Ưu tiên 1", "Ưu tiên 2", "Ưu tiên 3"],
  "corrections": [
    {{"original": "exact words copied from the transcript", "corrected": "better version", "type": "grammar", "explanation_vi": "Giải thích ngắn"}}
  ]{better_shape}
}}

Rules:
- Be realistic like a real examiner; never inflate bands because of the candidate's target. Short or off-topic answers lose marks in Fluency and Coherence.
- Check the answer actually addresses the question and, for Part 2/3, develops ideas with reasons and examples (Idea - Explanation - Example).
- {gc.language_rule(gc.feedback_language(cfg, learner))} {'"corrected", "better_answer" and "phrase" stay' if sk.get("better_answer") else '"corrected" stays'} in English.
- corrections: at most 8, only real errors or clearly unnatural wording; "original" must be copied exactly from the transcript. type is one of: grammar, vocabulary, pronunciation, coherence.
- At most 3 strengths and 3 improvements per criterion.{better_rule}"""


def normalise(raw: Dict[str, Any], transcript: str, part: int) -> Optional[Dict[str, Any]]:
    crit_in = raw.get("criteria") if isinstance(raw, dict) else None
    if not isinstance(crit_in, dict):
        return None
    criteria: Dict[str, Any] = {}
    for key in CRITERIA:
        c = crit_in.get(key)
        if not isinstance(c, dict) or "band" not in c:
            return None
        criteria[key] = {
            "name": CRITERION_NAMES[key],
            "band": _band(c.get("band")),
            "comment_vi": str(c.get("comment_vi") or "").strip(),
            "strengths": _strs(c.get("strengths"), 3),
            "improvements": _strs(c.get("improvements"), 3),
        }
    low = transcript.lower()
    corrections: List[Dict[str, Any]] = []
    for c in (raw.get("corrections") or [])[:8]:
        if not isinstance(c, dict):
            continue
        original = str(c.get("original") or "").strip()
        corrected = str(c.get("corrected") or "").strip()
        if not original or not corrected or original.lower() == corrected.lower():
            continue
        kind = str(c.get("type") or "grammar").lower()
        corrections.append({
            "original": original, "corrected": corrected,
            "type": kind if kind in CORRECTION_TYPES else "grammar",
            "explanation_vi": str(c.get("explanation_vi") or "").strip(),
            "in_transcript": original.lower() in low,
        })
    phrases = []
    for p in (raw.get("useful_phrases") or [])[:5]:
        if isinstance(p, dict) and str(p.get("phrase") or "").strip():
            phrases.append({"phrase": str(p["phrase"]).strip()[:120], "meaning_vi": str(p.get("meaning_vi") or "").strip()[:200]})
    better = str(raw.get("better_answer") or "").strip()[:2500] or None
    return {
        "part": part,
        "words": count_words(transcript),
        "overall": round_band(sum(c["band"] for c in criteria.values()) / 4),
        "criteria": criteria,
        "summary_vi": str(raw.get("summary_vi") or "").strip(),
        "priorities_vi": _strs(raw.get("priorities_vi"), 3),
        "corrections": corrections,
        "better_answer": better,
        "useful_phrases": phrases,
        "pronunciation_estimated": True,
    }


def grade(part: int, question: str, transcript: str, metrics: Optional[Dict[str, Any]] = None, self_review: str = "",
          learner: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Kết quả đã chuẩn hoá, hoặc None khi AI không khả dụng / trả sai định dạng."""
    cfg = gc.config()
    prompt = build_prompt(part, question, transcript, metrics, self_review, cfg, learner)
    raw = _call_gemini(prompt, expect_json=True, timeout=cfg["timeout_sec"])
    if not isinstance(raw, dict):
        return None
    result = normalise(raw, transcript, part)
    if result is not None:
        if not cfg["speaking"].get("better_answer"):
            result["better_answer"], result["useful_phrases"] = None, []
        result["context"] = gc.context_summary("speaking", cfg, learner)
    return result
