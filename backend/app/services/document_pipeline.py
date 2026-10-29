"""
Pipeline xử lý tài liệu sau khi upload. Các hàm ở đây là hàm đồng bộ: FastAPI BackgroundTasks chạy chúng
trong threadpool nên API không bị đứng trong lúc xử lý.

Thứ tự ưu tiên tốc độ cho người dùng:
1. Tách khối nội dung → lưu `document_blocks` → mở đọc/sửa được ngay.
2. Chunk + embedding (gọi theo lô, song song) → tìm kiếm ngữ nghĩa / AI Tutor.
3. Trích chủ đề, đồ thị tri thức, flashcard (các lời gọi Gemini chạy song song).
"""
import hashlib
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.uploads import DOCUMENTS_BUCKET, safe_filename, storage_path_from
from app.services.ai_engine import AIEngine
from app.services.doc_ingest import blocks_from_text, blocks_to_text, extract_blocks
from app.services.doc_ingest.ocr import get_ocr_provider
from app.services.doc_ingest.pdf_extractor import ocr_pdf_pages, read_pdf_text_layer
from app.services.rag_engine import RAGEngine

logger = logging.getLogger(__name__)

BLOCK_INSERT_BATCH = 500
CHUNK_INSERT_BATCH = 50
FLASHCARDS_PER_TOPIC = 4
AI_WORKERS = 6


