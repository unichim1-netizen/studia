"""
PDF → khối, dùng PDFium (pypdfium2): nhanh hơn pypdf/pdfminer nhiều lần và cho biết cỡ chữ, kiểu chữ
của từng dòng để nhận diện tiêu đề.

Chưa xử lý: OCR cho trang scan, dựng lại bảng, sắp thứ tự đọc cho trang nhiều cột phức tạp.
"""
import ctypes
import logging
import re
import threading
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

from app.services.doc_ingest.text_blocks import blocks_from_text

logger = logging.getLogger(__name__)

# PDFium không an toàn khi gọi đồng thời từ nhiều luồng
_PDFIUM_LOCK = threading.Lock()

_SOFT_HYPHEN_BREAK = "￾"  # PDFium đánh dấu chỗ từ bị ngắt bằng gạch nối cuối dòng
_LIST_MARKER = re.compile(r"^(?:[-•●▪◦–]|\d{1,3}[.)]|[A-Za-z][.)])\s+\S")
_PAGE_NUMBER = re.compile(r"^(?:page\s+|trang\s+)?[\divxlc]{1,5}(?:\s*(?:/|of)\s*\d{1,5})?$", re.IGNORECASE)
_SENTENCE_END = re.compile(r"[.!?:;…\"”’)\]]$")
_NUMBERED_START = re.compile(r"^\d{1,3}\s+[A-ZÀ-Ỹ]")
_BOLD_NAME = re.compile(r"bold|black|heavy|semibold|demi", re.IGNORECASE)
# PDFium trả ô tô đen/ký tự biểu tượng (Symbol, Wingdings) thành U+FFFD hoặc vùng private-use: đầu dòng là dấu đầu dòng,
# còn cả chuỗi dài là ô/gạch chân điền từ của đề thi.
_GLYPH = "\uFFFD\uF000-\uF8FF"
_GLYPH_RUN = re.compile(f"[{_GLYPH}]{{3,}}[-\u2013\u2014~]*[{_GLYPH}]*")
_GLYPH_BULLET = re.compile(f"^[{_GLYPH}\u25CF\u25AA\u25E6\u25A0\u25A1\u25C6\u27A2\u27A4\u25BA]+\\s*")

MIN_TEXT_CHARS_PER_PAGE = 20
LINE_BOX_EM = 1.115       # chiều cao hộp dòng danh định (theo cỡ chữ), không phụ thuộc phông thay thế của hệ điều hành
EDGE_ZONE = 0.09          # 9% trên/dưới trang là vùng header/footer
HEADING_SIZE_RATIO = 1.15
MAX_HEADING_CHARS = 120


def _clean_glyphs(text: str) -> str:
    text = _GLYPH_RUN.sub(" ........ ", text)
    text = _GLYPH_BULLET.sub("• ", text)
    return text.strip()


def _font_info(textpage, index: int) -> Tuple[float, bool]:
    size = pdfium_c.FPDFText_GetFontSize(textpage, index)
    flags = ctypes.c_int()
    buffer = ctypes.create_string_buffer(128)
    pdfium_c.FPDFText_GetFontInfo(textpage, index, buffer, 128, ctypes.byref(flags))
    name = buffer.value.decode("utf-8", "ignore")
    weight = pdfium_c.FPDFText_GetFontWeight(textpage, index)
    return round(size * 2) / 2, bool(_BOLD_NAME.search(name)) or weight >= 600


