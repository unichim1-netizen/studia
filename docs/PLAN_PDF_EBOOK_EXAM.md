# KẾ HOẠCH: PDF → EBOOK CHỈNH SỬA ĐƯỢC → BỘ ĐỀ PHÒNG THI ẢO + HỌC LIỆU

> Ngày lập: 13/10/2026 · Nhánh: `phase-0-foundation` · Trạng thái (14/10/2026): P0–P6 đã có code + test tự động; xem mục "Tình trạng thực hiện" bên dưới
> Cách dùng: làm tuần tự P0 → P6. Mỗi phase có **Việc cần làm** (checkbox), **Output để test** và **Điều kiện xong (DoD)**. Chỉ sang phase sau khi DoD của phase trước đạt. Tick `[x]` trực tiếp trong file này khi xong.

---

## 0. Trả lời nhanh: có tự triển khai được không?

**Có.** Không cần dịch vụ bên ngoài nào ngoài Gemini (đã có sẵn trong dự án). Chia thành 3 khối:

| Khối | Làm gì | Cách làm |
|---|---|---|
| **A. PDF Ingest Service** | PDF → trang → khối văn bản có cấu trúc (heading / đoạn / danh sách / bảng / ảnh), kèm số trang và toạ độ | `pdfplumber` + `pypdfium2` đọc text layer; trang scan thì OCR bằng Gemini Vision |
| **B. Ebook** | Đọc, sửa, ghi chú, highlight, tìm kiếm trên nội dung đã tách | Không sửa file PDF gốc. Sửa trên **bản khối (blocks)** lưu trong DB; PDF gốc giữ nguyên để đối chiếu |
| **C. Exam Builder** | Từ blocks → bộ đề có đáp án → duyệt → phòng thi ảo | Cắt đoạn bằng luật (regex) + Gemini trích xuất có schema + parser đáp án + validator + màn hình duyệt thủ công |

Ba điểm cần hiểu đúng trước khi làm:

1. **"Chỉnh sửa PDF như ebook" = chỉnh sửa bản văn bản đã tách, không phải chỉnh file PDF.** Sửa trực tiếp nhị phân PDF (giữ nguyên layout) là bài toán khác hẳn, đắt và không cần cho mục tiêu học tập. Bản đã sửa có thể xuất lại ra Markdown/PDF mới.
2. **PDF → bộ đề không thể tự động 100%.** Sách đề (ví dụ Cambridge IELTS) có bảng, sơ đồ, bản đồ, câu hỏi dạng nối. Thiết kế đúng là: máy làm bản nháp + báo lỗi rõ ràng → người duyệt sửa → mới publish. Kế hoạch này coi màn hình duyệt là bắt buộc, không phải tuỳ chọn.
3. **Listening cần file audio riêng.** PDF không chứa audio; người dùng upload mp3 và gán vào từng test. Phần "Audioscripts" trong sách được tách thành học liệu để xem lại sau khi thi.

Là **module trong backend FastAPI hiện tại** (`app/services/pdf_ingest/`, `app/services/exam_builder/`), có CLI chạy độc lập để test. Chưa tách thành microservice riêng: hiện chưa có hàng đợi/worker, tách sớm chỉ thêm việc vận hành. Giao diện module được giữ sạch để sau này bê sang worker.

---

## 1. Hiện trạng code (đã khảo sát 13/10/2026)

### Đang có
- `backend/app/api/v1/documents.py`: upload PDF → `pypdf` lấy text → chunk 600 ký tự → embedding → topics/graph → flashcards. Chạy bằng `BackgroundTasks`.
- `backend/app/api/v1/exam.py`: phiên thi IELTS, chấm band Listening/Reading, Writing chấm heuristic theo số từ, Speaking gán cứng 6.5.
- `frontend/src/app/exam/[id]/page.tsx` (1977 dòng): phòng thi 4 kỹ năng, nhận `ExamData.questions = { listening[], reading[], reading_passage, writing_task1, writing_task2, speaking }`.
- `frontend/src/app/books/[id]/page.tsx`: chỉ hiện metadata + topics, **chưa có trình đọc nội dung**.
- `SelectionContextMenu.tsx`: bôi đen → tra từ / highlight / tạo flashcard (tái sử dụng cho ebook).
- `app/core/supabase_client.py` + `local_db.py`: fallback JSON/local storage khi không có Supabase.

### Lỗi/thiếu sót phải xử lý (đưa vào P0)
| # | Vấn đề | Vị trí |
|---|---|---|
| 1 | ~~Frontend không build được vì thiếu 4 file `@/data/cambridge21_test*.json`~~ — **không còn đúng**: các file Cambridge đã được khôi phục, phần demo Cambridge giữ nguyên cho tới khi P5 thay bằng đề lấy từ DB | `frontend/src/app/exam/[id]/page.tsx:8-11` |
| 2 | Thiếu `from datetime import datetime, timezone` → `NameError` bị nuốt bởi `except`, flashcard tạo ra nhưng **không có `flashcard_states`** | `backend/app/api/v1/documents.py:152` |
| 3 | PDF scan (không có text layer) bị thay bằng câu giả "Tài liệu … Nội dung đang được cập nhật." rồi vẫn báo `completed` | `documents.py:247-248` |
| 4 | Text các trang nối liền không dấu phân cách, **mất số trang** → không trích dẫn được "trang 12" | `documents.py:241-242` |
| 5 | Bucket `documents` tạo ở chế độ **public** → PDF của người dùng ai có link cũng tải được | `documents.py:255` |
| 6 | Tên file người dùng đưa thẳng vào đường dẫn lưu trữ (`../` trong tên file thoát khỏi thư mục ở local storage) | `documents.py:251`, `local_db.py:254` |
| 7 | Đề thi là dữ liệu mẫu cứng; payload gửi cho client **có cả `correct_answer`**; chấm điểm so với đề mẫu chứ không theo đề đang thi | `exam.py:97-119, 261-262, 383-403` |
| 8 | Trang phòng thi **tạo phiên mới** mỗi lần mở thay vì nạp phiên theo `id`; không có `GET /exam/sessions/{id}` → không resume được | `exam/[id]/page.tsx:202`, `exam.py` |
| 9 | `answers` lưu dạng chuỗi JSON, mỗi câu trả lời là 1 lần đọc-sửa-ghi → trả lời nhanh 2 câu có thể mất 1 câu | `exam.py:309-321` |

---

## 2. Kiến trúc đích

```
Upload PDF
   │
   ▼
[A] pdf_ingest ── extract ──► document_pages (text + ảnh trang + nguồn text_layer/ocr)
   │              structure ─► document_blocks (heading/paragraph/list/table/image, page, bbox)
   │
   ├──► [B] Ebook API ──► Reader/Editor (sửa block, highlight, ghi chú, mục lục, tìm kiếm)
   │         └─ sửa xong ─► reindex: chunk theo block ─► embedding ─► RAG/Tutor/Lesson/Flashcard (đã có)
   │
   └──► [C] exam_builder: segment ─► extract (Gemini + schema) ─► answer key ─► validate
                 └─► exam_sets (draft) ─► màn hình duyệt ─► publish ─► exam_sessions ─► phòng thi ảo ─► chấm theo answer_key
```

### Thư viện thêm vào `backend/requirements.txt`
| Thư viện | Dùng cho | Ghi chú giấy phép |
|---|---|---|
| `pypdfium2` | chữ + cỡ font + toạ độ; render trang ra PNG (cho OCR và xem đối chiếu) | Apache-2.0 / BSD |
| `python-docx` | đọc DOCX theo style của Word | MIT |
| ~~`pdfplumber`~~ | bỏ: đo thực tế chậm hơn PDFium khoảng 20 lần (8.7 s so với 0.4 s cho 30 trang); chỉ cân nhắc lại cho việc dựng bảng | MIT |
| `Pillow` | xử lý ảnh trang, cắt hình | HPND |
| `fpdf2` (chỉ cho test) | sinh PDF mẫu trong `tests/fixtures` | LGPL, không ship |

Không dùng PyMuPDF dù tách cấu trúc tốt hơn: giấy phép AGPL buộc mở mã nguồn khi cung cấp dưới dạng dịch vụ web. OCR mặc định dùng Gemini Vision (model `settings.GEMINI_PRO_MODEL`, đã cấu hình); `rapidocr-onnxruntime` là phương án offline nếu sau này cần, chưa cài ở giai đoạn này.

