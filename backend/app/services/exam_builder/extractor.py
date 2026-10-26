"""
Trích câu hỏi, bài đọc, đề viết và nói từ các khối nội dung đã phân đoạn.

Luật (heuristic) luôn chạy trước và cho kết quả lặp lại được. Khi có mô hình ngôn ngữ, nhóm câu hỏi nào luật
xử lý chưa tốt (thiếu số câu, câu rỗng, trắc nghiệm không có lựa chọn…) sẽ được mô hình trích lại theo schema và
chỉ được chấp nhận nếu đối chiếu được với nguyên văn trong sách (mô hình không được tự bịa chữ).
"""
import logging
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional, Protocol, Tuple

from app.services.exam_builder.segmenter import Block, clean_text

logger = logging.getLogger(__name__)

ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv"]
LETTERS = [chr(c) for c in range(ord("A"), ord("Z") + 1)]
BLANK_RE = re.compile(r"…+|(?:[.·_][-–]{0,3}){4,}")
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "1": 1, "2": 2, "3": 3, "4": 4}

QUESTION_TYPES = (
    "multiple_choice", "multiple_select", "true_false_ng", "yes_no_ng", "matching_headings",
    "matching_information", "matching_features", "sentence_completion", "summary_completion",
    "note_completion", "table_completion", "form_completion", "flow_chart_completion",
    "diagram_labelling", "map_labelling", "short_answer",
)
COMPLETION_TYPES = {
    "sentence_completion", "summary_completion", "note_completion", "table_completion",
    "form_completion", "flow_chart_completion", "diagram_labelling", "map_labelling", "short_answer",
}
MATCHING_TYPES = {"matching_headings", "matching_information", "matching_features"}
TFNG_OPTIONS = {"true_false_ng": ["TRUE", "FALSE", "NOT GIVEN"], "yes_no_ng": ["YES", "NO", "NOT GIVEN"]}

INSTRUCTION_START = re.compile(
    r"^(?:complete|write|choose|label|do the following|look at|match|answer the|circle|tick|select|"
    r"nb\b|use\b|you may|in boxes|reading passage \d has|the (?:list|following)|listen|read\b)", re.IGNORECASE)
SPEND_RE = re.compile(r"^you should spend about", re.IGNORECASE)
OPTION_LINE = re.compile(r"^(?:[A-H]|i{1,3}|iv|vi{0,3}|ix|x)[.)]?\s+\S")


class JsonLLM(Protocol):
    def generate_json(self, prompt: str) -> Optional[Dict[str, Any]]:
        """Gửi prompt, trả về đối tượng JSON đã parse (hoặc None khi lỗi)."""


class GeminiJsonLLM:
    """Gọi Gemini qua AIEngine; trả None khi chưa cấu hình hoặc lỗi."""

    def generate_json(self, prompt: str) -> Optional[Dict[str, Any]]:
        from app.services.ai_engine import _call_gemini

        result = _call_gemini(prompt, expect_json=True)
        return result if isinstance(result, dict) else None


# ============================================================
# Tiện ích văn bản
# ============================================================

def normalize_blanks(text: str) -> str:
    """Mọi dấu chỗ trống về đúng "___" (giao diện phòng thi tách ô nhập theo chuỗi này)."""
    text = BLANK_RE.sub("___", text)
    return re.sub(r"(\d)\s*___", r"\1 ___", text)  # "7___" -> "7 ___"


def squash(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text.replace(" ", " ")).strip()


def block_text(block: Block) -> str:
    return clean_text(block.get("text", ""))


def detect_word_limit(text: str) -> Tuple[Optional[int], bool]:
    """(giới hạn số từ, có cho phép điền số không)."""
    t = text.lower()
    limit: Optional[int] = None
    m = re.search(r"no more than\s+(one|two|three|four|[1-4])\s+words?", t)
    if m:
        limit = NUMBER_WORDS[m.group(1)]
    else:
        m = re.search(r"\b(one|two|three|four|[1-4])\s+words?\b", t)
        if m:
            limit = NUMBER_WORDS[m.group(1)]
        elif re.search(r"\bone number\b|\ba number only\b|\bnumbers? only\b", t):
            limit = 1
    allow_number = bool(re.search(r"and/or\s+(?:a\s+)?numbers?|or\s+(?:a\s+)?numbers?|numbers? only|one number", t))
    return limit, allow_number


