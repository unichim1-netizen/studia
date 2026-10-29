"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { API, apiFetch } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

// ─── Kiểu dữ liệu ────────────────────────────────────────────
type Skill = "listening" | "reading";
type Selection =
  | { kind: "group"; skill: Skill; c: number; g: number }
  | { kind: "passage"; p: number }
  | { kind: "writing"; task: "task1" | "task2" }
  | { kind: "speaking" }
  | { kind: "media" }
  | null;

interface Issue { severity: string; code: string; message: string; section?: string; question?: number }
interface Draft {
  id: string; title: string; status: string; has_audio: boolean; build_state: string;
  content: any; answer_key: any; validation: { errors: Issue[]; warnings: Issue[]; stats: any; ok?: boolean };
}

const QUESTION_TYPES: [string, string][] = [
  ["multiple_choice", "Multiple choice"], ["multiple_select", "Chọn nhiều đáp án"], ["true_false_ng", "True / False / Not Given"],
  ["yes_no_ng", "Yes / No / Not Given"], ["matching_headings", "Matching headings"], ["matching_information", "Matching information"],
  ["matching_features", "Matching features / opinions"], ["sentence_completion", "Sentence completion"],
  ["summary_completion", "Summary completion"], ["note_completion", "Note completion"], ["table_completion", "Table completion"],
  ["form_completion", "Form completion"], ["flow_chart_completion", "Flow-chart completion"],
  ["diagram_labelling", "Diagram labelling"], ["map_labelling", "Map labelling"], ["short_answer", "Short answer"],
];
const TYPE_LABEL = Object.fromEntries(QUESTION_TYPES);
const PER_QUESTION_OPTIONS = new Set(["multiple_choice", "multiple_select"]);
const SHARED_OPTION_TYPES = new Set(["matching_headings", "matching_information", "matching_features",
  "map_labelling", "diagram_labelling", "flow_chart_completion"]);
const NEEDS_IMAGE = new Set(["map_labelling", "diagram_labelling", "flow_chart_completion", "table_completion"]);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const JSON_HEADERS = { "Content-Type": "application/json" };

function groupsOf(content: any, skill: Skill): { container: any; label: string; groups: any[] }[] {
  const section = content?.sections?.[skill];
  if (!section) return [];
  if (skill === "listening") {
    return (section.parts || []).map((p: any) => ({ container: p, label: `Part ${p.part}`, groups: p.groups || [] }));
  }
  return (section.passages || []).map((p: any) => ({ container: p, label: `Passage ${p.index}`, groups: p.groups || [] }));
}

function selectionForQuestion(content: any, skill: string, number?: number): Selection {
  if (skill !== "listening" && skill !== "reading") {
    if (skill === "writing") return { kind: "writing", task: "task1" };
    if (skill === "speaking") return { kind: "speaking" };
    return null;
  }
  const containers = groupsOf(content, skill as Skill);
  for (let c = 0; c < containers.length; c += 1) {
    for (let g = 0; g < containers[c].groups.length; g += 1) {
      const group = containers[c].groups[g];
      if (number === undefined || (number >= group.range[0] && number <= group.range[1])
        || group.questions?.some((q: any) => q.number === number)) {
        return { kind: "group", skill: skill as Skill, c, g };
      }
    }
  }
  return null;
}

