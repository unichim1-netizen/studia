"""
Chạy dựng đề từ dòng lệnh (không cần server/DB):

    python -m app.services.exam_builder.cli <sach.pdf | sach.docx | blocks.json> --out <thư mục> [--llm]

Ghi ra: segments.json, exam_test<N>.json, answer_key_test<N>.json, validation_test<N>.json,
exam_room_payload_test<N>.json, review.md
"""
import argparse
import json
import os
import sys
from typing import Any, Dict, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from app.services.exam_builder import ExamDraft, GeminiJsonLLM, build_exam_drafts
from app.services.exam_builder.schema import iter_groups, strip_answers, to_exam_room_payload
from app.services.exam_builder.segmenter import segment_blocks


def load_blocks(path: str) -> List[Dict[str, Any]]:
    lower = path.lower()
    if lower.endswith(".json"):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data["blocks"] if isinstance(data, dict) else data
    kind = "docx" if lower.endswith(".docx") else "pdf"
    from app.services.doc_ingest import extract_blocks

    with open(path, "rb") as f:
        return extract_blocks(f.read(), kind).blocks


def review_markdown(draft: ExamDraft) -> str:
    """Bản đọc bằng mắt: từng câu hỏi kèm đáp án bên cạnh, để soát nhanh."""
    out = [f"# {draft.title}", ""]
    v = draft.validation
    out += [f"- Lỗi: {len(v['errors'])} · Cảnh báo: {len(v['warnings'])} · Thống kê: {v['stats']}", ""]
    for item in v["errors"] + v["warnings"]:
        where = f"{item.get('section', '')}" + (f" Q{item['question']}" if item.get("question") else "")
        out.append(f"- **{item['severity']}** `{item['code']}` {where}: {item['message']}")
    out.append("")
    for skill in ("listening", "reading"):
        if skill not in draft.content["sections"]:
            continue
        out += [f"## {skill.title()}", ""]
        key = draft.answer_key.get(skill, {})
        for label, group in iter_groups(draft.content, skill):
            first, last = group["range"]
            out += [f"### {label} — Questions {first}–{last} ({group['type']})", "", f"_{group['instruction']}_", ""]
            if group.get("shared_options"):
                out += [f"- {o['key']}. {o['text']}" for o in group["shared_options"]] + [""]
            for q in group["questions"]:
                answer = ", ".join(key.get(str(q["number"]), {}).get("accept", [])) or "—"
                out.append(f"{q['number']}. {q['question']}  → **{answer}**")
                for o in q.get("options") or []:
                    out.append(f"    - {o['key']}. {o['text']}")
            out.append("")
    return "\n".join(out)


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(description="Dựng đề thi từ sách PDF/DOCX")
    parser.add_argument("input")
    parser.add_argument("--out", required=True)
    parser.add_argument("--llm", action="store_true", help="dùng Gemini để làm lại các nhóm câu hỏi khó")
    args = parser.parse_args(argv)

    blocks = load_blocks(args.input)
    os.makedirs(args.out, exist_ok=True)

    def dump(name: str, data: Any) -> None:
        with open(os.path.join(args.out, name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    dump("segments.json", {str(n): s.summary() for n, s in segment_blocks(blocks).items()})
    drafts = build_exam_drafts(blocks, llm=GeminiJsonLLM() if args.llm else None)
    review = []
    for draft in drafts:
        n = draft.test_number
        dump(f"exam_test{n}.json", draft.content)
        dump(f"answer_key_test{n}.json", draft.answer_key)
        dump(f"validation_test{n}.json", draft.validation)
        dump(f"exam_room_payload_test{n}.json", to_exam_room_payload(strip_answers(draft.content)))
        review.append(review_markdown(draft))
        v = draft.validation
        print(f"{draft.title}: {v['stats']} · lỗi {len(v['errors'])} · cảnh báo {len(v['warnings'])}")
    with open(os.path.join(args.out, "review.md"), "w", encoding="utf-8") as f:
        f.write("\n\n---\n\n".join(review))
    if not drafts:
        print("Không tìm thấy đề nào (cần có tiêu đề Test N và các phần LISTENING/READING...).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