### Cấu trúc file mới
```
backend/app/services/pdf_ingest/
    __init__.py        # ingest_pdf(pdf_bytes, on_progress) -> IngestResult
    models.py          # PageResult, Block, IngestResult (pydantic)
    extractor.py       # text layer theo trang, phát hiện trang scan
    ocr.py             # OcrProvider (GeminiVisionOcr, NullOcr)
    structure.py       # dòng -> block, phát hiện heading/list/table, bỏ header/footer lặp
    render.py          # trang -> PNG
    cli.py             # python -m app.services.pdf_ingest.cli <pdf> --out <dir>
backend/app/services/exam_builder/
    __init__.py        # build_exam_drafts(blocks) -> list[ExamDraft]
    schema.py          # ExamSet v1 (pydantic) + to_exam_room_payload()
    segmenter.py       # tìm Test/Listening/Part/Passage/Writing/Speaking/Answer keys
    extractor.py       # Gemini trích câu hỏi theo schema + fallback heuristic
    answer_key.py      # parse đáp án + chuẩn hoá + so khớp
    validator.py       # báo lỗi/thiếu
    cli.py             # python -m app.services.exam_builder.cli <blocks.json> --out <dir>
backend/app/api/v1/ebook.py        # blocks, annotations, progress, reindex
backend/app/api/v1/exam_sets.py    # build, list, get, patch, publish, audio
backend/sql/migration_v5.sql
backend/tests/fixtures/make_fixtures.py
backend/tests/test_pdf_ingest.py, test_ebook_api.py, test_exam_builder.py, test_exam_scoring.py
frontend/src/app/books/[id]/read/page.tsx          # ebook reader/editor
frontend/src/app/books/[id]/exam-builder/page.tsx  # duyệt đề
frontend/src/components/ebook/*                    # BlockView, BlockEditor, TocPanel, PageImagePane, AnnotationLayer
```

---

## 3. Hợp đồng dữ liệu

### 3.1. Block (đơn vị nội dung của ebook)
```json
{
  "id": "uuid",
  "document_id": "uuid",
  "page_number": 12,
  "order_index": 340,
  "block_type": "heading | paragraph | list_item | table | image | page_break",
  "level": 2,
  "text": "READING PASSAGE 1",
  "data": { "rows": [["..."]], "image_path": "..." },
  "bbox": [72.0, 90.5, 410.2, 112.0],
  "text_source": "text_layer | ocr | manual",
  "confidence": 1.0,
  "original_text": "READING PASSAGE 1",
  "is_edited": false
}
```
- `text` dùng Markdown nội dòng (`**đậm**`, `*nghiêng*`). `original_text` không bao giờ bị ghi đè → luôn "khôi phục bản gốc" được.
- `order_index` cách nhau 10 để chèn block mới không phải đánh số lại.

### 3.2. ExamSet v1 (lưu ở `exam_sets.content`, **không chứa đáp án**)
```json
{
  "schema_version": 1,
  "family": "ielts",
  "mode": "academic",
  "title": "Test 1",
  "sections": {
    "listening": {
      "audio_url": null,
      "parts": [{
        "part": 1,
        "groups": [{
          "instruction": "Complete the notes. Write ONE WORD AND/OR A NUMBER for each answer.",
          "type": "note_completion",
          "word_limit": 1,
          "context_title": "…",
          "shared_options": null,
          "image_url": null,
          "questions": [{ "number": 1, "question": "… 1 ___ …", "options": null }]
        }]
      }]
    },
    "reading": {
      "passages": [{
        "index": 1,
        "title": "…",
        "body_markdown": "…",
        "source_block_ids": ["uuid"],
        "groups": [ /* cùng cấu trúc group như listening */ ]
      }]
    },
    "writing": {
      "task1": { "prompt": "…", "image_url": null, "min_words": 150 },
      "task2": { "prompt": "…", "min_words": 250 }
    },
    "speaking": {
      "part1": { "questions": ["…"] },
      "part2": { "cue_card": "…" },
      "part3": { "questions": ["…"] }
    }
  }
}
```
Loại câu hỏi hợp lệ (`type`): `multiple_choice`, `multiple_select`, `true_false_ng`, `yes_no_ng`, `matching_headings`, `matching_information`, `matching_features`, `sentence_completion`, `summary_completion`, `note_completion`, `table_completion`, `form_completion`, `flow_chart_completion`, `diagram_labelling`, `map_labelling`, `short_answer`.

### 3.3. Answer key (lưu ở `exam_sets.answer_key`, chỉ backend đọc)
```json
{
  "listening": { "1": { "accept": ["engine"] }, "21": { "accept": ["A"], "pair_with": 22, "any_order": true } },
  "reading":   { "14": { "accept": ["TRUE"] }, "27": { "accept": ["wind", "winds"] } }
}
```
Luật so khớp (`answer_key.py::is_correct`): bỏ khoảng trắng thừa, không phân biệt hoa thường, bỏ mạo từ đầu khi đáp án ghi `(the)`, tách biến thể theo `/`, cặp `any_order` chấm theo tập hợp.

### 3.4. Payload cho phòng thi (adapter `to_exam_room_payload`)
Giữ nguyên các khoá phòng thi đang đọc và **bổ sung** khoá mới, để không phải viết lại 1977 dòng trong một lần:
```json
{
  "listening": [{ "number": 1, "type": "note_completion", "section": "Part 1", "question": "…", "options": null, "group_instruction": "…", "image_url": null }],
  "reading":   [{ "number": 1, "type": "true_false_ng", "passage": "Passage 1", "question": "…", "options": ["TRUE","FALSE","NOT GIVEN"], "group_instruction": "…" }],
  "reading_passage": "…(nối 3 passage, tương thích cũ)…",
  "reading_passages": [{ "index": 1, "title": "…", "body_markdown": "…" }],
  "writing_task1": "…", "writing_task1_image": null, "writing_task2": "…",
  "speaking": { "part1": {…}, "part2": {…}, "part3": {…} },
  "listening_audio": "…signed url…"
}
```
Tuyệt đối không có `correct_answer` trong payload này.

### 3.5. Migration `backend/sql/migration_v5.sql`
| Bảng | Cột chính |
|---|---|
| `documents` (ALTER) | `page_count INT`, `doc_kind TEXT DEFAULT 'study'` (`study`/`exam_source`), `ingest_stage TEXT`, `ingest_progress NUMERIC`, `ingest_error TEXT`, `ocr_page_count INT`, `index_dirty BOOLEAN DEFAULT false`, `content_version INT DEFAULT 1` |
| `document_pages` | `id`, `document_id FK`, `page_number`, `width`, `height`, `image_path`, `text_source`, `char_count`, `raw_text`; UNIQUE(`document_id`,`page_number`) |
| `document_blocks` | các trường ở 3.1 + `deleted_at`, `updated_at`; INDEX(`document_id`,`order_index`) |
| `document_block_revisions` | `id`, `block_id FK`, `text`, `block_type`, `created_at` |
| `document_annotations` | `id`, `user_id`, `document_id`, `block_id`, `kind` (`highlight`/`note`/`bookmark`), `start_offset`, `end_offset`, `color`, `note`, `created_at` |
| `reading_progress` | PK(`user_id`,`document_id`), `last_block_id`, `percent`, `updated_at` |
| `exam_sets` | `id`, `user_id`, `source_document_id FK NULL`, `title`, `family`, `mode`, `status` (`draft`/`published`/`archived`), `content JSONB`, `answer_key JSONB`, `validation JSONB`, `listening_audio_path`, `created_at`, `updated_at` |
| `exam_sessions` (ALTER) | `exam_set_id UUID NULL FK`, `answers_json JSONB DEFAULT '{}'` |
| `document_chunks` (dùng `metadata` sẵn có) | thêm `page_start`, `page_end`, `block_ids`, `heading_path`, `content_hash` |

RLS: "Owner access" cho `document_annotations`, `reading_progress`, `exam_sets`; các bảng phái sinh (`document_pages`, `document_blocks`, `document_block_revisions`) chỉ bật RLS không policy (chỉ `service_role`), đúng theo cách làm ở `migration_v4.sql`. Thêm RPC `exam_session_set_answer(session_id, key, value)` dùng `jsonb_set` để ghi 1 câu trả lời nguyên tử. Đồng thời khai báo các bảng mới trong `local_db.py` để chế độ fallback vẫn chạy.

---

## P0 — Dọn nền (làm trước, nhỏ)

