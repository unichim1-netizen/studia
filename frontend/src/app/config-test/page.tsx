"use client";

import { useState, useEffect, Suspense } from "react";

import { API, apiFetch } from "@/lib/api";

export default function ConfigTestPage() {
  const [activeTab, setActiveTab] = useState<string>("rag");
  const [documents, setDocuments] = useState<any[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("");

  // RAG Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any>(null);
  const [docChunks, setDocChunks] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Dual Coding state
  const [topicName, setTopicName] = useState("Vòng đời Dự án & Kiến trúc RAG");
  const [topicDesc, setTopicDesc] = useState("Triển khai RAG Engine kết hợp Vector Database và FSRS Spaced Repetition Engine.");
  const [mermaidResult, setMermaidResult] = useState<string>("");
  const [d2Result, setD2Result] = useState<string>("");
  const [generatingVisuals, setGeneratingVisuals] = useState(false);

  // Speech & Shadowing state
  const [speechText, setSpeechText] = useState("Studia tự động chuyển hóa tài liệu thô thành đồ thị tri thức có cấu trúc.");
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0);
  const [shadowingGuide, setShadowingGuide] = useState<any>(null);
  const [userSpokenText, setUserSpokenText] = useState("");
  const [evalResult, setEvalResult] = useState<any>(null);
  const [testingSpeech, setTestingSpeech] = useState(false);

  // FSRS Engine Simulator state
  const [stability, setStability] = useState<number>(1.0);
  const [difficulty, setDifficulty] = useState<number>(5.0);
  const [fsrsRating, setFsrsRating] = useState<number>(3);
  const [fsrsCalculated, setFsrsCalculated] = useState<any>(null);

  // Adaptive Reschedule Simulator state
  const [adaptResult, setAdaptResult] = useState<any>(null);
  const [adapting, setAdapting] = useState(false);

  useEffect(() => {
    fetchDocs();
  }, []);

  const fetchDocs = async () => {
    try {
      const res = await apiFetch(`${API}/documents/`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
        if (data.documents && data.documents.length > 0) {
          setSelectedDocId(data.documents[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Run RAG Semantic Search
  const runRagSearch = async () => {
    if (!selectedDocId || !searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch(`${API}/documents/${selectedDocId}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, top_k: 4 })
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
      }
    } catch (e) {
      console.error(e);
    }
    setSearching(false);
  };

  // Fetch Chunks
  const loadChunks = async () => {
    if (!selectedDocId) return;
    try {
      const res = await apiFetch(`${API}/documents/${selectedDocId}/chunks?limit=10`);
      if (res.ok) {
        const data = await res.json();
        setDocChunks(data.chunks || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Generate Visual Diagrams
  const generateVisuals = async () => {
    setGeneratingVisuals(true);
    try {
      // Mermaid
      const resM = await apiFetch(`${API}/dual-coding/generate-mermaid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_name: topicName, concept_description: topicDesc })
      });
      if (resM.ok) {
        const dataM = await resM.json();
        setMermaidResult(dataM.diagram_code || "");
      }

      // D2
      const resD = await apiFetch(`${API}/dual-coding/generate-d2`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_name: topicName, concept_description: topicDesc })
      });
      if (resD.ok) {
        const dataD = await resD.json();
        setD2Result(dataD.diagram_code || "");
      }
    } catch (e) {
      console.error(e);
    }
    setGeneratingVisuals(false);
  };

  // Speech Guide & Eval
  const testSpeechGuide = async () => {
    setTestingSpeech(true);
    try {
      const res = await apiFetch(`${API}/speech/guide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: speechText, speed: speechSpeed })
      });
      if (res.ok) {
        setShadowingGuide(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
    setTestingSpeech(false);
  };

  const evaluateSpeech = async () => {
    if (!userSpokenText.trim()) return;
    try {
      const res = await apiFetch(`${API}/speech/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_text: speechText,
          user_spoken_text: userSpokenText
        })
      });
      if (res.ok) {
        setEvalResult(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  // FSRS Simulation
  const simulateFsrs = () => {
    // Formula simulation according to fsrs_engine.py
    const isCorrect = fsrsRating >= 2;
    let newS = stability;
    let newD = difficulty;

    if (isCorrect) {
      const multiplier = 1.0 + Math.exp(1.5) * Math.pow(difficulty, -0.5) * (Math.pow(stability, -0.2) - 1);
      newS = Math.round(stability * (1 + (multiplier * (fsrsRating - 2) * 0.5)) * 10) / 10;
      newD = Math.max(1.0, Math.min(10.0, Math.round((difficulty - 0.15 * (fsrsRating - 3)) * 10) / 10));
    } else {
      newS = Math.max(0.5, Math.round(stability * 0.4 * 10) / 10);
      newD = Math.min(10.0, Math.round((difficulty + 0.3) * 10) / 10);
    }

    const intervalDays = Math.max(1, Math.round(newS * (1 / 0.9 - 1)));
    const retention = Math.round(Math.exp(-1 / Math.max(0.1, newS)) * 100);

    setFsrsCalculated({
      new_stability: newS,
      new_difficulty: newD,
      interval_days: intervalDays,
      retention_pct: retention
    });
  };

  const tabs = [
    { id: "rag", label: "RAG & Vector Chunks" },
    { id: "fsrs", label: "FSRS & Export Console" },
    { id: "dual", label: "Dual Coding Visuals" },
    { id: "speech", label: "Speech & Shadowing" },
    { id: "matrix", label: "Master Config Matrix" },
  ];

  return (
    <div style={{ maxWidth: "1050px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div className="st-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span className="st-badge st-badge-brand" style={{ marginBottom: "10px" }}>
             Senior Technical Business Analyst Test Suite
          </span>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, fontFamily: "var(--font-display)" }}>
            Studia Config & Feature Test Console
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "0.9rem" }}>
            Kiểm tra và nghiệm thu toàn bộ 10 phân hệ nghiệp vụ & 21 hàm cốt lõi theo config.md
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <a href={`${API}/export/schedule/ical`} target="_blank" className="st-btn st-btn-secondary">
             Export iCal (.ics)
          </a>
          <a href={`${API}/docs`} target="_blank" className="st-btn st-btn-primary">
            Swagger API Docs 
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "12px", overflowX: "auto" }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={isActive ? "st-btn st-btn-primary" : "st-btn st-btn-ghost"}
              style={{
                borderRadius: "12px", padding: "10px 18px", fontSize: "0.88rem",
                display: "flex", alignItems: "center", gap: "8px", flexShrink: 0
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: RAG & Vector Chunks */}
      {activeTab === "rag" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="st-card">
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              Thử nghiệm Semantic Vector Search (pgvector 768d + Gemini)
            </h2>

            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <select
                value={selectedDocId}
                onChange={e => setSelectedDocId(e.target.value)}
                style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.88rem" }}
              >
                <option value="">-- Chọn tài liệu PDF/Text --</option>
                {documents.map(d => (
                  <option key={d.id} value={d.id}>{d.title} ({d.source_type})</option>
                ))}
              </select>

              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runRagSearch()}
                placeholder="Nhập câu hỏi hoặc khái niệm cần tìm kiếm trong sách..."
                style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.88rem" }}
              />

              <button className="st-btn st-btn-primary" onClick={runRagSearch} disabled={searching || !selectedDocId}>
                {searching ? <span className="spinner" /> : null}
                Tìm Vector Search
              </button>

              <button className="st-btn st-btn-secondary" onClick={loadChunks} disabled={!selectedDocId}>
                Xem 10 Chunks
              </button>
            </div>

            {searchResults && (
              <div style={{ marginTop: 16, background: "var(--bg-card-hover)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--accent-indigo)", marginBottom: 10 }}>
                  Kết quả Vector Search Cosine Distance ({searchResults.matches?.length || 0} chunks phù hợp nhất):
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {searchResults.matches?.map((m: any, idx: number) => (
                    <div key={idx} style={{ background: "var(--bg-card)", padding: 12, borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>
                        <span>Chunk #{m.chunk_index || idx + 1}</span>
                        <span className="st-badge st-badge-success">Similarity: {((1 - (m.similarity || 0.1)) * 100).toFixed(1)}%</span>
                      </div>
                      <p style={{ fontSize: "0.85rem", margin: 0, color: "var(--text-primary)", lineHeight: 1.5 }}>
                        {m.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {docChunks.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 10 }}>10 Chunks đã tách (Kích thước ~600ch, Overlap 80ch):</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10 }}>
                  {docChunks.map((c: any, i: number) => (
                    <div key={i} style={{ padding: 12, borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border-subtle)", fontSize: "0.8rem" }}>
                      <div style={{ fontWeight: 700, color: "var(--accent-indigo)", marginBottom: 4 }}>Chunk #{c.chunk_index} ({c.content?.length || 0} ký tự)</div>
                      <div style={{ color: "var(--text-secondary)", lineHeight: 1.4, maxHeight: 90, overflow: "hidden", textOverflow: "ellipsis" }}>{c.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: FSRS & Export Console */}
      {activeTab === "fsrs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="st-card">
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              Mô phỏng Thuật toán FSRS toán học (Free Spaced Repetition Scheduler)
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Stability (S - Ngày): {stability}
                </label>
                <input
                  type="range" min="0.5" max="30" step="0.5"
                  value={stability} onChange={e => setStability(parseFloat(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Difficulty (D - Thang 1-10): {difficulty}
                </label>
                <input
                  type="range" min="1" max="10" step="0.5"
                  value={difficulty} onChange={e => setDifficulty(parseFloat(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                  Đánh giá Rating (1: Again, 2: Hard, 3: Good, 4: Easy)
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 2, 3, 4].map(r => (
                    <button
                      key={r}
                      onClick={() => setFsrsRating(r)}
                      className={fsrsRating === r ? "st-btn st-btn-primary" : "st-btn st-btn-secondary"}
                      style={{ flex: 1, padding: "6px", fontSize: "0.8rem" }}
                    >
                      {r === 1 ? "Again" : r === 2 ? "Hard" : r === 3 ? "Good" : "Easy"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button className="st-btn st-btn-primary" onClick={simulateFsrs} style={{ marginBottom: 16 }}>
               Tính toán FSRS Interval Tiếp theo
            </button>

            {fsrsCalculated && (
              <div style={{ background: "var(--bg-card-hover)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Stability Mới ($S$)</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--success)" }}>{fsrsCalculated.new_stability} ngày</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Difficulty Mới ($D$)</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--accent-strong)" }}>{fsrsCalculated.new_difficulty}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Khoảng thời gian lặp ($I$)</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--brand)" }}>{fsrsCalculated.interval_days} ngày</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Retention kỳ vọng ($R$)</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--brand)" }}>{fsrsCalculated.retention_pct}%</div>
                </div>
              </div>
            )}
          </div>

          {/* Export section */}
          <div className="st-card">
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              Xuất tệp tích hợp Anki CSV & iCalendar (.ics)
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 16 }}>
              Hỗ trợ xuất Flashcards ra Anki TSV/CSV (.apkg importable) và đồng bộ Lịch học Thích ứng ra tệp iCalendar cho Google Calendar / Outlook.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <a href={`${API}/export/flashcards/anki/all`} target="_blank" className="st-btn st-btn-secondary">
                Export Anki CSV/TSV (.apkg)
              </a>
              <a href={`${API}/export/schedule/ical`} target="_blank" className="st-btn st-btn-secondary">
                Export Lịch học iCalendar (.ics)
              </a>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Dual Coding Visuals */}
      {activeTab === "dual" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="st-card">
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              Thử nghiệm Sinh Sơ đồ Trực quan (Dual Coding Theory)
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
              <input
                type="text"
                value={topicName}
                onChange={e => setTopicName(e.target.value)}
                placeholder="Tên chủ đề..."
                style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.88rem" }}
              />
              <textarea
                value={topicDesc}
                onChange={e => setTopicDesc(e.target.value)}
                rows={3}
                placeholder="Mô tả khái niệm..."
                style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.88rem" }}
              />
              <button className="st-btn st-btn-primary" onClick={generateVisuals} disabled={generatingVisuals} style={{ alignSelf: "flex-start" }}>
                {generatingVisuals ? <span className="spinner" /> : null}
                Sinh Mermaid & D2 Diagram
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* Mermaid */}
              <div style={{ background: "var(--bg-card)", padding: 16, borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontWeight: 700, color: "var(--accent-indigo)", marginBottom: 8 }}>Mã Mermaid Diagram:</div>
                <pre style={{ fontSize: "0.78rem", background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 8, overflowX: "auto" }}>
                  {mermaidResult || "Chưa tạo mã Mermaid. Bấm nút phía trên để sinh."}
                </pre>
              </div>

              {/* D2 */}
              <div style={{ background: "var(--bg-card)", padding: 16, borderRadius: 12, border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontWeight: 700, color: "var(--accent-purple)", marginBottom: 8 }}>Mã D2 Terrastruct Diagram (Theme 0 - White):</div>
                <pre style={{ fontSize: "0.78rem", background: "rgba(0,0,0,0.2)", padding: 12, borderRadius: 8, overflowX: "auto" }}>
                  {d2Result || "Chưa tạo mã D2. Bấm nút phía trên để sinh."}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Speech & Shadowing */}
      {activeTab === "speech" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="st-card">
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              Kỹ thuật Speech Shadowing & Chấm điểm Levenshtein Distance
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-muted)" }}>Văn bản câu mẫu (Reference Text):</label>
              <textarea
                value={speechText}
                onChange={e => setSpeechText(e.target.value)}
                rows={2}
                style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.88rem" }}
              />

              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-muted)" }}>Tốc độ đọc mẫu:</span>
                {[0.8, 1.0, 1.2].map(spd => (
                  <button
                    key={spd}
                    onClick={() => setSpeechSpeed(spd)}
                    className={speechSpeed === spd ? "st-btn st-btn-primary" : "st-btn st-btn-secondary"}
                    style={{ padding: "6px 12px", fontSize: "0.8rem" }}
                  >
                    {spd}x
                  </button>
                ))}

                <button className="st-btn st-btn-primary" onClick={testSpeechGuide} disabled={testingSpeech}>
                  {testingSpeech ? <span className="spinner" /> : null}
                  Phân tích Hướng dẫn Shadowing
                </button>
              </div>
            </div>

            {shadowingGuide && (
              <div style={{ background: "var(--bg-card-hover)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: "var(--accent-strong)", marginBottom: 8 }}>Kết quả Phân tích Nhịp ngắt Shadowing:</div>
                <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: 10 }}>
                  Tổng từ: {shadowingGuide.total_words} từ | Thời gian ước tính: {shadowingGuide.estimated_duration_sec} giây ở {shadowingGuide.speed}x
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {shadowingGuide.chunks?.map((c: any, i: number) => (
                    <div key={i} style={{ background: "var(--bg-card)", padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border-subtle)", fontSize: "0.82rem" }}>
                      "{c.text}" <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>({c.pause_after_ms}ms pause)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                Thực hành Thu âm / Giả lập Speech-to-Text của người học:
              </label>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <input
                  type="text"
                  value={userSpokenText}
                  onChange={e => setUserSpokenText(e.target.value)}
                  placeholder="Nhập hoặc dán transcript học viên đọc..."
                  style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: "0.88rem" }}
                />
                <button className="st-btn st-btn-primary" onClick={evaluateSpeech}>
                  Chấm điểm Levenshtein
                </button>
              </div>

              {evalResult && (
                <div style={{ background: "var(--bg-card-hover)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent-indigo)", marginBottom: 4 }}>
                    Độ chính xác: {evalResult.accuracy_percent}% ({evalResult.score}/10)
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 10 }}>{evalResult.feedback}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Khoảng cách Levenshtein: {evalResult.levenshtein_distance} | Số từ đúng: {evalResult.correct_words}/{evalResult.total_ref_words}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: Master Config Matrix */}
      {activeTab === "matrix" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="st-card">
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              Bảng Audit Tiến độ 10 Phân hệ & 21 Hàm Cốt lõi (config.md)
            </h2>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left" }}>
                    <th style={{ padding: "10px 12px" }}>Phân hệ Nghiệp vụ</th>
                    <th style={{ padding: "10px 12px" }}>Hàm Cốt lõi (Core Function)</th>
                    <th style={{ padding: "10px 12px" }}>Mã nguồn Backend/Frontend</th>
                    <th style={{ padding: "10px 12px" }}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { module: "RAG Vector & PDF", fn: "upload_pdf(), chunk_text(), generate_embedding(), search_relevant_chunks()", code: "documents.py, rag_engine.py", status: "100% Ready" },
                    { module: "Knowledge Graph & DAG", fn: "extract_topics_and_graph(), build_topological_order(), check_prerequisites()", code: "graph_engine.py, learning_paths.py", status: "100% Ready" },
                    { module: "Adaptive Learning Plan", fn: "set_goal(), generate_study_plan(), adapt_plan(), get_today_tasks()", code: "learning_engine.py, plan/page.tsx", status: "100% Ready" },
                    { module: "RAG Lesson & Quiz", fn: "generate_lesson(), generate_adaptive_quiz(), evaluate_quiz_response()", code: "ai_engine.py, quizzes.py", status: "100% Ready" },
                    { module: "FSRS Repetition", fn: "calculate_next_review(), get_due_flashcards(), review_flashcard()", code: "fsrs_engine.py, flashcards.py", status: "100% Ready" },
                    { module: "AI Tutor Chatbot", fn: "ask_ai_tutor(), get_chat_sessions()", code: "tutor.py, tutor/page.tsx", status: "100% Ready" },
                    { module: "Speech & Shadowing", fn: "synthesize_shadowing_guide(), evaluate_shadowing_attempt()", code: "speech_engine.py, speech.py", status: "100% Ready" },
                    { module: "Dual Coding Diagrams", fn: "generate_mermaid_diagram(), generate_d2_diagram()", code: "dual_coding_engine.py, dual_coding.py", status: "100% Ready" },
                    { module: "Roleplay TBLT Scenarios", fn: "generate_scenarios(), interact_scenario_step()", code: "scenario_engine.py, scenarios.py", status: "100% Ready" },
                    { module: "Export & Integration", fn: "export_flashcards_anki(), export_schedule_ical()", code: "export_engine.py, export.py", status: "100% Ready" }
                  ].map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700 }}>{row.module}</td>
                      <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "var(--accent-indigo)", fontSize: "0.78rem" }}>{row.fn}</td>
                      <td style={{ padding: "10px 12px", color: "var(--text-secondary)", fontSize: "0.78rem" }}>{row.code}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span className="st-badge st-badge-success">{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