def detect_type(instruction: str, body: str, title: str = "") -> str:
    t = instruction.lower()
    wide = f"{instruction} {title} {body[:500]}".lower()
    if "true" in wide and "false" in wide and "not given" in wide:
        return "true_false_ng"
    if re.search(r"\byes\b", wide) and re.search(r"\bno\b", wide) and "not given" in wide \
            and re.search(r"\bwrite\b|\bchoose\b|\bdo the following\b", wide):
        return "yes_no_ng"
    from_box = "from the box" in t or re.search(r"\blist of\b", t) or "from the list" in t
    if re.search(r"choose\s+(?:two|three|four|2|3|4)\s+letters?", t) or (
            re.search(r"choose\s+(?:two|three|four|2|3|4)\s+answers?", t) and not from_box):
        return "multiple_select"
    if "list of headings" in t or "choose the correct heading" in t or ("heading" in t and "paragraph" in t):
        return "matching_headings"
    if "which paragraph" in wide or "paragraph contains" in wide or re.search(r"has \w+ paragraphs", t):
        return "matching_information"
    if "flow-chart" in t or "flow chart" in t or "flowchart" in t:
        return "flow_chart_completion" if not from_box else "matching_features"
    if "label" in t and re.search(r"\bmap\b|\bplan\b", t + " " + title.lower() + " " + body[:120].lower()):
        return "map_labelling"
    if "label" in t:
        return "diagram_labelling"
    if "match" in t or from_box or "correct ending" in t \
            or re.search(r"write the correct letter.*next to questions", t) or "list of words" in t:
        return "matching_features"
    if "table" in t and "complete" in t:
        return "table_completion"
    if "summary" in t:
        return "summary_completion"
    if "complete the form" in t or re.search(r"\bform\b", t) and "complete" in t:
        return "form_completion"
    if "notes" in t:
        return "note_completion"
    if "sentence" in t:
        return "sentence_completion"
    if "answer the questions" in t or "answer the following questions" in t:
        return "short_answer"
    if "choose the correct letter" in t or "choose the correct answer" in t or "choose the best" in t:
        return "multiple_choice"
    return "multiple_choice" if find_option_candidates(body, LETTERS[:3]) else "short_answer"


# ============================================================
# Đánh số câu & lựa chọn
# ============================================================

@lru_cache(maxsize=256)
def _number_marker(n: int) -> re.Pattern:
    return re.compile(
        rf"(?<![\w.,/&$£%:-]){n}(?![\w.,%/&-])(?=\s*(?:_{{2,}}|…|[.·]{{4,}}|[.·_\-–]{{6,}})|\s+\S|\s*$)"
    )


@lru_cache(maxsize=256)
def _anchor(n: int) -> re.Pattern:
    """Số đứng ngay trước chỗ trống: "2 ___"."""
    return re.compile(rf"(?<![\w.,/&$£%-]){n}\s*(?=_{{2,}}|…|[.·]{{4,}}|[.·_\-–]{{6,}})")


def find_number_positions(text: str, numbers: List[int]) -> Dict[int, Tuple[int, int]]:
    """Vị trí (bắt đầu, kết thúc) của dấu hiệu từng số, tìm tuần tự để các số trùng nội dung không nhầm."""
    positions: Dict[int, Tuple[int, int]] = {}
    cursor = 0
    for n in numbers:
        m = _number_marker(n).search(text, cursor)
        if m:
            positions[n] = (m.start(), m.end())
            cursor = m.end()
    return positions


def split_numbered(text: str, numbers: List[int]) -> Dict[int, str]:
    positions = find_number_positions(text, numbers)
    found = [n for n in numbers if n in positions]
    result: Dict[int, str] = {}
    for i, n in enumerate(found):
        end = positions[found[i + 1]][0] if i + 1 < len(found) else len(text)
        result[n] = squash(text[positions[n][1]:end])
    return result


def option_labels(style: str, count: int) -> List[str]:
    return (ROMAN if style == "roman" else LETTERS)[:count]


def expected_option_count(instruction: str) -> Optional[int]:
    """"A-I" trong câu lệnh → 9 lựa chọn."""
    m = re.search(r"\b([A-Z])\s*[-–—]\s*([A-Z])\b", instruction)
    if m:
        count = ord(m.group(2)) - ord(m.group(1)) + 1
        if 2 <= count <= 12 and m.group(1) == "A":
            return count
    return None