**Việc cần làm**
- [~] ~~Gỡ import `@/data/cambridge21_test*.json`~~ — bỏ qua: file Cambridge đã được khôi phục nên không còn lỗi build; giữ nguyên demo.
- [x] Thêm import `datetime, timezone` ở `documents.py`.
- [x] `safe_filename()` trong `app/core/uploads.py`, dùng cho `storage_path`; `LocalStorageBucket.upload` chặn đường dẫn thoát khỏi bucket.
- [x] Kiểm tra upload (`validate_pdf_bytes`): chữ ký `%PDF-`, `MAX_PDF_MB` (100), `MAX_PDF_PAGES` (800), PDF hỏng, PDF có mật khẩu.
- [x] Bucket `documents` private (bucket cũ đang public được chuyển về private ở lần upload kế tiếp); `GET /documents/{id}/file-url` trả signed URL 10 phút; `documents.file_path` giờ lưu đường dẫn object (bản ghi cũ lưu public URL vẫn đọc được); `books/[id]/page.tsx` mở PDF gốc qua endpoint này. Ở chế độ local fallback, link tải là `/local-storage/{token}` có chữ ký và hạn dùng.
- [x] `backend/tests/fixtures/make_fixtures.py` sinh `text_book.pdf` (6 trang), `scanned.pdf` (2 trang ảnh), `mini_ielts.pdf` (19 trang) + `*.expected.json` chứa đáp án đúng để P1/P4 đối chiếu. PDF sinh ra không commit (`tests/fixtures/.gitignore`).

**Output để test**
| Lệnh | Kết quả mong đợi | Kết quả 13/10/2026 |
|---|---|---|
| `cd frontend && npx tsc --noEmit` | 0 lỗi | ✅ 0 lỗi |
| `cd frontend && npm run build` | build thành công | ⚠️ Biên dịch + kiểm tra kiểu qua; bước "Collecting page data" lỗi vì `next dev` đang chạy dùng chung thư mục `.next`. Cần tắt dev server rồi chạy lại để xác nhận. |
| `cd backend && python -m pytest -q` | test cũ xanh + test mới | ✅ 30 passed (12 cũ + 18 mới trong `tests/test_uploads.py`) |
| `test_auto_generated_flashcards_get_review_state` | flashcard tự sinh có `flashcard_states` | ✅ |
| `python tests/fixtures/make_fixtures.py` | tạo đúng 3 file PDF | ✅ 6 / 2 / 19 trang |

**Chưa kiểm trên Supabase thật**: signed URL và việc chuyển bucket sang private mới chỉ chạy trên local fallback trong test. Cần khởi động lại backend, upload 1 PDF, bấm "PDF gốc" ở trang sách để xác nhận.

**DoD**: các mục 2, 5, 6 ở bảng lỗi mục 1 đã đóng (mục 1 không còn áp dụng; 3, 4 đóng ở P1–P2; 7, 8, 9 đóng ở P5).

---

## Ebook MVP — làm trước một phần P1–P3 (13/10/2026)

Theo yêu cầu: upload PDF/DOCX xử lý nhanh, mở đọc/sửa ngay, tuỳ chỉnh hiển thị, in đậm, flashcard, sổ ghi chú cho từng sách.

**Đã làm**
- [x] Upload **PDF và DOCX** (`POST /documents/upload-file`; `/upload-pdf` vẫn dùng được). PDF scan bị từ chối ngay lúc upload với thông báo rõ ràng (422).
- [x] Bộ tách mới `app/services/doc_ingest/`: PDF dùng **PDFium (`pypdfium2`)** thay cho `pypdf` — nhận diện tiêu đề theo cỡ chữ, gộp dòng thành đoạn, bỏ header/footer lặp, nối từ bị ngắt dòng, mục danh sách, trang 2 cột đơn giản. DOCX dùng style của Word (Heading, List, bảng, chữ đậm).
- [x] Pipeline nền `app/services/document_pipeline.py` chạy trong threadpool (API không còn bị đứng): tách khối → **đọc được ngay** → embedding theo lô 100, chạy song song → trích chủ đề song song với embedding → flashcard các chủ đề chạy song song → ghi DB theo lô.
- [x] `migration_v5.sql`: bảng `document_blocks`, `document_notes`.
- [x] Ebook API (`app/api/v1/ebook.py`): `GET blocks` (phân trang), `GET outline`, `PATCH/POST/DELETE blocks`, `POST blocks/{id}/restore`, `GET/POST/PATCH/DELETE notes`. Tài liệu cũ được dựng khối ở lần mở đầu tiên.
- [x] Trang đọc `frontend/src/app/books/[id]/read/page.tsx`: mục lục; cỡ chữ, phông, 6 màu nền, giãn dòng, độ rộng (lưu theo trình duyệt); chế độ chỉnh sửa (sửa chữ, đổi loại khối, thêm/xoá đoạn, khôi phục bản gốc); bôi đen → **In đậm** (lưu vào sách) / **Ghi chú** / Thêm Flashcard / Tra từ; **Sổ ghi chú** theo từng sách (ghi tự do hoặc kèm trích dẫn, nhảy về đoạn, sửa, xoá).
- [x] LocalStore: ghi trì hoãn (không còn ghi đúp mỗi lần insert), có khoá + ghi nguyên tử (trước đó ghi đồng thời làm hỏng `local_db.json`).

**Số đo**
| Việc | Trước | Sau |
|---|---|---|
| Tách text sách 128 trang (English Unlimited) | 11.2 s (`pypdf`) | 3.7 s, kèm cấu trúc tiêu đề/đoạn |
| Tách text sách 146 trang (Cambridge IELTS 21) | — | 1.2–1.7 s |
| Số lời gọi embedding cho 979 chunk | 979 lời gọi nối tiếp | 10 lời gọi, 4 luồng |
| API trong lúc xử lý tài liệu | đứng toàn bộ | phục vụ bình thường |
| Test | 30 | 55 passed |

Thời gian embedding/AI thật **chưa đo được**: khoá Gemini trong `backend/.env` đang bị Google đình chỉ (`CONSUMER_SUSPENDED`), mọi lời gọi AI hiện rơi về chế độ dự phòng (embedding giả, chủ đề heuristic).

**Chưa làm (vẫn theo P1–P3)**
- [ ] OCR cho PDF scan; dựng lại bảng trong PDF; ảnh trang gốc để đối chiếu.
- [ ] Cập nhật chỉ mục AI sau khi sửa nội dung (Tutor/tìm kiếm hiện vẫn dùng bản lúc upload).
- [ ] Lịch sử sửa từng khối, tách/gộp khối bằng phím, tìm kiếm trong sách, vị trí đang đọc, xuất Markdown/PDF.
- [ ] Highlight nhiều màu lưu lâu dài (nút Highlight cũ bị ẩn trong trình đọc vì nó không lưu và sửa DOM trực tiếp).
- [ ] Giá trị `'docx'` cho cột `documents.source_type` (hiện DOCX lưu là `'text'`, nhận biết bằng đuôi `file_path`).

**Việc cần người làm**
1. Chạy `backend/sql/migration_v5.sql` trong Supabase SQL Editor. Chưa chạy thì khối nội dung và ghi chú rơi về `backend/data/local_db.json`.
2. Thay khoá Gemini mới trong `backend/.env`.
3. `pip install -r backend/requirements.txt` (thêm `pypdfium2`, `python-docx`), khởi động lại backend.

---

## Tình trạng thực hiện (cập nhật 14/10/2026)

**Kiểm chứng đã chạy:** `python -m pytest -q` → **157 passed**; `npx tsc --noEmit` → 0 lỗi; `next build` (bản sao cô lập) → thành công;
trình duyệt: luồng đầy đủ upload → dựng đề → sửa → upload audio → publish → vào phòng thi → trả lời → tải lại (khôi phục) → nộp → kết quả,
chạy trên server cô lập (không Supabase, không AI).

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| P0 Dọn nền | Xong | build frontend xác nhận ở bản sao cô lập |
| P1 Tách PDF/DOCX | Xong, trừ bảng PDF | PDFium; OCR bằng Gemini Vision (chạy được khi có khoá hợp lệ — chưa thử thật vì khoá bị đình chỉ, đã test bằng OCR giả); **bảng trong PDF vẫn thành các dòng chữ** |
| P2 API ebook + chỉ mục | Xong | chunk theo block, reindex tăng dần, tìm kiếm, vị trí đọc, lịch sử sửa, tách/gộp, xuất Markdown, xử lý lại tài liệu |
| P3 Trình đọc/sửa | Xong | highlight nhiều màu lưu lâu dài, sổ ghi chú, ảnh trang gốc, in/lưu PDF qua hộp thoại in |
| P4 Exam Builder | Xong | CLI + API + AI làm lại nhóm khó (có kiểm chứng nguyên văn); đo trên Cambridge IELTS 21 thật: 4 test × (40 Listening + 40 Reading) đủ 320/320 đáp án; 29/320 câu bị validator báo lỗi (≈9%), hầu hết là bảng/bản đồ bị dàn phẳng |
| P5 Duyệt đề + phòng thi | Xong | màn hình duyệt 3 cột, phiên thi theo đề, snapshot, tải lại vẫn thi tiếp, chấm server, xem lại từng câu |
| P6 Học liệu & hoàn thiện | Xong một phần | bài kiểm tra tự sinh từ chương (kiểm chứng nguyên văn); in/PDF; xử lý lại tài liệu |