def _batched(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _set_status(supabase, doc_id: str, status: str) -> None:
    try:
        supabase.table("documents").update({"processing_status": status}).eq("id", doc_id).execute()
    except Exception as e:
        logger.warning(f"[{doc_id}] Could not set status {status}: {e}")


PIPELINE_STEPS = [
    "Tải lên",
    "Đọc nội dung từng trang",
    "Tách chương và bài đọc",
    "Lập chỉ mục cho Trợ lý AI",
    "Tạo chủ đề, bài học và flashcard",
]


def _set_step(supabase, doc_id: str, step: int, detail: Optional[str] = None) -> None:
    """Ghi bước đang chạy (1..5) để giao diện hiển thị tiến độ. Lỗi (vd. chưa chạy migration v9) chỉ ghi log."""
    try:
        supabase.table("documents").update(
            {"processing_step": step, "processing_detail": detail}
        ).eq("id", doc_id).execute()
    except Exception as e:
        logger.debug(f"[{doc_id}] Could not set step {step}: {e}")


# ------------------------------------------------------------
# Tiến độ theo trang, nhịp tim và việc dở (migration v14)
# ------------------------------------------------------------

HEARTBEAT_SECONDS = 30
# Quá ngần này không thấy nhịp tim thì coi như việc xử lý đã bị bỏ dở (server tắt/khởi động lại giữa chừng)
STALE_SECONDS = 120
# DB chưa chạy migration v14 (không có cột nhịp tim): chỉ dựa vào giờ tạo, chờ lâu hơn cho chắc
STALE_SECONDS_WITHOUT_HEARTBEAT = 15 * 60
MAX_RESUMES = 3

# Tài liệu đang được xử lý trong tiến trình này: vòng quét chạy tiếp và nút "Xử lý lại" không đụng vào
_running: set = set()
_running_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_progress(supabase, doc_id: str, **fields: Any) -> None:
    """Ghi tiến độ chi tiết kèm nhịp tim. DB thiếu cột (chưa chạy migration v14) thì chỉ ghi log."""
    try:
        supabase.table("documents").update({**fields, "processing_heartbeat": _now_iso()}).eq("id", doc_id).execute()
    except Exception as e:
        logger.debug(f"[{doc_id}] Could not set progress {fields}: {e}")


def _fail(supabase, doc_id: str, message: Optional[str] = None) -> None:
    _set_status(supabase, doc_id, "failed")
    if message:
        _set_progress(supabase, doc_id, ingest_error=message)


def is_running_here(doc_id: str) -> bool:
    with _running_lock:
        return doc_id in _running


class _Job:
    """Đánh dấu tài liệu đang xử lý trong tiến trình này và gửi nhịp tim định kỳ cho tới khi xong."""

    def __init__(self, supabase, doc_id: str):
        self.supabase, self.doc_id = supabase, doc_id
        self._stop = threading.Event()

    def __enter__(self):
        with _running_lock:
            _running.add(self.doc_id)
        _set_progress(self.supabase, self.doc_id)
        threading.Thread(target=self._beat, name=f"heartbeat-{self.doc_id[:8]}", daemon=True).start()
        return self

    def _beat(self) -> None:
        while not self._stop.wait(HEARTBEAT_SECONDS):
            _set_progress(self.supabase, self.doc_id)

    def __exit__(self, *exc) -> bool:
        self._stop.set()
        with _running_lock:
            _running.discard(self.doc_id)
        return False


def _parse_time(value: Any) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_stalled(document: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    """
    Tài liệu đang chờ/đang xử lý mà không còn tiến trình nào làm: không chạy ở tiến trình này và quá
    STALE_SECONDS không có nhịp tim. Dòng không có cột nhịp tim (chưa chạy migration v14) thì dựa vào giờ tạo.
    """
    if document.get("processing_status") not in ("pending", "processing") or is_running_here(document["id"]):
        return False
    now = now or datetime.now(timezone.utc)
    has_column = "processing_heartbeat" in document
    last = _parse_time(document.get("processing_heartbeat")) or _parse_time(document.get("created_at"))
    if last is None:
        return True
    limit = STALE_SECONDS if has_column else STALE_SECONDS_WITHOUT_HEARTBEAT
    return (now - last).total_seconds() > limit


def _insert_rows(supabase, table: str, rows: List[Dict[str, Any]], doc_id: str) -> None:
    """Ghi theo lô; lô lỗi (vd. trùng khoá) thì ghi lại từng dòng để không mất các dòng hợp lệ."""
    if not rows:
        return
    try:
        supabase.table(table).insert(rows).execute()
    except Exception:
        for row in rows:
            try:
                supabase.table(table).insert(row).execute()
            except Exception as e:
                logger.debug(f"[{doc_id}] Skip {table} row: {e}")


# ------------------------------------------------------------
# Khối nội dung (ebook)
# ------------------------------------------------------------

def save_blocks(supabase, doc_id: str, blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Lưu khối nội dung; trả về các dòng đã lưu (có id) theo thứ tự đọc."""
    now = datetime.now(timezone.utc).isoformat()
    per_page: Dict[int, int] = {}

    def order_of(i: int, block: Dict[str, Any]) -> float:
        # Khối có số trang: trang*1000 + thứ tự trong trang, để trang OCR lưu sau vẫn nằm đúng chỗ
        page = block.get("page_number")
        if page:
            k = per_page.get(page, 0)
            per_page[page] = k + 1
            return float(page * 1000 + min(k, 999))
        return float(i)

    rows = [{
        "id": str(uuid.uuid4()),
        "document_id": doc_id,
        "order_index": order_of(i, block),
        "page_number": block.get("page_number"),
        "block_type": block["block_type"],
        "level": block.get("level"),
        "text": block["text"],
        "original_text": block["text"],
        "is_edited": False,
        "created_at": now,
        "updated_at": now,
    } for i, block in enumerate(blocks, start=1)]
    for batch in _batched(rows, BLOCK_INSERT_BATCH):
        supabase.table("document_blocks").insert(batch).execute()
    return rows


def ensure_blocks(supabase, document: Dict[str, Any]) -> int:
    """
    Tài liệu upload trước khi có trình đọc chưa có khối nội dung: dựng lại từ tệp gốc trong kho,
    nếu không có thì từ raw_content, cuối cùng là từ các chunk đã lưu. Trả về số khối đã tạo.
    """
    doc_id = document["id"]
    blocks: List[Dict[str, Any]] = []

    path = storage_path_from(document.get("file_path"))
    kind = "docx" if (path or "").lower().endswith(".docx") else "pdf" if (path or "").lower().endswith(".pdf") else None
    if path and kind:
        try:
            file_bytes = supabase.storage.from_(DOCUMENTS_BUCKET).download(path)
            blocks = extract_blocks(file_bytes, kind).blocks
        except Exception as e:
            logger.info(f"[{doc_id}] Cannot rebuild blocks from stored file: {e}")

    if not blocks and document.get("raw_content"):
        blocks = blocks_from_text(document["raw_content"])

    if not blocks:
        chunks = supabase.table("document_chunks").select("chunk_index, content") \
            .eq("document_id", doc_id).order("chunk_index").limit(1000).execute().data or []
        blocks = [{"block_type": "paragraph", "level": None, "text": c["content"], "page_number": None}
                  for c in chunks if c.get("content")]

    return len(save_blocks(supabase, doc_id, blocks)) if blocks else 0


# ------------------------------------------------------------
# Lập chỉ mục AI: chunk, embedding, chủ đề, flashcard
# ------------------------------------------------------------

def _chunk_row(doc_id: str, chunk: Dict[str, Any], embedding: List[float], total: int) -> Dict[str, Any]:
    return {
        "document_id": doc_id,
        "chunk_index": chunk["chunk_index"],
        "content": chunk["content"],
        "embedding": embedding,
        "metadata": {
            "chunk_index": chunk["chunk_index"],
            "total_chunks": total,
            "block_ids": chunk.get("block_ids", []),
            "page_start": chunk.get("page_start"),
            "page_end": chunk.get("page_end"),
            "heading_path": chunk.get("heading_path", []),
            "content_hash": chunk["content_hash"],
        },
    }


def _save_topics(supabase, doc_id: str, user_id: str, extracted: Dict[str, Any]):
    """Lưu chủ đề, quan hệ giữa chủ đề và trạng thái kiến thức ban đầu. Trả về (topics, topic_ids)."""
    topics = extracted.get("topics", [])
    topic_ids = [str(uuid.uuid4()) for _ in topics]
    _insert_rows(supabase, "topics", [{
        "id": topic_id,
        "document_id": doc_id,
        "name": topic.get("name", ""),
        # slug duy nhất nhờ hậu tố doc_id
        "slug": f"{topic.get('slug', '')[:50]}-{doc_id[:8]}",
        "description": topic.get("description", ""),
        "difficulty_level": topic.get("difficulty_level", 1),
    } for topic_id, topic in zip(topic_ids, topics)], doc_id)

    _insert_rows(supabase, "topic_relationships", [{
        "source_topic_id": topic_ids[rel.get("source_index", 0)],
        "target_topic_id": topic_ids[rel.get("target_index", 1)],
        "relationship_type": rel.get("relationship_type", "prerequisite"),
        "weight": rel.get("weight", 1.0),
    } for rel in extracted.get("relationships", [])
        if rel.get("source_index", 0) < len(topic_ids) and rel.get("target_index", 1) < len(topic_ids)], doc_id)

    _insert_rows(supabase, "knowledge_states", [{
        "user_id": user_id,
        "topic_id": topic_id,
        "mastery_score": 0.0,
        "confidence_score": 0.5,
        "retention_score": 1.0,
        "stability": 1.0,
        "difficulty_rating": 5.0,
    } for topic_id in topic_ids], doc_id)
    return topics, topic_ids


def _save_flashcards(pool: ThreadPoolExecutor, supabase, doc_id: str, user_id: str,
                     topics: List[Dict[str, Any]], topic_ids: List[str], chunks: List[str]) -> int:
    """Flashcard: mỗi chủ đề một lời gọi Gemini, chạy song song. Trả về số thẻ đã tạo."""
    def cards_for(topic: Dict[str, Any]) -> List[Dict[str, Any]]:
        name = topic.get("name", "")
        context = [c for c in chunks if name and name.lower() in c.lower()] or chunks[:6]
        try:
            return AIEngine.generate_flashcards(topic_name=name, rag_context=context[:5],
                                                count=FLASHCARDS_PER_TOPIC)
        except Exception as e:
            logger.warning(f"[{doc_id}] Flashcard generation failed for '{name}': {e}")
            return []

    now = datetime.now(timezone.utc).isoformat()
    flashcards, states = [], []
    for topic_id, cards in zip(topic_ids, pool.map(cards_for, topics)):
        for card in cards:
            card_id = str(uuid.uuid4())
            flashcards.append({
                "id": card_id,
                "topic_id": topic_id,
                "document_id": doc_id,
                "front": card.get("front", ""),
                "back": card.get("back", ""),
                "source_chunk": (card.get("source_chunk") or "")[:500],
                "card_type": card.get("card_type", "concept"),
            })
            states.append({
                "user_id": user_id,
                "flashcard_id": card_id,
                "stability": 1.0,
                "difficulty_rating": 5.0,
                "mastery_score": 0.0,
                "next_review_at": now,
            })
    _insert_rows(supabase, "flashcards", flashcards, doc_id)
    _insert_rows(supabase, "flashcard_states", states, doc_id)
    return len(flashcards)


def index_document(doc_id: str, user_id: str, title: str, raw_content: str, supabase,
                   blocks: Optional[List[Dict[str, Any]]] = None, enrich: bool = True) -> None:
    started = time.perf_counter()
    try:
        _set_status(supabase, doc_id, "processing")
        _set_step(supabase, doc_id, 4)
        if blocks:
            chunk_dicts = RAGEngine.chunk_blocks(blocks)
        else:  # tài liệu không có khối: chunk theo văn bản thuần
            chunk_dicts = [
                {"chunk_index": i, "content": c, "content_hash": hashlib.sha1(c.encode("utf-8")).hexdigest()}
                for i, c in enumerate(RAGEngine.chunk_text(raw_content))
            ]
        chunks = [c["content"] for c in chunk_dicts]

        with ThreadPoolExecutor(max_workers=AI_WORKERS) as pool:
            # Trích chủ đề chạy song song với embedding
            topics_future = pool.submit(AIEngine.extract_topics_and_graph, raw_content, title) if enrich else None

            embeddings = RAGEngine.generate_embeddings(chunks)
            chunk_records = [_chunk_row(doc_id, chunk, embedding, len(chunk_dicts))
                             for chunk, embedding in zip(chunk_dicts, embeddings)]
            for batch in _batched(chunk_records, CHUNK_INSERT_BATCH):
                supabase.table("document_chunks").insert(batch).execute()
            embedded_at = time.perf_counter()

            _set_step(supabase, doc_id, 5)
            extracted = topics_future.result() if topics_future else {}
            topics, topic_ids = _save_topics(supabase, doc_id, user_id, extracted)
            card_count = _save_flashcards(pool, supabase, doc_id, user_id, topics, topic_ids, chunks)

        _set_status(supabase, doc_id, "completed")
        _set_step(supabase, doc_id, len(PIPELINE_STEPS) + 1)
        logger.info(
            f"[{doc_id}] Indexed: {len(chunks)} chunks in {embedded_at - started:.1f}s, "
            f"{len(topics)} topics + {card_count} flashcards in {time.perf_counter() - embedded_at:.1f}s"
        )
    except Exception as e:
        logger.error(f"[{doc_id}] Indexing FAILED: {e}", exc_info=True)
        _fail(supabase, doc_id, "Lập chỉ mục AI bị lỗi. Bấm \"Xử lý lại\" để thử lại.")


# ------------------------------------------------------------
# Điểm vào của background task
# ------------------------------------------------------------

def _store_original(supabase, doc_id: str, storage_path: str, file_bytes: bytes, content_type: str) -> None:
    try:
        try:
            supabase.storage.create_bucket(DOCUMENTS_BUCKET, options={"public": False})
        except Exception:
            try:
                supabase.storage.update_bucket(DOCUMENTS_BUCKET, {"public": False})
            except Exception as e:
                logger.warning(f"Could not enforce private '{DOCUMENTS_BUCKET}' bucket: {e}")
        supabase.storage.from_(DOCUMENTS_BUCKET).upload(
            path=storage_path, file=file_bytes,
            file_options={"content-type": content_type, "x-upsert": "true"},
        )
    except Exception as e:
        logger.warning(f"[{doc_id}] Storage upload warning: {e}")


CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}



OCR_BATCH_PAGES = 6


def _extract_pdf_progressively(supabase, doc_id: str, file_bytes: bytes, ocr,
                               skip_pages: frozenset = frozenset()) -> List[Dict[str, Any]]:
    """
    PDF: lưu ngay các trang có lớp văn bản (sách mở đọc được ngay), rồi OCR các trang scan theo lô
    và lưu dần. `processing_detail` và `pages_done` báo tiến độ để giao diện hiển thị.
    `skip_pages`: trang đã có khối từ lần chạy trước (khi chạy tiếp) thì không đọc lại, tránh nhân đôi.
    Trả về các khối mới lưu ở lần chạy này.
    """
    blocks, page_count, empty = read_pdf_text_layer(file_bytes)
    saved: List[Dict[str, Any]] = []
    fresh = [b for b in blocks if b.get("page_number") not in skip_pages]
    if fresh:
        saved += save_blocks(supabase, doc_id, fresh)
    todo = [p for p in empty if p not in skip_pages]
    pages_done = page_count - len(todo)
    ocr_done = len(empty) - len(todo)
    _set_step(supabase, doc_id, 3, f"{pages_done}/{page_count} trang đã đọc xong")
    _set_progress(supabase, doc_id, page_count=page_count, pages_done=pages_done, ocr_page_count=len(empty))
    if todo and ocr is not None:
        for i in range(0, len(todo), OCR_BATCH_PAGES):
            batch = todo[i:i + OCR_BATCH_PAGES]
            _set_step(supabase, doc_id, 2, f"Đang nhận dạng chữ trang scan: {ocr_done}/{len(empty)}")
            try:
                got = ocr_pdf_pages(file_bytes, batch, ocr)
            except Exception as e:
                logger.warning(f"[{doc_id}] OCR batch {batch[0]}-{batch[-1]} failed: {e}")
                got = {}
            page_blocks = [b for page in sorted(got) for b in got[page]]
            if page_blocks:
                saved += save_blocks(supabase, doc_id, page_blocks)
            ocr_done += len(batch)
            pages_done += len(batch)
            _set_progress(supabase, doc_id, pages_done=pages_done)
        _set_step(supabase, doc_id, 3, f"{pages_done}/{page_count} trang đã đọc xong")
    saved.sort(key=lambda r: r["order_index"])  # trang OCR đến sau phải về đúng vị trí khi chunk/index
    return saved


def process_uploaded_file(doc_id: str, user_id: str, title: str, filename: str,
                          file_bytes: bytes, kind: str, supabase, enrich: bool = True) -> None:
    """PDF/DOCX: tách khối (đọc được ngay) → lưu tệp gốc (song song) → lập chỉ mục AI."""
    started = time.perf_counter()
    storage_path = f"{user_id}/{doc_id}/{safe_filename(filename)}"
    with _Job(supabase, doc_id):
        try:
            _set_status(supabase, doc_id, "processing")
            _set_step(supabase, doc_id, 2)
            _set_progress(supabase, doc_id, resume_count=0, ingest_error=None, pages_done=0)
            with ThreadPoolExecutor(max_workers=1) as pool:
                upload_future = pool.submit(_store_original, supabase, doc_id, storage_path, file_bytes,
                                            CONTENT_TYPES[kind])
                if kind == "pdf":
                    saved_blocks = _extract_pdf_progressively(supabase, doc_id, file_bytes,
                                                              get_ocr_provider())
                else:
                    result = extract_blocks(file_bytes, kind)
                    _set_step(supabase, doc_id, 3)
                    saved_blocks = save_blocks(supabase, doc_id, result.blocks)
                upload_future.result()
                logger.info(f"[{doc_id}] Readable: {len(saved_blocks)} blocks in {time.perf_counter() - started:.2f}s")

            raw_text = blocks_to_text(saved_blocks)
            if len(raw_text) < 50:
                logger.error(f"[{doc_id}] No extractable text (scanned document?)")
                _set_step(supabase, doc_id, 2, "Không đọc được chữ — có thể là bản scan mờ")
                _fail(supabase, doc_id, "Không đọc được chữ trong tệp, có thể là bản scan mờ.")
                return
        except Exception as e:
            logger.error(f"[{doc_id}] File processing FAILED: {e}", exc_info=True)
            _fail(supabase, doc_id, "Không đọc được tệp này. Bấm \"Xử lý lại\" để thử lại.")
            return

        index_document(doc_id, user_id, title, raw_text, supabase, blocks=saved_blocks, enrich=enrich)


def process_text_document(doc_id: str, user_id: str, title: str, raw_content: str, supabase) -> None:
    with _Job(supabase, doc_id):
        saved_blocks: List[Dict[str, Any]] = []
        try:
            saved_blocks = save_blocks(supabase, doc_id, blocks_from_text(raw_content))
        except Exception as e:
            logger.warning(f"[{doc_id}] Could not save blocks for text document: {e}")
        index_document(doc_id, user_id, title, raw_content, supabase, blocks=saved_blocks)


# ------------------------------------------------------------
# Chạy tiếp tài liệu bị bỏ dở (server tắt/khởi động lại giữa lúc xử lý)
# ------------------------------------------------------------

# Một luồng: chạy tiếp lần lượt từng tài liệu, không tranh tài nguyên với việc upload mới
_resume_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="resume")

_STALL_FIELDS = "id, processing_status, created_at"


def find_stalled(supabase, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Các tài liệu đang chờ/đang xử lý mà không còn tiến trình nào làm."""
    query = lambda fields: supabase.table("documents").select(fields) \
        .in_("processing_status", ["pending", "processing"]).execute().data or []
    try:
        rows = query(_STALL_FIELDS + ", processing_heartbeat, resume_count")
    except Exception:  # chưa chạy migration v14
        rows = query(_STALL_FIELDS)
    return [row for row in rows if is_stalled(row, now)]


def resume_document(supabase, document: Dict[str, Any]) -> None:
    """
    Chạy tiếp một tài liệu bị bỏ dở mà không làm lại phần đã xong:
    - PDF chỉ đọc (và OCR) các trang chưa có khối; DOCX/văn bản chỉ tách lại khi chưa có khối nào;
    - chỉ mục vector dùng lại chunk đã có (chỉ embedding chunk còn thiếu);
    - chủ đề và flashcard chỉ tạo khi chưa có.
    """
    doc_id = document["id"]
    user_id = str(document.get("user_id") or "")
    title = document.get("title") or ""
    with _Job(supabase, doc_id):
        try:
            _set_status(supabase, doc_id, "processing")
            existing = load_all_blocks(supabase, doc_id)
            path = storage_path_from(document.get("file_path"))
            lower = (path or "").lower()
            kind = "pdf" if lower.endswith(".pdf") else "docx" if lower.endswith(".docx") else None
            if kind:
                _set_step(supabase, doc_id, 2, "Đang chạy tiếp sau khi máy chủ khởi động lại")
                try:
                    file_bytes = supabase.storage.from_(DOCUMENTS_BUCKET).download(path)
                except Exception as e:
                    logger.warning(f"[{doc_id}] Resume: original file missing: {e}")
                    _set_step(supabase, doc_id, 1, "Chưa lưu xong tệp gốc")
                    _fail(supabase, doc_id, "Máy chủ khởi động lại trước khi lưu xong tệp gốc. Hãy tải tệp lên lại.")
                    return
                if kind == "pdf":
                    done_pages = frozenset(b["page_number"] for b in existing if b.get("page_number"))
                    _extract_pdf_progressively(supabase, doc_id, file_bytes, get_ocr_provider(), skip_pages=done_pages)
                elif not existing:
                    _set_step(supabase, doc_id, 3)
                    save_blocks(supabase, doc_id, extract_blocks(file_bytes, kind).blocks)
            elif not existing and document.get("raw_content"):
                save_blocks(supabase, doc_id, blocks_from_text(document["raw_content"]))

            blocks = load_all_blocks(supabase, doc_id)
            raw_text = blocks_to_text(blocks) or (document.get("raw_content") or "")
            if len(raw_text) < 50:
                _set_step(supabase, doc_id, 2, "Không đọc được chữ — có thể là bản scan mờ")
                _fail(supabase, doc_id, "Không đọc được chữ trong tệp, có thể là bản scan mờ.")
                return

            _set_step(supabase, doc_id, 4)
            stats = reindex_document(supabase, doc_id)
            _set_step(supabase, doc_id, 5)
            topics = supabase.table("topics").select("id, name").eq("document_id", doc_id).execute().data or []
            has_cards = bool(supabase.table("flashcards").select("id").eq("document_id", doc_id).limit(1).execute().data)
            if not topics or not has_cards:
                chunks = [c["content"] for c in RAGEngine.chunk_blocks(blocks)]
                with ThreadPoolExecutor(max_workers=AI_WORKERS) as pool:
                    if topics:
                        topic_ids = [t["id"] for t in topics]
                    else:
                        topics, topic_ids = _save_topics(supabase, doc_id, user_id,
                                                         AIEngine.extract_topics_and_graph(raw_text, title))
                    _save_flashcards(pool, supabase, doc_id, user_id, topics, topic_ids, chunks)

            _set_status(supabase, doc_id, "completed")
            _set_step(supabase, doc_id, len(PIPELINE_STEPS) + 1)
            _set_progress(supabase, doc_id, ingest_error=None)
            logger.info(f"[{doc_id}] Resumed and completed: {len(blocks)} blocks, index {stats}")
        except Exception as e:
            logger.error(f"[{doc_id}] Resume FAILED: {e}", exc_info=True)
            _fail(supabase, doc_id, "Không chạy tiếp được. Bấm \"Xử lý lại\" để thử lại.")


def _resume_safely(supabase, doc_id: str) -> None:
    try:
        rows = supabase.table("documents").select("*").eq("id", doc_id).execute().data or []
        if rows and rows[0].get("processing_status") in ("pending", "processing"):
            resume_document(supabase, rows[0])
    except Exception as e:
        logger.error(f"[{doc_id}] Resume crashed: {e}", exc_info=True)
    finally:
        with _running_lock:
            _running.discard(doc_id)


def resume_stalled(supabase, run=None) -> List[str]:
    """
    Tìm tài liệu bị bỏ dở và xếp hàng chạy tiếp (mặc định ở luồng nền riêng; `run` để test chạy đồng bộ).
    Tài liệu đã chạy tiếp MAX_RESUMES lần mà vẫn dở thì dừng hẳn, báo lỗi để người dùng tự bấm "Xử lý lại".
    Trả về id các tài liệu đã xếp hàng.
    """
    queued: List[str] = []
    for row in find_stalled(supabase):
        doc_id = row["id"]
        tries = int(row.get("resume_count") or 0)
        if tries >= MAX_RESUMES:
            logger.warning(f"[{doc_id}] Gave up after {tries} resumes")
            _fail(supabase, doc_id, "Xử lý bị gián đoạn nhiều lần. Bấm \"Xử lý lại\" để làm lại từ đầu.")
            continue
        with _running_lock:
            if doc_id in _running:
                continue
            _running.add(doc_id)  # giữ chỗ để vòng quét sau không xếp hàng trùng
        # Ghi lượt chạy tiếp và nhịp tim trước khi chạy: tiến trình khác (nếu có) thấy tài liệu không còn "bỏ dở"
        _set_progress(supabase, doc_id, resume_count=tries + 1)
        logger.info(f"[{doc_id}] Resuming stalled document (attempt {tries + 1})")
        (run or _resume_pool.submit)(_resume_safely, supabase, doc_id)
        queued.append(doc_id)
    return queued


# ------------------------------------------------------------
# Lập chỉ mục lại sau khi sửa nội dung (tăng dần)
# ------------------------------------------------------------

def load_all_blocks(supabase, doc_id: str) -> List[Dict[str, Any]]:
    """Toàn bộ khối của tài liệu theo thứ tự đọc (đọc theo lô để không vướng giới hạn dòng mỗi lần)."""
    blocks: List[Dict[str, Any]] = []
    after = -1e18
    while True:
        page = supabase.table("document_blocks").select("id, order_index, page_number, block_type, level, text") \
            .eq("document_id", doc_id).gt("order_index", after).order("order_index").limit(1000).execute().data or []
        blocks += page
        if len(page) < 1000:
            return blocks
        after = page[-1]["order_index"]


def _stored_chunks(supabase, doc_id: str, fields: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    start = 0
    while True:
        page = supabase.table("document_chunks").select(fields) \
            .eq("document_id", doc_id).gte("chunk_index", start).order("chunk_index").limit(1000).execute().data or []
        rows += page
        if len(page) < 1000:
            return rows
        start = page[-1]["chunk_index"] + 1


def _hash_of(row: Dict[str, Any]) -> Optional[str]:
    return (row.get("metadata") or {}).get("content_hash")


def index_status(supabase, doc_id: str) -> Dict[str, Any]:
    """So sánh nội dung hiện tại với chỉ mục đã lưu: có chunk nào cần lập lại không."""
    current = RAGEngine.chunk_blocks(load_all_blocks(supabase, doc_id))
    stored = _stored_chunks(supabase, doc_id, "id, chunk_index, metadata")
    stored_hashes = [_hash_of(r) for r in stored]
    wanted = [c["content_hash"] for c in current]
    available: Dict[str, int] = {}
    for h in stored_hashes:
        if h:
            available[h] = available.get(h, 0) + 1
    changed = 0
    for h in wanted:
        if available.get(h, 0) > 0:
            available[h] -= 1
        else:
            changed += 1
    return {
        "stale": wanted != stored_hashes,
        "chunks_total": len(wanted),
        "chunks_changed": changed,
        "chunks_stored": len(stored),
    }


def reindex_document(supabase, doc_id: str) -> Dict[str, Any]:
    """
    Cập nhật `document_chunks` theo nội dung hiện tại. Chỉ chunk có nội dung mới (content_hash mới)
    phải gọi embedding; chunk giữ nguyên nội dung dùng lại vector cũ.
    Thứ tự an toàn: chèn chunk mới trước, xoá chunk cũ sau.
    """
    wanted = RAGEngine.chunk_blocks(load_all_blocks(supabase, doc_id))
    stored = _stored_chunks(supabase, doc_id, "id, chunk_index, embedding, metadata")

    by_hash: Dict[str, List[Dict[str, Any]]] = {}
    for row in stored:
        h = _hash_of(row)
        if h:
            by_hash.setdefault(h, []).append(row)

    keep_ids = set()
    to_insert: List[Dict[str, Any]] = []
    to_embed: List[Dict[str, Any]] = []
    for chunk in wanted:
        candidates = by_hash.get(chunk["content_hash"]) or []
        reusable = candidates.pop(0) if candidates else None
        if reusable and reusable.get("chunk_index") == chunk["chunk_index"] \
                and (reusable.get("metadata") or {}).get("block_ids") == chunk.get("block_ids"):
            keep_ids.add(reusable["id"])
            continue
        if reusable and reusable.get("embedding"):
            to_insert.append(_chunk_row(doc_id, chunk, reusable["embedding"], len(wanted)))
        else:
            to_embed.append(chunk)

    if to_embed:
        vectors = RAGEngine.generate_embeddings([c["content"] for c in to_embed])
        to_insert += [_chunk_row(doc_id, c, v, len(wanted)) for c, v in zip(to_embed, vectors)]

    for batch in _batched(to_insert, CHUNK_INSERT_BATCH):
        supabase.table("document_chunks").insert(batch).execute()

    # Chunk cũ đã được thay thế (hoặc mồ côi): xoá sau khi chunk mới đã vào
    stale_ids = [r["id"] for r in stored if r["id"] not in keep_ids]
    for batch in _batched(stale_ids, 100):
        supabase.table("document_chunks").delete().in_("id", batch).execute()

    return {
        "chunks_total": len(wanted),
        "chunks_reembedded": len(to_embed),
        "chunks_rewritten": len(to_insert) - len(to_embed),
        "chunks_kept": len(keep_ids),
        "chunks_deleted": len(stale_ids),
    }