// ─── Trang ───────────────────────────────────────────────────
export default function ExamBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const bookId = params.id as string;
  const base = `${API}/documents/${bookId}`;

  const [title, setTitle] = useState("");
  const [sets, setSets] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [useAi, setUseAi] = useState(false);
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState<{ type: "info" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSource, setShowSource] = useState(true);
  const [chapters, setChapters] = useState<{ block_id: string; text: string; level: number }[]>([]);
  const [chapterId, setChapterId] = useState("");
  const [questionCount, setQuestionCount] = useState(10);
  const [generating, setGenerating] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  const notify = (type: "info" | "error", text: string) => {
    setMessage({ type, text });
    if (type === "info") setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 4000);
  };

  const loadSets = useCallback(async () => {
    const res = await apiFetch(`${API}/exam-sets?document_id=${bookId}`);
    if (res.ok) setSets((await res.json()).exam_sets || []);
  }, [bookId]);

  const loadDraft = useCallback(async (id: string, keepSelection = false) => {
    const res = await apiFetch(`${API}/exam-sets/${id}?include_key=true`);
    if (!res.ok) { notify("error", "Không tải được đề này."); return; }
    const data = await res.json();
    setDraft(data);
    setDirty(false);
    if (!keepSelection) {
      const first = selectionForQuestion(data.content, "listening") || selectionForQuestion(data.content, "reading");
      setSelection(first);
    }
  }, []);

  useEffect(() => {
    apiFetch(`${base}/status`).then(async (r) => { if (r.ok) setTitle((await r.json()).title || ""); }).catch(() => {});
    apiFetch(`${base}/outline`).then(async (r) => {
      if (r.ok) setChapters(((await r.json()).outline || []).filter((o: any) => o.level <= 2));
    }).catch(() => {});
    loadSets();
  }, [base, loadSets]);

  // Theo dõi các đề đang được AI làm lại
  const refining = sets.some((s) => s.build_state === "refining");
  usePolling(loadSets, 4000, refining);
  useEffect(() => {
    if (selectedId && !refining && draft?.build_state === "refining") loadDraft(selectedId, true);
  }, [refining, selectedId, draft?.build_state, loadDraft]);

  const select = (id: string) => {
    if (dirty && !window.confirm("Bạn có thay đổi chưa lưu. Chuyển sang đề khác?")) return;
    setSelectedId(id);
    setDraft(null);
    loadDraft(id);
  };

  // ─── Lưu (tự động sau 1.5 giây không sửa) ───────────────────
  const save = useCallback(async () => {
    const current = draftRef.current;
    if (!current || current.status === "published") return;
    setSaving(true);
    try {
      const res = await apiFetch(`${API}/exam-sets/${current.id}`, {
        method: "PATCH", headers: JSON_HEADERS,
        body: JSON.stringify({ content: current.content, answer_key: current.answer_key }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify("error", typeof err.detail === "string" ? err.detail : "Không lưu được thay đổi.");
        return;
      }
      const data = await res.json();
      setDraft((d) => (d ? { ...d, validation: data.validation } : d));
      setDirty(false);
      loadSets();
    } finally {
      setSaving(false);
    }
  }, [loadSets]);

  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void save(); }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [dirty, draft?.content, draft?.answer_key, save]);

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  /** Sửa nội dung/đáp án: `mutate` nhận bản sao của content và answer_key. */
  const update = (mutate: (content: any, key: any) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const content = clone(d.content);
      const key = clone(d.answer_key);
      mutate(content, key);
      return { ...d, content, answer_key: key };
    });
    setDirty(true);
  };

  // ─── Hành động ──────────────────────────────────────────────
  const build = async () => {
    if (sets.some((s) => s.status === "draft") && !window.confirm(
      "Dựng lại sẽ thay thế các bản nháp hiện có của sách này (đề đã publish được giữ nguyên). Tiếp tục?")) return;
    setBuilding(true);
    setMessage(null);
    try {
      const res = await apiFetch(`${base}/exam-sets/build`, {
        method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ use_ai: useAi, replace_drafts: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify("error", typeof data.detail === "string" ? data.detail : "Không dựng được đề.");
        return;
      }
      setSelectedId(null);
      setDraft(null);
      await loadSets();
      notify("info", `Đã dựng ${data.exam_sets.length} đề nháp${data.ai_enabled ? " — AI đang làm lại các nhóm khó ở nền" : ""}.`);
      if (data.exam_sets.length === 1) select(data.exam_sets[0].id);
    } finally {
      setBuilding(false);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await apiFetch(`${base}/exam-sets/generate`, {
        method: "POST", headers: JSON_HEADERS,
        body: JSON.stringify({ heading_block_id: chapterId || null, question_count: questionCount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify("error", typeof data.detail === "string" ? data.detail : "Không tạo được bài kiểm tra.");
        return;
      }
      await loadSets();
      notify("info", `Đã tạo bài kiểm tra ${data.report.generated} câu (đã kiểm chứng với nội dung sách).`);
      select(data.exam_set.id);
    } finally {
      setGenerating(false);
    }
  };

  const runAction = async (path: string, method: string, ok: string, after?: () => void) => {
    if (!draft) return;
    setBusy(true);
    try {
      if (dirty) await save();
      const res = await apiFetch(`${API}/exam-sets/${draft.id}${path}`, { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail;
        notify("error", typeof detail === "string" ? detail : detail?.message || "Thao tác thất bại.");
        if (detail?.errors) await loadDraft(draft.id, true);
        return;
      }
      notify("info", ok);
      await loadSets();
      await loadDraft(draft.id, true);
      after?.();
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    if (!draft) return;
    if (dirty) await save();
    const res = await apiFetch(`${API}/exam/sessions`, {
      method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ exam_set_id: draft.id, exam_type: "full" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { notify("error", typeof data.detail === "string" ? data.detail : "Không tạo được phiên xem thử."); return; }
    window.open(`/exam/${data.session.session_id}`, "_blank");
  };

  const uploadFile = async (path: string, file: File, ok: string) => {
    if (!draft) return;
    setBusy(true);
    try {
      if (dirty) await save();
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`${API}/exam-sets/${draft.id}${path}`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { notify("error", typeof data.detail === "string" ? data.detail : "Không tải lên được."); return; }
      notify("info", ok);
      await loadDraft(draft.id, true);
      loadSets();
    } finally {
      setBusy(false);
    }
  };

  const locked = draft?.status === "published";
  const issues: Issue[] = useMemo(
    () => [...(draft?.validation?.errors || []), ...(draft?.validation?.warnings || [])], [draft]);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 4px 80px" }}>
      <Link href={`/books/${bookId}`} className="st-btn st-btn-ghost st-btn-sm" style={{ padding: "4px 0", marginBottom: 8, display: "inline-flex" }}>
        ← Quay lại sách
      </Link>
      <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: "4px 0 6px" }}>Dựng đề thi từ sách</h1>
      <p style={{ color: "var(--ink-secondary)", marginBottom: 20, maxWidth: 780 }}>
        Hệ thống tách đề, câu hỏi và trang đáp án từ “{title || "sách"}” thành bộ đề nháp. Hãy rà soát từng nhóm câu hỏi bên dưới
        (đối chiếu với trang gốc), sửa chỗ nào sai rồi publish để thi trong phòng thi ảo.
      </p>

      {message && (
        <div role="status" style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 14, fontSize: "0.88rem",
          background: message.type === "error" ? "var(--danger-tint)" : "var(--success-tint)",
          color: message.type === "error" ? "var(--danger)" : "var(--success)",
          border: `1px solid ${message.type === "error" ? "color-mix(in srgb, var(--danger) 30%, transparent)" : "color-mix(in srgb, var(--success) 30%, transparent)"}`,
        }}>{message.text}</div>
      )}

      {/* Dựng đề + danh sách đề */}
      <div className="st-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button className="st-btn st-btn-primary" onClick={build} disabled={building}>
            {building ? "Đang dựng đề..." : sets.length ? "Dựng lại đề từ sách" : "Tạo đề thi từ sách này"}
          </button>
          <label style={{ fontSize: "0.85rem", display: "flex", gap: 6, alignItems: "center", color: "var(--ink-secondary)" }}>
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            Dùng AI làm lại các nhóm câu hỏi khó (chạy nền)
          </label>
        </div>
        {sets.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 16 }}>
            {sets.map((s) => (
              <button key={s.id} onClick={() => select(s.id)} style={{
                textAlign: "left", padding: 14, borderRadius: 12, cursor: "pointer", background: "var(--surface)",
                color: "var(--ink)",
                border: `2px solid ${selectedId === s.id ? "var(--border-glow)" : "var(--hairline)"}`,
              }}>
                <div style={{ fontWeight: 700 }}>{s.title}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  <span className="st-badge" style={{ color: s.status === "published" ? "var(--success)" : "var(--ink-secondary)" }}>
                    {s.status === "published" ? "Đã publish" : "Bản nháp"}
                  </span>
                  <span className="st-badge" style={{ color: s.errors ? "var(--danger)" : "var(--success)" }}>{s.errors} lỗi</span>
                  <span className="st-badge" style={{ color: "var(--warning)" }}>{s.warnings} cảnh báo</span>
                  {s.build_state === "refining" && <span className="st-badge">AI đang xử lý…</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bài kiểm tra tự sinh từ tài liệu học */}
      <div className="st-card" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Hoặc: tạo bài kiểm tra từ một chương</div>
        <p style={{ fontSize: "0.85rem", color: "var(--ink-secondary)", margin: "0 0 12px", maxWidth: 760 }}>
          Dành cho giáo trình/tài liệu học (không phải sách đề). AI viết câu hỏi từ nội dung chương; chỉ những câu có bằng chứng
          nguyên văn trong sách mới được giữ lại.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <select style={{ ...fieldStyle, width: "auto", minWidth: 240 }} value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
            <option value="">Toàn bộ sách (nếu ngắn)</option>
            {chapters.map((c) => (
              <option key={c.block_id} value={c.block_id}>{`${"— ".repeat(c.level - 1)}${c.text.replace(/\*\*/g, "")}`}</option>
            ))}
          </select>
          <label style={{ fontSize: "0.85rem", display: "flex", gap: 6, alignItems: "center" }}>
            Số câu
            <input style={{ ...fieldStyle, width: 70 }} type="number" min={3} max={20} value={questionCount}
              onChange={(e) => setQuestionCount(Math.max(3, Math.min(20, Number(e.target.value) || 10)))} />
          </label>
          <button className="st-btn st-btn-secondary" onClick={generate} disabled={generating}>
            {generating ? "AI đang viết câu hỏi..." : "Tạo bài kiểm tra"}
          </button>
        </div>
      </div>

      {draft && (
        <>
          {/* Thanh hành động */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem", flex: 1, minWidth: 200 }}>{draft.title}</h2>
            <span style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
              {saving ? "Đang lưu..." : dirty ? "Có thay đổi chưa lưu" : "Đã lưu"}
            </span>
            <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setShowSource((v) => !v)}>
              {showSource ? "Ẩn trang gốc" : "Hiện trang gốc"}
            </button>
            <button className="st-btn st-btn-secondary" onClick={preview} disabled={busy}>Xem thử như thí sinh</button>
            <button className="st-btn st-btn-secondary" onClick={() => runAction("/validate", "POST", "Đã kiểm tra lại đề.")} disabled={busy}>
              Kiểm tra lại
            </button>
            {locked ? (
              <button className="st-btn st-btn-secondary" onClick={() => runAction("/unpublish", "POST", "Đã gỡ publish — có thể sửa lại.")} disabled={busy}>
                Gỡ publish để sửa
              </button>
            ) : (
              <button className="st-btn st-btn-primary" onClick={() => runAction("/publish", "POST", "Đã publish — đề xuất hiện ở phòng thi.")}
                disabled={busy || draft.build_state === "refining" || (draft.validation.errors?.length ?? 0) > 0}
                title={(draft.validation.errors?.length ?? 0) > 0 ? "Sửa hết lỗi trước khi publish" : undefined}>
                Publish
              </button>
            )}
            <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => {
              if (window.confirm("Lưu trữ (ẩn) đề này?")) runAction("", "DELETE", "Đã lưu trữ đề.", () => { setDraft(null); setSelectedId(null); });
            }} disabled={busy}>Lưu trữ</button>
          </div>
          {locked && (
            <div style={{ padding: "10px 14px", borderRadius: 10, marginBottom: 14, background: "var(--brand-tint)", fontSize: "0.85rem" }}>
              Đề đã publish nên đang ở chế độ chỉ xem. Bấm “Gỡ publish để sửa” nếu cần chỉnh.
            </div>
          )}
          {draft.build_state === "refining" && (
            <div style={{ padding: "10px 14px", borderRadius: 10, marginBottom: 14, background: "var(--warning-tint)", fontSize: "0.85rem" }}>
              AI đang làm lại các nhóm khó. Việc sửa và publish tạm khoá cho tới khi xong (vài chục giây).
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: showSource ? "220px minmax(0, 1fr) 300px" : "220px minmax(0, 1fr)",
            gap: 16, alignItems: "start" }}>
            {/* Cột trái: cây đề + lỗi */}
            <aside className="st-card" style={{ padding: 14, position: "sticky", top: 12, maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}>
              <Tree content={draft.content} selection={selection} onSelect={setSelection} issues={issues} />
              <IssueList issues={issues} onPick={(issue) => {
                const sel = selectionForQuestion(draft.content, issue.section || "", issue.question);
                if (issue.code === "LISTENING_AUDIO_MISSING" || issue.code === "IMAGE_MISSING" || issue.code === "WRITING_IMAGE_MISSING") {
                  setSelection(issue.code === "LISTENING_AUDIO_MISSING" ? { kind: "media" } : sel);
                } else if (sel) setSelection(sel);
              }} />
            </aside>

            {/* Cột giữa: biểu mẫu sửa */}
            <main className="st-card" style={{ padding: 20, minWidth: 0, opacity: locked || draft.build_state === "refining" ? 0.75 : 1 }}>
              <fieldset disabled={locked || draft.build_state === "refining"} style={{ border: "none", padding: 0, margin: 0 }}>
                {selection?.kind === "group" && (
                  <GroupEditor draft={draft} selection={selection} update={update}
                    onUploadImage={(target, file) => uploadFile(`/images?target=${encodeURIComponent(target)}`, file, "Đã gắn hình vào đề.")} />
                )}
                {selection?.kind === "passage" && <PassageEditor draft={draft} index={selection.p} update={update} />}
                {selection?.kind === "writing" && (
                  <WritingEditor draft={draft} task={selection.task} update={update} onTask={(t) => setSelection({ kind: "writing", task: t })}
                    onUploadImage={(file) => uploadFile(`/images?target=${encodeURIComponent("writing.task1")}`, file, "Đã gắn hình vào Writing Task 1.")} />
                )}
                {selection?.kind === "speaking" && <SpeakingEditor draft={draft} update={update} />}
                {selection?.kind === "media" && (
                  <MediaPanel draft={draft} onUploadAudio={(file) => uploadFile("/audio", file, "Đã tải audio lên.")} />
                )}
                {!selection && <p style={{ color: "var(--ink-muted)" }}>Chọn một mục ở cột trái để xem và sửa.</p>}
              </fieldset>
            </main>

            {/* Cột phải: trang gốc */}
            {showSource && <SourcePage base={base} content={draft.content} selection={selection} />}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Cây đề ──────────────────────────────────────────────────
function Tree({ content, selection, onSelect, issues }: {
  content: any; selection: Selection; onSelect: (s: Selection) => void; issues: Issue[];
}) {
  const count = (skill: string, a: number, b: number) =>
    issues.filter((i) => i.severity === "error" && i.section === skill && i.question !== undefined && i.question >= a && i.question <= b).length;
  const item = (label: string, active: boolean, onClick: () => void, errors = 0, key?: string) => (
    <button key={key || label} onClick={onClick} style={{
      display: "flex", justifyContent: "space-between", gap: 8, width: "100%", textAlign: "left", padding: "7px 10px",
      borderRadius: 8, border: "none", cursor: "pointer", fontSize: "0.82rem",
      background: active ? "var(--brand-tint)" : "transparent", color: "var(--ink)",
      fontWeight: active ? 700 : 500,
    }}>
      <span>{label}</span>
      {errors > 0 && <span style={{ color: "var(--danger)", fontWeight: 700 }}>{errors}</span>}
    </button>
  );

  const sectionTitle = (text: string) => (
    <div style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
      color: "var(--ink-muted)", margin: "14px 0 4px" }}>{text}</div>
  );

  return (
    <div>
      {sectionTitle("Phần thi")}
      {item("Audio & hình", selection?.kind === "media", () => onSelect({ kind: "media" }))}
      {(["listening", "reading"] as Skill[]).map((skill) => {
        const containers = groupsOf(content, skill);
        if (!containers.length) return null;
        return (
          <div key={skill}>
            {sectionTitle(skill === "listening" ? "Listening" : "Reading")}
            {containers.map((c, ci) => (
              <div key={c.label}>
                {skill === "reading" && item(`${c.label} — bài đọc`, selection?.kind === "passage" && selection.p === ci,
                  () => onSelect({ kind: "passage", p: ci }))}
                {skill === "listening" && <div style={{ fontSize: "0.72rem", color: "var(--ink-muted)", padding: "4px 10px" }}>{c.label}</div>}
                {c.groups.map((g: any, gi: number) => (
                  item(`Q${g.range[0]}–${g.range[1]} ${TYPE_LABEL[g.type] || g.type}`,
                    selection?.kind === "group" && selection.skill === skill && selection.c === ci && selection.g === gi,
                    () => onSelect({ kind: "group", skill, c: ci, g: gi }), count(skill, g.range[0], g.range[1]),
                    `${skill}-${ci}-${gi}`)
                ))}
              </div>
            ))}
          </div>
        );
      })}
      {content?.sections?.writing && (
        <>
          {sectionTitle("Writing")}
          {item("Task 1", selection?.kind === "writing" && selection.task === "task1", () => onSelect({ kind: "writing", task: "task1" }))}
          {item("Task 2", selection?.kind === "writing" && selection.task === "task2", () => onSelect({ kind: "writing", task: "task2" }))}
        </>
      )}
      {content?.sections?.speaking && (
        <>
          {sectionTitle("Speaking")}
          {item("Part 1–3", selection?.kind === "speaking", () => onSelect({ kind: "speaking" }))}
        </>
      )}
    </div>
  );
}

function IssueList({ issues, onPick }: { issues: Issue[]; onPick: (issue: Issue) => void }) {
  if (issues.length === 0) {
    return <p style={{ fontSize: "0.82rem", color: "var(--success)", marginTop: 16 }}>Không có lỗi hay cảnh báo.</p>;
  }
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 6 }}>
        Cần xem lại ({issues.length})
      </div>
      {issues.map((issue, i) => (
        <button key={i} onClick={() => onPick(issue)} style={{
          display: "block", width: "100%", textAlign: "left", padding: "7px 8px", marginBottom: 4, borderRadius: 8,
          cursor: "pointer", fontSize: "0.78rem", lineHeight: 1.4, color: "var(--ink)", background: "transparent",
          border: `1px solid ${issue.severity === "error" ? "color-mix(in srgb, var(--danger) 35%, transparent)" : "color-mix(in srgb, var(--warning) 35%, transparent)"}`,
        }}>
          <strong style={{ color: issue.severity === "error" ? "var(--danger)" : "var(--warning)" }}>
            {issue.severity === "error" ? "Lỗi" : "Cảnh báo"}
          </strong>{" "}{issue.message}
        </button>
      ))}
    </div>
  );
}

// ─── Trình sửa nhóm câu hỏi ──────────────────────────────────
const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-input)",
  background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: "0.88rem",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--ink-muted)", margin: "14px 0 6px",
};