**Chưa làm / hạn chế đã biết**
- Dựng lại **bảng** trong PDF (cả bảng điền đáp án Listening/Writing Task 1): đề dùng bảng bị tách sai → validator báo, cần sửa tay hoặc bật AI.
- Hình bản đồ/sơ đồ không được tự cắt ra từ PDF: phải upload hình ở màn hình duyệt (trang gốc hiện bên cạnh để chụp/cắt).
- Speaking chưa được chấm (band null, không tính vào Overall). Writing chỉ chấm bằng AI khi có `GEMINI_API_KEY` hợp lệ; nếu không, điểm chỉ là ước lượng theo độ dài và được ghi rõ.
- Chưa tạo **flashcard/quiz theo khoảng khối kèm liên kết "Xem trong sách"** và chưa trích **Knowledge Graph theo đường dẫn tiêu đề** (P6 mục 1–2). Hiện có: chọn chữ trong sách → Thêm Flashcard (cũ) và "tạo bài kiểm tra từ chương".
- "OCR lại một trang" riêng lẻ chưa có (chỉ "Xử lý lại" cả tài liệu).
- `documents.source_type` chưa có giá trị `docx` (DOCX lưu là `text`, nhận biết bằng đuôi `file_path`).
- Đáp án trong bảng `exam_sets`/`exam_sessions.exam_snapshot` nằm cùng dòng với đề: người dùng đọc trực tiếp bằng anon key vẫn thấy đáp án của đề do chính họ tạo. Phòng thi không bao giờ nhận đáp án từ API.

**Việc cần người làm trước khi dùng thật** (theo thứ tự)
1. Supabase SQL Editor: chạy lần lượt `migration_v5.sql`, `migration_v6.sql`, `migration_v7.sql` (và các bản sau tới `migration_v14.sql`). Thiếu một file thì phần tương ứng lặng lẽ rơi về `backend/data/local_db.json` (mất khi đổi máy).
2. Thay khoá Gemini hợp lệ trong `backend/.env` (OCR, trích câu hỏi bằng AI, chấm Writing, tạo bài kiểm tra).
3. `pip install -r backend/requirements.txt`; khởi động lại backend.
4. Kiểm tra trên Supabase thật: signed URL của kho `documents`, `exam-audio`, `exam-media` (bucket riêng tư).

## Rà soát đối chiếu code (29/10/2026)

Kiểm chứng: `pytest` toàn bộ **318 passed** (chạy với `SUPABASE_URL=` để không đụng Supabase thật) · `npx tsc --noEmit` 0 lỗi. Các checkbox P1–P5 bên dưới vẫn để trống vì được viết trước khi làm; bảng này là tình trạng thật.

**Đã đáp ứng** (có code + test): tách PDF/DOCX theo khối bằng PDFium (đặt ở `app/services/doc_ingest/`, không phải `pdf_ingest/` như dự kiến), phát hiện trang scan + OCR Gemini theo trang, ảnh trang gốc; ebook API đủ các route ở P2 (khối, tách/gộp, xoá mềm, khôi phục, lịch sử sửa, highlight, ghi chú, vị trí đọc, tìm kiếm, reindex tăng dần, xuất Markdown); trình đọc/sửa P3; Exam Builder P4 (segmenter, answer key, validator, extractor có fallback, sinh đề `generic`, API `exam-sets` kể cả preview/unpublish); phiên thi P5 (snapshot, `GET session` khôi phục bài và giờ, chấm theo `answer_key`, payload không có đáp án, Speaking `not_scored`, xem lại từng câu, sảnh lấy đề từ API).

**Chưa đáp ứng / lệch kế hoạch**
| # | Yêu cầu | Tình trạng | Mức |
|---|---|---|---|
| 1 | P2.2 + P2.6: tiến độ theo trang, tự chạy tiếp khi server khởi động lại; `/status` trả số trang, số khối | **Xong 29/10/2026** (cần chạy `migration_v14.sql`): cột `page_count`, `pages_done`, `ocr_page_count`, `processing_heartbeat` (ghi mỗi 30 s), `resume_count`, `ingest_error`. Vòng nền trong `main.py` (lúc khởi động và mỗi phút) tìm tài liệu quá 2 phút không có nhịp tim, chạy tiếp: PDF chỉ đọc/OCR trang chưa có khối, chỉ mục dùng lại chunk cũ, chủ đề/flashcard chỉ tạo khi thiếu; quá 3 lần thì dừng và báo lỗi. `/status` thêm `pages_done`, `block_count`, `stalled`, `resuming`, `ingest_error`; màn tiến độ hiện số trang và lý do dừng. Không làm `index_dirty` (đã có `GET /index-status`). Test: `tests/test_resume_processing.py` | ~~Cao~~ |
| 2 | P5.3: ghi câu trả lời nguyên tử qua RPC `exam_session_set_answer` | Thay bằng khoá trong tiến trình (`_locked_update`). Đúng khi chỉ 1 tiến trình uvicorn (cấu hình EC2 hiện tại); chạy nhiều worker/instance thì vẫn có thể mất câu | Trung bình |
| 3 | P5.6: "Tạo flashcard từ câu sai", "Thêm chủ đề yếu vào lịch học", đoạn audioscript liên quan ở trang kết quả | Chưa có nút nào; backend có trả `materials.audioscripts` nhưng màn kết quả chưa hiện | Trung bình |
| 4 | P6.1–P6.2: bài học/flashcard/quiz theo khoảng khối kèm "Xem trong sách"; Knowledge Graph theo heading path | Chưa làm (chunk có `heading_path` nhưng topic/flashcard chưa trỏ về khối) | Trung bình |
| 5 | P1.4 + P4.4: dựng bảng trong PDF; tự cắt hình bản đồ/sơ đồ/Task 1 | Chưa làm: bảng thành dòng chữ, hình phải upload tay ở màn duyệt | Trung bình |
| 6 | P3.4: bookmark do người đọc đặt; "Tạo quiz từ chương này" ngay trong trình đọc | Chưa có trong trình đọc (tạo đề từ chương chỉ ở màn Exam Builder) | Thấp |
| 7 | P6.4: xuất ebook ra PDF qua `export_engine.py` | Chỉ có `format=md`; PDF qua hộp thoại in của trình duyệt | Thấp |
| 8 | P1.6: CLI riêng cho bước tách PDF | Không có; CLI dựng đề nhận thẳng PDF nên vẫn test được | Thấp |
| 9 | `documents.source_type = 'docx'`; chấm Speaking trong phòng thi | Vẫn như hạn chế đã ghi ở trên | Thấp |
| 10 | P6.6: cập nhật `config.md` | Chưa kiểm | Thấp |

## Hướng dẫn kiểm thử nhanh

```bash
# 1. Toàn bộ test backend (≈1–2 phút)
cd backend && python -m pytest -q
# 2. Dựng đề từ một cuốn sách đề, không cần server
python -m app.services.exam_builder.cli "../Cambridge IELTS 21.pdf" --out ../tmp/exam
#    → mở ../tmp/exam/review.md (câu hỏi + đáp án), validation_test*.json (lỗi/cảnh báo)
# 3. Frontend
cd ../frontend && npx tsc --noEmit
```

Kịch bản tay trên app: Thư viện → upload PDF/DOCX → "Đọc & chỉnh sửa" (đổi cỡ chữ/nền, bôi đen → In đậm/Tô sáng/Ghi chú/Hỏi AI, Tìm, Trang gốc) →
"Tạo đề thi từ sách" → rà lỗi/cảnh báo, upload audio → Publish → "Thi thử IELTS" → chọn đề → làm bài, tải lại trang, nộp → xem kết quả.

---

