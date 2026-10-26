"""
AI Engine — Studia v3 (Learnova)
Tích hợp thực sự với Gemini API (google-generativeai) để:
  - Trích xuất Topics và Knowledge Graph từ tài liệu
  - Sinh bài học (Lesson) cá nhân hóa theo RAG context + i+1 vocabulary highlight
  - Tạo câu hỏi Quiz thích ứng (Adaptive Quiz) — multi-type: MC, fill_blank, recall
  - Sinh Flashcards từ content
  - AI Tutor: trả lời câu hỏi từ nội dung sách
  - Vocabulary Card: phân tích từ vựng chi tiết (meaning_vi, collocations, examples)
  - Open Answer Grading: Gemini chấm điểm câu trả lời mở
  - Error Analysis: phân tích lỗi từ quiz/scenario để sinh feedback cá nhân hóa
  - Remedial Exercises: sinh bài tập nhắm vào weak points từ error logs
"""
from typing import List, Dict, Any, Optional
import json
import re
import logging

logger = logging.getLogger(__name__)

def _get_gemini_client():
    """Lazy-load Gemini client để tránh lỗi khi không có key."""
    try:
        import google.generativeai as genai
        from app.config import settings
        if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY == "your_gemini_api_key_here":
            return None
        genai.configure(api_key=settings.GEMINI_API_KEY)
        return genai.GenerativeModel(settings.GEMINI_PRO_MODEL)
    except Exception as e:
        logger.warning(f"Gemini client init failed: {e}")
        return None


def _call_gemini(prompt: str, expect_json: bool = True, timeout: Optional[float] = None) -> Any:
    """
    Gọi Gemini API với prompt, trả về JSON object hoặc text.
    Fallback về None nếu không có key hoặc lỗi.
    timeout (giây): đặt cho tác vụ người dùng đang chờ (vd. tra từ) để không treo khi Gemini lỗi; khi đó bỏ cả cơ chế thử lại.
    """
    model = _get_gemini_client()
    if not model:
        return None

    try:
        from google.generativeai.types import GenerationConfig
        config = GenerationConfig(
            temperature=0.3,
            response_mime_type="application/json" if expect_json else "text/plain",
        )
        opts = {"timeout": timeout, "retry": None} if timeout else None
        response = model.generate_content(prompt, generation_config=config, request_options=opts)
        text = response.text.strip()

        if expect_json:
            # Clean markdown code fences nếu có
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            return json.loads(text)
        return text
    except Exception as e:
        logger.error(f"Gemini call failed: {e}")
        return None


import urllib.parse
import urllib.request

