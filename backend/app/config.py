import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Studia Intelligence Platform API"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"

    # Supabase Configuration
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    # Chỉ cần khi project Supabase còn ký JWT bằng HS256 (legacy secret); ES256/RS256 dùng JWKS
    SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "")

    # Auth — AUTH_REQUIRED=false chỉ có hiệu lực khi ENVIRONMENT=development
    AUTH_REQUIRED: bool = True

    # CORS — danh sách origin frontend, phân tách bằng dấu phẩy
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # LLM Provider — "gemini" | "openai"
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "gemini")
    GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY", None)
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY", None)

    # Tác vụ được phép gọi Gemini (phân tách bằng dấu phẩy): hỏi đáp, tra cứu, chấm viết, chấm nói.
    # Mọi thứ khác (bài học, quiz, flashcard, hội thoại, đề thi, sơ đồ…) làm thủ công, không gọi AI.
    AI_ENABLED_FEATURES: str = os.getenv("AI_ENABLED_FEATURES", "tutor,lookup,writing,speaking")

    # Gemini model names
    GEMINI_PRO_MODEL: str = "models/gemini-3.8-flash"
    GEMINI_EMBEDDING_MODEL: str = "models/text-embedding-004"
    GEMINI_EMBEDDING_DIMS: int = 768  # text-embedding-004 outputs 768 dims

    # Upload — giới hạn tệp PDF
    MAX_PDF_MB: int = 100
    MAX_PDF_PAGES: int = 800
    MAX_AUDIO_MB: int = 150

    # Lưu trữ — thời hạn signed URL và địa chỉ công khai của backend (dùng cho local storage fallback)
    SIGNED_URL_TTL_SECONDS: int = 600
    BACKEND_PUBLIC_URL: str = "http://localhost:8000"

    # Vai trò — email / user id luôn được nâng lên quản lý (phân tách bằng dấu phẩy)
    ADMIN_EMAILS: str = ""
    ADMIN_USER_IDS: str = ""

    # Thanh toán chuyển khoản qua webhook SePay — đặt MỘT trong hai (API key hoặc HMAC secret)
    SEPAY_API_KEY: str = ""
    SEPAY_WEBHOOK_SECRET: str = ""
    # Cổng thanh toán SePay (https://my.sepay.vn/pg): khách trả bằng QR trên trang của SePay, SePay gọi IPN về
    # POST /api/v1/billing/webhook/sepay-ipn kèm header X-Secret-Key = SEPAY_SECRET_KEY.
    SEPAY_MERCHANT_ID: str = ""
    SEPAY_SECRET_KEY: str = ""
    SEPAY_ENV: str = "production"  # production | sandbox
    # Địa chỉ frontend, để SePay đưa khách quay lại sau khi thanh toán
    FRONTEND_URL: str = "http://localhost:3000"
    # Tiền tố mã nội dung chuyển khoản (phải trùng "Cấu trúc mã thanh toán" cấu hình trên SePay)
    PAYMENT_CODE_PREFIX: str = "STD"

    # Email nhắc lịch học — để trống SMTP_HOST thì chỉ ghi log, không gửi
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""  # vd. "Studia <no-reply@studia.vn>"; trống thì dùng SMTP_USER
    SMTP_SECURITY: str = "starttls"  # starttls | ssl | none
    REMINDERS_ENABLED: bool = True
    REMINDER_LEAD_MINUTES: int = 10
    # Múi giờ của người học (Việt Nam không có giờ mùa hè nên dùng độ lệch cố định so với UTC)
    TZ_OFFSET_HOURS: float = 7.0

    # Demo user — chỉ dùng khi tắt auth ở development
    DEFAULT_USER_ID: str = "11111111-1111-1111-1111-111111111111"

    # Server Settings
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
