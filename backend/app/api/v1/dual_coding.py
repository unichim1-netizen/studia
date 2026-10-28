"""
Dual Coding API — Mermaid & D2 Terrastruct Visual Diagram Generation
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
from app.services.dual_coding_engine import DualCodingEngine
from app.services.ai_engine import require_ai_feature

router = APIRouter(prefix="/dual-coding", tags=["Dual Coding & Diagrams"])


class DiagramRequest(BaseModel):
    topic_name: str
    concept_description: str


class EnrichLessonRequest(BaseModel):
    topic_name: str
    content_markdown: str


@router.post("/generate-mermaid")
async def generate_mermaid_diagram(req: DiagramRequest):
    """
    Sinh mã nguồn Mermaid Diagram (TD graph / Mindmap) từ tên chủ đề và mô tả khái niệm.
    """
    require_ai_feature("diagrams", "Tạo sơ đồ")
    if not req.topic_name:
        raise HTTPException(status_code=400, detail="Thiếu topic_name")

    mermaid_code = DualCodingEngine.generate_mermaid_diagram(
        topic_name=req.topic_name,
        concept_description=req.concept_description or ""
    )

    return {
        "topic_name": req.topic_name,
        "format": "mermaid",
        "diagram_code": mermaid_code
    }


@router.post("/generate-d2")
async def generate_d2_diagram(req: DiagramRequest):
    """
    Sinh mã nguồn D2 (Terrastruct) Diagram với theme nền trắng (theme-id: 0) & tiếng Việt có dấu.
    """
    require_ai_feature("diagrams", "Tạo sơ đồ")
    if not req.topic_name:
        raise HTTPException(status_code=400, detail="Thiếu topic_name")

    d2_code = DualCodingEngine.generate_d2_diagram(
        topic_name=req.topic_name,
        concept_description=req.concept_description or ""
    )

    return {
        "topic_name": req.topic_name,
        "format": "d2",
        "diagram_code": d2_code
    }


@router.post("/enrich-lesson")
async def enrich_lesson_with_visuals(req: EnrichLessonRequest):
    """
    Tự động bổ sung sơ đồ trực quan (Mermaid / Dual Coding) vào bài học Markdown.
    """
    require_ai_feature("diagrams", "Tạo sơ đồ")
    if not req.content_markdown:
        raise HTTPException(status_code=400, detail="Thiếu content_markdown")

    enriched_content = DualCodingEngine.enrich_lesson_with_visuals(
        topic_name=req.topic_name or "Bài học",
        content_markdown=req.content_markdown
    )

    return {
        "topic_name": req.topic_name,
        "enriched_content": enriched_content
    }
