"use client";

import React, { useState, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { BookOpen, Layers, Check, X, Volume2, Plus, Loader2 } from "lucide-react";

interface DictionaryData {
  word: string;
  word_type?: string;
  meaning_vi: string;
  pronunciation?: string;
  source_sentence?: string;
  example_sentences?: { en: string; vi: string }[];
  collocations?: string[];
  synonyms?: string[];
  usage_note?: string;
}

/** Vị trí vùng chọn (tính theo ký tự hiển thị) trong khối ebook chứa nó; null nếu không nằm trọn trong một khối. */
function locateEbookSelection(range: Range): { blockId: string; start: number; end: number } | null {
  const closestBlock = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-ebook-block]") ?? null;
  const block = closestBlock(range.startContainer);
  if (!block || block !== closestBlock(range.endContainer) || !block.dataset.ebookBlock) return null;

  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { blockId: block.dataset.ebookBlock, start, end: start + range.toString().length };
}

export default function SelectionContextMenu() {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState("");
  const [sourceSentence, setSourceSentence] = useState("");
  const [savedRange, setSavedRange] = useState<Range | null>(null);

  // Vùng chọn nằm trọn trong một khối của trình đọc ebook (books/[id]/read)
  const [ebookSelection, setEbookSelection] = useState<{ blockId: string; start: number; end: number } | null>(null);

  // Color picker popover state for highlighting
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Modals state
  const [dictModalOpen, setDictModalOpen] = useState(false);
  const [flashcardModalOpen, setFlashcardModalOpen] = useState(false);
  const [loadingDict, setLoadingDict] = useState(false);
  const [dictData, setDictData] = useState<DictionaryData | null>(null);

  // Flashcard form state
  const [fcFront, setFcFront] = useState("");
  const [fcBack, setFcBack] = useState("");
  // Bộ thẻ: "" = bộ mặc định "Từ vựng tự học"; còn lại là id bộ người dùng tự tạo
  const [fcDeckId, setFcDeckId] = useState("");
  const [decks, setDecks] = useState<{ id: string; name: string }[]>([]);
  const [newDeckOpen, setNewDeckOpen] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [deckBusy, setDeckBusy] = useState(false);
  const [deckError, setDeckError] = useState("");
  const [fcBackLoading, setFcBackLoading] = useState(false);
  const fcBackTouched = useRef(false);
  const [fcSaved, setFcSaved] = useState(false);
  const [fcSaving, setFcSaving] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  // Phòng thi đặt body[data-exam-mode]: "real" chỉ cho tô sáng như thi thật, "practice" thêm từ điển/ghi chú/flashcard
  const examMode = typeof document !== "undefined" ? document.body.dataset.examMode : undefined;
  const realExam = examMode === "real";

  // Global mouse selection & contextmenu listener
  useEffect(() => {
    const handleSelectionEnd = (e: MouseEvent) => {
      // If clicking inside menu or modals, don't hide
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        // Hide menu if user clicks elsewhere without selection
        if (!showColorPicker && !dictModalOpen && !flashcardModalOpen) {
          setVisible(false);
        }
        return;
      }

      const text = selection.toString().trim();
      if (text.length > 0) {
        // Extract parent sentence
        const anchorNode = selection.anchorNode;
        const parentText = anchorNode?.parentElement?.innerText || text;

        setSelectedText(text);
        setSourceSentence(parentText.length > 300 ? parentText.slice(0, 300) + "..." : parentText);

        try {
          const range = selection.getRangeAt(0);
          setSavedRange(range.cloneRange());
          setEbookSelection(locateEbookSelection(range));
          const rect = range.getBoundingClientRect();

          // Position menu above or below selected text
          const menuWidth = 320;
          let left = rect.left + rect.width / 2 - menuWidth / 2;
          let top = rect.top - 54;

          // Screen bounds adjustment
          if (top < 10) top = rect.bottom + 10;
          if (left < 10) left = 10;
          if (left + menuWidth > window.innerWidth - 10) {
            left = window.innerWidth - menuWidth - 10;
          }

          setPosition({ top, left });
          setVisible(true);
        } catch {
          setPosition({ top: e.clientY - 40, left: Math.max(10, e.clientX - 100) });
          setVisible(true);
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        e.preventDefault(); // Override standard browser right-click menu when text selected
        const text = selection.toString().trim();
        setSelectedText(text);

        try {
          const range = selection.getRangeAt(0);
          setSavedRange(range.cloneRange());
          setEbookSelection(locateEbookSelection(range));
        } catch {}

        let left = e.clientX;
        let top = e.clientY - 48;
        if (top < 10) top = e.clientY + 10;
        if (left + 320 > window.innerWidth) left = window.innerWidth - 330;

        setPosition({ top, left });
        setVisible(true);
        setShowColorPicker(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setVisible(false);
        setShowColorPicker(false);
        setDictModalOpen(false);
        setFlashcardModalOpen(false);
      }
    };

    document.addEventListener("mouseup", handleSelectionEnd);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mouseup", handleSelectionEnd);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showColorPicker, dictModalOpen, flashcardModalOpen]);

  // Instant translation helper (<50ms response)
  const fetchQuickTranslation = async (word: string, sentence: string): Promise<DictionaryData> => {
    let meaningVi = "";
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(word)}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json && json[0]) {
          meaningVi = json[0].map((part: any) => part[0]).join("").trim();
        }
      }
    } catch {}

    const isPhrase = word.trim().split(/\s+/).length > 1;
    return {
      word: word,
      word_type: isPhrase ? "phrase" : "noun",
      meaning_vi: meaningVi || `Nghĩa tiếng Việt của '${word}'`,
      pronunciation: `/${word.toLowerCase().replace(/\s+/g, "·")}/`,
      source_sentence: sentence,
      example_sentences: [
        {
          en: sentence || `The term '${word}' is commonly used in literature.`,
          vi: `Ngữ cảnh: "${sentence || word}"`
        }
      ],
      collocations: [`key ${word}`, `understand ${word}`, `apply ${word}`],
      usage_note: "Dịch nhanh ngữ cảnh."
    };
  };

  // 1. Tra cứu Từ điển (Dictionary Lookup - Sub 50ms)
  const handleLookupDictionary = async () => {
    if (!selectedText) return;
    setVisible(false);
    setShowColorPicker(false);
    setDictModalOpen(true);
    setLoadingDict(true);
    // Step 1: Render instant translation immediately (<50ms)
    const instantResult = await fetchQuickTranslation(selectedText, sourceSentence);
    setDictData(instantResult);
    setLoadingDict(false);

    // Step 2: Fetch AI-enriched data from backend in background
    try {
      const res = await apiFetch("/vocabulary/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: selectedText,
          source_sentence: sourceSentence,
        }),
      });

      if (res.ok) {
        const aiData = await res.json();
        if (aiData && aiData.meaning_vi) {
          setDictData((prev) => ({
            ...instantResult,
            ...aiData,
            meaning_vi: (aiData.meaning_vi.includes("Vui lòng tra") || !aiData.meaning_vi)
              ? instantResult.meaning_vi
              : aiData.meaning_vi
          }));
        }
      }
    } catch {}
  };

  // 2. Highlight text color
  const handleApplyHighlight = (colorClass: string) => {
    if (ebookSelection) {
      window.dispatchEvent(new CustomEvent("studia:ebook-selection", {
        detail: { action: "highlight", color: colorClass.replace("studia-hl-", ""), text: selectedText, ...ebookSelection },
      }));
      window.getSelection()?.removeAllRanges();
      setVisible(false);
      setShowColorPicker(false);
      return;
    }
    if (savedRange) {
      try {
        const mark = document.createElement("mark");
        mark.className = colorClass;
        savedRange.surroundContents(mark);
      } catch (err) {
        // Fallback for complex multi-node selections
        const mark = document.createElement("mark");
        mark.className = colorClass;
        mark.innerText = selectedText;
        savedRange.deleteContents();
        savedRange.insertNode(mark);
      }
    }
    setVisible(false);
    setShowColorPicker(false);
  };

  // 3. Open Flashcard Modal: tự điền nghĩa của chữ vừa bôi đen vào mặt sau
  const handleOpenFlashcardModal = async () => {
    const word = selectedText;
    setVisible(false);
    setShowColorPicker(false);
    setFcFront(word);
    const known = dictData && dictData.word === word && !dictData.meaning_vi.startsWith("Nghĩa tiếng Việt của") ? dictData.meaning_vi : "";
    setFcBack(known);
    fcBackTouched.current = false;
    setFcSaved(false);
    setNewDeckOpen(false);
    setNewDeckName("");
    setDeckError("");
    setFlashcardModalOpen(true);

    apiFetch("/flashcards/decks").then(async (r) => { if (r.ok) setDecks((await r.json()).decks || []); }).catch(() => {});

    if (known) return;
    setFcBackLoading(true);
    const quick = await fetchQuickTranslation(word, sourceSentence);
    if (!fcBackTouched.current && !quick.meaning_vi.startsWith("Nghĩa tiếng Việt của")) setFcBack(quick.meaning_vi);
    setFcBackLoading(false);
    // Nghĩa sát ngữ cảnh hơn từ AI thì thay vào, trừ khi người dùng đã tự sửa
    try {
      const res = await apiFetch("/vocabulary/card", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, source_sentence: sourceSentence }),
      });
      if (res.ok) {
        const ai = await res.json();
        if (ai?.meaning_vi && !ai.meaning_vi.includes("Vui lòng tra") && !fcBackTouched.current) setFcBack(ai.meaning_vi);
      }
    } catch {}
  };

  const handleCreateDeck = async () => {
    const name = newDeckName.trim();
    if (!name) return;
    setDeckBusy(true);
    setDeckError("");
    try {
      const res = await apiFetch("/flashcards/decks", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Không tạo được bộ thẻ");
      setDecks((d) => [...d, data.deck]);
      setFcDeckId(data.deck.id);
      setNewDeckOpen(false);
      setNewDeckName("");
    } catch (e: any) {
      setDeckError(e.message || "Không tạo được bộ thẻ");
    }
    setDeckBusy(false);
  };

  // Save Flashcard
  const handleSaveFlashcard = async () => {
    setFcSaving(true);
    try {
      await apiFetch("/vocabulary/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: fcFront,
          meaning_vi: fcBack,
          source_sentence: sourceSentence,
          topic_id: fcDeckId || undefined,
          create_flashcard: true,
        }),
      });
    } catch {}

    // Save to local storage cache as well
    const existing = JSON.parse(localStorage.getItem("studia_user_flashcards") || "[]");
    existing.push({
      id: Date.now(),
      front: fcFront,
      back: fcBack,
      deck: decks.find((d) => d.id === fcDeckId)?.name || "Từ vựng tự học",
      createdAt: new Date().toISOString()
    });
    localStorage.setItem("studia_user_flashcards", JSON.stringify(existing));

    setFcSaving(false);
    setFcSaved(true);
    setTimeout(() => {
      setFlashcardModalOpen(false);
    }, 1200);
  };

  // Ebook: giao việc in đậm / ghi chú cho trang đọc, nơi giữ nội dung khối và gọi API lưu
  const dispatchEbookAction = (action: "bold" | "note" | "ask") => {
    if (!ebookSelection) return;
    window.dispatchEvent(new CustomEvent("studia:ebook-selection", {
      detail: { action, text: selectedText, ...ebookSelection },
    }));
    window.getSelection()?.removeAllRanges();
    setVisible(false);
    setShowColorPicker(false);
  };

  // 4. Pronounce text (TTS)
  const handlePronounce = () => {
    if (!selectedText) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(selectedText);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <>
      {/* ─── Floating Context Menu ─── */}
      {visible && (
        <div
          ref={menuRef}
          className="studia-selection-menu"
          style={{ top: `${position.top}px`, left: `${position.left}px` }}
        >
          {/* Lookup Dictionary */}
          {!realExam && (
            <>
              <button
                className="studia-selection-btn"
                onClick={handleLookupDictionary}
                title="Tra cứu từ điển & giải thích AI"
              >
                <span>Tra từ điển</span>
              </button>

              <div className="studia-selection-divider" />
            </>
          )}

          {examMode === "practice" && (
            <>
              <button
                className="studia-selection-btn"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("studia:exam-note", { detail: { text: selectedText } }));
                  window.getSelection()?.removeAllRanges();
                  setVisible(false);
                }}
                title="Lưu đoạn này vào sổ ghi chú của lượt thi"
              >
                <span>Ghi chú</span>
              </button>
              <div className="studia-selection-divider" />
            </>
          )}

          {!realExam && ebookSelection && (
            <>
              <button className="studia-selection-btn" onClick={() => dispatchEbookAction("bold")} title="In đậm / bỏ in đậm phần đã chọn (lưu vào sách)">
                <span style={{ fontWeight: 800 }}>In đậm</span>
              </button>
              <div className="studia-selection-divider" />
              <button className="studia-selection-btn" onClick={() => dispatchEbookAction("note")} title="Thêm ghi chú vào sổ tay của sách">
                <span>Ghi chú</span>
              </button>
              <div className="studia-selection-divider" />
              <button className="studia-selection-btn" onClick={() => dispatchEbookAction("ask")} title="Hỏi AI Tutor về đoạn này (mở ở tab mới)">
                <span>Hỏi AI</span>
              </button>
              <div className="studia-selection-divider" />
            </>
          )}

          {/* Highlight options — trong trình đọc ebook, màu được lưu vào sách qua API */}
          <div style={{ position: "relative" }}>
            <button
              className="studia-selection-btn"
              onClick={() => setShowColorPicker(!showColorPicker)}
              title="Tô màu highlight văn bản"
            >
              <span>Tô sáng</span>
            </button>

            {/* Color Palette Popover */}
            {showColorPicker && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: "6px",
                  background: "var(--bg-card)",
                  border: "1px solid rgba(var(--overlay-rgb), 0.15)",
                  borderRadius: "8px",
                  padding: "8px",
                  display: "flex",
                  gap: "6px",
                  boxShadow: "var(--shadow-2)",
                  zIndex: 100000
                }}
              >
                {[
                  { cls: "studia-hl-yellow", bg: "#fef08a", label: "Vàng" },
                  { cls: "studia-hl-green", bg: "#bbf7d0", label: "Xanh lá" },
                  { cls: "studia-hl-cyan", bg: "#bae6fd", label: "Xanh dương" },
                  { cls: "studia-hl-pink", bg: "#fbcfe8", label: "Hồng" },
                  { cls: "studia-hl-purple", bg: "#e9d5ff", label: "Tím" },
                ].map((c) => (
                  <button
                    key={c.cls}
                    onClick={() => handleApplyHighlight(c.cls)}
                    title={`Tô màu ${c.label}`}
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: c.bg,
                      border: "2px solid rgba(var(--overlay-rgb), 0.3)",
                      cursor: "pointer",
                      transition: "transform 0.15s ease"
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                  />
                ))}
              </div>
            )}
          </div>

          {!realExam && (
            <>
              <div className="studia-selection-divider" />

              {/* Add to Flashcard */}
              <button
                className="studia-selection-btn"
                onClick={handleOpenFlashcardModal}
                title="Tạo flashcard"
              >
                <span>Thêm Flashcard</span>
              </button>

              <div className="studia-selection-divider" />

              {/* Pronounce TTS */}
              <button
                className="studia-selection-btn"
                onClick={handlePronounce}
                title="Phát âm tiếng Anh"
              >
                <span>Đọc từ</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* ─── Dictionary Lookup Modal ─── */}
      {dictModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(6px)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px"
          }}
          onClick={() => setDictModalOpen(false)}
        >
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "12px",
              padding: "28px",
              maxWidth: "520px",
              width: "100%",
              color: "var(--text-primary)",
              boxShadow: "var(--shadow-2)",
              fontFamily: "inherit"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "8px",
                  background: "var(--primary)",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}><BookOpen size={18} strokeWidth={1.75} color="var(--on-brand)" /></div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-display)" }}>
                    Từ điển & tra cứu AI
                  </h3>
                  <div style={{ fontSize: "0.7rem", color: "var(--brand)", fontWeight: 600 }}>Trợ lý học tập Studia</div>
                </div>
              </div>
              <button aria-label="Đóng"
                onClick={() => setDictModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
              ><X size={20} strokeWidth={2} /></button>
            </div>

            {loadingDict ? (
              <div style={{ padding: "40px 0", textAlign: "center" }}>
                <div style={{ width: 36, height: 36, border: "3px solid var(--ink-secondary)", borderTopColor: "var(--brand)", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Đang phân tích ngữ cảnh bài đọc...</p>
              </div>
            ) : dictData ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Word & Pronunciation */}
                <div style={{ background: "rgba(var(--overlay-rgb), 0.04)", padding: "16px 20px", borderRadius: "12px", border: "1px solid rgba(var(--overlay-rgb), 0.08)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--brand)", fontFamily: "var(--font-display)" }}>
                      {dictData.word}
                    </div>
                    {dictData.word_type && (
                      <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: "6px", background: "var(--bg-card-hover)", color: "var(--brand)", textTransform: "uppercase" }}>
                        {dictData.word_type}
                      </span>
                    )}
                  </div>
                  {dictData.pronunciation && (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-muted)", fontSize: "0.88rem" }}>
                      <span>{dictData.pronunciation}</span>
                      <button
                        onClick={() => {
                          const u = new SpeechSynthesisUtterance(dictData.word);
                          u.lang = "en-US";
                          window.speechSynthesis.speak(u);
                        }}
                        style={{ background: "transparent", border: "none", color: "var(--brand)", cursor: "pointer", display: "flex", alignItems: "center" }}
                        title="Phát âm"
                      ><Volume2 size={18} strokeWidth={1.75} /></button>
                    </div>
                  )}
                </div>

                {/* Meaning */}
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
                    NGHĨA TIẾNG VIỆT
                  </div>
                  <div style={{ fontSize: "1.05rem", color: "var(--text-primary)", fontWeight: 700, lineHeight: 1.6, background: "var(--bg-card-hover)", padding: "14px 18px", borderRadius: "12px", border: "1px solid var(--border-subtle)" }}>
                    {dictData.meaning_vi}
                  </div>
                </div>

                {/* External Dictionary Quick Links */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <a
                    href={`https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(dictData.word)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "0.72rem", color: "var(--brand)", background: "var(--bg-card-hover)", padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--border-subtle)", textDecoration: "none", fontWeight: 600 }}
                  >
                    Cambridge Dictionary
                  </a>
                  <a
                    href={`https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(dictData.word)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "0.72rem", color: "var(--brand)", background: "var(--brand-tint)", padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--brand-tint)", textDecoration: "none", fontWeight: 600 }}
                  >
                    Oxford Learner's
                  </a>
                  <a
                    href={`https://translate.google.com/?sl=en&tl=vi&text=${encodeURIComponent(dictData.word)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "0.72rem", color: "var(--success)", background: "var(--success-tint)", padding: "4px 10px", borderRadius: "6px", border: "1px solid color-mix(in srgb, var(--success) 20%, transparent)", textDecoration: "none", fontWeight: 600 }}
                  >
                    Google Translate
                  </a>
                </div>

                {/* Example Sentences */}
                {dictData.example_sentences && dictData.example_sentences.length > 0 && (
                  <div>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: "6px" }}>
                      CÂU VÍ DỤ MINH HỌA
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {dictData.example_sentences.map((ex, idx) => (
                        <div key={idx} style={{ background: "rgba(var(--overlay-rgb), 0.03)", padding: "10px 14px", borderRadius: "8px", fontSize: "0.85rem", lineHeight: 1.6 }}>
                          <div style={{ color: "var(--text-primary)" }}>• {ex.en}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "2px" }}>{ex.vi}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                  <button
                    onClick={() => {
                      setDictModalOpen(false);
                      handleOpenFlashcardModal();
                    }}
                    style={{
                      flex: 1, padding: "11px", borderRadius: "12px",
                      background: "var(--primary)",
                      border: "none", color: "var(--on-brand)", cursor: "pointer",
                      fontWeight: 700, fontSize: "0.85rem",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                    }}
                  >
                     Tạo flashcard từ từ này
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}


      {/* ─── Add Flashcard Modal ─── */}
      {flashcardModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(6px)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px"
          }}
          onClick={() => setFlashcardModalOpen(false)}
        >
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "12px",
              padding: "28px",
              maxWidth: "480px",
              width: "100%",
              color: "var(--text-primary)",
              boxShadow: "var(--shadow-2)",
              fontFamily: "inherit"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "8px",
                  background: "var(--primary)",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}><Layers size={18} strokeWidth={1.75} color="var(--on-brand)" /></div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, fontFamily: "var(--font-display)" }}>
                    Thêm vào flashcard
                  </h3>
                  <div style={{ fontSize: "0.7rem", color: "var(--success)", fontWeight: 600 }}>Tự động nhắc ôn đúng lúc</div>
                </div>
              </div>
              <button aria-label="Đóng"
                onClick={() => setFlashcardModalOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
              ><X size={20} strokeWidth={2} /></button>
            </div>

            {fcSaved ? (
              <div style={{ padding: "30px 0", textAlign: "center" }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "color-mix(in srgb, var(--success) 20%, transparent)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}><Check size={24} strokeWidth={2.4} /></div>
                <h4 style={{ margin: 0, fontSize: "1.1rem", color: "var(--success)", fontWeight: 700 }}>Đã thêm vào bộ flashcard!</h4>
                <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginTop: "6px" }}>Từ vựng đã sẵn sàng cho các phiên ôn tập tiếp theo.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Select Deck */}
                <div>
                  <label className="label-text">Bộ thẻ</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <select
                      value={fcDeckId}
                      onChange={(e) => setFcDeckId(e.target.value)}
                      className="input-field"
                      style={{ background: "var(--bg-card)", flex: 1 }}
                    >
                      <option value="">Từ vựng tự học</option>
                      {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => { setNewDeckOpen((o) => !o); setDeckError(""); }}
                      aria-expanded={newDeckOpen}
                      style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 14px", borderRadius: "10px", border: "1.5px solid var(--border-control)", background: "transparent", color: "var(--text-primary)", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
                    ><Plus size={16} strokeWidth={2.2} /> Bộ mới</button>
                  </div>
                  {newDeckOpen && (
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      <input
                        type="text" autoFocus maxLength={80} placeholder="Tên bộ thẻ mới, ví dụ: Từ vựng Reading"
                        value={newDeckName} onChange={(e) => setNewDeckName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateDeck(); } }}
                        className="input-field" style={{ background: "var(--bg-card)", flex: 1 }}
                      />
                      <button
                        type="button" onClick={handleCreateDeck} disabled={deckBusy || !newDeckName.trim()}
                        style={{ padding: "0 16px", borderRadius: "10px", border: "none", background: "var(--primary)", color: "var(--on-brand)", fontWeight: 700, cursor: "pointer", opacity: deckBusy || !newDeckName.trim() ? 0.6 : 1 }}
                      >{deckBusy ? "Đang tạo…" : "Tạo bộ"}</button>
                    </div>
                  )}
                  {deckError && <div role="alert" style={{ color: "var(--danger)", fontSize: "0.8rem", marginTop: "6px" }}>{deckError}</div>}
                </div>

                {/* Front */}
                <div>
                  <label className="label-text">Mặt trước (từ vựng hoặc khái niệm)</label>
                  <input
                    type="text"
                    value={fcFront}
                    onChange={(e) => setFcFront(e.target.value)}
                    className="input-field"
                    style={{ background: "var(--bg-card)" }}
                  />
                </div>

                {/* Back */}
                <div>
                  <label className="label-text">Mặt sau (nghĩa và ví dụ){fcBackLoading && <Loader2 size={12} className="spin" style={{ marginLeft: 6, verticalAlign: -1 }} aria-label="Đang dịch" />}</label>
                  <textarea
                    rows={3}
                    value={fcBack}
                    placeholder={fcBackLoading ? "Đang tra nghĩa…" : "Nhập nghĩa của từ"}
                    onChange={(e) => { fcBackTouched.current = true; setFcBack(e.target.value); }}
                    className="input-field"
                    style={{ background: "var(--bg-card)", resize: "vertical" }}
                  />
                </div>

                {/* Save Button */}
                <button
                  onClick={handleSaveFlashcard}
                  disabled={fcSaving}
                  style={{
                    padding: "12px", borderRadius: "12px", marginTop: "6px",
                    background: "var(--primary)",
                    border: "none", color: "var(--on-brand)", cursor: "pointer",
                    fontWeight: 700, fontSize: "0.9rem",
                    opacity: fcSaving ? 0.7 : 1
                  }}
                >
                  {fcSaving ? "Đang lưu Flashcard..." : "Lưu VÀO BỘ FLASHCARD"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