def find_option_candidates(text: str, labels: List[str]) -> List[List[Tuple[str, int, int]]]:
    """Mọi chuỗi nhãn tuần tự (A, B, C… hoặc i, ii, iii…) có thể là danh sách lựa chọn."""
    first = labels[0]
    candidates = []
    for m in re.finditer(rf"(?:(?<=\s)|^){re.escape(first)}(?:[.)]\s*|\s+)(?=\S)", text):
        sequence = [(first, m.start(), m.end())]
        cursor = m.end()
        for label in labels[1:]:
            nxt = re.compile(rf"(?<=\s){re.escape(label)}(?:[.)]\s*|\s+)(?=\S)").search(text, cursor)
            if not nxt:
                break
            sequence.append((label, nxt.start(), nxt.end()))
            cursor = nxt.end()
        if len(sequence) >= 2:
            candidates.append(sequence)
    return candidates


def _unordered_markers(text: str, labels: List[str]) -> List[Tuple[str, int, int]]:
    """Danh sách xếp nhiều cột bị đọc theo hàng ("A x D y G z B w ..."): mỗi nhãn tìm độc lập rồi xếp theo vị trí."""
    first = re.compile(rf"(?:(?<=\s)|^){re.escape(labels[0])}(?:[.)]\s*|\s+)(?=\S)").search(text)
    if not first:
        return []
    found = [(labels[0], first.start(), first.end())]
    for label in labels[1:]:
        m = re.compile(rf"(?<=\s){re.escape(label)}(?:[.)]\s*|\s+)(?=\S)").search(text, first.end())
        if m:
            found.append((label, m.start(), m.end()))
    return sorted(found, key=lambda item: item[1])