def _page_lines(page, page_number: int) -> List[Dict[str, Any]]:
    """Các dòng văn bản của trang kèm cỡ chữ, đậm/thường và vị trí dọc (0 = mép trên, 1 = mép dưới)."""
    textpage = page.get_textpage()
    try:
        text = textpage.get_text_range()
        height = page.get_height() or 1.0
        lines: List[Dict[str, Any]] = []
        offset = 0
        for raw in text.split("\r\n"):
            stripped = raw.strip()  # vị trí ký tự tính trên bản gốc; chữ hiển thị là bản đã làm sạch ký hiệu
            cleaned = _clean_glyphs(stripped) if stripped else ""
            if cleaned:
                first = offset + (len(raw) - len(raw.lstrip()))
                last = first + len(stripped) - 1
                middle = (first + last) // 2
                size, bold = _font_info(textpage, first)
                mid_size, mid_bold = _font_info(textpage, middle)
                left, bottom, _, top = textpage.get_charbox(first, loose=True)
                right = textpage.get_charbox(last, loose=True)[2]
                line_size = max(size, mid_size)
                line_top = 1 - top / height
                lines.append({
                    "text": re.sub(r"\s+", " ", cleaned),
                    "size": line_size,
                    "bold": bold and mid_bold,
                    "top": line_top,
                    # Hộp ký tự "loose" của PDFium lấy theo ascent/descent của phông thay thế (Windows ≠ Linux),
                    # làm khoảng cách giữa dòng lệch và ngắt đoạn khác nhau giữa các máy; dùng hộp danh định theo cỡ chữ.
                    "bottom": line_top + line_size * LINE_BOX_EM / height,
                    "left": left,
                    "right": right,
                    "page": page_number,
                })
            offset += len(raw) + 2
        _flatten_if_unreliable(lines)
        return lines
    finally:
        textpage.close()


def _flatten_if_unreliable(lines: List[Dict[str, Any]]) -> None:
    """
    Trang có chữ bị xoay/ma trận lạ (toạ độ dòng sau nằm "phía trên" dòng trước ở phần lớn trang):
    bỏ thông tin hình học, chỉ giữ thứ tự dòng của PDFium và chia đoạn theo dấu câu.
    """
    if len(lines) < 4:
        return
    upward = sum(1 for previous, line in zip(lines, lines[1:]) if line["top"] < previous["top"] - 1e-4)
    if upward / (len(lines) - 1) > 0.4:
        for line in lines:
            line.update({"flat": True, "top": 0.5, "bottom": 0.5})


def _edge_key(line: Dict[str, Any]) -> Optional[str]:
    """Khoá nhận diện header/footer lặp: nội dung (số → #) + nằm ở mép trên hay dưới."""
    if line["top"] < EDGE_ZONE:
        zone = "top"
    elif line["bottom"] > 1 - EDGE_ZONE:
        zone = "bottom"
    else:
        return None
    return zone + ":" + re.sub(r"\d+", "#", line["text"].lower())


def _drop_running_headers(pages: List[List[Dict[str, Any]]]) -> None:
    text_pages = [p for p in pages if p]
    if len(text_pages) < 3:
        repeated = set()
    else:
        counts = Counter(key for p in text_pages for key in {_edge_key(line) for line in p} if key)
        repeated = {key for key, n in counts.items() if n >= max(3, 0.6 * len(text_pages))}

    for i, lines in enumerate(pages):
        pages[i] = [
            line for line in lines
            if _edge_key(line) not in repeated
            and not (_edge_key(line) and _PAGE_NUMBER.match(line["text"]))
        ]


def _heading_levels(pages: List[List[Dict[str, Any]]]) -> Tuple[float, Dict[float, int]]:
    """Cỡ chữ thân bài (phổ biến nhất theo số ký tự) và cấp tiêu đề cho từng cỡ chữ lớn hơn."""
    weight: Counter = Counter()
    for lines in pages:
        for line in lines:
            weight[line["size"]] += len(line["text"])
    if not weight:
        return 0.0, {}
    body = weight.most_common(1)[0][0]
    larger = sorted((s for s in weight if s >= body * HEADING_SIZE_RATIO), reverse=True)
    return body, {size: min(rank, 3) for rank, size in enumerate(larger, start=1)}


def _join(previous: str, line: str) -> str:
    if previous.endswith(_SOFT_HYPHEN_BREAK):
        return previous[:-1] + line
    if re.search(r"[A-Za-zÀ-ỹ]-$", previous) and line[:1].islower():
        return previous[:-1] + line
    return f"{previous} {line}"


def _mark_short_lines(pages: List[List[Dict[str, Any]]]) -> None:
    """Dòng kết thúc sớm hơn hẳn mép phải của cột (các dòng cùng lề trái) → nhiều khả năng là hết đoạn."""
    for lines in pages:
        column_right: Dict[int, float] = {}
        for line in lines:
            key = round(line["left"] / 10)
            column_right[key] = max(column_right.get(key, 0.0), line["right"])
        for line in lines:
            width = column_right[round(line["left"] / 10)] - line["left"]
            line["short"] = not line.get("flat") and width > 0 and (line["right"] - line["left"]) < 0.75 * width