function GroupEditor({ draft, selection, update, onUploadImage }: {
  draft: Draft; selection: Extract<Selection, { kind: "group" }>;
  update: (m: (content: any, key: any) => void) => void; onUploadImage: (target: string, file: File) => void;
}) {
  const containers = groupsOf(draft.content, selection.skill);
  const group = containers[selection.c]?.groups[selection.g];
  if (!group) return <p>Không tìm thấy nhóm câu hỏi này.</p>;
  const { skill, c, g } = selection;
  const keyOf = (n: number) => draft.answer_key?.[skill]?.[String(n)];
  const perQuestionOptions = PER_QUESTION_OPTIONS.has(group.type);
  const sharedOptions = SHARED_OPTION_TYPES.has(group.type) || !!group.shared_options;
  const synced = group.type === "multiple_select";

  const mutateGroup = (fn: (grp: any) => void) =>
    update((content) => fn(groupsOf(content, skill)[c].groups[g]));

  const setAnswer = (n: number, value: string) =>
    update((_content, key) => {
      key[skill] = key[skill] || {};
      const accept = value.split("/").map((v) => v.trim()).filter(Boolean);
      const previous = key[skill][String(n)] || {};
      key[skill][String(n)] = { ...previous, raw: value, accept };
    });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          {skill === "listening" ? "Listening" : "Reading"} · Câu {group.range[0]}–{group.range[1]}
        </h3>
        {group.source === "ai" && <span className="st-badge" style={{ color: "var(--plum)" }}>Do AI trích</span>}
        {group.needs_review && <span className="st-badge" style={{ color: "var(--warning)" }}>Nên xem lại</span>}
      </div>

      <label style={labelStyle}>Câu lệnh của nhóm</label>
      <textarea style={{ ...fieldStyle, minHeight: 64 }} value={group.instruction || ""}
        onChange={(e) => mutateGroup((grp) => { grp.instruction = e.target.value; })} />

      <label style={labelStyle}>Dạng câu hỏi</label>
      <select style={fieldStyle} value={group.type}
        onChange={(e) => mutateGroup((grp) => { grp.type = e.target.value; })}>
        {QUESTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label style={labelStyle}>Giới hạn số từ cho mỗi đáp án (để trống nếu không có)</label>
      <input style={{ ...fieldStyle, width: 120 }} type="number" min={0} max={10} value={group.word_limit ?? ""}
        onChange={(e) => mutateGroup((grp) => { grp.word_limit = e.target.value ? Number(e.target.value) : null; })} />

      <label style={labelStyle}>Tiêu đề ngữ cảnh (nếu có)</label>
      <input style={fieldStyle} value={group.context_title || ""}
        onChange={(e) => mutateGroup((grp) => { grp.context_title = e.target.value || null; })} />

      {sharedOptions && (
        <>
          <label style={labelStyle}>Danh sách lựa chọn dùng chung</label>
          {(group.shared_options || []).map((opt: any, oi: number) => (
            <div key={oi} style={{ display: "grid", gridTemplateColumns: "56px 1fr 32px", gap: 6, marginBottom: 6 }}>
              <input style={fieldStyle} value={opt.key}
                onChange={(e) => mutateGroup((grp) => { grp.shared_options[oi].key = e.target.value; })} />
              <input style={fieldStyle} value={opt.text}
                onChange={(e) => mutateGroup((grp) => { grp.shared_options[oi].text = e.target.value; })} />
              <button className="st-btn st-btn-ghost st-btn-sm" title="Xoá lựa chọn"
                onClick={() => mutateGroup((grp) => { grp.shared_options.splice(oi, 1); })}>×</button>
            </div>
          ))}
          <button className="st-btn st-btn-secondary" onClick={() => mutateGroup((grp) => {
            grp.shared_options = grp.shared_options || [];
            grp.shared_options.push({ key: String.fromCharCode(65 + grp.shared_options.length), text: "" });
          })}>+ Thêm lựa chọn</button>
        </>
      )}

      {synced && (
        <>
          <label style={labelStyle}>Câu dẫn và lựa chọn (áp dụng cho cả {group.questions.length} câu)</label>
          <textarea style={{ ...fieldStyle, minHeight: 56 }} value={group.questions[0]?.question || ""}
            onChange={(e) => mutateGroup((grp) => { grp.questions.forEach((q: any) => { q.question = e.target.value; }); })} />
          <OptionsEditor options={group.questions[0]?.options || []}
            onChange={(next) => mutateGroup((grp) => { grp.questions.forEach((q: any) => { q.options = clone(next); }); })} />
        </>
      )}

      <label style={labelStyle}>Câu hỏi và đáp án</label>
      {group.questions.map((q: any, qi: number) => {
        const entry = keyOf(q.number);
        const missing = !entry || !(entry.accept || []).length;
        return (
          <div key={qi} style={{ border: `1px solid ${missing ? "color-mix(in srgb, var(--danger) 50%, transparent)" : "var(--hairline)"}`,
            borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "64px 1fr 32px", gap: 8, alignItems: "start" }}>
              <input style={{ ...fieldStyle, fontWeight: 700, textAlign: "center" }} type="number" value={q.number}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  const prevNumber = q.number;
                  update((content, key) => {
                    const grp = groupsOf(content, skill)[c].groups[g];
                    grp.questions[qi].number = next;
                    if (key[skill]?.[String(prevNumber)] && prevNumber !== next) {
                      key[skill][String(next)] = key[skill][String(prevNumber)];
                      delete key[skill][String(prevNumber)];
                    }
                  });
                }} />
              {synced ? (
                <div style={{ fontSize: "0.82rem", color: "var(--ink-muted)", paddingTop: 8 }}>Chọn chữ cái của câu {q.number}</div>
              ) : (
                <textarea style={{ ...fieldStyle, minHeight: 44 }} value={q.question}
                  onChange={(e) => mutateGroup((grp) => { grp.questions[qi].question = e.target.value; })} />
              )}
              <button className="st-btn st-btn-ghost st-btn-sm" title="Xoá câu hỏi" onClick={() => update((content, key) => {
                const grp = groupsOf(content, skill)[c].groups[g];
                const [removed] = grp.questions.splice(qi, 1);
                if (removed && key[skill]) delete key[skill][String(removed.number)];
              })}>×</button>
            </div>
            {perQuestionOptions && !synced && (
              <OptionsEditor options={q.options || []}
                onChange={(next) => mutateGroup((grp) => { grp.questions[qi].options = next; })} />
            )}
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, marginTop: 8, alignItems: "center" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase" }}>Đáp án đúng</span>
              <input style={{ ...fieldStyle, borderColor: missing ? "color-mix(in srgb, var(--danger) 60%, transparent)" : undefined }}
                placeholder="vd. engine / motor  hoặc  B"
                value={entry ? (entry.accept || []).join(" / ") : ""}
                onChange={(e) => setAnswer(q.number, e.target.value)} />
            </div>
            {entry?.any_order_with?.length ? (
              <div style={{ fontSize: "0.74rem", color: "var(--ink-muted)", marginTop: 4 }}>
                Thứ tự bất kỳ với câu {entry.any_order_with.join(", ")}: nhập cùng bộ đáp án cho các câu trong cặp.
              </div>
            ) : null}
          </div>
        );
      })}
      <button className="st-btn st-btn-secondary" onClick={() => mutateGroup((grp) => {
        const last = grp.questions[grp.questions.length - 1];
        grp.questions.push({ number: (last?.number ?? grp.range[0] - 1) + 1, question: "", options: perQuestionOptions ? clone(last?.options || []) : null });
        grp.range = [grp.range[0], Math.max(grp.range[1], grp.questions[grp.questions.length - 1].number)];
      })}>+ Thêm câu hỏi</button>

      {(NEEDS_IMAGE.has(group.type) || group.image_url) && (
        <>
          <label style={labelStyle}>Hình của nhóm câu hỏi</label>
          {group.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.image_url} alt="Hình nhóm câu hỏi" style={{ maxWidth: "100%", borderRadius: 8, marginBottom: 8 }} />
          )}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(`group:${skill}:${group.range[0]}`, f); }} />
        </>
      )}
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: { key: string; text: string }[]; onChange: (next: any[]) => void }) {
  return (
    <div style={{ marginTop: 8 }}>
      {options.map((opt, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 1fr 32px", gap: 6, marginBottom: 6 }}>
          <input style={fieldStyle} value={opt.key}
            onChange={(e) => onChange(options.map((o, j) => (j === i ? { ...o, key: e.target.value } : o)))} />
          <input style={fieldStyle} value={opt.text}
            onChange={(e) => onChange(options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)))} />
          <button className="st-btn st-btn-ghost st-btn-sm" title="Xoá lựa chọn" onClick={() => onChange(options.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="st-btn st-btn-ghost st-btn-sm" style={{ fontSize: "0.78rem" }}
        onClick={() => onChange([...options, { key: String.fromCharCode(65 + options.length), text: "" }])}>
        + Thêm lựa chọn
      </button>
    </div>
  );
}

// ─── Bài đọc, Writing, Speaking, Media ───────────────────────
function PassageEditor({ draft, index, update }: { draft: Draft; index: number; update: (m: (c: any, k: any) => void) => void }) {
  const passage = draft.content?.sections?.reading?.passages?.[index];
  if (!passage) return null;
  const words = (passage.body_markdown || "").split(/\s+/).filter(Boolean).length;
  return (
    <div>
      <h3 style={{ margin: 0 }}>Bài đọc {passage.index}</h3>
      <label style={labelStyle}>Tiêu đề</label>
      <input style={fieldStyle} value={passage.title || ""}
        onChange={(e) => update((c) => { c.sections.reading.passages[index].title = e.target.value; })} />
      <label style={labelStyle}>Nội dung ({words} từ) — mỗi đoạn cách nhau một dòng trống</label>
      <textarea style={{ ...fieldStyle, minHeight: 420, lineHeight: 1.6 }} value={passage.body_markdown || ""}
        onChange={(e) => update((c) => { c.sections.reading.passages[index].body_markdown = e.target.value; })} />
    </div>
  );
}

function WritingEditor({ draft, task, update, onTask, onUploadImage }: {
  draft: Draft; task: "task1" | "task2"; update: (m: (c: any, k: any) => void) => void;
  onTask: (t: "task1" | "task2") => void; onUploadImage: (file: File) => void;
}) {
  const data = draft.content?.sections?.writing?.[task];
  if (!data) return <p>Đề này chưa có Writing {task}.</p>;
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {(["task1", "task2"] as const).map((t) => (
          <button key={t} className={t === task ? "st-btn st-btn-primary st-btn-sm" : "st-btn st-btn-secondary st-btn-sm"} onClick={() => onTask(t)}>
            {t === "task1" ? "Task 1" : "Task 2"}
          </button>
        ))}
      </div>
      <label style={labelStyle}>Đề bài</label>
      <textarea style={{ ...fieldStyle, minHeight: 240 }} value={data.prompt || ""}
        onChange={(e) => update((c) => { c.sections.writing[task].prompt = e.target.value; })} />
      <label style={labelStyle}>Số từ tối thiểu</label>
      <input style={{ ...fieldStyle, width: 140 }} type="number" min={0} value={data.min_words ?? ""}
        onChange={(e) => update((c) => { c.sections.writing[task].min_words = e.target.value ? Number(e.target.value) : null; })} />
      {task === "task1" && (
        <>
          <label style={labelStyle}>Hình / biểu đồ của Task 1</label>
          {data.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.image_url} alt="Hình Task 1" style={{ maxWidth: "100%", borderRadius: 8, marginBottom: 8 }} />
          )}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(f); }} />
        </>
      )}
    </div>
  );
}

