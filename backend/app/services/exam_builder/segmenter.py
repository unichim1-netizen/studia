"""
Phân đoạn sách đề: tìm Test N, Listening/Reading/Writing/Speaking, Part/Passage/Task, trang đáp án,
audioscript và bài viết mẫu. Chỉ dùng luật (không gọi AI) nên nhanh và cho kết quả lặp lại được.

Sách in thật có nhiễu: số trang/tiêu đề chạy ("11 Test 1 Questions 17-20 ...") dính vào đầu đoạn, mốc nằm giữa
một khối chữ. Vì vậy mốc viết HOA (LISTENING, PART 2, READING PASSAGE 1, WRITING TASK 1) được tìm ngay trong
dòng chữ; khối ngắn đứng riêng thì chấp nhận cả dạng viết thường ("Part 1").
"""
import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

Block = Dict[str, Any]

TEST_RE = re.compile(r"^test\s+(\d{1,2})$", re.IGNORECASE)
SKILL_RE = re.compile(r"^(listening|reading|writing|speaking)$", re.IGNORECASE)
PART_RE = re.compile(r"^(?:part|section)\s+(\d)$", re.IGNORECASE)
PASSAGE_RE = re.compile(r"^reading\s+passage\s+(\d)$", re.IGNORECASE)
TASK_RE = re.compile(r"^(?:writing\s+)?task\s+(\d)$", re.IGNORECASE)
ANSWER_SUBHEAD_RE = re.compile(
    r"^(?:part|section|reading\s+passage)\s+\d\s*[,:]?\s*questions?\s+\d+\s*[-–—]\s*\d+$", re.IGNORECASE)

# Mốc chuyển chế độ (chỉ nhận khi khối ngắn hoặc là tiêu đề, để bỏ qua mục lục dài)
_PAGENO = r"(?:\d{1,3}\s+)?"
ANSWER_KEY_RE = re.compile(rf"^{_PAGENO}(?:[\w ]{{0,40}}\s)?answer\s+keys?\b(?!\s+with\b)", re.IGNORECASE)
AUDIOSCRIPT_RE = re.compile(
    rf"^{_PAGENO}(?:audio\s*scripts?|recording\s+scripts?|listening\s+scripts?|tape\s*scripts?|transcripts?)\b",
    re.IGNORECASE)
SAMPLE_RE = re.compile(
    rf"^{_PAGENO}(?:sample|model)\s+(?:writing\s+)?answers?\b|^{_PAGENO}writing\s+(?:sample|model)\s+answers?\b",
    re.IGNORECASE)
END_MATTER_RE = re.compile(rf"^{_PAGENO}(?:sample\s+answer\s+sheets?|acknowledg(?:e)?ments?)\b", re.IGNORECASE)

INLINE_RE = re.compile(
    r"(?P<test>\b(?:Test|TEST)\s+(?P<tn>\d{1,2})\b)"
    r"|(?P<passage>\bREADING\s+PASSAGE\s+(?P<pn>\d)\b)"
    r"|(?P<task>\bWRITING\s+TASK\s+(?P<kn>\d)\b)"
    r"|(?P<part>\b(?:PART|SECTION)\s+(?P<sn>\d)\b)"
    r"|(?P<skill>\b(?P<sk>LISTENING|READING|WRITING|SPEAKING)\b)"
)

QUESTIONS_RE = re.compile(r"\bQuestions?\s+(\d{1,2})(?:\s*(?:[-–—]|and|&|to)\s*(\d{1,2}))?\b")
_PREPOSITION_BEFORE = re.compile(r"(?:\b(?:to|in|of|for|on|from|see|and|with|about|at|by|the|these|those)\b|\()\s*$",
                                 re.IGNORECASE)
_HEADER_JUNK_BEFORE = re.compile(
    r"(?:\d{1,3}|Test\s+\d|TEST\s+\d|(?:PART|SECTION)\s+\d|Listening|Reading|Writing|Speaking|"
    r"LISTENING|READING|WRITING|SPEAKING)$")
