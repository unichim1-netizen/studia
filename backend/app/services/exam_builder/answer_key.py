"""
Đáp án đề thi: đọc từ trang "answer key" của sách, chuẩn hoá và so khớp bài làm.

Dạng đáp án trong sách Cambridge IELTS:
    1  sailing                    đáp án một từ
    14 ii                         số La Mã (matching headings)
    37 ratio / proportion         nhiều đáp án chấp nhận, ngăn bằng "/"
    40 (a) signature              phần trong ngoặc là tuỳ chọn → "signature" và "a signature" đều đúng
    21&22 IN EITHER ORDER B C     hai câu chọn chữ, thứ tự tuỳ ý
    21 B   22 D (in either order) cách ghi khác của cùng ý
"""
import re
from typing import Any, Dict, Iterable, List, Optional

EITHER_ORDER = re.compile(r"\(?\s*in\s+either\s+order\s*\)?", re.IGNORECASE)
_PAIR_FORM = re.compile(
    r"(?<!\d)(\d{1,2})\s*(?:&|and)\s*(\d{1,2})\s+(?:(?i:in\s+either\s+order)\s*:?\s*)?"
    r"([A-I])\s*(?:,|&|and)?\s*([A-I])\b",
)
_WS = re.compile(r"\s+")


def _squash(text: str) -> str:
    return _WS.sub(" ", text.replace(" ", " ")).strip()


def normalize_answer(text: Any) -> str:
    """Dạng so sánh: không phân biệt hoa/thường, bỏ khoảng trắng/dấu câu thừa ở hai đầu, 1,000 = 1000."""
    s = _squash(str(text if text is not None else "")).casefold()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"(?<=\d),(?=\d{3}\b)", "", s)
    s = s.strip(" \t.,;:!?\"'()[]")
    return _WS.sub(" ", s)


def expand_variants(raw: str) -> List[str]:
    """
    "(the) river"        -> ["river", "the river"]
    "ratio / proportion" -> ["ratio", "proportion"]
    "(a) signature"      -> ["signature", "a signature"]
    Cụm tuỳ chọn ở giữa/cuối: "colour(s)" -> ["colour", "colours"].
    """
    variants: List[str] = []
    for part in re.split(r"\s*/\s*|\s+or\s+(?=[A-Za-z0-9])", _squash(raw)):
        part = part.strip()
        if not part:
            continue
        results = [part]
        while any("(" in r for r in results):
            expanded: List[str] = []
            for r in results:
                m = re.search(r"\(([^()]*)\)", r)
                if not m:
                    expanded.append(r)
                    continue
                without = _squash(r[:m.start()] + " " + r[m.end():]) if " " in r[:m.start()] + r[m.end():] \
                    else r[:m.start()] + r[m.end():]
                with_opt = _squash(r[:m.start()] + m.group(1) + r[m.end():]) if not m.group(1).endswith(" ") \
                    and (m.start() == 0 or r[m.start() - 1] == " ") else r[:m.start()] + m.group(1) + r[m.end():]
                expanded += [_squash(without), _squash(with_opt)]
            results = expanded
        variants += results
    seen, unique = set(), []
    for v in variants:
        key = normalize_answer(v)
        if key and key not in seen:
            seen.add(key)
            unique.append(v.strip())
    return unique


def _marker(number: int) -> re.Pattern:
    return re.compile(rf"(?<![\w.,/&-]){number}(?![\w.,%/&:-])(?=\s|$)")