## P1 — PDF Ingest Service (PDF → pages → blocks)

**Tính năng**
1. **Tách theo trang**: mỗi trang cho ra `raw_text`, danh sách dòng kèm cỡ font/đậm/toạ độ, kích thước trang.
2. **Phát hiện trang scan**: trang có `< 40` ký tự hoặc tỉ lệ ký tự lỗi (`�`, ký tự điều khiển) `> 20%` → đánh dấu cần OCR. Quyết định theo **từng trang**, vì sách thường trộn.
3. **OCR**: render trang 200 DPI → `GeminiVisionOcr.read(png)` trả Markdown giữ thứ tự đọc, tiêu đề, bảng. Chạy song song tối đa 4 trang, thử lại 2 lần khi lỗi. Không có `GEMINI_API_KEY` → `NullOcr`: trang để trống, ghi `ingest_error = "ocr_unavailable"`, tài liệu ở trạng thái `needs_ocr` thay vì bịa nội dung.
4. **Dựng cấu trúc** (`structure.py`):
   - gộp dòng thành đoạn theo khoảng cách dòng và thụt lề; nối từ bị ngắt bằng gạch nối cuối dòng;
   - heading = cỡ font lớn hơn cỡ phổ biến nhất của tài liệu ≥ 15% hoặc dòng ngắn in đậm/in hoa toàn bộ; cấp heading xếp theo thứ hạng cỡ font (tối đa 3 cấp);
   - `list_item` theo ký hiệu đầu dòng (`•`, `-`, `1.`, `A`, `a)`);
   - bảng lấy từ `pdfplumber.extract_tables()` → `data.rows`;
   - bỏ header/footer: dòng lặp lại ở cùng vị trí trên ≥ 60% số trang, và số trang đứng riêng;
   - trang 2 cột: sắp thứ tự đọc theo cột trái trước rồi cột phải khi phát hiện khoảng trống dọc ở giữa.
5. **Tiến độ**: callback `on_progress(stage, done, total)` với stage `extract → ocr → structure`.
6. **CLI** để test không cần server/DB.

**Việc cần làm**
- [ ] `models.py`, `extractor.py`, `render.py`, `ocr.py`, `structure.py`, `__init__.py::ingest_pdf`
- [ ] `cli.py`
- [ ] `tests/test_pdf_ingest.py`

**Output để test**

Lệnh: `cd backend && python -m app.services.pdf_ingest.cli tests/fixtures/text_book.pdf --out ../tmp/ingest/text_book`

Thư mục kết quả phải có:
| File | Nội dung kiểm tra |
|---|---|
| `summary.json` | `{"page_count": 6, "ocr_pages": 0, "block_count": N, "headings": 3+, "tables": 1, "elapsed_ms": …}` |
| `pages.json` | 6 phần tử, mỗi phần tử có `page_number`, `text_source: "text_layer"`, `char_count > 0` |
| `blocks.json` | mảng block theo hợp đồng 3.1, `order_index` tăng dần, không có block nào trùng nội dung header/footer |
| `document.md` | mở lên đọc được như sách: `#`/`##` cho chương/mục, bảng dạng Markdown, không có số trang rời |
| `pages/page-0001.png …` | ảnh từng trang (chỉ khi thêm `--render`) |

Test tự động (`pytest tests/test_pdf_ingest.py -q`):
- `test_page_count_matches` — 6 trang
- `test_headings_detected` — đúng 3 tiêu đề chương, đúng thứ tự
- `test_repeated_header_footer_removed`
- `test_hyphenated_words_joined`
- `test_table_extracted_as_rows`
- `test_two_column_reading_order`
- `test_scanned_page_flagged_for_ocr` — `scanned.pdf` 2/2 trang cần OCR
- `test_ocr_with_fake_provider` — OCR giả trả text biết trước → blocks khớp
- `test_no_ocr_provider_does_not_fabricate_text` — không còn câu "Nội dung đang được cập nhật"
- `test_encrypted_pdf_returns_clear_error`
- (đánh dấu `@pytest.mark.live`, chỉ chạy khi có key) `test_gemini_ocr_cer` — tỉ lệ sai ký tự so với văn bản gốc của `scanned.pdf` ≤ 5%

**DoD**: tất cả test không-live xanh; mở `document.md` của `text_book.pdf` và của 1 PDF thật do bạn cung cấp, đọc thấy đúng thứ tự và đúng tiêu đề. Ghi lại thời gian xử lý/trang và số lần gọi OCR vào cuối file này (mục Nhật ký) để ước lượng chi phí thật.

---

## P2 — Lưu trữ + Ebook API + lập chỉ mục theo block

**Tính năng**
1. Chạy `migration_v5.sql`.
2. Thay bước `pypdf` trong `_process_pdf_background` bằng `ingest_pdf`; lưu `document_pages`, `document_blocks`, ảnh trang (bucket private `documents`, đường dẫn `{user}/{doc}/pages/page-0001.png`). Ghi tiến độ theo từng trang vào `documents.ingest_stage/ingest_progress` → server khởi động lại thì chạy tiếp từ trang chưa xong.
3. **Chunk theo block** (`RAGEngine.chunk_blocks`): không cắt ngang heading, gộp các đoạn liền nhau tới ~600 ký tự, mỗi chunk mang `page_start`, `page_end`, `block_ids`, `heading_path`, `content_hash`. `raw_content` của document = ghép text các block (giữ tương thích cho topics/graph).
4. **Reindex tăng dần**: `POST /documents/{id}/reindex` tính lại chunk, chỉ embedding những chunk có `content_hash` mới, xoá chunk mồ côi, hạ cờ `index_dirty`.
5. Ebook API (`ebook.py`, mọi route đều `require_owned("documents", id)`):

| Method | Path | Mô tả |
|---|---|---|
| GET | `/documents/{id}/outline` | mục lục từ heading: `[{block_id, level, text, page_number}]` |
| GET | `/documents/{id}/blocks?after=&limit=200&page=` | phân trang theo `order_index` |
| GET | `/documents/{id}/pages/{n}/image-url` | signed URL ảnh trang gốc |
| PATCH | `/documents/{id}/blocks/{block_id}` | sửa `text` / `block_type` / `level`; ghi revision; `is_edited=true`; `index_dirty=true` |
| POST | `/documents/{id}/blocks` | chèn block mới `{after_block_id, block_type, text}` |
| POST | `/documents/{id}/blocks/{block_id}/split` | `{offset}` → 2 block |
| POST | `/documents/{id}/blocks/{block_id}/merge-previous` | gộp với block trước |
| DELETE | `/documents/{id}/blocks/{block_id}` | xoá mềm (`deleted_at`) |
| POST | `/documents/{id}/blocks/{block_id}/restore` | khôi phục `original_text` hoặc bỏ xoá |
| GET | `/documents/{id}/blocks/{block_id}/revisions` | lịch sử sửa |
| GET/POST/PATCH/DELETE | `/documents/{id}/annotations[/{aid}]` | highlight / ghi chú / bookmark |
| GET/PUT | `/documents/{id}/progress` | vị trí đang đọc |
| GET | `/documents/{id}/search?q=` | tìm trong sách: khớp chữ trên block + kết quả ngữ nghĩa, trả `block_id`, `page_number`, đoạn trích |
| POST | `/documents/{id}/reindex` | xem mục 4 |
| GET | `/documents/{id}/export?format=md` | xuất bản đã sửa ra Markdown |

6. `GET /documents/{id}/status` bổ sung `page_count`, `ocr_page_count`, `ingest_stage`, `ingest_progress`, `ingest_error`, `block_count`, `index_dirty`.

**Việc cần làm**
- [ ] `migration_v5.sql` + khai báo bảng trong `local_db.py`
- [ ] nối `ingest_pdf` vào pipeline, lưu pages/blocks/ảnh, tiến độ + resume
- [ ] `RAGEngine.chunk_blocks` + reindex tăng dần
- [ ] `ebook.py` + đăng ký router trong `main.py`
- [ ] `tests/test_ebook_api.py`