_INSTRUCTION_AFTER = re.compile(
    r"^(?:\s*(?:\d{1,3}|Listening|Reading|Writing|Speaking)\b)*[\s:.,]*"
    r"(?:Choose|Complete|Write|Label|Do the following|Look at|Match|Which|What|Who|How|Where|Why|Listen|"
    r"Read|Answer|Reading Passage \d has|The list|Use|Circle|Tick|Select|Summar|Identify|Classify)\b")

MAX_MARKER_CHARS = 90
SKILLS = ("listening", "reading", "writing", "speaking")

# Rác tiêu đề/chân trang dính ở đầu/cuối đoạn: "11 Test 1 ...", "... 14 p. 99 Listening"
_DEBRIS_HEAD = re.compile(
    r"^(?:(?:Listening|Reading|Writing|Speaking)\s+)?(?:\d{1,3}\s+)?(?:Test\s+\d\s+)?"
    r"(?:(?:Listening|Reading|Writing|Speaking)\s+)?(?=Questions?\b)")
_DEBRIS_TAILS = [
    re.compile(r"\s+\d{1,3}\s+(?:\S{1,6}\s+){0,4}p\.\s*\S*(?:\s+\S{1,10}){0,5}\s*$"),
    re.compile(r"\s+\d{2,3}\s+(?:Listening|Reading|Writing|Speaking)\s*$"),
    re.compile(r"\s+\d{1,3}\s+Test\s+\d\s*$"),
    re.compile(r"\s+(?:Listening|Reading|Writing|Speaking)\s*$"),
    re.compile(r"(?<=[._·…])\s+\d{1,3}\s*$"),   # số trang dính sau chỗ trống: "...... 12"
]
_NOISE_TOKEN = re.compile(r"^(?:\d{1,4}|(?:p|page|pp)\.?\d{1,4}|Test|Listening|Reading|Writing|Speaking|\S{1,2}|[^\w]+)$", re.IGNORECASE)


@lru_cache(maxsize=50000)
def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("**", "").replace(" ", " ")).strip()


@lru_cache(maxsize=50000)
def scrub(text: str) -> str:
    """Bỏ rác tiêu đề/chân trang ở hai đầu (giữ nguyên nội dung ở giữa)."""
    text = text.strip()
    text = _DEBRIS_HEAD.sub("", text, count=1)
    # Rác chân trang chỉ nằm ở cuối: chỉ quét ~150 ký tự cuối (đoạn dài không bị quét lại toàn bộ)
    window = max(0, len(text) - 150)
    for pattern in _DEBRIS_TAILS:
        m = pattern.search(text, window)
        if m and m.start() >= 3:
            text = text[:m.start()]
            break
    return text.strip()


def is_noise(text: str) -> bool:
    """Chỉ gồm số trang, "p. 99", tên kỹ năng, mảnh ký tự vô nghĩa."""
    if re.search(r"[._…·\-]{3,}", text):  # chỗ trống điền đáp án là nội dung, không phải rác
        return False
    tokens = text.split()
    return not tokens or all(_NOISE_TOKEN.match(t) for t in tokens)


@dataclass
class TestSegments:
    number: int
    listening: Dict[int, List[Block]] = field(default_factory=dict)
    reading: Dict[int, List[Block]] = field(default_factory=dict)
    writing: Dict[int, List[Block]] = field(default_factory=dict)
    speaking: Dict[int, List[Block]] = field(default_factory=dict)
    answers: Dict[str, List[Block]] = field(default_factory=dict)
    audioscripts: Dict[int, List[Block]] = field(default_factory=dict)
    samples: Dict[int, List[Block]] = field(default_factory=dict)

    def skill_parts(self, skill: str) -> Dict[int, List[Block]]:
        return getattr(self, skill)

    def summary(self) -> Dict[str, Any]:
        def span(blocks: List[Block]) -> Optional[List[int]]:
            pages = [b["page_number"] for b in blocks if b.get("page_number")]
            return [min(pages), max(pages)] if pages else None

        return {
            "test": self.number,
            "listening_parts": sorted(self.listening),
            "reading_passages": sorted(self.reading),
            "writing_tasks": sorted(self.writing),
            "speaking_parts": sorted(self.speaking),
            "answer_keys": {skill: span(blocks) for skill, blocks in self.answers.items()},
            "audioscripts": {str(part): span(blocks) for part, blocks in self.audioscripts.items()},
            "sample_answers": {str(task): span(blocks) for task, blocks in self.samples.items()},
            "pages": span([b for blocks in (self.listening, self.reading, self.writing, self.speaking)
                           for part in blocks.values() for b in part]),
        }


