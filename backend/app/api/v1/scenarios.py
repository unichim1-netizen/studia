"""
Scenarios API v2 — Task-Based Language Teaching (TBLT) & AI Roleplay Interactive Sessions
Feature E: Auto-save vocabulary & errors sau mỗi roleplay step
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from app.services.scenario_engine import ScenarioEngine
from app.services.ai_engine import AIEngine, require_ai_feature
from app.services.rag_engine import RAGEngine
from app.core.supabase_client import get_supabase_client
from app.config import settings
from app.core.auth import current_user_id
import uuid
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scenarios", tags=["Scenarios & Roleplay"])


class GenerateScenariosRequest(BaseModel):
    document_id: str
    topic_name: str
    count: int = 3


class InteractStepRequest(BaseModel):
    scenario_title: str
    ai_role: str
    user_role: str
    user_message: str
    chat_history: Optional[List[Dict[str, str]]] = []
    document_id: Optional[str] = None
    topic_id: Optional[str] = None
    save_vocabulary: bool = True   # Feature E: auto-save vocab
    user_id: Optional[str] = None


@router.post("/generate")
async def generate_scenarios(req: GenerateScenariosRequest):
    """
    Sinh các nhiệm vụ tình huống thực tế (TBLT Scenarios) từ RAG context của sách.
    """
    require_ai_feature("scenarios", "Tạo tình huống hội thoại")
    supabase = get_supabase_client()
    document_title = "Tài liệu chuyên ngành"

    if supabase and req.document_id:
        doc_resp = supabase.table("documents").select("title").eq("id", req.document_id).execute()
        if doc_resp.data:
            document_title = doc_resp.data[0].get("title", "")

    # RAG Context
    rag_chunks = []
    if supabase and req.document_id:
        rag_chunks = RAGEngine.search_relevant_chunks(
            query=req.topic_name,
            supabase_client=supabase,
            document_id=req.document_id,
            top_k=5
        )

    rag_texts = RAGEngine.extract_rag_texts(rag_chunks)

    scenarios = ScenarioEngine.generate_scenarios(
        document_title=document_title,
        topic_name=req.topic_name,
        rag_context=rag_texts,
        count=req.count
    )

    return {
        "document_id": req.document_id,
        "topic_name": req.topic_name,
        "scenarios": scenarios
    }


@router.post("/interact")
async def interact_scenario_step(req: InteractStepRequest):
    """
    Lượt tương tác nhập vai (Roleplay Turn) với AI.
    Trả về phản hồi của nhân vật AI + điểm đánh giá truyền thông & thuật ngữ.
    """
    require_ai_feature("scenarios", "Nhập vai hội thoại với AI")
    supabase = get_supabase_client()
    rag_chunks = []

    if supabase and req.document_id:
        rag_chunks = RAGEngine.search_relevant_chunks(
            query=req.user_message,
            supabase_client=supabase,
            document_id=req.document_id,
            top_k=4
        )

    rag_texts = RAGEngine.extract_rag_texts(rag_chunks)

    result = ScenarioEngine.interact_scenario_step(
        scenario_title=req.scenario_title,
        ai_role=req.ai_role,
        user_role=req.user_role,
        user_message=req.user_message,
        chat_history=req.chat_history or [],
        rag_context=rag_texts
    )

    # Feature E: Auto-extract & save vocabulary + errors
    vocab_saved = []
    errors_logged = 0
    if req.save_vocabulary:
        try:
            extracted = AIEngine.extract_scenario_vocabulary(
                scenario_title=req.scenario_title,
                user_message=req.user_message,
                ai_response=result.get("ai_response", ""),
                rag_context=rag_texts
            )

            uid = current_user_id()

            # Lưu vocabulary items
            vocab_items = extracted.get("vocabulary_items", [])
            for item in vocab_items:
                word = item.get("word", "").strip()
                meaning = item.get("meaning_vi", "").strip()
                if not word or not meaning:
                    continue
                try:
                    v_id = str(uuid.uuid4())
                    supabase.table("vocabulary_items").insert({
                        "id": v_id,
                        "user_id": uid,
                        "document_id": req.document_id,
                        "topic_id": req.topic_id,
                        "word": word,
                        "meaning_vi": meaning,
                        "source_sentence": item.get("source_sentence", ""),
                        "word_type": item.get("word_type", "noun"),
                        "source": "scenario"
                    }).execute()
                    vocab_saved.append({"word": word, "meaning_vi": meaning})
                except Exception as ve:
                    logger.warning(f"Vocab save failed for '{word}': {ve}")

            # Lưu errors
            user_errors = extracted.get("errors_in_user_input", [])
            for err in user_errors:
                if not err.get("error_detail"):
                    continue
                try:
                    existing = supabase.table("error_logs") \
                        .select("id, occurrence_count") \
                        .eq("user_id", uid) \
                        .eq("error_detail", err.get("error_detail", "")[:200]) \
                        .limit(1).execute()

                    if existing.data:
                        supabase.table("error_logs").update({
                            "occurrence_count": existing.data[0]["occurrence_count"] + 1,
                            "last_seen_at": "now()"
                        }).eq("id", existing.data[0]["id"]).execute()
                    else:
                        supabase.table("error_logs").insert({
                            "user_id": uid,
                            "topic_id": req.topic_id,
                            "error_type": err.get("error_type", "grammar"),
                            "error_detail": err.get("error_detail", "")[:500],
                            "user_input": err.get("user_input", ""),
                            "correct_form": err.get("correct_form", ""),
                            "context_sentence": req.user_message[:300],
                            "source": "scenario"
                        }).execute()
                    errors_logged += 1
                except Exception as ee:
                    logger.warning(f"Error log save failed: {ee}")

        except Exception as ex:
            logger.warning(f"Scenario vocab extraction failed: {ex}")

    return {
        **result,
        "vocabulary_saved": vocab_saved,
        "errors_logged": errors_logged
    }