**Output để test**
```bash
# sau khi upload text_book.pdf và lấy được DOC
curl -s -H "Authorization: Bearer $TOKEN" localhost:8000/api/v1/documents/$DOC/status
# → {"processing_status":"completed","page_count":6,"ocr_page_count":0,"block_count":N,"ingest_progress":1.0,"index_dirty":false,...}
curl -s -H "Authorization: Bearer $TOKEN" localhost:8000/api/v1/documents/$DOC/outline
# → 3 mục cấp 1 đúng tên chương, có page_number
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Nội dung đã sửa"}' localhost:8000/api/v1/documents/$DOC/blocks/$BLOCK
# → {"id":"…","text":"Nội dung đã sửa","is_edited":true,"original_text":"<bản cũ>"}
curl -s -X POST -H "Authorization: Bearer $TOKEN" localhost:8000/api/v1/documents/$DOC/reindex
# → {"chunks_total":K,"chunks_reembedded":1,"chunks_deleted":0}
```
Test tự động (`pytest tests/test_ebook_api.py -q`, chạy trên local fallback, không cần Supabase):
- `test_upload_creates_pages_and_blocks`
- `test_blocks_pagination_is_ordered`
- `test_patch_block_keeps_original_and_writes_revision`
- `test_split_then_merge_roundtrip`
- `test_soft_delete_and_restore`
- `test_reindex_only_reembeds_changed_chunks` (đếm số lần gọi `generate_embedding` bằng mock)
- `test_chunk_metadata_has_pages_and_heading_path`
- `test_search_finds_edited_text_after_reindex`
- `test_other_user_gets_404_on_blocks_and_annotations`
- `test_annotation_crud` / `test_progress_roundtrip`
- `test_ingest_resumes_after_interruption`

**DoD**: test xanh; AI Tutor trả lời về một câu vừa sửa trong sách (sau reindex) và nêu được số trang nguồn.

---

## P3 — Ebook Reader/Editor (frontend)

Trang mới `frontend/src/app/books/[id]/read/page.tsx`, thêm nút "Đọc sách" ở `books/[id]/page.tsx`.

**Tính năng**
1. **Đọc**: cuộn liên tục, nạp 200 block mỗi lần khi cuộn; cột trái là mục lục (bấm nhảy tới heading); hiển thị số trang bên lề; tự lưu và khôi phục vị trí đọc; cỡ chữ/giãn dòng/chế độ tối dùng theme sẵn có.
2. **Đối chiếu bản gốc**: bật "Xem trang gốc" → khung bên phải hiện ảnh trang PDF của block đang xem (rất cần khi soát lỗi OCR).
3. **Sửa**: bật "Chế độ sửa" → mỗi block là 1 vùng `contentEditable`; lưu khi rời block hoặc sau 1.5 giây ngừng gõ; `Enter` giữa đoạn = tách block, `Backspace` đầu đoạn = gộp với block trước; menu block: đổi loại (đoạn ↔ tiêu đề cấp 1/2/3 ↔ danh sách), chèn block bên dưới, xoá, khôi phục bản gốc, xem lịch sử. Block đã sửa có chấm đánh dấu. Sau khi sửa hiện thanh "Nội dung đã thay đổi — Cập nhật chỉ mục AI" (gọi `reindex`; tự gọi sau 30 giây không sửa nữa).
4. **Thao tác trên văn bản** (nối với `SelectionContextMenu` sẵn có): highlight nhiều màu **lưu vào DB** và hiện lại khi mở lại; thêm ghi chú; bookmark; tra từ; tạo flashcard; mục mới "Hỏi AI về đoạn này" mở `/tutor` kèm `block_id` làm ngữ cảnh; "Tạo quiz từ chương này".
5. **Tìm trong sách**: ô tìm kiếm → danh sách kết quả, bấm nhảy tới block và tô sáng.
6. **Bảng ghi chú**: liệt kê toàn bộ highlight/ghi chú/bookmark của sách, bấm để nhảy tới.
7. **Xuất** Markdown bản đã sửa.

Dùng trình sửa tự viết theo từng block (không thêm TipTap/Slate): mỗi block trên màn hình ứng đúng 1 dòng DB nên lưu, lịch sử và reindex tăng dần đều đơn giản. Bảng ở v1 chỉ sửa theo từng ô.

**Việc cần làm**
- [ ] `components/ebook/BlockView.tsx`, `BlockEditor.tsx`, `TocPanel.tsx`, `PageImagePane.tsx`, `AnnotationLayer.tsx`, `NotesPanel.tsx`
- [ ] `books/[id]/read/page.tsx`
- [ ] mở rộng `SelectionContextMenu` để lưu highlight qua API khi đang ở trang đọc
- [ ] hiển thị tiến độ ingest (stage + %) trên `books/page.tsx` thay cho trạng thái chung chung

**Output để test** (kịch bản thủ công, chạy `npm run dev` + backend, ghi kết quả pass/fail vào Nhật ký)
| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Upload `text_book.pdf`, mở "Đọc sách" | thấy 3 chương trong mục lục, nội dung đúng thứ tự |
| 2 | Bấm chương 3 ở mục lục | nhảy đúng vị trí, lề hiện số trang đúng |
| 3 | Cuộn tới giữa sách, tải lại trang | quay lại đúng vị trí cũ |
| 4 | Bật sửa, đổi 1 câu, tải lại trang | câu mới còn nguyên; block có dấu "đã sửa" |
| 5 | Menu block → Khôi phục bản gốc | về lại câu ban đầu |
| 6 | `Enter` giữa đoạn rồi `Backspace` đầu đoạn sau | tách thành 2 rồi gộp lại như cũ |
| 7 | Bôi đen → highlight vàng, thêm ghi chú, tải lại | highlight + ghi chú còn; có trong bảng ghi chú |
| 8 | Sửa 1 thuật ngữ → "Cập nhật chỉ mục AI" → hỏi Tutor về thuật ngữ đó | Tutor trả lời theo nội dung mới |
| 9 | Upload `scanned.pdf` (có key Gemini), bật "Xem trang gốc" | chữ OCR nằm cạnh ảnh trang tương ứng |
| 10 | Tìm một từ có trong chương 2 | kết quả nhảy đúng block, từ được tô sáng |
| 11 | `npx tsc --noEmit` và `npm run build` | 0 lỗi |

**DoD**: 11/11 mục pass.

---

## P4 — Exam Builder (backend): blocks → bộ đề nháp

**Tính năng**
1. **Segmenter** (thuần luật, không gọi AI): quét block tìm mốc — `Test N`, `LISTENING`, `PART n`, `SECTION n`, `READING PASSAGE n`, `Questions 14–18` / `Question 27`, `WRITING TASK n`, `SPEAKING` + `PART n`, `Listening and Reading answer keys`, `Audioscripts`, `Sample Writing answers`. Kết quả: cây `test → skill → part/passage → question-range` kèm khoảng block và trang. Một sách nhiều test cho ra nhiều đề nháp.
2. **Extractor** (theo từng nhóm câu hỏi, không đưa cả sách vào 1 prompt): đầu vào là text các block của nhóm + câu lệnh đề; nhóm có bảng/sơ đồ/bản đồ thì gửi kèm ảnh trang. Gemini trả JSON đúng schema group ở 3.2; phản hồi được kiểm bằng pydantic, sai schema thì thử lại 1 lần kèm thông báo lỗi. Thân passage **lấy thẳng từ blocks**, không cho AI chép lại (tránh AI sửa chữ). Không có key → fallback heuristic: tách câu theo số thứ tự, đoán loại theo câu lệnh đề (`TRUE/FALSE/NOT GIVEN`, `Choose the correct letter`, `Complete the notes`…).
3. **Answer key parser** (thuần luật): đọc dạng `1 engine`, `14 TRUE`, `27 wind / winds`, `(the) river`, `21&22 A, C (in either order)`; gắn vào đúng test theo tiêu đề `TEST 1`.
4. **Hình ảnh**: ảnh nhúng ≥ 200×200 px trên trang Writing Task 1 và các nhóm `map_labelling`/`diagram_labelling` được cắt, lưu storage, gắn `image_url`; nếu không tìm được thì dùng ảnh cả trang và báo cảnh báo.
5. **Học liệu đi kèm**: phần Audioscripts và Sample answers lưu thành block có nhãn `data.role = "audioscript" | "sample_answer"`, liên kết tới test/part để xem lại sau khi thi.
6. **Validator** → `validation = { "errors": [...], "warnings": [...], "stats": {...} }`, mỗi mục có `code`, `section`, `question`, `message`, `block_id`:
   - lỗi: số câu không liên tục 1..40; trùng số; câu không có đáp án; đáp án không có câu; `multiple_choice` < 3 lựa chọn; đáp án MCQ không nằm trong lựa chọn; passage rỗng; thiếu Task 1/Task 2
   - cảnh báo: Listening chưa có audio; nhóm cần hình nhưng không có hình; passage < 400 từ; câu hỏi trích từ trang OCR độ tin cậy thấp; không xác định được loại câu