def segment_blocks(blocks: List[Block]) -> Dict[int, TestSegments]:
    """Chia danh sách khối (theo thứ tự đọc) thành các đề Test N."""
    tests: Dict[int, TestSegments] = {}
    state = {"mode": "test", "test": None, "skill": None, "part": None}

    def destination() -> Optional[List[Block]]:
        mode, test_no, skill, part = state["mode"], state["test"], state["skill"], state["part"]
        if test_no is None or mode == "ignore":
            return None
        seg = tests.setdefault(test_no, TestSegments(test_no))
        if mode == "answers":
            return seg.answers.setdefault(skill, []) if skill else None
        if mode == "audioscripts":
            return seg.audioscripts.setdefault(part or 0, [])
        if mode == "samples":
            return seg.samples.setdefault(part or 0, [])
        if skill is None:
            return None
        return seg.skill_parts(skill).setdefault(part or 1, [])

    def switch_mode(mode: str) -> None:
        # Tiêu đề chạy lặp lại ở đầu mỗi trang ("Listening and Reading answer keys"): giữ nguyên Test/kỹ năng đang xét
        if state["mode"] != mode:
            state.update(mode=mode, test=None, skill=None, part=None)

    def set_test(number: int) -> None:
        if number != state["test"]:  # cùng số = tiêu đề chạy lặp lại ở đầu mỗi trang
            state.update(test=number, skill=None, part=None)
            tests.setdefault(number, TestSegments(number))

    def emit(block: Block, text: str) -> None:
        text = scrub(text)
        # Trang đáp án toàn số và chữ cái ngắn ("1 25", "11 B") — không được coi là rác
        if not text or (state["mode"] != "answers" and is_noise(text)):
            return
        target = destination()
        if target is not None:
            target.append({**block, "text": text})

    for block in blocks:
        raw = clean_text(block.get("text", ""))
        if not raw:
            continue
        short = len(raw) <= MAX_MARKER_CHARS or block.get("block_type") == "heading"

        page_no = block.get("page_number") or 0
        is_toc = bool(re.search(r"\s+\d{1,3}$", raw))
        if short and len(raw) <= 160 and not is_toc and (bool(tests) or page_no == 0):
            if END_MATTER_RE.match(raw):
                switch_mode("ignore")
                continue
            if ANSWER_KEY_RE.match(raw):
                switch_mode("answers")
                m = re.search(r"\bTEST\s+(\d{1,2})\b", raw, re.IGNORECASE)
                if m:
                    set_test(int(m.group(1)))
                    state["test"] = int(m.group(1))
                rest = raw[m.end():] if m else ""
                sk = SKILL_RE.match(rest.strip())
                if sk:
                    state["skill"] = sk.group(1).lower()
                continue
            if AUDIOSCRIPT_RE.match(raw):
                switch_mode("audioscripts")
                m = re.search(r"\b(?:PART|SECTION)\s+(\d)\b", raw)
                if m:
                    state["part"] = int(m.group(1))
                rest = AUDIOSCRIPT_RE.sub("", raw, count=1)
                if rest.strip() and not is_noise(rest):
                    emit(block, re.sub(r"^(?:\s*(?:PART|SECTION)\s+\d)+", "", rest))
                continue
            if SAMPLE_RE.match(raw):
                switch_mode("samples")
                raw = SAMPLE_RE.sub("", raw, count=1).strip()
                if not raw:
                    continue

        # Khối ngắn đứng riêng: chấp nhận dạng viết thường
        if len(raw) <= MAX_MARKER_CHARS:
            m = TEST_RE.match(raw)
            if m:
                set_test(int(m.group(1)))
                continue
            if state["test"] is not None:
                m = SKILL_RE.match(raw)
                if m and state["mode"] in ("test", "answers"):
                    skill = m.group(1).lower()
                    if skill != state["skill"]:
                        state.update(skill=skill, part=None)
                    continue
                if state["mode"] == "answers" and ANSWER_SUBHEAD_RE.match(raw):
                    continue
                m = PASSAGE_RE.match(raw)
                if m and state["mode"] == "test":
                    state.update(skill="reading", part=int(m.group(1)))
                    continue
                m = TASK_RE.match(raw)
                if m and (state["mode"] == "samples" or (state["mode"] == "test" and (
                        state["skill"] == "writing" or raw.lower().startswith("writing")))):
                    if state["mode"] == "test":
                        state["skill"] = "writing"
                    state["part"] = int(m.group(1))
                    continue
                m = PART_RE.match(raw)
                if m and state["mode"] in ("test", "audioscripts"):
                    state["part"] = int(m.group(1))
                    continue

        # Mốc VIẾT HOA nằm giữa dòng chữ
        position = 0
        for m in INLINE_RE.finditer(raw):
            emit(block, raw[position:m.start()])
            position = m.end()
            if m.group("test"):
                set_test(int(m.group("tn")))
            elif state["test"] is None:
                continue
            elif m.group("passage") and state["mode"] == "test":
                state.update(skill="reading", part=int(m.group("pn")))
            elif m.group("task") and state["mode"] in ("test", "samples"):
                if state["mode"] == "test":
                    state["skill"] = "writing"
                state["part"] = int(m.group("kn"))
            elif m.group("part") and state["mode"] in ("test", "audioscripts"):
                state["part"] = int(m.group("sn"))
            elif m.group("skill") and state["mode"] in ("test", "answers"):
                skill = m.group("sk").lower()
                if skill != state["skill"]:
                    state.update(skill=skill, part=None)
        emit(block, raw[position:])
    return tests