def _paragraph_gap_threshold(pages: List[List[Dict[str, Any]]]) -> float:
    """
    Khoảng trống (tính theo chiều cao dòng) từ đó trở lên được coi là ngắt đoạn.
    Dựa trên khoảng cách dòng phổ biến của chính tài liệu, vì mỗi sách giãn dòng khác nhau.
    """
    gaps = []
    for lines in pages:
        for previous, line in zip(lines, lines[1:]):
            height = max(line["bottom"] - line["top"], 1e-4)
            gap = (line["top"] - previous["bottom"]) / height
            if 0 <= gap < 3 and not line.get("flat"):
                gaps.append(gap)
    if not gaps:
        return 0.75
    typical = sorted(gaps)[len(gaps) // 2]
    return max(0.75, typical * 1.6, typical + 0.35)


def _build_blocks(pages: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    _mark_short_lines(pages)
    body_size, levels = _heading_levels(pages)
    paragraph_gap = _paragraph_gap_threshold(pages)
    blocks: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    previous_line: Optional[Dict[str, Any]] = None

    def flush():
        nonlocal current
        if current:
            current["text"] = current["text"].replace(_SOFT_HYPHEN_BREAK, "").strip()
            if current["text"]:
                blocks.append(current)
        current = None

    for lines in pages:
        for line in lines:
            text = line["text"]
            same_page = previous_line is not None and previous_line["page"] == line["page"]
            flat = bool(line.get("flat"))
            gap = (line["top"] - previous_line["bottom"]) if same_page and not flat else 0.0
            line_height = max(line["bottom"] - line["top"], 1e-4)
            starts_like_sentence = text[:1].isupper() or text[:1].isdigit()
            after_sentence = previous_line is not None and bool(_SENTENCE_END.search(previous_line["text"]))
            # Vùng mới: đầu trang, cách dòng trước một khoảng, nhảy lên cột kế bên, hoặc ngay sau tiêu đề
            fresh_start = (
                not same_page or gap > line_height * paragraph_gap or gap < -line_height
                or (current is not None and current["block_type"] == "heading")
                or flat and after_sentence
            )

            level = levels.get(line["size"])
            short = len(text) <= MAX_HEADING_CHARS
            if level is None and line["bold"] and short and line["size"] >= body_size \
                    and fresh_start and starts_like_sentence \
                    and not _SENTENCE_END.search(text) and not _LIST_MARKER.match(text):
                level = 3
            is_heading = level is not None and short
            is_list = not is_heading and bool(_LIST_MARKER.match(text))

            new_paragraph = (
                current is None
                or is_heading or is_list
                or current["block_type"] == "heading" and not (
                    is_heading and current["level"] == level and same_page and gap < line_height * 0.6)
                or same_page and (gap > line_height * paragraph_gap or gap < -line_height)
                or flat and after_sentence and starts_like_sentence
                or same_page and previous_line["short"] and (
                    bool(_SENTENCE_END.search(previous_line["text"])) or bool(_NUMBERED_START.match(text)))
                or not same_page and bool(_SENTENCE_END.search(current["text"].rstrip(_SOFT_HYPHEN_BREAK)))
            )

            if is_heading and current and current["block_type"] == "heading" and current["level"] == level \
                    and same_page and gap < line_height * 0.6:
                current["text"] = _join(current["text"], text)  # tiêu đề dài xuống dòng
            elif new_paragraph:
                flush()
                current = {
                    "block_type": "heading" if is_heading else "list_item" if is_list else "paragraph",
                    "level": level if is_heading else None,
                    "text": text,
                    "page_number": line["page"],
                }
            else:
                current["text"] = _join(current["text"], text)
            previous_line = line
    flush()
    return blocks


def read_pdf_text_layer(pdf_bytes: bytes) -> Tuple[List[Dict[str, Any]], int, List[int]]:
    """
    Đọc nhanh lớp văn bản của mọi trang (không OCR). Trả về (blocks, số trang, các trang không có chữ).
    Dùng để mở sách đọc được ngay; trang scan được OCR sau bằng `ocr_pdf_pages`.
    """
    empty_page_numbers: List[int] = []
    with _PDFIUM_LOCK:
        pdf = pdfium.PdfDocument(pdf_bytes)
        try:
            pages: List[List[Dict[str, Any]]] = []
            for index in range(len(pdf)):
                page = pdf[index]
                try:
                    lines = _page_lines(page, index + 1)
                    if sum(len(line["text"]) for line in lines) < MIN_TEXT_CHARS_PER_PAGE:
                        empty_page_numbers.append(index + 1)
                finally:
                    page.close()
                pages.append(lines)
        finally:
            pdf.close()

    page_count = len(pages)
    _drop_running_headers(pages)
    return _build_blocks(pages), page_count, empty_page_numbers


def ocr_pdf_pages(pdf_bytes: bytes, page_numbers: List[int], ocr: Any,
                  workers: int = 4, dpi: int = 200) -> Dict[int, List[Dict[str, Any]]]:
    """OCR các trang được chọn; trả về {số trang: [khối]}. Trang lỗi/không có chữ bị bỏ qua."""
    images: Dict[int, bytes] = {}
    with _PDFIUM_LOCK:
        pdf = pdfium.PdfDocument(pdf_bytes)
        try:
            for number in page_numbers:
                page = pdf[number - 1]
                try:
                    images[number] = _render_png(page, dpi)
                finally:
                    page.close()
        finally:
            pdf.close()
    out: Dict[int, List[Dict[str, Any]]] = {}
    for number, markdown in _run_ocr(ocr, images, workers).items():
        if markdown.strip():
            out[number] = [{**b, "page_number": number} for b in blocks_from_text(markdown)]
    return out


def extract_pdf_blocks(
    pdf_bytes: bytes,
    ocr: Optional[Any] = None,
    ocr_workers: int = 4,
    ocr_dpi: int = 200,
) -> Tuple[List[Dict[str, Any]], int, int, int]:
    """
    Trả về (blocks, số trang, số trang không có lớp văn bản, số trang đã OCR thành công).
    Trang không có lớp văn bản chỉ được OCR khi truyền `ocr` (đối tượng có `.read(png_bytes) -> str`).
    """
    blocks, page_count, empty = read_pdf_text_layer(pdf_bytes)
    ocr_ok = 0
    if empty and ocr is not None:
        done = ocr_pdf_pages(pdf_bytes, empty, ocr, ocr_workers, ocr_dpi)
        ocr_ok = len(done)
        for page_blocks in done.values():
            blocks.extend(page_blocks)
        blocks.sort(key=lambda b: b.get("page_number") or 0)  # sắp ổn định: giữ thứ tự trong trang
    return blocks, page_count, len(empty), ocr_ok


def _render_png(page, dpi: int) -> bytes:
    import io

    image = page.render(scale=dpi / 72.0).to_pil().convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _run_ocr(ocr: Any, images: Dict[int, bytes], workers: int) -> Dict[int, str]:
    """OCR song song; trang lỗi được bỏ qua (ghi log) thay vì làm hỏng cả tài liệu."""
    from concurrent.futures import ThreadPoolExecutor

    def one(item):
        page_number, png = item
        try:
            return page_number, ocr.read(png)
        except Exception as e:
            logger.warning(f"OCR failed for page {page_number}: {e}")
            return page_number, ""

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        return dict(pool.map(one, images.items()))


def pdf_has_text_layer(pdf_bytes: bytes, sample_pages: int = 8) -> bool:
    """Kiểm tra nhanh lúc upload: lấy mẫu vài trang rải đều, có trang nào có chữ không."""
    with _PDFIUM_LOCK:
        pdf = pdfium.PdfDocument(pdf_bytes)
        try:
            total = len(pdf)
            step = max(1, total // sample_pages)
            for index in range(0, total, step):
                page = pdf[index]
                textpage = page.get_textpage()
                try:
                    if len(textpage.get_text_range().strip()) >= MIN_TEXT_CHARS_PER_PAGE:
                        return True
                finally:
                    textpage.close()
                    page.close()
            return False
        finally:
            pdf.close()