7. **Sinh đề từ tài liệu học** (không phải sách đề): `mode=generate` dùng `AIEngine.generate_multi_type_quiz` trên các chương được chọn → `ExamSet` family `generic` (danh sách câu hỏi + đáp án + giải thích + `source_block_ids`).
8. API (`exam_sets.py`):

| Method | Path | Mô tả |
|---|---|---|
| POST | `/documents/{id}/exam-sets/build` | `{mode: "parse" \| "generate", block_range?, question_count?}` → chạy nền, trả `job` |
| GET | `/exam-sets?status=&document_id=` | danh sách của người dùng |
| GET | `/exam-sets/{id}` | `content` + `validation`; kèm `answer_key` **chỉ khi là chủ sở hữu và đang ở màn hình duyệt** (`?include_key=true`) |
| PATCH | `/exam-sets/{id}` | sửa `content` / `answer_key` (toàn phần hoặc theo JSON path); chạy lại validator |
| POST | `/exam-sets/{id}/audio` | upload mp3 Listening (giới hạn 150 MB) |
| POST | `/exam-sets/{id}/images` | upload/thay hình cho task/nhóm |
| POST | `/exam-sets/{id}/validate` | chạy lại validator |
| POST | `/exam-sets/{id}/publish` | chỉ cho phép khi `errors` rỗng |
| DELETE | `/exam-sets/{id}` | lưu trữ (archive) |

**Việc cần làm**
- [ ] `schema.py`, `segmenter.py`, `answer_key.py`, `validator.py` (làm trước, không cần AI)
- [ ] `extractor.py` (Gemini + fallback)
- [ ] `cli.py`
- [ ] `exam_sets.py` + router
- [ ] `tests/test_exam_builder.py`

**Output để test**

Lệnh:
```bash
cd backend
python -m app.services.pdf_ingest.cli tests/fixtures/mini_ielts.pdf --out ../tmp/ingest/mini_ielts
python -m app.services.exam_builder.cli ../tmp/ingest/mini_ielts/blocks.json --out ../tmp/exam/mini_ielts
```
Thư mục kết quả:
| File | Nội dung kiểm tra |
|---|---|
| `segments.json` | 1 test; listening 4 part; reading 3 passage; writing 2 task; speaking 3 part; có mục `answer_keys` và `audioscripts` với khoảng trang đúng |
| `exam_test1.json` | đúng schema ExamSet v1, **không có đáp án** |
| `answer_key_test1.json` | listening 40 khoá, reading 40 khoá |
| `validation_test1.json` | `errors: []`; `warnings` có đúng 1 mục `LISTENING_AUDIO_MISSING`; `stats: {"listening":40,"reading":40,"passages":3,"writing_tasks":2}` |
| `exam_room_payload_test1.json` | đúng dạng 3.4, dán thẳng vào chế độ demo của phòng thi để xem thử |
| `review.md` | bản đọc bằng mắt: từng câu hỏi kèm đáp án bên cạnh, để soát nhanh |

Test tự động (`pytest tests/test_exam_builder.py -q`, extractor dùng Gemini giả):
- `test_segmenter_finds_all_sections`, `test_segmenter_splits_multiple_tests`
- `test_answer_key_simple` / `_variants_slash` / `_optional_article` / `_either_order_pair`
- `test_is_correct_normalisation` (bảng 20 cặp đáp án/đúng-sai)
- `test_validator_flags_missing_number`, `_duplicate_number`, `_mcq_key_not_in_options`, `_missing_key`
- `test_passage_body_copied_verbatim_from_blocks`
- `test_extractor_retries_on_schema_error`
- `test_heuristic_fallback_without_api_key_produces_draft`
- `test_payload_never_contains_answers`
- `test_publish_blocked_when_errors_exist`
- `test_other_user_cannot_read_exam_set`
- (`live`) `test_mini_ielts_end_to_end_with_gemini` — 40/40 + 40/40, đáp án phủ 100%

**DoD**: test không-live xanh; chạy CLI trên **1 sách đề thật do bạn cung cấp**, đếm trong `validation_*.json` và ghi vào Nhật ký: số câu trích đúng ngay / tổng số câu. Mục tiêu ≥ 90% câu không cần sửa tay; dưới mức đó thì chỉnh segmenter/prompt trước khi sang P5.

---

## P5 — Màn hình duyệt đề + nối phòng thi ảo + chấm điểm thật

**Tính năng**
1. **Duyệt đề** `books/[id]/exam-builder/page.tsx`:
   - nút "Tạo đề từ sách này" → tiến độ → danh sách đề nháp (Test 1…N) kèm số lỗi/cảnh báo;
   - màn hình 3 cột: (trái) cây Listening/Reading/Writing/Speaking + danh sách lỗi, bấm lỗi nhảy tới câu; (giữa) form sửa: câu hỏi, loại, lựa chọn, câu lệnh đề, giới hạn từ, đáp án và biến thể chấp nhận; thêm/xoá/đổi số câu; (phải) ảnh trang PDF gốc của câu đang chọn;
   - upload mp3 Listening, nghe thử; upload/thay hình Task 1, bản đồ, sơ đồ;
   - sửa passage (dùng lại `BlockEditor`);
   - "Xem thử như thí sinh" mở phòng thi ở chế độ xem trước; "Publish" bị khoá khi còn lỗi.
2. **Danh sách đề** `exam/page.tsx`: lấy từ `GET /exam-sets?status=published` thay cho các thẻ cứng; chọn thi cả đề hoặc từng kỹ năng.
3. **Phiên thi**:
   - `POST /exam/sessions` nhận `exam_set_id` + `exam_type`; chụp lại (snapshot) nội dung và đáp án của đề vào phiên để đề bị sửa sau này không làm sai lệch bài đã thi;
   - `GET /exam/sessions/{id}` (mới) trả payload 3.4 + câu trả lời đã lưu + thời gian còn lại tính ở server (`started_at` + thời lượng) → **tải lại trang vẫn thi tiếp**;
   - `POST /exam/sessions/{id}/answer` ghi nguyên tử qua RPC `exam_session_set_answer`;
   - trang `exam/[id]/page.tsx` nạp phiên bằng `GET` (bỏ việc tạo phiên mới khi mở trang), nối autosave Writing (đang để trống ở dòng 244-250) với `POST …/writing`.
4. **Phòng thi hiển thị đúng đề thật**: 3 passage tách riêng (`reading_passages`), câu lệnh theo nhóm (`group_instruction`), hình cho Task 1/bản đồ/sơ đồ, audio qua signed URL.
5. **Chấm điểm** theo `answer_key` của đề: `submit` trả thêm `review[]` cho từng câu `{number, user_answer, correct_answers, is_correct, type}` và thống kê đúng/sai theo loại câu; phân tích điểm yếu dựa trên loại câu sai thật (thay cho danh sách cứng trong `_generate_exam_analysis`). Writing chấm bằng `AIEngine.grade_open_answer` theo 4 tiêu chí IELTS khi có key, giữ heuristic làm fallback và **ghi rõ nguồn chấm** (`scored_by: "ai" | "heuristic"`). Speaking: khi chưa chấm thật thì trả `band: null` + `status: "not_scored"` và không tính vào Overall (bỏ số 6.5 gán cứng).
6. **Xem lại bài**: trang kết quả cho xem từng câu, đáp án đúng, đoạn passage/audioscript liên quan; nút "Tạo flashcard từ câu sai" và "Thêm chủ đề yếu vào lịch học" (nối `learning_paths`).

**Việc cần làm**
- [ ] sửa `exam.py`: `exam_set_id`, snapshot, `GET session`, ghi nguyên tử, chấm theo key, bỏ `correct_answer` khỏi payload, bỏ điểm Speaking cứng
- [ ] `books/[id]/exam-builder/page.tsx`
- [ ] `exam/page.tsx` lấy danh sách từ API
- [ ] `exam/[id]/page.tsx`: nạp theo id, resume, passages, nhóm, hình, audio, autosave
- [ ] trang/khối xem lại bài
- [ ] `tests/test_exam_scoring.py`

**Output để test**

Test tự động (`pytest tests/test_exam_scoring.py -q`):
- `test_session_payload_has_no_answers`
- `test_get_session_restores_answers_and_remaining_time`
- `test_concurrent_answers_are_not_lost` (gửi 20 câu song song → đủ 20)
- `test_scoring_uses_exam_set_key` (đáp đúng 30/40 Listening → raw 30, band 7.0)
- `test_either_order_pair_scored_once_each`
- `test_snapshot_isolated_from_later_edits`
- `test_speaking_not_scored_excluded_from_overall`
- `test_expired_session_auto_submits`
- `test_cannot_start_session_on_unpublished_or_foreign_exam_set`

