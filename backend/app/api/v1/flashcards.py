"""
Flashcards API — Generate, Review (FSRS), Due Queue
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from app.services.ai_engine import AIEngine, require_ai_feature
from app.services.rag_engine import RAGEngine
from app.services.fsrs_engine import FSRSEngine
from app.core.supabase_client import get_supabase_client
from app.config import settings
from app.core.auth import current_user_id
import uuid

router = APIRouter(prefix="/flashcards", tags=["Flashcards"])



class GenerateFlashcardsRequest(BaseModel):
    topic_id: str
    topic_name: str
    document_id: Optional[str] = None
    count: int = 10
    user_id: Optional[str] = None


class ReviewFlashcardRequest(BaseModel):
    flashcard_id: str
    rating: int  # 1=Again, 2=Hard, 3=Good, 4=Easy
    response_time_ms: int = 5000
    user_id: Optional[str] = None


class CustomFlashcardCreate(BaseModel):
    front: str
    back: str
    topic_name: Optional[str] = "Bộ thẻ tùy chỉnh"
    topic_id: Optional[str] = None
    document_id: Optional[str] = None
    card_type: Optional[str] = "concept"
    source_chunk: Optional[str] = "Tự tạo bởi người dùng"
    user_id: Optional[str] = None


class DeckCreate(BaseModel):
    name: str


@router.get("/decks")
async def list_decks():
    """Các bộ thẻ người dùng tự tạo (topic có slug deck-<user_id>-...)."""
    uid = current_user_id()
    supabase = get_supabase_client()
    if not supabase:
        return {"decks": []}
    try:
        rows = supabase.table("topics").select("id, name").like("slug", f"deck-{uid}-%").order("name").execute().data or []
        return {"decks": [{"id": r["id"], "name": r["name"]} for r in rows]}
    except Exception:
        return {"decks": []}


@router.post("/decks")
async def create_deck(req: DeckCreate):
    """Tạo bộ thẻ mới; trả về id để gắn thẻ vào bộ này."""
    uid = current_user_id()
    name = req.name.strip()[:80]
    if not name:
        raise HTTPException(status_code=422, detail="Tên bộ thẻ không được để trống")
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")
    deck_id = str(uuid.uuid4())
    try:
        supabase.table("topics").insert({
            "id": deck_id,
            "name": name,
            "slug": f"deck-{uid}-{deck_id[:8]}",
            "description": "Bộ thẻ flashcard tự tạo bởi người dùng",
            "difficulty_level": 1,
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo bộ thẻ: {e}")
    return {"deck": {"id": deck_id, "name": name}}


@router.post("/custom-create")
async def create_custom_flashcard(req: CustomFlashcardCreate):
    """
    Người dùng tự tạo thẻ flashcard tùy chỉnh (Manual Custom Flashcard).
    Hệ thống tự động tạo topic (nếu chưa có) và khởi tạo FSRS state.
    """
    user_id = current_user_id()
    supabase = get_supabase_client()

    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    card_id = str(uuid.uuid4())
    topic_id = req.topic_id or str(uuid.uuid4())

    # Check/insert topic record if missing
    try:
        if not req.topic_id:
            supabase.table("topics").insert({
                "id": topic_id,
                "name": req.topic_name,
                "slug": f"custom-{topic_id[:8]}",
                "description": "Bộ thẻ flashcard tự tạo bởi người dùng",
                "difficulty_level": 1
            }).execute()
    except Exception:
        pass

    try:
        supabase.table("flashcards").insert({
            "id": card_id,
            "topic_id": topic_id,
            "document_id": req.document_id,
            "front": req.front,
            "back": req.back,
            "source_chunk": req.source_chunk,
            "card_type": req.card_type
        }).execute()

        # Khởi tạo FSRS state cho user
        supabase.table("flashcard_states").insert({
            "user_id": user_id,
            "flashcard_id": card_id,
            "stability": 1.0,
            "difficulty_rating": 5.0,
            "mastery_score": 0.0,
            "next_review_at": "now()"
        }).execute()

        return {
            "status": "success",
            "message": f"Đã tạo thành công thẻ flashcard mới cho bộ '{req.topic_name}'",
            "flashcard": {
                "id": card_id,
                "topic_id": topic_id,
                "topic_name": req.topic_name,
                "front": req.front,
                "back": req.back,
                "card_type": req.card_type,
                "mastery_score": 0.0,
                "review_count": 0
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo flashcard: {e}")


@router.post("/generate")
async def generate_flashcards(req: GenerateFlashcardsRequest):
    """
    Sinh flashcards cho topic từ RAG context (content trong sách).
    Lưu vào Supabase với topic_id.
    """
    require_ai_feature("flashcards", "Tạo flashcard")
    user_id = current_user_id()
    supabase = get_supabase_client()

    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    # 1. RAG: lấy context liên quan
    rag_chunks = []
    if req.document_id:
        rag_chunks = RAGEngine.search_relevant_chunks(
            query=req.topic_name,
            supabase_client=supabase,
            document_id=req.document_id,
            top_k=6
        )

    rag_texts = RAGEngine.extract_rag_texts(rag_chunks)

    # 2. Sinh flashcards qua Gemini
    flashcard_data = AIEngine.generate_flashcards(
        topic_name=req.topic_name,
        rag_context=rag_texts,
        count=req.count
    )

    # 3. Lưu vào Supabase
    saved_cards = []
    for card in flashcard_data:
        card_id = str(uuid.uuid4())
        try:
            supabase.table("flashcards").insert({
                "id": card_id,
                "topic_id": req.topic_id,
                "document_id": req.document_id,
                "front": card.get("front", ""),
                "back": card.get("back", ""),
                "source_chunk": card.get("source_chunk", "")[:500],
                "card_type": card.get("card_type", "concept")
            }).execute()

            # Khởi tạo FSRS state cho user
            supabase.table("flashcard_states").insert({
                "user_id": user_id,
                "flashcard_id": card_id,
                "stability": 1.0,
                "difficulty_rating": 5.0,
                "mastery_score": 0.0,
                "next_review_at": "now()"
            }).execute()

            saved_cards.append({**card, "id": card_id})
        except Exception as e:
            print(f"Flashcard save warning: {e}")

    return {
        "topic_id": req.topic_id,
        "topic_name": req.topic_name,
        "generated_count": len(saved_cards),
        "flashcards": saved_cards,
        "rag_chunks_used": len(rag_chunks)
    }


@router.get("/due")
async def get_due_flashcards(
    user_id: Optional[str] = None,
    limit: int = 20,
    topic_id: Optional[str] = None
):
    """
    Lấy danh sách flashcards đến hạn ôn tập (FSRS schedule).
    """
    uid = current_user_id()
    supabase = get_supabase_client()

    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    try:
        # Dùng RPC function get_due_flashcards nếu có
        resp = supabase.rpc("get_due_flashcards", {
            "p_user_id": uid,
            "p_limit": limit
        }).execute()

        cards = resp.data or []

        if topic_id:
            cards = [c for c in cards if c.get("topic_id") == topic_id]

        return {
            "user_id": uid,
            "due_count": len(cards),
            "flashcards": cards
        }
    except Exception:
        # Fallback: query trực tiếp
        try:
            fs_resp = supabase.table("flashcard_states") \
                .select("flashcard_id, stability, difficulty_rating, mastery_score, next_review_at, review_count") \
                .eq("user_id", uid) \
                .lte("next_review_at", "now()") \
                .order("next_review_at") \
                .limit(limit) \
                .execute()

            card_ids = [fs["flashcard_id"] for fs in (fs_resp.data or [])]
            fs_map = {fs["flashcard_id"]: fs for fs in (fs_resp.data or [])}

            cards = []
            if card_ids:
                fc_resp = supabase.table("flashcards").select("*").in_("id", card_ids).execute()
                for fc in (fc_resp.data or []):
                    state = fs_map.get(fc["id"], {})
                    cards.append({**fc, **state})

            return {"user_id": uid, "due_count": len(cards), "flashcards": cards}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@router.post("/review")
async def review_flashcard(req: ReviewFlashcardRequest):
    """
    Submit kết quả review một flashcard.
    Cập nhật FSRS state (stability, difficulty, next_review_at).
    """
    uid = current_user_id()
    supabase = get_supabase_client()

    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    # Lấy FSRS state hiện tại
    state_resp = supabase.table("flashcard_states") \
        .select("*") \
        .eq("user_id", uid) \
        .eq("flashcard_id", req.flashcard_id) \
        .execute()

    if not state_resp.data:
        # Tạo mới nếu chưa có
        current_state = {"stability": 1.0, "difficulty_rating": 5.0, "mastery_score": 0.0, "review_count": 0}
    else:
        current_state = state_resp.data[0]

    # Tính FSRS
    is_correct = req.rating >= 3  # Good hoặc Easy = correct
    fsrs_result = FSRSEngine.calculate_next_review(
        stability=current_state.get("stability", 1.0),
        difficulty_rating=current_state.get("difficulty_rating", 5.0),
        mastery_score=current_state.get("mastery_score", 0.0),
        is_correct=is_correct,
        confidence_rating=req.rating,
        response_time_ms=req.response_time_ms
    )

    # Cập nhật FSRS state
    try:
        supabase.table("flashcard_states").upsert({
            "user_id": uid,
            "flashcard_id": req.flashcard_id,
            "stability": fsrs_result["stability"],
            "difficulty_rating": fsrs_result["difficulty_rating"],
            "mastery_score": fsrs_result["mastery_score"],
            "retention_score": fsrs_result["retention_score"],
            "next_review_at": fsrs_result["next_review_at"],
            "review_count": current_state.get("review_count", 0) + 1,
            "last_rating": req.rating,
            "updated_at": "now()"
        }, on_conflict="user_id,flashcard_id").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi cập nhật FSRS state: {e}")

    rating_labels = {1: "Again 😓", 2: "Hard 😕", 3: "Good 😊", 4: "Easy 😄"}

    return {
        "flashcard_id": req.flashcard_id,
        "rating": req.rating,
        "rating_label": rating_labels.get(req.rating, "Good"),
        "is_correct": is_correct,
        "updated_state": fsrs_result,
        "message": f"Ôn tập tiếp theo: {fsrs_result['interval_days']:.1f} ngày"
    }


@router.get("/topic/{topic_id}")
async def get_topic_flashcards(topic_id: str, user_id: Optional[str] = None):
    """Lấy tất cả flashcards của một topic."""
    uid = current_user_id()
    supabase = get_supabase_client()

    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase không khả dụng")

    fc_resp = supabase.table("flashcards").select("*").eq("topic_id", topic_id).execute()
    flashcards = fc_resp.data or []

    # Attach FSRS state
    if flashcards:
        card_ids = [fc["id"] for fc in flashcards]
        fs_resp = supabase.table("flashcard_states") \
            .select("*") \
            .eq("user_id", uid) \
            .in_("flashcard_id", card_ids) \
            .execute()
        fs_map = {fs["flashcard_id"]: fs for fs in (fs_resp.data or [])}

        for fc in flashcards:
            state = fs_map.get(fc["id"], {})
            fc["mastery_score"] = state.get("mastery_score", 0.0)
            fc["next_review_at"] = state.get("next_review_at", None)
            fc["review_count"] = state.get("review_count", 0)

    return {"topic_id": topic_id, "total": len(flashcards), "flashcards": flashcards}