# ─── Chia một phần (Part / Passage) thành các nhóm "Questions a–b" ───

@dataclass
class QuestionGroupSegment:
    start: int
    end: int
    blocks: List[Block]


def _is_group_marker(text: str, m: re.Match) -> bool:
    before = text[:m.start()].rstrip()
    if not before:
        return True
    if _PREPOSITION_BEFORE.search(before):
        return False
    if before[-1] in ".?!:" or _HEADER_JUNK_BEFORE.search(before):
        return True
    return bool(_INSTRUCTION_AFTER.match(text[m.end():]))


def split_question_groups(blocks: List[Block]):
    """Trả về (khối trước nhóm đầu tiên — thường là bài đọc, danh sách nhóm câu hỏi)."""
    pre: List[Block] = []
    groups: List[QuestionGroupSegment] = []

    def attach(block: Block, text: str) -> None:
        text = text.strip()
        if text and not is_noise(text):
            (groups[-1].blocks if groups else pre).append({**block, "text": text})

    for block in blocks:
        text = clean_text(block.get("text", ""))
        position = 0
        for m in QUESTIONS_RE.finditer(text):
            if not _is_group_marker(text, m):
                continue
            attach(block, text[position:m.start()])
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else start
            if end < start:
                start, end = end, start
            if groups and not groups[-1].blocks:  # "PART 2 Questions 11-20" rồi "Questions 11-16": bỏ nhóm rỗng
                groups.pop()
            groups.append(QuestionGroupSegment(start, end, []))
            position = m.end()
        attach(block, text[position:])
    groups = [g for g in groups if g.blocks]
    return pre, groups
