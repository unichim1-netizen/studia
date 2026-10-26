"""Chẩn đoán tạm cho CI: in dòng lỗi pytest và kết quả tách khối PDF thành annotation để đọc được trên trang run."""
import os
import sys
import tempfile
import traceback

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "backend", "tests", "fixtures"))


NL = chr(10)


def annotate(title: str, text: str) -> None:
    text = text[:3800].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title={title}::{text}")


mode = sys.argv[1]
try:
    if mode == "pytest":
        raw = open("/tmp/pytest.txt", encoding="utf-8", errors="ignore").read().splitlines()
        lines = [x for x in raw if x.strip() and "arning" not in x]
        annotate("pytest", "\n".join(lines[-60:]))
    else:
        import make_fixtures
        from app.services.doc_ingest import extract_blocks

        d = tempfile.mkdtemp()
        make_fixtures.build_all(d)
        blocks = extract_blocks(open(os.path.join(d, "mini_ielts.pdf"), "rb").read(), "pdf")
        blocks = getattr(blocks, "blocks", blocks)
        rows = [ascii(str(b.get("text") if isinstance(b, dict) else getattr(b, "text", b))[:90]) for b in blocks]
        import pypdfium2 as pdfium
        from app.services.doc_ingest import pdf_extractor as pe

        def dump(name, needle, before, after):
            pdf = pdfium.PdfDocument(open(os.path.join(d, name), "rb").read())
            pages = [pe._page_lines(pdf[i], i + 1) for i in range(len(pdf))]
            pe._mark_short_lines(pages)
            gap = pe._paragraph_gap_threshold(pages)
            for lines in pages:
                for i, ln in enumerate(lines):
                    if needle in ln["text"]:
                        rows = []
                        for x in lines[max(0, i - before):i + after]:
                            rows.append("%s|sz%s|t%.4f|b%.4f|l%.0f|r%.0f|s%d|%s" % (
                                x["page"], x["size"], x["top"], x["bottom"], x["left"], x["right"], x["short"], ascii(x["text"][:28])))
                        annotate("geom-" + name[:4], "gapthr=%.3f" % gap + NL + NL.join(rows))
                        return
        dump("text_book.pdf", "Review Interval", 2, 4)
        dump("mini_ielts.pdf", "Questions 15", 0, 5)
except Exception:
    annotate("diag-error", traceback.format_exc()[-1500:])
