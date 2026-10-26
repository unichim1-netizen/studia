"""Chẩn đoán tạm cho CI: in dòng lỗi pytest và kết quả tách khối PDF thành annotation để đọc được trên trang run."""
import os
import sys
import tempfile
import traceback

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "backend", "tests", "fixtures"))


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
        start = next((i for i, r in enumerate(rows) if "Space Gallery" in r), 0)
        annotate("blocks", "\n".join(rows[max(0, start - 6):start + 4]))
except Exception:
    annotate("diag-error", traceback.format_exc()[-1500:])