function SpeakingEditor({ draft, update }: { draft: Draft; update: (m: (c: any, k: any) => void) => void }) {
  const speaking = draft.content?.sections?.speaking || {};
  const lines = (part: string) => (speaking[part]?.questions || []).join("\n");
  const setLines = (part: string, value: string) =>
    update((c) => { c.sections.speaking[part] = { ...(c.sections.speaking[part] || {}), questions: value.split("\n").map((l) => l.trim()).filter(Boolean) }; });
  return (
    <div>
      <h3 style={{ margin: 0 }}>Speaking</h3>
      <label style={labelStyle}>Part 1 — mỗi câu hỏi một dòng</label>
      <textarea style={{ ...fieldStyle, minHeight: 110 }} value={lines("part1")} onChange={(e) => setLines("part1", e.target.value)} />
      <label style={labelStyle}>Part 2 — cue card (Markdown)</label>
      <textarea style={{ ...fieldStyle, minHeight: 160 }} value={speaking.part2?.cue_card || ""}
        onChange={(e) => update((c) => { c.sections.speaking.part2 = { ...(c.sections.speaking.part2 || {}), cue_card: e.target.value }; })} />
      <label style={labelStyle}>Part 3 — mỗi câu hỏi một dòng</label>
      <textarea style={{ ...fieldStyle, minHeight: 110 }} value={lines("part3")} onChange={(e) => setLines("part3", e.target.value)} />
    </div>
  );
}