def parse_numbered_answers(text: str, numbers: Iterable[int]) -> Dict[int, str]:
    """
    Tách "1 answer 2 answer ..." thành {số: đáp án}. Các số được tìm tuần tự theo thứ tự `numbers`,
    nên đáp án chứa chính con số kế tiếp (vd. "1 2 2 Monday") được xử lý bằng cách đòi đáp án không rỗng.
    """
    text, pair_answers = _extract_pairs(_clean_key_text(text))
    numbers = list(numbers)
    search_numbers = [n for n in numbers if n not in pair_answers]
    positions: Dict[int, tuple] = {}
    cursor = 0
    previous_end: Optional[int] = None
    for number in search_numbers:
        found = None
        for m in _marker(number).finditer(text, cursor):
            # Đáp án của câu trước không được rỗng: "1 2 2 Monday" → câu 1 là "2", dấu "2" thứ hai mới là câu 2
            if previous_end is not None and not text[previous_end:m.start()].strip():
                continue
            found = m
            break
        if found:
            positions[number] = (found.start(), found.end())
            cursor = previous_end = found.end()

    answers: Dict[int, str] = {}
    ordered = [n for n in search_numbers if n in positions]
    for i, number in enumerate(ordered):
        start = positions[number][1]
        end = positions[ordered[i + 1]][0] if i + 1 < len(ordered) else len(text)
        answer = _squash(text[start:end])
        if answer:
            answers[number] = clean_answer(answer)
    for number, raw in pair_answers.items():
        if number in numbers:
            answers[number] = raw
    return answers


_EITHER_TAG = re.compile(r"\[either:(\d+)-(\d+)\]")
# Rác của trang đáp án in: bảng quy điểm, tiêu đề phần kế tiếp, dải điểm "29-40 you may get ..."
_KEY_JUNK = re.compile(
    r"\s+(?:If you score\b|Part\s+\d\s*,|Reading\s+Passage\s+\d|Questions?\s+\d|Answer key\b|"
    r"you (?:are|may)\b|\d{1,2}\s*-\s*\d{1,2}\b).*$", re.IGNORECASE)


def _clean_key_text(text: str) -> str:
    text = text.replace("–", "-").replace("—", "-")
    text = _squash(text)
    text = re.sub(r"\bNOTGIVEN\b", "NOT GIVEN", text)
    # OCR hay đọc dấu "/" thành chữ I: "cafe I cafe"
    # Chữ I đứng giữa hai số thứ tự là đáp án "I" (vd. "32 E 33 I 34 A"), nên chỉ đổi khi bên phải là chữ thường
    # hoặc cả hai bên đều là số có dấu chấm/hai chấm (ngày, giờ: "06.04 I 6.4")
    text = re.sub(r"(?<=[a-z0-9])\s+I\s+(?=[a-z])", " / ", text)
    text = re.sub(r"(\d+[.:]\d+)\s+I\s+(?=\d+[.:]\d)", r"\1 / ", text)
    return text


_EITHER_MARK = re.compile(r"(?<!\d)(\d{1,2})\s*(?:&|and)\s*(\d{1,2})\s+in\s+either\s+order\b", re.IGNORECASE)


def _extract_pairs(text: str) -> tuple:
    """
    Tách các cặp "21&22 IN EITHER ORDER B D" ra khỏi dòng số thứ tự → (văn bản còn lại, {số: "B [either:21-22]"}).
    Trang đáp án in nhiều cột bị đọc xen kẽ nên hai chữ cái có thể cách xa mốc: khi đó lấy hai chữ cái đứng riêng
    (không đi sau một số, vì "15 F" là đáp án của câu 15) kế tiếp trong văn bản.
    """
    pairs: Dict[int, str] = {}

    def record(a: str, b: str, x: str, y: str) -> None:
        tag = f"[either:{a}-{b}]"
        pairs[int(a)] = f"{x.upper()} {tag}"
        pairs[int(b)] = f"{y.upper()} {tag}"

    def adjacent(m: "re.Match") -> str:
        record(m.group(1), m.group(2), m.group(3), m.group(4))
        return " "

    text = _PAIR_FORM.sub(adjacent, text)
    while True:
        m = _EITHER_MARK.search(text)
        if not m:
            return text, pairs
        rest = text[m.end():]
        letters: List[tuple] = []
        for cand in re.finditer(r"(?<![\w/&])([A-I])(?![\w/&])", rest):
            before = rest[:cand.start()].rstrip()
            if re.search(r"(?<!\d)\d{1,2}$", before):
                continue
            letters.append((cand.start(), cand.end(), cand.group(1)))
            if len(letters) == 2:
                break
        if len(letters) < 2:
            text = text[:m.start()] + " " + rest
            continue
        record(m.group(1), m.group(2), letters[0][2], letters[1][2])
        rest = rest[:letters[0][0]] + rest[letters[0][1]:letters[1][0]] + rest[letters[1][1]:]
        text = text[:m.start()] + " " + rest