def _quick_translate_vi(text: str) -> str:
    """Instant translation from EN to VI via Google Translate API endpoint (free, sub-100ms)."""
    if not text:
        return ""
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q={urllib.parse.quote(text)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data and data[0]:
                translated = "".join([part[0] for part in data[0] if part and part[0]])
                if translated:
                    return translated.strip()
    except Exception as e:
        logger.warning(f"Quick translate failed for '{text}': {e}")
    return ""


class AIEngine:
    """
    AI Engine điều phối tất cả tác vụ AI của Studia:
    - extract_topics_and_graph: Phân tích tài liệu → Topics + Knowledge Graph
    - generate_lesson: Sinh bài học cá nhân hóa
    - generate_adaptive_quiz: Sinh câu hỏi trắc nghiệm adaptive
    - generate_flashcards: Sinh flashcard front/back
    - generate_ai_tutor_response: AI Tutor trả lời từ RAG context
    """

    @staticmethod
    def extract_topics_and_graph(content: str, title: str) -> Dict[str, Any]:
        """
        Phân tích tài liệu đầu vào → trích xuất Topics (nodes) và Relationships (edges).
        Nếu Gemini khả dụng → gọi LLM thực.
        Fallback → heuristic-based extraction.
        """
        # Giới hạn content để tránh token overflow
        content_preview = content[:4000]

        prompt = f"""You are an expert educator analyzing a learning document.
Document Title: "{title}"

Document Content (preview):
{content_preview}

Extract the main TOPICS and their relationships for a Knowledge Graph.

Return ONLY valid JSON (no markdown, no extra text):
{{
  "topics": [
    {{
      "name": "Topic Name",
      "slug": "topic-slug-lowercase-hyphen",
      "description": "Clear description in Vietnamese (1-2 sentences)",
      "difficulty_level": 1
    }}
  ],
  "relationships": [
    {{
      "source_index": 0,
      "target_index": 1,
      "relationship_type": "prerequisite",
      "weight": 1.0
    }}
  ]
}}

Rules:
- Extract 4-8 main topics that cover the document's core content
- difficulty_level: 1=Basic, 2=Beginner, 3=Intermediate, 4=Advanced, 5=Expert
- relationship_type: "prerequisite" (must learn first) | "related" | "contains"
- slug: lowercase, hyphens only, no Vietnamese diacritics
- descriptions MUST be in Vietnamese
- source_index is the prerequisite of target_index"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "topics" in result and len(result["topics"]) > 0:
            return result

        # --- Fallback: heuristic extraction ---
        logger.info("Using heuristic topic extraction (no LLM)")
        return AIEngine._heuristic_extract_topics(content, title)

    @staticmethod
    def _heuristic_extract_topics(content: str, title: str) -> Dict[str, Any]:
        """Fallback: trích xuất topic đơn giản từ headings và keywords."""
        import re
        # Tìm headings markdown
        headings = re.findall(r'^#{1,3}\s+(.+)$', content, re.MULTILINE)
        # Tìm từ khóa viết hoa
        keywords = list(set(re.findall(r'\b[A-Z][a-zA-Z]{3,}\b', content)))[:8]

        candidates = headings[:6] if headings else keywords[:6]
        if not candidates:
            candidates = ["Khái niệm cơ bản", "Nguyên lý hoạt động", "Ứng dụng thực tế"]

        topics = []
        for idx, name in enumerate(candidates[:6]):
            slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
            topics.append({
                "name": name.strip(),
                "slug": slug or f"topic-{idx+1}",
                "description": f"Chủ đề học tập về {name} được trích xuất từ tài liệu '{title}'.",
                "difficulty_level": min(5, (idx // 2) + 1)
            })

        relationships = []
        for i in range(len(topics) - 1):
            relationships.append({
                "source_index": i,
                "target_index": i + 1,
                "relationship_type": "prerequisite",
                "weight": 1.0
            })

        return {"topics": topics, "relationships": relationships}

    @staticmethod
    def generate_lesson(
        topic_name: str,
        user_mastery: float,
        rag_context: List[str],
        language: str = "vi"
    ) -> Dict[str, Any]:
        """
        Sinh nội dung bài học cá nhân hóa dựa trên:
        - Điểm Mastery hiện tại (điều chỉnh độ sâu)
        - RAG context (nội dung từ sách thực tế)
        """
        depth_label = (
            "cơ bản, dễ hiểu với nhiều ví dụ minh họa" if user_mastery < 40
            else ("trung cấp, kết hợp lý thuyết và thực hành" if user_mastery < 70
                  else "nâng cao, chuyên sâu với phân tích kỹ thuật")
        )

        context_str = "\n\n---\n\n".join(rag_context) if rag_context else ""

        prompt = f"""You are an expert Vietnamese educator creating a personalized lesson.

Topic: "{topic_name}"
Student's current mastery level: {user_mastery:.0f}% (0=beginner, 100=expert)
Required depth: {depth_label}

Reference content from the textbook:
{context_str[:3000]}

Create a comprehensive lesson in MARKDOWN format. Return ONLY valid JSON:
{{
  "title": "Lesson title in Vietnamese",
  "content_markdown": "Full lesson in Markdown (Vietnamese), using ## headings, bullet points, **bold**, code blocks if relevant. Min 400 words.",
  "key_takeaways": ["takeaway 1", "takeaway 2", "takeaway 3"]
}}

Requirements:
- Language: Vietnamese (tiếng Việt)
- Base the lesson on the reference content provided
- Adapt complexity to the student's mastery level
- Include: introduction, core concepts, examples, summary
- key_takeaways: 3-5 bullet points, concise"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "content_markdown" in result:
            return result

        # Fallback
        return AIEngine._fallback_lesson(topic_name, user_mastery, context_str)

    @staticmethod
    def _fallback_lesson(topic_name: str, user_mastery: float, context_str: str) -> Dict[str, Any]:
        depth = "Cơ bản" if user_mastery < 40 else ("Trung cấp" if user_mastery < 70 else "Nâng cao")
        return {
            "title": f"Bài học: {topic_name}",
            "content_markdown": f"""# {topic_name}

> **Mức độ**: {depth} | **Mastery hiện tại**: {user_mastery:.0f}%

## Giới Thiệu
{topic_name} là một chủ đề quan trọng trong tài liệu bạn đang học.

## Nội Dung Chính

{context_str[:500] if context_str else "Hãy đọc kỹ tài liệu để nắm nội dung chính."}

## Tóm Tắt
- Hiểu rõ định nghĩa và bản chất của {topic_name}
- Nắm vững các ứng dụng thực tế
- Chuẩn bị cho Quiz đánh giá năng lực
""",
            "key_takeaways": [
                f"Hiểu khái niệm cốt lõi của {topic_name}",
                "Kết nối kiến thức với chủ đề liên quan",
                "Thực hành qua Quiz và Flashcard"
            ]
        }

    @staticmethod
    def generate_adaptive_quiz(
        topic_name: str,
        user_mastery: float,
        rag_context: List[str],
        question_count: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Sinh câu hỏi trắc nghiệm thích ứng từ RAG context.
        Độ khó được điều chỉnh theo mastery của người dùng.
        """
        difficulty_label = (
            "easy (basic definitions and facts)" if user_mastery < 40
            else ("medium (application and understanding)" if user_mastery < 70
                  else "hard (analysis, synthesis, and evaluation)")
        )

        context_str = "\n\n---\n\n".join(rag_context) if rag_context else ""

        prompt = f"""You are an expert educator creating quiz questions.

Topic: "{topic_name}"
Student mastery: {user_mastery:.0f}% → Generate {difficulty_label} questions
Number of questions: {question_count}

Reference content from the textbook:
{context_str[:3000]}

Generate questions STRICTLY based on the provided content. Return ONLY valid JSON:
{{
  "questions": [
    {{
      "question_text": "Question text in Vietnamese",
      "question_type": "multiple_choice",
      "options": [
        {{"id": "A", "text": "Option A"}},
        {{"id": "B", "text": "Option B"}},
        {{"id": "C", "text": "Option C"}},
        {{"id": "D", "text": "Option D"}}
      ],
      "correct_answer": "A",
      "explanation": "Explanation why A is correct (Vietnamese)",
      "difficulty": 2
    }}
  ]
}}

Requirements:
- All text in Vietnamese
- Questions must be directly derived from the reference content
- correct_answer must be one of: A, B, C, D
- difficulty: 1-5 scale
- Do NOT create questions about topics not in the reference content"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "questions" in result and len(result["questions"]) > 0:
            return result["questions"]

        # Fallback
        return AIEngine._fallback_quiz(topic_name, user_mastery, question_count)

    @staticmethod
    def _fallback_quiz(topic_name: str, user_mastery: float, count: int) -> List[Dict]:
        difficulty = 1 if user_mastery < 40 else (3 if user_mastery < 70 else 5)
        return [
            {
                "question_text": f"Khái niệm nào mô tả đúng nhất về {topic_name}?",
                "question_type": "multiple_choice",
                "options": [
                    {"id": "A", "text": f"Là nguyên lý cốt lõi của {topic_name}"},
                    {"id": "B", "text": "Là một khái niệm không liên quan"},
                    {"id": "C", "text": "Chỉ áp dụng trong lý thuyết"},
                    {"id": "D", "text": "Không có ứng dụng thực tế"}
                ],
                "correct_answer": "A",
                "explanation": f"Đáp án A đúng vì nó mô tả đúng bản chất của {topic_name}.",
                "difficulty": difficulty,
                "is_fallback": True
            }
            for _ in range(count)
        ]

    @staticmethod
    def generate_flashcards(
        topic_name: str,
        rag_context: List[str],
        count: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Sinh flashcard front/back từ RAG context.
        Bao gồm nhiều loại: định nghĩa, so sánh, ứng dụng.
        """
        context_str = "\n\n---\n\n".join(rag_context) if rag_context else ""

        prompt = f"""You are creating Anki-style flashcards for studying.

Topic: "{topic_name}"
Generate {count} flashcards.

Reference content:
{context_str[:3000]}

Return ONLY valid JSON:
{{
  "flashcards": [
    {{
      "front": "Question or concept prompt (Vietnamese)",
      "back": "Answer or explanation (Vietnamese, concise but complete)",
      "card_type": "concept",
      "source_chunk": "Exact quote from reference content that this card is based on"
    }}
  ]
}}

card_type options: "concept" | "definition" | "question" | "fill_blank"
Requirements:
- Vietnamese language
- Mix different card types for better learning
- front: short, clear prompt (question or fill-in-the-blank)
- back: concise but informative answer
- Cards must be directly based on the reference content
- Vary the difficulty across cards"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "flashcards" in result and len(result["flashcards"]) > 0:
            return result["flashcards"]

        # Fallback
        return [
            {
                "front": f"Định nghĩa của {topic_name} là gì?",
                "back": f"{topic_name} là một khái niệm quan trọng trong lĩnh vực này. Hãy đọc lại tài liệu để nắm rõ hơn.",
                "card_type": "definition",
                "source_chunk": context_str[:200] if context_str else ""
            }
        ]

    @staticmethod
    def generate_ai_tutor_response(
        question: str,
        rag_context: List[str],
        chat_history: List[Dict[str, str]] = None,
        document_title: str = ""
    ) -> Dict[str, Any]:
        """
        AI Tutor: trả lời câu hỏi của người dùng dựa trên RAG context từ sách.
        """
        context_str = "\n\n---\n\n".join(rag_context) if rag_context else ""

        # Build conversation history
        history_str = ""
        if chat_history:
            for msg in chat_history[-6:]:  # Lấy 6 tin nhắn gần nhất
                role = "User" if msg.get("role") == "user" else "Assistant"
                history_str += f"{role}: {msg.get('content', '')}\n"

        prompt = f"""You are Coal, the friendly AI study buddy of Studia — a small lump of coal who dreams of becoming a diamond
and believes steady effort under pressure is how that happens. You help Vietnamese learners (mostly IELTS) study.
You answer questions based STRICTLY on the provided reference material. Speak as a warm, upbeat friend: say "mình" for yourself,
never lecture, never shame the student for mistakes or a broken streak, and celebrate small progress.

{"Document: " + document_title if document_title else ""}

Reference material from the textbook:
{context_str[:3500] if context_str else "No specific context available."}

{"Previous conversation:\n" + history_str if history_str else ""}

Student's question: {question}

Instructions:
- Answer in Vietnamese (tiếng Việt)
- Base your answer on the reference material provided
- If the question is outside the reference material scope, say so honestly
- Be conversational, encouraging, and clear
- Use examples when helpful
- Keep response focused (200-400 words)

Return ONLY valid JSON:
{{
  "answer": "Your complete answer in Vietnamese",
  "confidence": 0.9,
  "related_concepts": ["concept1", "concept2"],
  "follow_up_suggestions": ["Follow-up question 1?", "Follow-up question 2?"]
}}"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "answer" in result:
            return result

        # Fallback
        return {
            "answer": f"Tôi đang xử lý câu hỏi của bạn về '{question}'. Dựa trên tài liệu bạn đã upload, đây là những gì tôi tìm thấy:\n\n{context_str[:300] if context_str else 'Hãy đảm bảo bạn đã upload tài liệu để AI có thể trả lời chính xác hơn.'}",
            "confidence": 0.5,
            "related_concepts": [],
            "follow_up_suggestions": []
        }

    @staticmethod
    def evaluate_quiz_response(
        question: Dict[str, Any],
        user_answer: str,
        response_time_ms: int
    ) -> Dict[str, Any]:
        """Đánh giá câu trả lời và trả về phản hồi chi tiết."""
        correct_answer = question.get("correct_answer", "A")
        is_correct = (user_answer.strip().upper() == correct_answer.strip().upper())

        feedback = (
            "✅ Chính xác! Bạn đã nắm rất tốt khái niệm này."
            if is_correct
            else f"❌ Chưa đúng. Đáp án đúng là **{correct_answer}**. Hãy đọc kỹ phần giải thích bên dưới."
        )

        return {
            "is_correct": is_correct,
            "user_answer": user_answer,
            "correct_answer": correct_answer,
            "feedback": feedback,
            "explanation": question.get("explanation", ""),
            "response_time_ms": response_time_ms
        }

    @staticmethod
    def analyze_weak_topics(
        quiz_results: List[Dict[str, Any]],
        topic_name: str
    ) -> Dict[str, Any]:
        """
        Phân tích kết quả quiz để tìm weak concepts.
        Trả về danh sách các khái niệm cần ôn tập thêm.
        """
        total = len(quiz_results)
        correct = sum(1 for r in quiz_results if r.get("is_correct", False))
        score_pct = (correct / total * 100) if total > 0 else 0

        wrong_answers = [r for r in quiz_results if not r.get("is_correct", False)]
        needs_review = score_pct < 70

        return {
            "topic_name": topic_name,
            "score_percentage": round(score_pct, 1),
            "correct_count": correct,
            "total_count": total,
            "needs_review": needs_review,
            "wrong_answer_count": len(wrong_answers),
            "recommendation": (
                "🔴 Cần ôn tập ngay — Hệ thống sẽ tự động thêm ngày ôn tập vào lịch học"
                if score_pct < 50
                else ("🟡 Cần luyện tập thêm — Làm flashcard để củng cố"
                      if score_pct < 70
                      else "✅ Tốt! Tiếp tục với chủ đề tiếp theo")
            )
        }

    # ================================================================
    # LEARNOVA v3 — New Methods
    # ================================================================

    @staticmethod
    def generate_lesson_with_vocabulary(
        topic_name: str,
        user_mastery: float,
        rag_context: List[str],
        proficiency_level: str = "intermediate"
    ) -> Dict[str, Any]:
        """
        Feature A: i+1 Adaptive Lesson với Vocabulary Highlights.
        Sinh bài học cá nhân hóa + trích xuất từ vựng khó giải thích bằng tiếng Việt.
        Không giới thiệu quá nhiều khái niệm mới cùng lúc (i+1 principle).
        """
        depth_label = (
            "cơ bản, dễ hiểu với nhiều ví dụ minh họa" if user_mastery < 40
            else ("trung cấp, kết hợp lý thuyết và thực hành" if user_mastery < 70
                  else "nâng cao, chuyên sâu với phân tích kỹ thuật")
        )
        proficiency_map = {
            "beginner": "A1-A2 (người mới bắt đầu, ưu tiên từ vựng đơn giản)",
            "elementary": "A2-B1 (cơ bản, giải thích kỹ thuật ngữ)",
            "intermediate": "B1-B2 (trung cấp, cân bằng từ mới và từ đã biết)",
            "advanced": "C1-C2 (nâng cao, có thể dùng thuật ngữ chuyên ngành)"
        }
        level_desc = proficiency_map.get(proficiency_level, proficiency_map["intermediate"])
        context_str = "\n\n---\n\n".join(rag_context) if rag_context else ""

        prompt = f"""You are an expert Vietnamese educator applying the i+1 comprehensible input principle.

Topic: "{topic_name}"
Student mastery: {user_mastery:.0f}% → Depth: {depth_label}
Student proficiency level: {level_desc}

Reference content from the textbook:
{context_str[:3000]}

Create a comprehensive lesson in MARKDOWN format that:
1. Introduces at most 5-7 new vocabulary/concepts (i+1 principle — slightly above current level)
2. Explains difficult English words/grammar in Vietnamese inline
3. Preserves original meaning and source references

Return ONLY valid JSON:
{{
  "title": "Lesson title in Vietnamese",
  "content_markdown": "Full lesson in Markdown (Vietnamese). Wrap difficult vocabulary like: **word** *(nghĩa: giải thích tiếng Việt)* — Example: The **transformer** *(máy biến đổi chuỗi)* architecture... Min 400 words.",
  "key_takeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "vocabulary_highlights": [
    {{
      "word": "English word or term",
      "meaning_vi": "Nghĩa tiếng Việt ngắn gọn",
      "source_sentence": "Câu gốc từ tài liệu chứa từ này",
      "word_type": "noun"
    }}
  ],
  "new_concepts_count": 5
}}

Requirements:
- Vietnamese language for explanations
- vocabulary_highlights: 5-10 key terms extracted from the lesson
- word_type: noun/verb/adjective/adverb/phrase
- Do NOT introduce more than 7 completely unfamiliar concepts at once"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "content_markdown" in result:
            if "vocabulary_highlights" not in result:
                result["vocabulary_highlights"] = []
            return result

        # Fallback to basic lesson
        basic = AIEngine._fallback_lesson(topic_name, user_mastery, context_str)
        basic["vocabulary_highlights"] = []
        basic["new_concepts_count"] = 0
        return basic

    @staticmethod
    def generate_vocabulary_card(
        word: str,
        source_sentence: str,
        rag_context: List[str],
        target_language: str = "en"
    ) -> Dict[str, Any]:
        """
        Feature C: Sinh Vocabulary Card chi tiết cho một từ vựng.
        Trả về meaning_vi, examples, collocations, pronunciation guide.
        """
        context_str = "\n\n---\n\n".join(rag_context[:3]) if rag_context else ""

        prompt = f"""You are an expert Vietnamese language learning specialist.

Word/Phrase: "{word}"
Found in sentence: "{source_sentence}"
Context from document:
{context_str[:1500]}

Create a detailed vocabulary learning card. Return ONLY valid JSON:
{{
  "word": "{word}",
  "word_type": "noun",
  "meaning_vi": "Nghĩa tiếng Việt rõ ràng, chính xác",
  "pronunciation": "Phiên âm IPA hoặc hướng dẫn đọc: /ˈwɜːrd/",
  "source_sentence": "{source_sentence}",
  "example_sentences": [
    {{"en": "English example sentence 1", "vi": "Bản dịch tiếng Việt 1"}},
    {{"en": "English example sentence 2", "vi": "Bản dịch tiếng Việt 2"}}
  ],
  "collocations": ["common collocation 1", "verb + {word}", "adjective + {word}"],
  "synonyms": ["synonym 1", "synonym 2"],
  "usage_note": "Ghi chú về cách dùng hoặc ngữ cảnh thích hợp (tiếng Việt)"
}}

Requirements:
- meaning_vi: rõ ràng, dễ hiểu, bằng tiếng Việt
- example_sentences: lấy từ hoặc liên quan đến context tài liệu
- collocations: 3-5 cụm từ thông dụng
- pronunciation: IPA notation nếu có thể"""

        result = _call_gemini(prompt, expect_json=True, timeout=10)

        if result and "meaning_vi" in result and len(result["meaning_vi"].strip()) > 2 and "Vui lòng tra từ điển" not in result["meaning_vi"]:
            return result

        # High-speed accurate fallback translation
        translated_meaning = _quick_translate_vi(word)
        translated_sentence = _quick_translate_vi(source_sentence) if source_sentence else ""

        is_phrase = len(word.split()) > 1
        w_type = "phrase" if is_phrase else "noun"
        ipa = f"/{word.lower().replace(' ', '·')}/"

        return {
            "word": word,
            "word_type": w_type,
            "meaning_vi": translated_meaning or f"Nghĩa tiếng Việt của '{word}'",
            "pronunciation": ipa,
            "source_sentence": source_sentence,
            "example_sentences": [
                {
                    "en": source_sentence or f"The term '{word}' is frequently used in academic contexts.",
                    "vi": translated_sentence or f"Thuật ngữ '{word}' (nghĩa là: {translated_meaning}) thường được sử dụng trong bài đọc."
                }
            ],
            "collocations": [f"key {word}", f"apply {word}", f"study of {word}"],
            "synonyms": [],
            "usage_note": f"Tra cứu nhanh cho từ/cụm từ '{word}'."
        }


    @staticmethod
    def generate_multi_type_quiz(
        topic_name: str,
        user_mastery: float,
        rag_context: List[str],
        question_count: int = 5,
        exercise_types: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Feature B: Sinh câu hỏi đa dạng loại (multi-type exercises).
        Hỗ trợ: multiple_choice, fill_blank, sentence_construction, recall.
        """
        if exercise_types is None:
            if user_mastery < 40:
                exercise_types = ["multiple_choice", "fill_blank"]
            elif user_mastery < 70:
                exercise_types = ["multiple_choice", "fill_blank", "recall"]
            else:
                exercise_types = ["fill_blank", "recall", "sentence_construction"]

        types_str = ", ".join(exercise_types)
        difficulty_label = (
            "easy (basic recognition)" if user_mastery < 40
            else ("medium (understanding and application)" if user_mastery < 70
                  else "hard (production and synthesis)")
        )
        context_str = "\n\n---\n\n".join(rag_context) if rag_context else ""

        prompt = f"""You are an expert language educator creating diverse exercise types.

Topic: "{topic_name}"
Student mastery: {user_mastery:.0f}% → {difficulty_label}
Exercise types to include: {types_str}
Number of questions: {question_count}

Reference content:
{context_str[:3000]}

Generate exercises. Return ONLY valid JSON:
{{
  "questions": [
    {{
      "question_text": "Question or instruction in Vietnamese",
      "exercise_type": "multiple_choice",
      "question_type": "multiple_choice",
      "options": [{{"id": "A", "text": "..."}}, {{"id": "B", "text": "..."}}, {{"id": "C", "text": "..."}}, {{"id": "D", "text": "..."}}],
      "correct_answer": "A",
      "explanation": "Giải thích tại sao đúng (Vietnamese)",
      "difficulty": 2,
      "requires_ai_grading": false
    }},
    {{
      "question_text": "Điền vào chỗ trống: The ___ (transformer/encoder/decoder) processes input tokens in parallel.",
      "exercise_type": "fill_blank",
      "question_type": "short_answer",
      "options": [],
      "correct_answer": "transformer",
      "acceptable_answers": ["transformer", "Transformer"],
      "explanation": "Transformer xử lý các token đầu vào song song.",
      "difficulty": 2,
      "requires_ai_grading": false
    }},
    {{
      "question_text": "Hãy viết một câu giải thích khái niệm [concept] bằng ngôn ngữ của bạn.",
      "exercise_type": "recall",
      "question_type": "short_answer",
      "options": [],
      "correct_answer": "",
      "grading_rubric": "Câu trả lời phải đề cập đến: [key point 1], [key point 2]",
      "explanation": "Đây là câu hỏi tự do — AI sẽ chấm điểm dựa trên rubric.",
      "difficulty": 3,
      "requires_ai_grading": true
    }}
  ]
}}

Rules:
- Mix different exercise_type based on the requested types list
- fill_blank: dùng ___ để đánh dấu chỗ trống, correct_answer là từ/cụm từ cần điền
- recall: câu hỏi mở, cần AI grading — set requires_ai_grading: true
- sentence_construction: yêu cầu viết câu hoàn chỉnh
- All text Vietnamese, based strictly on reference content"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "questions" in result and len(result["questions"]) > 0:
            return result["questions"]

        # Fallback to basic MC questions
        return AIEngine._fallback_quiz(topic_name, user_mastery, question_count)

    @staticmethod
    def grade_open_answer(
        question_text: str,
        grading_rubric: str,
        user_answer: str,
        rag_context: List[str],
        topic_name: str
    ) -> Dict[str, Any]:
        """
        Feature B: Gemini chấm điểm câu trả lời mở (recall, sentence_construction).
        Trả về score (0-100), feedback, identified_errors.
        """
        context_str = "\n\n---\n\n".join(rag_context[:3]) if rag_context else ""

        prompt = f"""You are an expert language teacher grading a student's open-ended answer.

Topic: "{topic_name}"
Question: "{question_text}"
Grading Rubric: "{grading_rubric}"
Reference material: {context_str[:1500]}

Student's answer: "{user_answer}"

Grade the answer and provide feedback. Return ONLY valid JSON:
{{
  "score": 75,
  "is_acceptable": true,
  "feedback_vi": "Nhận xét chi tiết bằng tiếng Việt: điểm tốt và điểm cần cải thiện",
  "correct_points": ["Điểm đúng 1", "Điểm đúng 2"],
  "missing_points": ["Điểm còn thiếu 1"],
  "errors_detected": [
    {{
      "error_type": "vocabulary",
      "user_input": "từ/cụm từ sai của user",
      "correct_form": "Dạng đúng",
      "error_detail": "Giải thích lỗi"
    }}
  ],
  "improved_version": "Câu trả lời mẫu cải thiện (tiếng Việt/English tùy câu hỏi)"
}}

Rules:
- score: 0-100 (70+ = acceptable)
- is_acceptable: true if score >= 60
- errors_detected: grammar, vocabulary, comprehension errors found
- Be constructive and encouraging in Vietnamese"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "score" in result:
            return result

        # Fallback grading
        has_content = len(user_answer.strip()) > 10
        return {
            "score": 60 if has_content else 0,
            "is_acceptable": has_content,
            "feedback_vi": "Câu trả lời đã được ghi nhận. Hãy tham khảo tài liệu để bổ sung thêm chi tiết.",
            "correct_points": [],
            "missing_points": [],
            "errors_detected": [],
            "improved_version": ""
        }

    @staticmethod
    def analyze_error_patterns(
        error_logs: List[Dict[str, Any]],
        user_profile: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Feature F: Phân tích mẫu lỗi từ error_logs để sinh Personalized Feedback.
        Nhóm lỗi theo type, tìm recurring patterns, đề xuất remedial actions.
        """
        if not error_logs:
            return {
                "has_patterns": False,
                "summary": "Chưa có đủ dữ liệu lỗi để phân tích.",
                "error_categories": [],
                "recommendations": [],
                "priority_topics": []
            }

        # Build error summary for prompt
        error_summary_lines = []
        for err in error_logs[:20]:
            error_summary_lines.append(
                f"- [{err.get('error_type', 'unknown')}] {err.get('error_detail', '')} "
                f"(xảy ra {err.get('occurrence_count', 1)} lần, nguồn: {err.get('source', '')})"
            )
        error_summary_str = "\n".join(error_summary_lines)

        prompt = f"""You are an expert language learning analyst.

Student profile:
- Overall mastery: {user_profile.get('overall_mastery', 0):.0f}%
- Total topics studied: {user_profile.get('total_topics', 0)}

Recurring errors detected:
{error_summary_str}

Analyze these error patterns and provide personalized recommendations. Return ONLY valid JSON:
{{
  "has_patterns": true,
  "summary": "Tóm tắt tình trạng học tập và các vấn đề chính (tiếng Việt, 2-3 câu)",
  "error_categories": [
    {{
      "category": "vocabulary",
      "label": "Từ vựng",
      "count": 5,
      "severity": "high",
      "description": "Mô tả vấn đề cụ thể"
    }}
  ],
  "recommendations": [
    {{
      "type": "flashcard_review",
      "title": "Tiêu đề gợi ý",
      "description": "Mô tả chi tiết hành động cần làm",
      "priority": "high"
    }}
  ],
  "priority_topics": ["topic cần ưu tiên ôn tập 1", "topic 2"]
}}"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "has_patterns" in result:
            return result

        # Fallback analysis
        from collections import Counter
        type_counts = Counter(e.get("error_type", "unknown") for e in error_logs)
        categories = [
            {"category": t, "label": t.capitalize(), "count": c, "severity": "medium", "description": f"{c} lỗi loại {t}"}
            for t, c in type_counts.most_common(5)
        ]
        return {
            "has_patterns": True,
            "summary": f"Phát hiện {len(error_logs)} lỗi. Loại lỗi phổ biến nhất: {type_counts.most_common(1)[0][0] if type_counts else 'chưa xác định'}.",
            "error_categories": categories,
            "recommendations": [
                {"type": "flashcard_review", "title": "Ôn tập Flashcard", "description": "Ôn lại các từ vựng hay gặp lỗi", "priority": "high"}
            ],
            "priority_topics": []
        }

    @staticmethod
    def generate_remedial_exercises(
        error_categories: List[Dict[str, Any]],
        rag_context: List[str],
        topic_name: str
    ) -> List[Dict[str, Any]]:
        """
        Feature F: Sinh bài tập khắc phục dựa trên error patterns.
        """
        context_str = "\n\n---\n\n".join(rag_context[:3]) if rag_context else ""
        categories_str = ", ".join([c.get("category", "") for c in error_categories[:3]])

        prompt = f"""You are creating targeted remedial exercises for a language learner.

Topic: "{topic_name}"
Error patterns to address: {categories_str}
Reference material: {context_str[:2000]}

Create 3-5 targeted exercises specifically addressing these errors. Return ONLY valid JSON:
{{
  "exercises": [
    {{
      "exercise_type": "fill_blank",
      "question_text": "Câu hỏi nhắm vào lỗi cụ thể",
      "target_error": "vocabulary",
      "correct_answer": "đáp án",
      "explanation": "Giải thích tại sao đúng",
      "difficulty": 2
    }}
  ]
}}

Requirements:
- Each exercise must directly target one of the identified error patterns
- Use Vietnamese for instructions and explanations
- Based on the reference material content"""

        result = _call_gemini(prompt, expect_json=True)

        if result and "exercises" in result:
            return result["exercises"]

        return [
            {
                "exercise_type": "fill_blank",
                "question_text": f"Ôn tập lại khái niệm chính của {topic_name}: ___",
                "target_error": categories_str,
                "correct_answer": topic_name,
                "explanation": f"Hãy ôn lại định nghĩa và cách dùng các khái niệm trong {topic_name}.",
                "difficulty": 2
            }
        ]

    @staticmethod
    def extract_scenario_vocabulary(
        scenario_title: str,
        user_message: str,
        ai_response: str,
        rag_context: List[str]
    ) -> Dict[str, Any]:
        """
        Feature E: Trích xuất từ vựng và lỗi từ một lượt roleplay scenario.
        Gọi sau mỗi interact_scenario_step để build vocabulary & error log.
        """
        context_str = "\n\n---\n\n".join(rag_context[:2]) if rag_context else ""

        prompt = f"""You are analyzing a language learning roleplay session.

Scenario: "{scenario_title}"
Learner said: "{user_message}"
AI response contained: "{ai_response[:500]}"
Reference material: {context_str[:1000]}

Extract vocabulary and errors from this exchange. Return ONLY valid JSON:
{{
  "vocabulary_items": [
    {{
      "word": "key term from the exchange",
      "meaning_vi": "Nghĩa tiếng Việt",
      "source_sentence": "Câu chứa từ này",
      "word_type": "noun"
    }}
  ],
  "errors_in_user_input": [
    {{
      "error_type": "grammar",
      "user_input": "câu/từ sai của user",
      "correct_form": "dạng đúng",
      "error_detail": "giải thích lỗi (Vietnamese)"
    }}
  ],
  "key_phrases_used": ["phrase 1", "phrase 2"]
}}

Extract at most 5 vocabulary items and identify real language errors (not just imperfect style)."""

        result = _call_gemini(prompt, expect_json=True)

        if result and ("vocabulary_items" in result or "errors_in_user_input" in result):
            return result

        return {"vocabulary_items": [], "errors_in_user_input": [], "key_phrases_used": []}