function MediaPanel({ draft, onUploadAudio }: { draft: Draft; onUploadAudio: (file: File) => void }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setAudioUrl(null);
    if (!draft.has_audio) return;
    apiFetch(`${API}/exam-sets/${draft.id}/audio-url`).then(async (res) => {
      if (res.ok && !cancelled) setAudioUrl((await res.json()).url);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [draft.id, draft.has_audio]);

  return (
    <div>
      <h3 style={{ margin: 0 }}>Audio Listening</h3>
      <p style={{ color: "var(--ink-secondary)", fontSize: "0.88rem" }}>
        File PDF không chứa audio. Tải lên file MP3/M4A/WAV/OGG (tối đa 150 MB) của phần Listening để dùng trong phòng thi.
      </p>
      <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadAudio(f); }} />
      {draft.has_audio ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: "0.82rem", color: "var(--success)", marginBottom: 6 }}>Đã có audio. Nghe thử:</div>
          {audioUrl ? <audio controls src={audioUrl} style={{ width: "100%" }} /> : <span className="reader-muted">Đang tải...</span>}
        </div>
      ) : (
        <p style={{ marginTop: 14, color: "var(--warning)", fontSize: "0.85rem" }}>Chưa có audio — Listening sẽ không phát được tiếng.</p>
      )}
      <h3 style={{ margin: "28px 0 0" }}>Hình cho đề</h3>
      <p style={{ color: "var(--ink-secondary)", fontSize: "0.88rem" }}>
        Hình Writing Task 1 tải ở mục Writing; hình bản đồ/sơ đồ tải ở từng nhóm câu hỏi tương ứng.
      </p>
    </div>
  );
}

