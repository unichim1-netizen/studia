"use client";

import { useState, useEffect, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

import { API, apiFetch } from "@/lib/api";
import DiagramView from "@/components/DiagramView";
import { Volume2, ChevronLeft, ArrowRight, Layers, Mic } from "lucide-react";

type VocabItem = {
  word: string;
  meaning_vi: string;
  source_sentence?: string;
  word_type?: string;
};

type LessonData = {
  title: string;
  content_markdown: string;
  key_takeaways: string[];
  vocabulary_highlights?: VocabItem[];
  new_concepts_count?: number;
  user_mastery?: number;
  proficiency_level?: string;
  rag_chunks_used?: number;
  vocabulary_auto_saved?: number;
};

function LessonContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const topicId = params.id as string;
  const docId = searchParams.get("doc");
  const profLevel = searchParams.get("level") || "intermediate";

  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [ragChunks, setRagChunks] = useState(0);
  const [tab, setTab] = useState<"read" | "diagram">("read");
  const [diagram, setDiagram] = useState<string | null>(null);
  const [diagramState, setDiagramState] = useState<"idle" | "loading" | "error">("idle");

  const loadDiagram = async () => {
    if (diagram || diagramState === "loading" || !lesson) return;
    setDiagramState("loading");
    try {
      const res = await apiFetch(`${API}/dual-coding/generate-mermaid`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_name: lesson.title, concept_description: (lesson.key_takeaways || []).join(". ") || lesson.content_markdown.slice(0, 800) }),
      });
      if (!res.ok) throw new Error();
      setDiagram((await res.json()).diagram_code);
      setDiagramState("idle");
    } catch {
      setDiagramState("error");
    }
  };

  // Vocabulary panel state
  const [vocabOpen, setVocabOpen] = useState(true);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [savingWord, setSavingWord] = useState<string | null>(null);
  const [expandedWord, setExpandedWord] = useState<string | null>(null);
  const [wordCardData, setWordCardData] = useState<Record<string, any>>({});
  const [loadingCard, setLoadingCard] = useState<string | null>(null);

  useEffect(() => {
    if (topicId) generateLesson();
  }, [topicId]);

  const generateLesson = async () => {
    setLoading(true);
    try {
      let topicName = "Chủ đề";
      let mastery = 0;

      if (docId) {
        const topicsRes = await apiFetch(`${API}/documents/${docId}/topics`);
        if (topicsRes.ok) {
          const data = await topicsRes.json();
          const topic = data.topics?.find((t: any) => t.id === topicId);
          if (topic) topicName = topic.name;
        }
      }

      // Feature A: Use generate-lesson-v2 (i+1 with vocab highlights)
      const res = await apiFetch(`${API}/learning-paths/generate-lesson-v2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic_id: topicId,
          topic_name: topicName,
          user_mastery: mastery,
          document_id: docId,
          proficiency_level: profLevel,
          auto_save_vocabulary: true
        })
      });

      if (res.ok) {
        const data = await res.json();
        setLesson(data);
        setRagChunks(data.rag_chunks_used || 0);
        // Mark auto-saved words
        if (data.vocabulary_highlights) {
          const autoSaved = new Set<string>(
            (data.vocabulary_highlights || []).map((v: VocabItem) => v.word)
          );
          setSavedWords(autoSaved);
        }
      }
    } catch {
      setLesson({
        title: "Bài học",
        content_markdown: "# Bài học\n\nĐang tải nội dung...",
        key_takeaways: [],
        vocabulary_highlights: []
      });
    }
    setLoading(false);
  };

  const handleSaveVocab = async (item: VocabItem) => {
    if (savedWords.has(item.word)) return;
    setSavingWord(item.word);
    try {
      const res = await apiFetch(`${API}/vocabulary/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: item.word,
          meaning_vi: item.meaning_vi,
          source_sentence: item.source_sentence || "",
          word_type: item.word_type || "noun",
          topic_id: topicId,
          document_id: docId,
          source: "lesson",
          create_flashcard: true
        })
      });
      if (res.ok) {
        setSavedWords(prev => new Set(prev).add(item.word));
      }
    } catch { /* ignore */ }
    setSavingWord(null);
  };

  const handleExpandWord = async (word: string, sourceSentence: string) => {
    if (expandedWord === word) {
      setExpandedWord(null);
      return;
    }
    setExpandedWord(word);
    if (wordCardData[word]) return;

    setLoadingCard(word);
    try {
      const res = await apiFetch(`${API}/vocabulary/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word,
          source_sentence: sourceSentence || "",
          document_id: docId,
          topic_id: topicId
        })
      });
      if (res.ok) {
        const data = await res.json();
        setWordCardData(prev => ({ ...prev, [word]: data }));
      }
    } catch { /* ignore */ }
    setLoadingCard(null);
  };

  const playTTS = (text: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US"; u.rate = 0.85;
      window.speechSynthesis.speak(u);
    }
  };

  // Simple markdown renderer
  const renderMarkdown = (md: string) => {
    if (!md) return null;
    return md.split("\n").map((line, i) => {
      if (line.startsWith("# ")) return <h1 key={i} style={{ fontSize: "1.6rem", fontWeight: 700, margin: "24px 0 12px", fontFamily: "var(--font-display)" }}>{line.slice(2)}</h1>;
      if (line.startsWith("## ")) return <h2 key={i} style={{ fontSize: "1.2rem", fontWeight: 700, margin: "20px 0 8px", color: "var(--ink)" }}>{line.slice(3)}</h2>;
      if (line.startsWith("### ")) return <h3 key={i} style={{ fontSize: "1rem", fontWeight: 700, margin: "16px 0 6px" }}>{line.slice(4)}</h3>;
      if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 4, marginLeft: 20 }}>{line.slice(2).replace(/\*\*(.*?)\*\*/g, "$1")}</li>;
      if (line.startsWith("> ")) return <blockquote key={i} style={{ borderLeft: "3px solid rgba(var(--primary-rgb), 0.5)", paddingLeft: 16, color: "var(--text-muted)", fontStyle: "italic", margin: "12px 0" }}>{line.slice(2)}</blockquote>;
      if (line.startsWith("```")) return null;
      if (line.trim() === "---" || line.trim() === "") return <br key={i} />;
      const boldLine = line
        .replace(/\*\*(.*?)\*\*/g, (_, m) => `<strong>${m}</strong>`)
        .replace(/`(.*?)`/g, (_, m) => `<code style="background:rgba(var(--primary-rgb), 0.12);color:var(--brand);padding:2px 6px;border-radius:4px;font-size:0.85em">${m}</code>`)
        .replace(/\*(nghĩa:.*?)\*/g, (_, m) => `<em style="color:var(--success);font-size:0.88em;background:var(--success-tint);padding:1px 6px;border-radius:4px">${m}</em>`);
      return <p key={i} style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 8 }} dangerouslySetInnerHTML={{ __html: boldLine }} />;
    });
  };

  if (loading) return (
    <div className="wrap">
      <div className="skeleton" style={{ height: 80 }} />
      <div className="split"><div className="skeleton" style={{ height: 520 }} /><div className="skeleton" style={{ height: 420 }} /></div>
      <p className="meta" style={{ textAlign: "center" }}>Studia đang soạn bài học vừa sức bạn…</p>
    </div>
  );

  const vocabHighlights = lesson?.vocabulary_highlights || [];
  const savedCount = vocabHighlights.filter((v) => savedWords.has(v.word)).length;
  const unsaved = vocabHighlights.filter((v) => !savedWords.has(v.word));

  return (
    <div className="wrap stagger">
      <header>
        <Link className="crumb" href={docId ? `/books/${docId}` : "/books"}><ChevronLeft size={16} strokeWidth={2} />{docId ? "Về sách" : "Thư viện sách"}</Link>
        <div className="page-head">
          <div style={{ maxWidth: 720 }}>
            <div className="row-wrap" style={{ marginBottom: 10 }}>
              <span className="st-badge st-badge-brand">Thành thạo {lesson?.user_mastery?.toFixed(0) || 0}%</span>
              {lesson?.proficiency_level && <span className="st-badge">Trình độ {lesson.proficiency_level}</span>}
              {lesson?.new_concepts_count !== undefined && <span className="st-badge st-badge-success">{lesson.new_concepts_count} khái niệm mới</span>}
            </div>
            <h1 className="page-title">{lesson?.title}</h1>
          </div>
          <ol className="row" aria-label="Các bước bài học" style={{ listStyle: "none", margin: 0, padding: 0, gap: 18, font: "550 14px/1 var(--font-sans)" }}>
            <li className="row" style={{ gap: 8, color: "var(--ink)" }}><b style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--brand)", color: "var(--on-brand)", fontSize: 12 }}>1</b>Đọc</li>
            <li className="row" style={{ gap: 8, color: vocabHighlights.length ? "var(--ink)" : "var(--ink-muted)" }}><b style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", background: savedCount === vocabHighlights.length && vocabHighlights.length ? "var(--success)" : "var(--surface-sunken)", color: savedCount === vocabHighlights.length && vocabHighlights.length ? "var(--surface)" : "var(--ink-muted)", fontSize: 12 }}>2</b>Từ vựng</li>
            <li className="row" style={{ gap: 8, color: "var(--ink-muted)" }}><b style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--surface-sunken)", fontSize: 12 }}>3</b>Quiz</li>
          </ol>
        </div>
      </header>

      <div className="split" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(300px, 1fr)" }}>
        <article className="st-card" style={{ padding: "32px 36px" }}>
          {tab === "diagram" ? (
            <div role="tabpanel" aria-label="Sơ đồ khái niệm" style={{ overflowX: "auto" }}>
              {diagramState === "loading" && <div className="skeleton" style={{ height: 320 }} />}
              {diagramState === "error" && (
                <div role="alert" className="st-alert st-alert-danger" style={{ justifyContent: "space-between" }}>
                  <span>Không tạo được sơ đồ lúc này.</span>
                  <button className="st-btn st-btn-ghost st-btn-sm" type="button" onClick={() => { setDiagramState("idle"); loadDiagram(); }}>Thử lại</button>
                </div>
              )}
              {diagram && <DiagramView code={diagram} />}
              <p className="meta" style={{ marginTop: 12 }}>Sơ đồ do AI tóm tắt từ bài học; đối chiếu với bài đọc nếu thấy chưa khớp.</p>
            </div>
          ) : (
            <div className="prose-dark">{renderMarkdown(lesson?.content_markdown || "")}</div>
          )}

          {(lesson?.key_takeaways?.length || 0) > 0 && (
            <section style={{ marginTop: 28, padding: "18px 20px", borderRadius: "var(--radius-md)", background: "var(--surface-sunken)" }} aria-labelledby="kt-h">
              <h2 id="kt-h" className="eyebrow" style={{ marginBottom: 10 }}>Ý cần nhớ</h2>
              <ul className="ink2" style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
                {lesson!.key_takeaways.map((t: string, i: number) => <li key={i}>{t}</li>)}
              </ul>
            </section>
          )}

          <div className="row" style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid var(--hairline)", justifyContent: "space-between", flexWrap: "wrap" }}>
            <span className="meta">Xong phần từ vựng, làm quiz để chốt chủ đề này.</span>
            <div className="row-wrap">
              <Link className="st-btn st-btn-ghost" href={`/tutor?topic=${topicId}${docId ? `&doc=${docId}` : ""}`}>Hỏi trợ lý AI</Link>
              <Link className="st-btn st-btn-secondary" href={`/quiz/${topicId}?mode=multi${docId ? `&doc=${docId}` : ""}`}>Quiz nhiều dạng</Link>
              <Link className="st-btn st-btn-primary" href={`/quiz/${topicId}`}>Làm quiz <ArrowRight className="st-btn-arrow" size={18} strokeWidth={2} /></Link>
            </div>
          </div>
        </article>

        <aside className="stack" style={{ gap: 16 }}>
          {vocabHighlights.length > 0 && (
            <section className="st-card" aria-labelledby="v-h">
              <div className="sec-head" style={{ marginBottom: 8 }}>
                <h2 id="v-h" className="heading-3">Từ vựng trong bài</h2>
                <span className="meta num">{savedCount}/{vocabHighlights.length} đã lưu</span>
              </div>
              <div>
                {vocabHighlights.map((item, idx) => {
                  const isSaved = savedWords.has(item.word);
                  const isSaving = savingWord === item.word;
                  const isExpanded = expandedWord === item.word;
                  const cardData = wordCardData[item.word];
                  return (
                    <div key={idx} style={{ padding: "12px 0", borderTop: idx ? "1px solid var(--hairline)" : "none" }}>
                      <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                        <button type="button" onClick={() => handleExpandWord(item.word, item.source_sentence || "")} aria-expanded={isExpanded}
                          style={{ flex: 1, minWidth: 0, background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }}>
                          <span className="row" style={{ gap: 8 }}>
                            <b style={{ font: "650 17px/24px var(--font-display)", color: "var(--ink)" }}>{item.word}</b>
                            {item.word_type && <span className="st-badge" style={{ height: 20 }}>{item.word_type}</span>}
                          </span>
                          <span className="meta" style={{ display: "block", color: "var(--ink-secondary)" }}>{item.meaning_vi}</span>
                        </button>
                        <button className="icon-btn" type="button" aria-label={`Nghe phát âm ${item.word}`} onClick={() => playTTS(item.word)} style={{ width: 36, height: 36, color: "var(--brand)" }}><Volume2 size={18} strokeWidth={1.75} /></button>
                        {isSaved ? <span className="st-badge st-badge-success">Đã lưu</span> : (
                          <button className="st-btn st-btn-secondary st-btn-sm" type="button" onClick={() => handleSaveVocab(item)} disabled={isSaving} aria-busy={isSaving || undefined}>{isSaving ? "Đang lưu…" : "Lưu"}</button>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="st-enter stack" style={{ gap: 8, marginTop: 10, padding: 12, borderRadius: "var(--radius-sm)", background: "var(--surface-sunken)", fontSize: 14 }}>
                          {loadingCard === item.word ? <span className="meta row" style={{ gap: 8 }}><span className="st-spinner" /> Đang tải chi tiết…</span> : (
                            <>
                              {cardData?.pronunciation && <span className="passage-sm muted">{cardData.pronunciation}</span>}
                              {item.source_sentence && <span className="passage-sm ink2" style={{ fontStyle: "italic", paddingLeft: 10, borderLeft: "2px solid var(--marker)" }}>{item.source_sentence}</span>}
                              {cardData?.example_sentences?.slice(0, 2).map((ex: any, ei: number) => (
                                <span key={ei}><span style={{ color: "var(--ink)", display: "block" }}>{ex.en}</span><span className="meta">{ex.vi}</span></span>
                              ))}
                              {cardData?.collocations?.length > 0 && <span className="meta">Cụm từ: {cardData.collocations.slice(0, 3).join(" · ")}</span>}
                              {cardData?.usage_note && <span className="meta">{cardData.usage_note}</span>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {unsaved.length > 1 && (
                <button className="st-btn st-btn-ghost st-btn-block" type="button" style={{ marginTop: 8 }} onClick={() => unsaved.forEach((v) => handleSaveVocab(v))}>Lưu cả {unsaved.length} từ còn lại</button>
              )}
              {lesson?.vocabulary_auto_saved !== undefined && lesson.vocabulary_auto_saved > 0 && (
                <p className="meta" style={{ marginTop: 8 }}>{lesson.vocabulary_auto_saved} từ đã tự động lưu vào flashcard.</p>
              )}
            </section>
          )}

          <section className="st-card" aria-labelledby="nx-h">
            <h2 id="nx-h" className="heading-3" style={{ marginBottom: 12 }}>Luyện thêm</h2>
            <div className="stack" style={{ gap: 8 }}>
              <Link className="lrow" href="/flashcards"><span className="tile tile-sm" aria-hidden="true"><Layers size={16} strokeWidth={1.75} /></span><span className="lrow-title" style={{ fontSize: 14.5 }}>Ôn flashcard đã lưu</span></Link>
              <Link className="lrow" href={`/scenarios${docId ? `?doc=${docId}` : ""}`}><span className="tile tile-sm tile-accent" aria-hidden="true"><Mic size={16} strokeWidth={1.75} /></span><span className="lrow-title" style={{ fontSize: 14.5 }}>Luyện hội thoại theo chủ đề</span></Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export default function LessonPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: "80vh" }} />}>
      <LessonContent />
    </Suspense>
  );
}