def parse_options(text: str, style: str = "letter", max_options: int = 10, limit: Optional[int] = None,
                  expected: Optional[int] = None) -> Tuple[str, List[Dict[str, str]]]:
    """
    Tách "câu dẫn A xxx B yyy C zzz" thành (câu dẫn, [{"key","text"}…]). `limit` chặn phần cuối của lựa chọn
    cuối cùng; `expected` là số lựa chọn kỳ vọng (từ "A-I" trong câu lệnh).
    """
    labels = option_labels(style, expected or max_options)
    best: Optional[List[Tuple[str, int, int]]] = None
    for candidate in find_option_candidates(text, labels):
        if best is None or len(candidate) >= len(best):  # hoà thì lấy ứng viên sau (lựa chọn nằm sau câu dẫn)
            best = candidate
    if expected and (best is None or len(best) < expected):
        unordered = _unordered_markers(text, labels)
        if len(unordered) >= max(2, (expected * 2 + 2) // 3) and (best is None or len(unordered) > len(best)):
            best = unordered
    if not best:
        return text.strip(), []
    stem = text[:best[0][1]].strip()
    options = []
    for i, (label, _start, end) in enumerate(best):
        last = i + 1 >= len(best)
        stop = best[i + 1][1] if not last else (limit if limit is not None else len(text))
        piece = text[end:stop]
        if last:
            piece = piece.split("\n", 1)[0]
        options.append({"key": label, "text": squash(piece)})
    options.sort(key=lambda o: labels.index(o["key"]) if o["key"] in labels else 99)  # hiển thị theo A, B, C…
    return stem, options


# ============================================================
# Nhóm câu hỏi (heuristic)
# ============================================================

def _split_instruction(blocks: List[Block], start_number: Optional[int] = None) -> Tuple[str, List[Block]]:
    """Câu lệnh = các khối đầu bắt đầu như câu lệnh; phần còn lại là nội dung nhóm."""
    taken: List[str] = []
    index = 0
    while index < len(blocks):
        text = block_text(blocks[index])
        if not text:
            index += 1
            continue
        if start_number is not None:
            marker = _number_marker(start_number).search(text)
            if marker:
                head = text[:marker.start()].strip()
                tail = text[marker.start():].strip()
                if head:
                    taken.append(head)
                rest_blocks = [{**blocks[index], "text": tail}] + blocks[index + 1:]
                return " ".join(taken), rest_blocks

        starts_like_instruction = bool(INSTRUCTION_START.match(text))
        if index == 0 or (starts_like_instruction and taken):
            if index == 0 and not starts_like_instruction and blocks[index].get("block_type") == "heading":
                break
            taken.append(text)
            index += 1
            continue
        break
    return " ".join(taken), blocks[index:]


def _is_title(block: Block) -> bool:
    text = block_text(block)
    if not text or len(text) > 90 or BLANK_RE.search(text) or re.match(r"^\d{1,2}\s", text):
        return False
    if OPTION_LINE.match(text):  # "A How to make ..." là một lựa chọn, không phải tiêu đề
        return False
    return block.get("block_type") == "heading" or not text.endswith((".", "?", ":"))


def _embedded_units(text: str, numbers: List[int]) -> Dict[int, str]:
    """
    Câu hỏi có số nằm ngay trước chỗ trống ("the 2 ___ and tides"). Mỗi dòng (các khối được nối bằng "\\n")
    chứa chỗ trống là một đơn vị; dòng có nhiều chỗ trống được cắt giữa các chỗ trống.
    """
    anchors: Dict[int, Tuple[int, int]] = {}
    cursor = 0
    for n in numbers:
        m = _anchor(n).search(text, cursor)
        if m:
            anchors[n] = (m.start(), m.end())
            cursor = m.end()
    ordered = [n for n in numbers if n in anchors]
    if not ordered:
        return {}

    def line_bounds(pos: int) -> Tuple[int, int]:
        begin = text.rfind("\n", 0, pos) + 1
        finish = text.find("\n", pos)
        return begin, len(text) if finish < 0 else finish

    by_line: Dict[Tuple[int, int], List[int]] = {}
    for n in ordered:
        by_line.setdefault(line_bounds(anchors[n][0]), []).append(n)

    units: Dict[int, str] = {}
    for (begin, finish), group in by_line.items():
        cursor = begin
        for i, n in enumerate(group):
            if i + 1 < len(group):
                gap = text[anchors[n][1]:anchors[group[i + 1]][0]]
                cut = anchors[n][1] + _boundary(gap)
            else:
                cut = finish
            units[n] = squash(text[cursor:cut])
            cursor = cut
    return units


def _boundary(gap: str) -> int:
    """Vị trí ngắt giữa hai chỗ trống liền nhau trên cùng một dòng: hết câu → gạch đầu dòng → chữ hoa → giữa."""
    sentence = re.search(r"[.;!?](?=\s+[A-Z“\"'(•●▪-]|\s*$)", gap)
    if sentence:
        return sentence.end()
    bullet = re.search(r"\s[•●▪\-–]\s", gap)
    if bullet:
        return bullet.start() + 1
    upper = re.search(r"(?<=[a-z)\]\d,])\s+(?=[A-Z])", gap)
    if upper:
        return upper.end()
    words = gap.split(" ")
    return len(" ".join(words[: max(1, len(words) // 2)])) + 1 if len(words) > 1 else len(gap)


def _tidy_question(text: str) -> str:
    text = squash(text)
    text = re.sub(r"^(?:[•●▪◦*]|[-–]\s)\s*", "", text)
    text = re.sub(r"\s+([.,;:?!])", r"\1", text)
    return text.strip()


def _make_question(number: int, text: str, options: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    return {"number": number, "question": normalize_blanks(_tidy_question(text)), "options": options}


def _segments(body: str, numbers: List[int]) -> Dict[int, str]:
    """Tách theo số câu; nhóm chỉ có một câu mà không thấy số thì cả phần thân là câu đó."""
    segments = split_numbered(body, numbers)
    if len(numbers) == 1 and numbers[0] not in segments:
        segments[numbers[0]] = squash(body)
    return segments


def parse_group(start: int, end: int, blocks: List[Block]) -> Dict[str, Any]:
    """Một nhóm "Questions a–b" → dict nhóm chuẩn (xem docs/PLAN_PDF_EBOOK_EXAM.md mục 3.2)."""
    numbers = list(range(start, end + 1))
    instruction, body_blocks = _split_instruction(blocks, start_number=start)
    body_blocks = [b for b in body_blocks if block_text(b)]

    # Tiêu đề ngữ cảnh / tiêu đề danh sách lựa chọn ngay sau câu lệnh
    context_title: Optional[str] = None
    options_title: Optional[str] = None
    while body_blocks and _is_title(body_blocks[0]) and (context_title is None or options_title is None):
        text = block_text(body_blocks[0])
        if re.match(r"^list of\b", text, re.IGNORECASE):
            options_title = text
        elif context_title is None and options_title is None:
            context_title = text
        else:
            break
        body_blocks = body_blocks[1:]

    body = "\n".join(block_text(b) for b in body_blocks)
    qtype = detect_type(instruction, body, context_title or "")
    word_limit, allow_number = detect_word_limit(instruction)
    source_ids = [b.get("id") for b in blocks if b.get("id")]

    group: Dict[str, Any] = {
        "instruction": squash(instruction),
        "type": qtype,
        "word_limit": word_limit if qtype in COMPLETION_TYPES else None,
        "allow_number": allow_number if qtype in COMPLETION_TYPES else False,
        "context_title": context_title,
        "options_title": options_title,
        "shared_options": None,
        "image_url": None,
        "range": [start, end],
        "questions": [],
        "source_block_ids": list(dict.fromkeys(source_ids)),
        "source": "heuristic",
    }
    if qtype in TFNG_OPTIONS:  # tiêu đề "TRUE FALSE NOT GIVEN" không phải tiêu đề ngữ cảnh
        group["context_title"] = None

    embedded = sum(1 for n in numbers if _anchor(n).search(body)) >= max(1, round(0.6 * len(numbers)))
    if qtype in COMPLETION_TYPES and not embedded and not BLANK_RE.search(body):
        for n in numbers:
            body = re.sub(rf"(?<![\w.,/&$£%:-]){n}(?![\w.,%/&-])(?!\s*___)", rf"{n} ___", body)
        embedded = sum(1 for n in numbers if _anchor(n).search(body)) >= max(1, round(0.6 * len(numbers)))

    if qtype in TFNG_OPTIONS:
        segments = _segments(body, numbers)
        group["questions"] = [_make_question(n, segments.get(n, "")) for n in numbers]

    elif qtype == "multiple_select":
        stem, options = parse_options(body, expected=expected_option_count(instruction))
        group["questions"] = [_make_question(n, stem, [dict(o) for o in options]) for n in numbers]
        group["choose_count"] = len(numbers)

    elif qtype in MATCHING_TYPES:
        style = "roman" if qtype == "matching_headings" else "letter"
        expected = expected_option_count(instruction) if style == "letter" else None
        positions = find_number_positions(body, numbers)
        if embedded:  # tóm tắt điền từ chọn trong bảng từ: số nằm trước chỗ trống, danh sách từ ở cuối
            anchor_ends = [m.end() for n in numbers if (m := _anchor(n).search(body))]
            last_end = max(anchor_ends, default=0)
            line_end = body.find("\n", last_end)
            tail = body[line_end + 1:] if line_end >= 0 else ""
            _stem, shared = parse_options(tail, style, expected=expected)
            statements = _embedded_units(body, numbers)
        else:
            first_pos = min((p[0] for p in positions.values()), default=None)
            statements_text = body
            shared = []
            if first_pos is not None and first_pos > 0:
                _stem, shared = parse_options(body[:first_pos], style, expected=expected)
                if shared:
                    statements_text = body[first_pos:]
            if not shared:
                last_pos = max((p[0] for p in positions.values()), default=0)
                stem_after, shared_after = parse_options(body[last_pos:], style, expected=expected)
                if shared_after:
                    shared = shared_after
                    statements_text = body[:last_pos] + stem_after  # cắt phần lựa chọn ra khỏi câu hỏi cuối
            statements = split_numbered(statements_text, numbers)
        if not shared and qtype == "matching_information":
            count = expected_option_count(instruction)
            if count:
                shared = [{"key": LETTERS[i], "text": f"Paragraph {LETTERS[i]}"} for i in range(count)]
        group["shared_options"] = shared or None
        group["questions"] = [_make_question(n, statements.get(n, "")) for n in numbers]
        if shared and context_title and not options_title and qtype == "matching_features" and len(shared) > 3:
            # Tiêu đề đứng trên danh sách lựa chọn ("Opinions", "Duties") thuộc danh sách, không phải đề bài
            group["options_title"], group["context_title"] = context_title, None

    elif qtype == "multiple_choice":
        segments = _segments(body, numbers)
        questions = []
        for n in numbers:
            stem, options = parse_options(segments.get(n, ""))
            questions.append(_make_question(n, stem, options or None))
        group["questions"] = questions

    else:  # các dạng điền
        segments = _embedded_units(body, numbers) if embedded else _segments(body, numbers)
        group["questions"] = [_make_question(n, segments.get(n, "")) for n in numbers]
        group["layout"] = "embedded" if embedded else "leading"
        if qtype in ("map_labelling", "diagram_labelling"):
            count = expected_option_count(instruction)
            if count:  # đáp án là nhãn chữ cái đặt trên hình
                group["shared_options"] = [{"key": LETTERS[i], "text": ""} for i in range(count)]
            group["needs_review"] = True
        if qtype == "table_completion" or any(len(q["question"]) > 220 for q in group["questions"]):
            group["needs_review"] = True
    return group


# ============================================================
# Bài đọc, đề viết, đề nói
# ============================================================

def extract_passage(pre_blocks: List[Block]) -> Dict[str, Any]:
    content = [b for b in pre_blocks if block_text(b) and not SPEND_RE.match(block_text(b))]
    title = ""
    if content and (content[0].get("block_type") == "heading" or _is_title(content[0])):
        title = block_text(content[0])
        content = content[1:]
    paragraphs = [(b.get("text") or "").strip() for b in content]
    return {
        "title": title,
        "body_markdown": "\n\n".join(p for p in paragraphs if p),
        "source_block_ids": list(dict.fromkeys(b.get("id") for b in pre_blocks if b.get("id"))),
    }


def _join_paragraphs(parts: List[str]) -> str:
    """Nối các mảnh văn bản thành đoạn; mảnh trước chưa kết thúc câu và mảnh sau viết thường thì cùng một đoạn."""
    out: List[str] = []
    for part in parts:
        if not part:
            continue
        if out and not re.search(r"[.?!:;)\]]$", out[-1]) and part[:1].islower():
            out[-1] = f"{out[-1]} {part}"
        else:
            out.append(part)
    return "\n\n".join(out)


def extract_writing_task(blocks: List[Block]) -> Dict[str, Any]:
    prompt_parts: List[str] = []
    min_words: Optional[int] = None
    for block in blocks:
        text = block_text(block)
        if not text or SPEND_RE.match(text):
            continue
        m = re.match(r"^write at least\s+(\d+)\s+words?\.?$", text, re.IGNORECASE)
        if m:
            min_words = int(m.group(1))
            continue
        prompt_parts.append((block.get("text") or "").strip())
    return {
        "prompt": _join_paragraphs(prompt_parts),
        "min_words": min_words,
        "image_url": None,
        "source_block_ids": list(dict.fromkeys(b.get("id") for b in blocks if b.get("id"))),
    }


def _questions_from(blocks: List[Block]) -> List[str]:
    questions: List[str] = []
    for block in blocks:
        text = block_text(block)
        if not text or text.endswith(":") and "?" not in text:
            continue
        text = re.sub(r"^[-•●▪◦–*]\s*", "", text)
        for piece in re.split(r"(?<=\?)\s+", text):
            piece = piece.strip()
            if not piece.endswith("?"):
                continue
            if questions and len(piece.split()) <= 2:
                questions[-1] = f"{questions[-1]} {piece}"
            else:
                questions.append(piece)
    return questions


def extract_speaking(parts: Dict[int, List[Block]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    if 1 in parts:
        result["part1"] = {"questions": _questions_from(parts[1])}
    if 2 in parts:
        texts = [re.sub(r"^[-•●▪◦–*]\s*", "", block_text(b)) for b in parts[2] if block_text(b)]
        topic = next((t for t in texts if not re.match(r"^(?:you should say|you will have to|you have one minute|"
                                                         r"the examiner|candidate)", t, re.IGNORECASE)), "")
        points: List[str] = []
        closing = ""
        for block, text in zip([b for b in parts[2] if block_text(b)], texts):
            if text == topic or re.match(r"^(?:you should say|you will have to|you have one minute)", text, re.I):
                continue
            if block.get("block_type") != "list_item" and not points and not re.match(r"^and\b", text, re.I):
                continue
            m = re.split(r"\s+(?=and\s+explain\b)", text, maxsplit=1)
            points.append(m[0].strip())
            if len(m) == 2:
                closing = m[1].strip()
            elif re.match(r"^and\b", text, re.IGNORECASE):
                points.pop()
                closing = text
        cue = f"**{topic}**\n\nYou should say:\n" + "\n".join(f"• {p}" for p in points)
        if closing:
            cue += f"\n\n{closing}"
        result["part2"] = {"topic": topic, "points": points, "closing": closing, "cue_card": cue}
    if 3 in parts:
        result["part3"] = {"questions": _questions_from(parts[3])}
    return result


# ============================================================
# Làm lại nhóm bằng mô hình ngôn ngữ (có kiểm chứng)
# ============================================================

LLM_PROMPT = """You are extracting ONE group of IELTS questions from OCR/PDF text of a published exam book.

Return ONLY a JSON object:
{{
  "type": one of {types},
  "context_title": string or null,
  "shared_options": [{{"key": "A", "text": "..."}}] or null,
  "questions": [{{"number": int, "question": "verbatim question text; keep each gap as ___", "options": [{{"key": "A", "text": "..."}}] or null}}]
}}

Rules:
- The group covers question numbers {start} to {end} inclusive. Return exactly one entry per number.
- Copy wording EXACTLY from the text. Never invent, translate or paraphrase. Do not add answers.
- For multiple choice, put the options on each question. For matching, put the shared list in shared_options.
- For true/false/not given and yes/no/not given questions, options must be null.
- For completion questions, keep one gap per question, written as ___ (three underscores).

Instruction: {instruction}

Text:
{body}
"""


def _tokens(text: str) -> set:
    return set(re.findall(r"[a-z0-9']+", text.lower()))


def validate_llm_group(result: Optional[Dict[str, Any]], heuristic: Dict[str, Any],
                       body_text: str) -> Optional[Dict[str, Any]]:
    """Chấp nhận kết quả của mô hình chỉ khi đủ số câu và chữ khớp với nguyên văn trong sách."""
    if not isinstance(result, dict):
        return None
    start, end = heuristic["range"]
    questions = result.get("questions")
    if not isinstance(questions, list):
        return None
    try:
        numbers = sorted(int(q["number"]) for q in questions)
    except (KeyError, TypeError, ValueError):
        return None
    if numbers != list(range(start, end + 1)):
        return None
    qtype = result.get("type") if result.get("type") in QUESTION_TYPES else heuristic["type"]

    source_tokens = _tokens(body_text + " " + heuristic.get("instruction", ""))
    cleaned: List[Dict[str, Any]] = []
    for q in sorted(questions, key=lambda x: int(x["number"])):
        text = str(q.get("question", "")).strip()
        options = q.get("options")
        parts = [text] + [str(o.get("text", "")) for o in (options or []) if isinstance(o, dict)]
        tokens = _tokens(" ".join(parts))
        if tokens and len(tokens & source_tokens) / len(tokens) < 0.8:
            return None  # chữ không có trong nguyên văn → coi là bịa
        if options is not None:
            if not isinstance(options, list) or not all(isinstance(o, dict) and "key" in o and "text" in o
                                                        for o in options):
                return None
            options = [{"key": str(o["key"]).strip(), "text": str(o["text"]).strip()} for o in options]
        cleaned.append(_make_question(int(q["number"]), text, options))

    shared = result.get("shared_options")
    if isinstance(shared, list) and shared and all(isinstance(o, dict) and "key" in o and "text" in o for o in shared):
        shared = [{"key": str(o["key"]).strip(), "text": str(o["text"]).strip()} for o in shared]
    else:
        shared = heuristic.get("shared_options")

    refined = dict(heuristic)
    refined.update({
        "type": qtype,
        "questions": cleaned,
        "shared_options": shared,
        "context_title": result.get("context_title") or heuristic.get("context_title"),
        "source": "ai",
    })
    refined.pop("needs_review", None)
    return refined


def group_needs_help(group: Dict[str, Any]) -> bool:
    """Luật xử lý chưa tốt nhóm này?"""
    for q in group["questions"]:
        if not q["question"].strip() and group["type"] != "multiple_select":
            return True
        if group["type"] == "multiple_choice" and not q.get("options"):
            return True
    if group["type"] in MATCHING_TYPES and not group.get("shared_options"):
        return True
    if group["type"] == "multiple_select" and not group["questions"][0].get("options"):
        return True
    return bool(group.get("needs_review"))


def refine_group(llm: JsonLLM, group: Dict[str, Any], body_text: str) -> Dict[str, Any]:
    start, end = group["range"]
    prompt = LLM_PROMPT.format(types=list(QUESTION_TYPES), start=start, end=end,
                               instruction=group.get("instruction", ""), body=body_text[:6000])
    try:
        refined = validate_llm_group(llm.generate_json(prompt), group, body_text)
    except Exception as e:  # lỗi mạng/định dạng: giữ kết quả luật
        logger.warning(f"LLM refine failed for Q{start}-{end}: {e}")
        refined = None
    return refined or group