// ─── Trang gốc của PDF ───────────────────────────────────────
function SourcePage({ base, content, selection }: { base: string; content: any; selection: Selection }) {
  const initial = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "group") return groupsOf(content, selection.skill)[selection.c]?.groups[selection.g]?.pages?.[0] ?? null;
    if (selection.kind === "passage") return content?.sections?.reading?.passages?.[selection.p]?.pages?.[0] ?? null;
    if (selection.kind === "writing") return content?.sections?.writing?.[selection.task]?.pages?.[0] ?? null;
    return null;
  }, [content, selection]);
  const [page, setPage] = useState<number | null>(initial);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const cache = useRef<Map<number, string>>(new Map());

  useEffect(() => { setPage(initial); }, [initial]);

  useEffect(() => {
    if (!page) { setUrl(null); return; }
    let cancelled = false;
    setError(false);
    const cached = cache.current.get(page);
    if (cached) { setUrl(cached); return; }
    setUrl(null);
    apiFetch(`${base}/pages/${page}/image?scale=1.4`).then(async (res) => {
      if (!res.ok) throw new Error(String(res.status));
      const objectUrl = URL.createObjectURL(await res.blob());
      cache.current.set(page, objectUrl);
      if (!cancelled) setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [base, page]);

  useEffect(() => () => { cache.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  return (
    <aside className="st-card" style={{ padding: 14, position: "sticky", top: 12, maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ fontSize: "0.85rem" }}>Trang gốc để đối chiếu</strong>
        {page && (
          <span style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.8rem" }}>
            <button className="st-btn st-btn-ghost st-btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
            Trang {page}
            <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => setPage(page + 1)}>→</button>
          </span>
        )}
      </div>
      {!page && <p style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>Mục này không có thông tin trang trong PDF.</p>}
      {page && error && <p style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>Không tải được ảnh trang (tài liệu không phải PDF hoặc trang không tồn tại).</p>}
      {page && !error && !url && <p style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>Đang tải ảnh trang...</p>}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Trang ${page} của PDF gốc`} style={{ width: "100%", borderRadius: 6, border: "1px solid var(--hairline)" }} />
      )}
    </aside>
  );
}