def clean_answer(raw: str) -> str:
    """Cắt phần rác (bảng quy điểm, tiêu đề phần sau) dính vào cuối đáp án."""
    return _squash(_KEY_JUNK.sub("", raw)).strip(" ,;")


def build_answer_entries(raw_answers: Dict[int, str]) -> Dict[str, Dict[str, Any]]:
    """Từ đáp án thô {số: chuỗi} sang mục đáp án chuẩn {"accept": [...], "any_order_with": [...], "raw": ...}."""
    tagged: Dict[int, tuple] = {}
    for n, raw in raw_answers.items():
        tag = _EITHER_TAG.search(raw)
        if tag:
            tagged[n] = (int(tag.group(1)), int(tag.group(2)))
    flagged = sorted(n for n, raw in raw_answers.items() if EITHER_ORDER.search(raw) and n not in tagged)
    cleaned = {n: clean_answer(EITHER_ORDER.sub("", _EITHER_TAG.sub("", raw))) for n, raw in raw_answers.items()}

    # Các số liền nhau cùng mang "in either order" tạo thành một nhóm
    groups: List[List[int]] = []
    for n in flagged:
        if groups and n == groups[-1][-1] + 1:
            groups[-1].append(n)
        else:
            groups.append([n])

    entries: Dict[str, Dict[str, Any]] = {}
    for n, raw in cleaned.items():
        entries[str(n)] = {"raw": raw, "accept": expand_variants(raw)}
    pairs: Dict[tuple, List[int]] = {}
    for n, pair in tagged.items():
        pairs.setdefault(pair, []).append(n)
    groups = [sorted(g) for g in pairs.values()] + groups
    for group in groups:
        if len(group) < 2 or any(str(n) not in entries for n in group):
            continue
        letters = [entries[str(n)]["raw"].strip().upper() for n in group]
        for n in group:
            entries[str(n)]["accept"] = list(dict.fromkeys(letters))
            entries[str(n)]["any_order_with"] = [m for m in group if m != n]
    return entries


def is_correct(user_answer: Any, entry: Optional[Dict[str, Any]]) -> bool:
    if not entry:
        return False
    given = normalize_answer(user_answer)
    if not given:
        return False
    return any(given == normalize_answer(option) for option in entry.get("accept", []))


def score_answers(key: Dict[str, Dict[str, Any]], answers: Dict[str, Any],
                  numbers: Optional[Iterable[int]] = None) -> Dict[int, Dict[str, Any]]:
    """
    Chấm từng câu. Nhóm "in either order": mỗi chữ chỉ được tính một lần trong nhóm
    (trả lời B và B cho hai câu thì chỉ đúng một câu).
    Trả về {số: {"correct": bool, "user_answer": ..., "correct_answers": [...]}}.
    """
    numbers = sorted(numbers) if numbers is not None else sorted(int(n) for n in key)
    result: Dict[int, Dict[str, Any]] = {}
    consumed: Dict[tuple, set] = {}
    for n in numbers:
        entry = key.get(str(n))
        user = answers.get(str(n), answers.get(n, ""))
        ok = is_correct(user, entry)
        if ok and entry and entry.get("any_order_with"):
            group = tuple(sorted([n, *entry["any_order_with"]]))
            used = consumed.setdefault(group, set())
            token = normalize_answer(user)
            if token in used:
                ok = False
            else:
                used.add(token)
        result[n] = {
            "correct": ok,
            "user_answer": user if user is not None else "",
            "correct_answers": entry.get("accept", []) if entry else [],
        }
    return result
