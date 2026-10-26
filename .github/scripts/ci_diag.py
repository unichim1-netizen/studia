"""Chẩn đoán tạm cho CI: in dòng lỗi pytest và kết quả tách khối PDF thành annotation để đọc được trên trang run."""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.join("backend"))
sys.path.insert(0, os.path.join("backend", "tests", "fixtures"))


def annotate(title: str, text: str) -> None:
    text = text[:3800].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title={title}::{text}")


mode = sys.argv[1]
if mode == "pytest":
    lines = [l for l in open("/tmp/pytest.txt", encoding="utf-8", errors="ignore").read().splitlines() if l.strip() and "arning" not in l]
    annotate("pytest", "\n".join(lines[-60:]))
else:
    import make_fixtures
    from app.services.doc_ingest import extract_blocks
    d = tempfile.mkdtemp()
    make_fixtures.build_all(d)
    blocks = extract_blocks(open(os.path.join(d, "mini_ielts.pdf"), "rb").read(), "pdf")
    blocks = blocks.blocks if hasattr(blocks, "blocks") else blocks
    rows = [f"{b.get("kind") or b.get("type")}|{(b.get('text') or '')[:70]}" for b in blocks]
    start = next((i for i, r in enumerate(rows) if "Space Gallery" in r), 0)
    annotate("blocks", "\n".join(rows[max(0, start - 14):start + 8]))