Kịch bản thủ công (đầu-cuối, dùng `mini_ielts.pdf` + 1 file mp3 bất kỳ):
| # | Thao tác | Kết quả mong đợi |
|---|---|---|
| 1 | Sách → "Tạo đề từ sách này" | xuất hiện đề nháp "Test 1", 0 lỗi, 1 cảnh báo thiếu audio |
| 2 | Xoá đáp án câu 7 | xuất hiện lỗi "câu 7 thiếu đáp án", nút Publish bị khoá |
| 3 | Nhập lại đáp án, upload mp3, Publish | đề xuất hiện ở `/exam` |
| 4 | Vào thi Reading, trả lời 5 câu, tải lại trang | 5 câu còn nguyên, đồng hồ chạy tiếp không reset |
| 5 | Mở DevTools → Network, xem response phiên thi | không có đáp án ở bất kỳ đâu |
| 6 | Nộp bài với đúng 30/40 | raw 30, band Reading 7.0, bảng xem lại từng câu khớp đáp án |
| 7 | Thi Listening | audio phát được, câu lệnh từng nhóm hiển thị đúng |
| 8 | Sửa đề sau khi đã có bài nộp, mở lại kết quả cũ | kết quả cũ không đổi |
| 9 | Bấm "Tạo flashcard từ câu sai" | flashcard mới xuất hiện ở `/flashcards` |

**DoD**: test xanh, 9/9 kịch bản pass, các mục 7–9 ở bảng lỗi mục 1 đã đóng.

---

## P6 — Học liệu từ ebook + hoàn thiện

- [ ] Từ một chương/khoảng block: "Tạo bài học", "Tạo flashcards", "Tạo quiz" (tái dùng `AIEngine.generate_lesson_with_vocabulary`, `generate_flashcards`, `generate_multi_type_quiz`) với `source_block_ids`; trong bài học/thẻ có liên kết "Xem trong sách" nhảy đúng block.
- [ ] Topics/Knowledge Graph trích theo heading path thay cho toàn văn bản; mỗi topic trỏ tới khoảng block.
- [ ] Phòng thi cho đề `generic` (đề tự sinh từ tài liệu học): một danh sách câu hỏi có đồng hồ, chấm ngay, giải thích kèm trích dẫn trang.
- [ ] Xuất ebook đã sửa ra PDF (qua `export_engine.py` sẵn có) ngoài Markdown.
- [ ] Nút "Xử lý lại" cho tài liệu lỗi; nút "OCR lại trang này" trong reader; khi xử lý lại thì giữ nguyên các block `is_edited`.
- [ ] Cập nhật `config.md` mục 3, 5, 6, 9 theo những gì đã làm.

**Output để test**: `pytest -q` toàn bộ xanh; từ `text_book.pdf` tạo được 1 bài học + 5 flashcard + 1 quiz 10 câu cho chương 2, mỗi mục bấm "Xem trong sách" mở đúng đoạn; xuất PDF mở được và chứa nội dung đã sửa.

---

## 4. Rủi ro và cách xử lý

| Rủi ro | Xử lý |
|---|---|
| Sách scan dày (300+ trang) OCR chậm và tốn lượt gọi Gemini | OCR theo trang, 4 luồng, lưu kết quả từng trang để chạy tiếp; đo thời gian/chi phí thật ở P1 rồi mới đặt giới hạn `MAX_PDF_PAGES`; cho phép chọn khoảng trang khi upload |
| `BackgroundTasks` mất việc khi server restart | tiến độ lưu theo trang + tự chạy tiếp khi khởi động; nếu sau này cần nhiều người dùng đồng thời thì chuyển sang worker riêng (giao diện `ingest_pdf` không đổi) |
| Layout phức tạp (bảng, sơ đồ, 2 cột) tách sai | gửi kèm ảnh trang cho Gemini ở các nhóm có hình; validator bắt lỗi; màn hình duyệt có ảnh trang gốc bên cạnh |
| AI sửa chữ trong passage/câu hỏi | passage lấy nguyên văn từ block; câu hỏi được đối chiếu lại với text nguồn, lệch nhiều thì gắn cảnh báo |
| Xử lý lại tài liệu ghi đè phần đã sửa tay | block `is_edited` không bị ghi đè; `original_text` luôn giữ |
| Sách đề thương mại có bản quyền | file và đề chỉ thuộc tài khoản người upload, bucket private, không có tính năng chia sẻ công khai; fixture test là nội dung tự viết; PDF fixture sinh ra không commit. **Lưu ý**: PDF/audio Cambridge và `backend/data/storage/` hiện vẫn đang được git theo dõi — cần quyết định có giữ trong repo hay không |

## 5. Quyết định mặc định (đổi được, báo trước khi tới phase liên quan)

1. OCR bằng Gemini Vision, chưa cài OCR offline. *(ảnh hưởng P1)*
2. `pdfplumber` + `pypdfium2`, không dùng PyMuPDF vì AGPL. *(P1)*
3. Trình sửa ebook tự viết theo block, không dùng TipTap. *(P3)*
4. Làm IELTS trước; đề `generic` để ở P6. *(P4–P6)*
5. Module trong backend hiện tại, chưa tách microservice. *(P1)*

## 6. Nhật ký thực hiện

| Ngày | Phase | Kết quả test / số đo | Ghi chú |
|---|---|---|---|
| 13/10/2026 | — | Lập kế hoạch | |
| 14/10/2026 | P1–P6 | `pytest`: 157 passed · `tsc`: 0 lỗi · `next build` OK · Cambridge IELTS 21: 4 test đủ 40+40 câu và đáp án, tách 146 trang trong ≈1.5 s, dựng đề ≈1.5 s | Máy thử bị chậm I/O ở một số lúc (import mất ~20 s) nên lần chạy test đầy đủ có thể lâu hơn. Chưa thử với Supabase thật và khoá Gemini hợp lệ. |
| 13/10/2026 | Ebook MVP | `pytest`: 55 passed · `tsc --noEmit`: 0 lỗi · thử trên trình duyệt (server cô lập, không Supabase/không AI): đọc PDF + DOCX, đổi nền/phông/cỡ chữ, sửa đoạn, in đậm, ghi chú kèm trích dẫn đều chạy | Chưa thử trên Supabase thật (cần chạy migration v5). Khoá Gemini bị đình chỉ. |
| 13/10/2026 | P0 | `pytest`: 30 passed · `tsc --noEmit`: 0 lỗi · fixtures: 6/2/19 trang | Bỏ mục gỡ Cambridge (file đã khôi phục). `npm run build` và signed URL trên Supabase thật chưa xác nhận — xem bảng P0. Cài thêm `pytest`, `fpdf2` vào Python 3.12 hệ thống. |
| 29/10/2026 | Chạy tiếp việc dở | `pytest`: 329 passed (thêm 11 test) · `tsc`: 0 lỗi · chạy thật app với lifespan trên DB tạm: tài liệu "bỏ dở" tự hoàn tất sau khởi động | Cần chạy `migration_v14.sql` trên Supabase; chưa chạy thì vẫn hoạt động nhưng chỉ nhận ra việc dở sau 15 phút (dựa vào giờ tạo) và không hiện số trang. |
| 29/10/2026 | Rà soát + UI | `pytest`: 318 passed · `tsc --noEmit`: 0 lỗi · đo 26 trang ở 1280px và 390px trên bản xem thử cô lập | Xem mục "Rà soát đối chiếu code". Đồng nhất UI: quy tắc ghi ở `DESIGN.md` mục "Khuôn trang". |
| 19/10/2026 | Exam v2 | `pytest` (exam_sessions + exam_sets + exam_builder): 75 passed · `tsc --noEmit`: 0 lỗi · thử trên trình duyệt (server cô lập): sảnh chọn đề theo bộ, cấu hình phần thi/giờ, 2 chế độ thi thật và luyện tập, giải thích từng câu, thẻ ảnh kết quả lưu vào Khoảnh khắc học | Phiên thi lưu cấu hình trong `exam_snapshot.config` (không cần migration). Giải thích do Gemini viết khi có khoá, không thì theo luật; chưa thử Gemini thật. Backend đang chạy cần khởi động lại để nhận API mới. |
