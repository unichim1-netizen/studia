"""
Documents API v2 — Upload PDF/Text, Real Supabase Storage
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form, Response
from pydantic import BaseModel
from typing import Optional, List
from app.services.rag_engine import RAGEngine
from app.services.ai_engine import AIEngine
from app.core.supabase_client import get_supabase_client
from app.config import settings
from app.core.auth import current_user_id, forget_owned, require_owned
from app.core.accounts import current_account
from app.services import billing, sysconfig
from app.core.uploads import (
    DOCUMENTS_BUCKET, safe_filename, storage_path_from, validate_docx_bytes, validate_pdf_bytes,
)
from app.services.doc_ingest import pdf_has_text_layer
from app.services.doc_ingest.ocr import get_ocr_provider
from app.services.doc_ingest.render import render_page_png
from app.services.document_pipeline import process_text_document, process_uploaded_file
from fastapi.concurrency import run_in_threadpool
import uuid
import logging
from collections import OrderedDict

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/documents", tags=["Documents"])



class DocumentTextCreate(BaseModel):
    title: str
    source_type: str = "text"
    raw_content: str
    user_id: Optional[str] = None
    shared: bool = False  # chỉ quản lý: đưa thẳng vào thư viện chung (ẩn cho tới khi bật hiện)


@router.post("/upload")
async def upload_document_text(
    doc_in: DocumentTextCreate,
    background_tasks: BackgroundTasks
):
    """
    Upload tài liệu dạng text → khối nội dung + Chunk + Embed + Knowledge Graph.
    Processing chạy background, trả về ngay document_id.
    """
    user_id = current_user_id()
    doc_id = str(uuid.uuid4())

    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    visibility = _upload_visibility(doc_in.shared)
    ledger_id = await run_in_threadpool(billing.consume_upload_credit, user_id, doc_in.title)
    try:
        supabase.table("documents").insert({
            "id": doc_id,
            "user_id": user_id,
            "title": doc_in.title,
            "source_type": doc_in.source_type,
            "raw_content": doc_in.raw_content,
            "processing_status": "pending",
            "visibility": visibility,
        }).execute()
    except Exception:
        billing.refund_upload(ledger_id)
        raise
    billing.attach_document(ledger_id, doc_id)

    # Hàm đồng bộ → BackgroundTasks chạy trong threadpool, không chặn event loop
    background_tasks.add_task(
        process_text_document,
        doc_id=doc_id,
        user_id=user_id,
        title=doc_in.title,
        raw_content=doc_in.raw_content,
        supabase=supabase
    )

    return {
        "status": "processing",
        "document_id": doc_id,
        "title": doc_in.title,
        "message": "Tài liệu đang được xử lý. Kiểm tra lại sau vài giây.",
        "estimated_seconds": max(5, len(doc_in.raw_content) // 500)
    }


def _upload_visibility(shared: bool) -> str:
    """Quản lý có thể tải thẳng vào thư viện chung (ở trạng thái ẩn); học sinh luôn là sách riêng."""
    is_admin = current_account().get("role") == "admin"
    if shared:
        if not is_admin:
            raise HTTPException(status_code=403, detail="Chỉ quản lý mới thêm sách vào thư viện chung")
        return "shared_draft"
    if not is_admin and not sysconfig.feature_enabled("upload"):
        raise HTTPException(status_code=403, detail="Quản lý đang tạm tắt việc tải sách lên. Bạn vẫn đọc được Thư viện Studia.")
    return "private"


def _validate_upload(kind: str, file_bytes: bytes) -> None:
    if kind == "docx":
        validate_docx_bytes(file_bytes)
        return
    validate_pdf_bytes(file_bytes)
    if not pdf_has_text_layer(file_bytes) and get_ocr_provider() is None:
        raise HTTPException(
            status_code=422,
            detail="PDF này là bản scan (chỉ có ảnh, không có lớp văn bản) và OCR chưa được cấu hình "
                   "(cần GEMINI_API_KEY hợp lệ).",
        )


@router.post("/upload-file")
@router.post("/upload-pdf")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    shared: bool = Form(False),
):
    """
    Upload PDF hoặc DOCX — kiểm tra tệp rồi trả về ngay.
    Tách nội dung (mở đọc được sau vài giây), lưu tệp gốc, embedding và Knowledge Graph chạy nền.
    """
    name = (file.filename or "").lower()
    kind = "pdf" if name.endswith(".pdf") else "docx" if name.endswith(".docx") else None
    if not kind:
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận tệp .pdf hoặc .docx")

    # Đọc tối đa giới hạn + 1 byte để phát hiện tệp quá lớn mà không nạp hết vào RAM
    file_bytes = await file.read(sysconfig.limit("MAX_PDF_MB") * 1024 * 1024 + 1)
    await run_in_threadpool(_validate_upload, kind, file_bytes)
    filename = safe_filename(file.filename, default=f"document.{kind}")

    user_id = current_user_id()
    doc_id = str(uuid.uuid4())
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    visibility = _upload_visibility(shared)
    # Trừ lượt sau khi tệp đã hợp lệ: tệp bị từ chối không tốn lượt
    ledger_id = await run_in_threadpool(billing.consume_upload_credit, user_id, title)
    try:
        supabase.table("documents").insert({
            "id": doc_id,
            "user_id": user_id,
            "title": title,
            # Ràng buộc CHECK của cột source_type chưa có 'docx' → DOCX lưu là 'text', phân biệt bằng đuôi file_path
            "source_type": "pdf" if kind == "pdf" else "text",
            "file_path": f"{user_id}/{doc_id}/{filename}",
            "raw_content": None,
            "processing_status": "pending",
            "visibility": visibility,
        }).execute()
    except Exception:
        billing.refund_upload(ledger_id)
        raise
    billing.attach_document(ledger_id, doc_id)

    background_tasks.add_task(
        process_uploaded_file,
        doc_id=doc_id,
        user_id=user_id,
        title=title,
        filename=filename,
        file_bytes=file_bytes,
        kind=kind,
        supabase=supabase
    )

    return {
        "status": "pending",
        "document_id": doc_id,
        "title": title,
        "filename": filename,
        "kind": kind,
        "message": "Upload thành công! Nội dung sẽ mở đọc được sau vài giây; phân tích AI tiếp tục chạy nền."
    }


@router.get("/{document_id}/status")
async def get_document_status(document_id: str):
    """Kiểm tra trạng thái xử lý document."""
    require_owned("documents", document_id)
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    resp = supabase.table("documents").select("*").eq("id", document_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Document không tồn tại")

    doc = resp.data[0]
    # Chỉ trả các trường giao diện cần, kèm danh sách bước xử lý
    from app.services.document_pipeline import PIPELINE_STEPS, is_running_here, is_stalled
    stalled = is_stalled(doc)
    resumed = int(doc.get("resume_count") or 0) > 0 and is_running_here(document_id)
    doc = {k: doc.get(k) for k in ("id", "title", "source_type", "file_path", "processing_status",
                                    "created_at", "processing_step", "processing_detail",
                                    "page_count", "pages_done", "ocr_page_count", "ingest_error", "resume_count")}
    doc["steps"] = PIPELINE_STEPS
    # stalled: không còn tiến trình nào xử lý (server vừa tắt) → backend sẽ tự chạy tiếp trong ít phút
    doc["stalled"] = stalled
    doc["resuming"] = resumed

    # Có khối nội dung là mở trình đọc được, không cần chờ phân tích AI xong
    try:
        block_resp = supabase.table("document_blocks").select("id").eq("document_id", document_id).limit(1).execute()
        doc["readable"] = bool(block_resp.data)
        count_resp = supabase.table("document_blocks").select("id", count="exact").eq("document_id", document_id).execute()
        doc["block_count"] = count_resp.count or 0
    except Exception:
        doc["readable"] = False
        doc["block_count"] = 0

    # Đếm chunks và topics đã xử lý
    chunk_count = 0
    topic_count = 0
    if doc["processing_status"] in ("processing", "completed"):
        chunk_resp = supabase.table("document_chunks").select("id", count="exact").eq("document_id", document_id).execute()
        chunk_count = chunk_resp.count or 0
        topic_resp = supabase.table("topics").select("id", count="exact").eq("document_id", document_id).execute()
        topic_count = topic_resp.count or 0

    return {
        **doc,
        "chunk_count": chunk_count,
        "topic_count": topic_count
    }


@router.get("/{document_id}/file-url")
async def get_document_file_url(document_id: str):
    """Signed URL ngắn hạn để mở tệp PDF gốc (bucket riêng tư)."""
    require_owned("documents", document_id)
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    resp = supabase.table("documents").select("file_path").eq("id", document_id).execute()
    storage_path = storage_path_from(resp.data[0].get("file_path")) if resp.data else None
    if not storage_path:
        raise HTTPException(status_code=404, detail="Tài liệu không có tệp gốc")

    try:
        signed = supabase.storage.from_(DOCUMENTS_BUCKET).create_signed_url(
            storage_path, settings.SIGNED_URL_TTL_SECONDS
        )
        url = signed.get("signedURL") or signed.get("signedUrl")
    except Exception as e:
        logger.warning(f"[{document_id}] Signed URL error: {e}")
        url = None
    if not url:
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp gốc trong kho lưu trữ")

    return {"url": url, "expires_in": settings.SIGNED_URL_TTL_SECONDS}


_PAGE_IMAGE_CACHE: "OrderedDict[tuple, bytes]" = OrderedDict()
_PAGE_IMAGE_CACHE_SIZE = 24


@router.get("/{document_id}/pages/{page_number}/image")
def get_page_image(document_id: str, page_number: int, scale: float = 1.5):
    """Ảnh PNG của một trang trong PDF gốc, để đối chiếu với nội dung đã tách (đặc biệt khi OCR)."""
    require_owned("documents", document_id)
    scale = min(max(scale, 0.5), 3.0)
    key = (document_id, page_number, round(scale, 2))
    cached = _PAGE_IMAGE_CACHE.get(key)
    if cached is None:
        supabase = get_supabase_client()
        rows = supabase.table("documents").select("file_path").eq("id", document_id).execute().data
        path = storage_path_from(rows[0].get("file_path")) if rows else None
        if not path or not path.lower().endswith(".pdf"):
            raise HTTPException(status_code=404, detail="Tài liệu không có tệp PDF gốc")
        try:
            pdf_bytes = supabase.storage.from_(DOCUMENTS_BUCKET).download(path)
        except Exception as e:
            logger.warning(f"[{document_id}] Cannot download original for page image: {e}")
            raise HTTPException(status_code=404, detail="Không tìm thấy tệp gốc trong kho lưu trữ")
        cached = render_page_png(pdf_bytes, page_number, scale=scale)
        if cached is None:
            raise HTTPException(status_code=404, detail="Trang không tồn tại")
        _PAGE_IMAGE_CACHE[key] = cached
        while len(_PAGE_IMAGE_CACHE) > _PAGE_IMAGE_CACHE_SIZE:
            _PAGE_IMAGE_CACHE.popitem(last=False)
    return Response(content=cached, media_type="image/png", headers={"Cache-Control": "private, max-age=600"})


@router.post("/{document_id}/reprocess")
def reprocess_document(document_id: str, background_tasks: BackgroundTasks, discard_edits: bool = False):
    """
    Xử lý lại tài liệu từ tệp gốc (tài liệu lỗi, hoặc muốn tách lại sau khi nâng cấp bộ tách).
    Khối nội dung và chỉ mục vector được dựng lại; chủ đề/flashcard đã có được giữ nguyên.
    Nếu đã có đoạn bạn tự sửa thì phải truyền `discard_edits=true` (các chỉnh sửa, highlight sẽ mất).
    """
    require_owned("documents", document_id, write=True)
    supabase = get_supabase_client()
    rows = supabase.table("documents").select("*").eq("id", document_id).execute().data
    document = rows[0]
    path = storage_path_from(document.get("file_path"))
    lower = (path or "").lower()
    kind = "pdf" if lower.endswith(".pdf") else "docx" if lower.endswith(".docx") else None
    if not path or not kind:
        raise HTTPException(status_code=409, detail="Tài liệu này không có tệp gốc để xử lý lại (tạo từ văn bản dán).")
    # Đang có tiến trình xử lý (nhịp tim còn mới) thì chờ; bị bỏ dở (server tắt giữa chừng) thì cho xử lý lại ngay
    from app.services.document_pipeline import is_stalled
    if document.get("processing_status") in ("pending", "processing") and not is_stalled(document):
        raise HTTPException(status_code=409, detail="Tài liệu đang được xử lý, vui lòng chờ.")

    edited = supabase.table("document_blocks").select("id").eq("document_id", document_id) \
        .eq("is_edited", True).limit(1).execute().data
    if edited and not discard_edits:
        raise HTTPException(status_code=409, detail={
            "message": "Tài liệu có đoạn đã chỉnh sửa. Xử lý lại sẽ mất các chỉnh sửa và highlight.",
            "requires": "discard_edits",
        })
    try:
        file_bytes = supabase.storage.from_(DOCUMENTS_BUCKET).download(path)
    except Exception:
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp gốc trong kho lưu trữ")

    had_topics = bool(supabase.table("topics").select("id").eq("document_id", document_id).limit(1).execute().data)
    for table in ("document_highlights", "document_blocks", "document_chunks"):
        supabase.table(table).delete().eq("document_id", document_id).execute()
    supabase.table("documents").update({"processing_status": "pending"}).eq("id", document_id).execute()

    background_tasks.add_task(
        process_uploaded_file, doc_id=document_id, user_id=str(document.get("user_id") or current_user_id()),
        title=document.get("title") or "", filename=path.rsplit("/", 1)[-1], file_bytes=file_bytes,
        kind=kind, supabase=supabase, enrich=not had_topics,
    )
    return {"document_id": document_id, "status": "pending", "kept_topics": had_topics}


@router.get("/topics/{topic_id}")
async def get_topic(topic_id: str):
    """Thông tin một chủ đề (tên + tài liệu chứa nó) cho trang quiz/bài học."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")
    rows = supabase.table("topics").select("*").eq("id", topic_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy chủ đề")
    topic = rows[0]
    if topic.get("document_id"):
        require_owned("documents", topic["document_id"])
    return topic


@router.get("/{document_id}/topics")
async def get_document_topics(document_id: str):
    """Lấy danh sách topics đã extract từ document."""
    require_owned("documents", document_id)
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    topics_resp = supabase.table("topics").select("*").eq("document_id", document_id).execute()
    rels_resp = supabase.table("topic_relationships") \
        .select("*") \
        .execute()

    topic_ids = {t["id"] for t in (topics_resp.data or [])}
    rels = [
        r for r in (rels_resp.data or [])
        if r["source_topic_id"] in topic_ids and r["target_topic_id"] in topic_ids
    ]

    return {
        "document_id": document_id,
        "topics": topics_resp.data or [],
        "relationships": rels
    }


@router.delete("/{document_id}")
def delete_document(document_id: str):
    """
    Xoá tài liệu (chủ sở hữu hoặc quản lý). Không hoàn lượt upload.
    Xoá cả tệp gốc trong kho lưu trữ; dữ liệu liên quan (khối, chunk, chủ đề...) xoá theo ràng buộc CASCADE.
    """
    require_owned("documents", document_id, write=True)
    supabase = get_supabase_client()
    rows = supabase.table("documents").select("id, file_path").eq("id", document_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Không tìm thấy")
    path = storage_path_from(rows[0].get("file_path"))
    if path:
        try:
            supabase.storage.from_(DOCUMENTS_BUCKET).remove([path])
        except Exception as e:
            logger.warning(f"[{document_id}] Cannot remove original file: {e}")
    # LocalStore không có CASCADE → dọn các bảng con chính
    for table in ("document_highlights", "document_blocks", "document_chunks", "reading_progress"):
        try:
            supabase.table(table).delete().eq("document_id", document_id).execute()
        except Exception:
            pass
    supabase.table("documents").delete().eq("id", document_id).execute()
    forget_owned("documents", document_id)
    return {"deleted": True, "id": document_id}


@router.get("/")
async def list_documents(user_id: Optional[str] = None):
    """Lấy danh sách documents của user."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    uid = current_user_id()
    cols = "id, user_id, title, source_type, file_path, processing_status, visibility, created_at"
    try:
        own = supabase.table("documents").select(cols).eq("user_id", uid) \
            .order("created_at", desc=True).execute().data or []
        shared = supabase.table("documents").select(cols).eq("visibility", "shared") \
            .order("created_at", desc=True).execute().data or []
    except Exception as e:
        logger.error(f"Error listing documents: {e}")
        own, shared = [], []

    seen = set()
    documents = []
    book_meta = sysconfig.book_meta()
    for doc in own + shared:
        if doc["id"] in seen:
            continue
        seen.add(doc["id"])
        doc["visibility"] = doc.get("visibility") or "private"
        doc["is_owner"] = str(doc.get("user_id")) == uid
        # Sách thư viện chung luôn ở tab "Thư viện Studia", kể cả với quản lý đã tải nó lên
        doc["is_shared"] = doc["visibility"] in ("shared", "shared_draft")
        meta = book_meta.get(str(doc["id"])) if doc["is_shared"] else None
        if meta:
            doc.update({k: meta[k] for k in ("description", "category", "sort_order", "featured") if k in meta})
        doc.pop("user_id", None)
        documents.append(doc)

    # Thư viện chung: sách nổi bật lên đầu, rồi theo thứ tự quản lý đặt (không đặt thì theo ngày thêm như cũ)
    shared_docs = [d for d in documents if d["is_shared"]]
    if any("sort_order" in d or d.get("featured") for d in shared_docs):
        order = {id(d): i for i, d in enumerate(shared_docs)}
        shared_docs.sort(key=lambda d: (not d.get("featured"), d.get("sort_order", 10**6), order[id(d)]))
        documents = [d for d in documents if not d["is_shared"]] + shared_docs

    # Thêm topic count cho mỗi document
    for doc in documents:
        try:
            tc = supabase.table("topics").select("id", count="exact").eq("document_id", doc["id"]).execute()
            doc["topic_count"] = getattr(tc, "count", 0) or 0
        except Exception:
            doc["topic_count"] = 0

    return {"documents": documents, "total": len(documents)}


class SearchChunksRequest(BaseModel):
    query: str
    top_k: int = 5


@router.get("/{document_id}/chunks")
async def get_document_chunks(document_id: str, limit: int = 20):
    """
    Lấy danh sách các đoạn văn bản (chunks) 600 ký tự kèm metadata đã tách của tài liệu.
    """
    require_owned("documents", document_id)
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    resp = supabase.table("document_chunks") \
        .select("id, chunk_index, content, metadata") \
        .eq("document_id", document_id) \
        .order("chunk_index") \
        .limit(limit) \
        .execute()

    chunks = resp.data or []
    return {
        "document_id": document_id,
        "total_returned": len(chunks),
        "chunks": chunks
    }


@router.post("/{document_id}/search")
async def search_document_vector(document_id: str, req: SearchChunksRequest):
    """
    Thử nghiệm Semantic Vector Search trên tài liệu qua Supabase RPC match_document_chunks_by_doc (Cosine Distance).
    """
    require_owned("documents", document_id)
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    if not req.query:
        raise HTTPException(status_code=400, detail="Thiếu từ khóa tìm kiếm query")

    results = RAGEngine.search_relevant_chunks(
        query=req.query,
        supabase_client=supabase,
        document_id=document_id,
        top_k=req.top_k
    )

    return {
        "document_id": document_id,
        "query": req.query,
        "top_k": req.top_k,
        "matches": results
    }

