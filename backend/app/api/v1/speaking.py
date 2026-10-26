"""
Speaking API — chấm câu trả lời IELTS Speaking Part 1/2/3 bằng AI (4 tiêu chí band) từ lời đã nhận dạng và số đo nhịp nói.
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.services import grading_context as gc
from app.services import speaking_grader as sg

router = APIRouter(prefix="/speaking", tags=["Speaking"])


class GradeRequest(BaseModel):
    part: int = Field(ge=1, le=3)
    question: str = Field(min_length=3, max_length=sg.QUESTION_MAX)
    transcript: str
    metrics: Optional[Dict[str, Any]] = None
    self_review: str = Field(default="", max_length=1500)
    context: Optional[Dict[str, Any]] = None    # ngữ cảnh người học (band mục tiêu, tiêu chí cần tập trung…)


@router.post("/grade")
async def grade_speaking(req: GradeRequest):
    transcript = " ".join((req.transcript or "").split())
    words = sg.count_words(transcript)
    if words < sg.MIN_WORDS:
        raise HTTPException(status_code=422, detail=f"Câu trả lời quá ngắn ({words} từ). Cần ít nhất {sg.MIN_WORDS} từ để chấm.")
    if words > sg.MAX_WORDS:
        raise HTTPException(status_code=422, detail=f"Câu trả lời quá dài ({words} từ). Tối đa {sg.MAX_WORDS} từ.")
    learner = gc.clean_learner(req.context, "speaking") if req.context is not None else None
    metrics = sg.clean_metrics(req.metrics)
    result = await run_in_threadpool(sg.grade, req.part, req.question, transcript, metrics, req.self_review, learner)
    if result is None:
        raise HTTPException(status_code=503, detail="Chưa chấm được lúc này: trợ lý AI không khả dụng hoặc trả kết quả lỗi. Hãy thử lại sau.")
    return result
