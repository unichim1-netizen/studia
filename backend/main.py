from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.config import settings
from app.core.auth import require_user
from app.api.v1.documents import router as documents_router
from app.api.v1.ebook import router as ebook_router
from app.api.v1.learning_paths import router as learning_paths_router
from app.api.v1.quizzes import router as quizzes_router
from app.api.v1.reviews import router as reviews_router
from app.api.v1.flashcards import router as flashcards_router
from app.api.v1.tutor import router as tutor_router
from app.api.v1.speech import router as speech_router
from app.api.v1.scenarios import router as scenarios_router
from app.api.v1.writing import router as writing_router
from app.api.v1.speaking import router as speaking_router
from app.api.v1.export import router as export_router
from app.api.v1.dual_coding import router as dual_coding_router
from app.api.v1.vocabulary import router as vocabulary_router
from app.api.v1.feedback import router as feedback_router
from app.api.v1.exam import router as exam_router
from app.api.v1.exam_sets import router as exam_sets_router
from app.api.v1.profile import router as profile_router
from app.api.v1.billing import account_router, public_router as billing_public_router, router as billing_router, webhook_router as billing_webhook_router
from app.api.v1.admin import router as admin_router
from app.api.v1.site_config import admin_router as admin_config_router, public_router as config_public_router
from app.api.v1.schedule import router as schedule_router
from app.api.v1.friends import router as friends_router
from app.core.accounts import require_admin
from app.core.features import require_feature
import asyncio
import contextlib
import logging

logger = logging.getLogger(__name__)

REMINDER_SCAN_SECONDS = 60


async def _reminder_loop():
    """Quét khung giờ học sắp bắt đầu và gửi email nhắc. Lỗi một vòng không làm dừng vòng sau."""
    from fastapi.concurrency import run_in_threadpool
    from app.services.schedule import run_reminder_cycle
    while True:
        try:
            counts = await run_in_threadpool(run_reminder_cycle)
            if counts.get("sent") or counts.get("failed"):
                logger.info(f"Reminder cycle: {counts}")
        except Exception as e:
            logger.warning(f"Reminder cycle error: {e}")
        await asyncio.sleep(REMINDER_SCAN_SECONDS)


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI):
    # Chỉ chạy vòng quét khi có SMTP để gửi: không thì mỗi phút đọc DB chỉ để bỏ qua
    from app.services import mailer
    task = asyncio.create_task(_reminder_loop()) if settings.REMINDERS_ENABLED and mailer.smtp_configured() else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    description="Studia Personal Learning Intelligence Platform — RAG + Adaptive FSRS + Gemini AI + Speech Shadowing + TBLT Scenarios",
    lifespan=lifespan,
)

# Nén JSON/HTML lớn (danh sách sách, khối ebook…) để giảm băng thông ra
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    error_msg = str(exc)
    logger.error(f"Unhandled exception on {request.url}: {error_msg}\n{traceback.format_exc()}")
    
    origin = request.headers.get("origin")
    headers = {}
    if origin in settings.cors_origins:
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
        headers=headers
    )


# V1 Routers — mọi route đều yêu cầu access token Supabase hợp lệ
authenticated = [Depends(require_user)]
app.include_router(documents_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(ebook_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(learning_paths_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(quizzes_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("practice"))])
app.include_router(reviews_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("practice"))])
app.include_router(flashcards_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("flashcards"))])
app.include_router(tutor_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("tutor"))])
app.include_router(speech_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("pronunciation"))])
app.include_router(scenarios_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("scenarios"))])
app.include_router(writing_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("writing"))])
app.include_router(speaking_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("speaking"))])
app.include_router(export_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(dual_coding_router, prefix=settings.API_V1_STR, dependencies=authenticated)
# V3 — Learnova Language Learning Features
app.include_router(vocabulary_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("flashcards"))])
app.include_router(feedback_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(exam_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("exam"))])
app.include_router(exam_sets_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(account_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(profile_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(billing_router, prefix=settings.API_V1_STR, dependencies=authenticated)
app.include_router(schedule_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("plan"))])
app.include_router(friends_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_feature("friends"))])
# Quản trị: phải đăng nhập VÀ có role admin
app.include_router(admin_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_admin)])
app.include_router(admin_config_router, prefix=settings.API_V1_STR, dependencies=authenticated + [Depends(require_admin)])
# Webhook ngân hàng: không có token người dùng — tự xác thực bằng API key / chữ ký HMAC của SePay
app.include_router(billing_webhook_router, prefix=settings.API_V1_STR)
# Bảng giá cho trang giới thiệu: công khai, chỉ đọc
app.include_router(billing_public_router, prefix=settings.API_V1_STR)
# Cấu hình công khai cho frontend (tính năng đang bật, banner, nội dung luyện tập)
app.include_router(config_public_router, prefix=settings.API_V1_STR)

@app.get("/")
async def root():
    return {
        "message": "Studia Personal Learning Intelligence Platform API v3 (Learnova)",
        "version": settings.VERSION,
        "llm_provider": settings.LLM_PROVIDER,
        "docs_url": "/docs",
        "features": [
            "PDF Upload + RAG Pipeline",
            "Adaptive Study Plans (Interleaved Scheduler)",
            "Gemini-powered Lessons with i+1 Vocabulary Highlights",
            "FSRS Spaced Repetition",
            "Flashcard Generation + Anki Export",
            "Multi-Type Quiz (MC, Fill-Blank, Recall, Sentence Construction)",
            "AI Open-Answer Grading",
            "Contextual Vocabulary Learning (word cards, collocations, examples)",
            "AI Tutor Chat",
            "Speech Audio Shadowing (0.8x-1.2x & Levenshtein STT)",
            "Task-Based Roleplay Scenarios (TBLT) + Auto Vocab Save",
            "Personalized Error Tracking & Remedial Exercises",
            "Dual Coding Diagram Generation"
        ]
    }

@app.get("/local-storage/{token}")
async def download_local_storage_file(token: str):
    """Tải tệp ở local storage fallback; quyền truy cập nằm trong token ký ngắn hạn do /file-url cấp."""
    import os
    from app.core.local_db import resolve_local_storage_token
    try:
        path = resolve_local_storage_token(token)
    except Exception:
        raise HTTPException(status_code=404, detail="Liên kết không hợp lệ hoặc đã hết hạn")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp")
    return FileResponse(path)


@app.get("/health")
async def health_check():
    from app.core.supabase_client import get_supabase_client
    supabase = get_supabase_client()
    db_status = "connected" if supabase else "disconnected"
    
    gemini_status = "configured" if (
        settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here"
    ) else "not configured"

    return {
        "status": "healthy",
        "database": f"Supabase Cloud ({db_status})",
        "llm": f"Gemini ({gemini_status})",
        "version": settings.VERSION
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
