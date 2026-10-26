"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { API, apiFetch } from "@/lib/api";
import { Clock } from "lucide-react";
import TestLibrary, { type TestStat } from "@/components/exam/TestLibrary";
import StartPanel from "@/components/exam/StartPanel";
import {
  BUILTIN_TESTS, SAMPLE_TEST, SKILL_LABEL, activeSections, demoQuery, loadConfig, saveConfig, testFromSet,
  DEFAULT_CONFIG, type ExamConfig, type LibraryTest,
} from "@/lib/examConfig";
import "./lobby.css";

function sessionLabel(h: any) {
  if (h.title) return h.title;
  const m = /^cambridge(\d+)_test(\d)$/.exec(h.exam_type || "");
  return m ? `Cambridge IELTS ${m[1]} - Test ${m[2]}` : "Phiên thi";
}

export default function ExamLobbyPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ExamConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [sets, setSets] = useState<any[]>([]);
  const [loadingSets, setLoadingSets] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    setConfig(loadConfig());
    setReady(true);
    apiFetch(`${API}/exam-sets?status=published`).then(async (res) => {
      if (res.ok) setSets((await res.json()).exam_sets || []);
    }).catch(() => {}).finally(() => setLoadingSets(false));
    apiFetch(`${API}/exam/sessions?limit=40`).then(async (res) => {
      if (res.ok) setHistory((await res.json()).sessions || []);
    }).catch(() => {});
  }, []);

  const updateConfig = (c: ExamConfig) => { setConfig(c); if (ready) saveConfig(c); };

  const tests = useMemo<LibraryTest[]>(() => [...BUILTIN_TESTS, ...sets.map(testFromSet), SAMPLE_TEST], [sets]);
  const selected = tests.find((t) => t.key === selectedKey) || null;

  const stats = useMemo(() => {
    const out: Record<string, TestStat> = {};
    for (const h of history) {
      if (h.status !== "SUBMITTED" && h.status !== "AUTO_SUBMITTED") continue;
      const title = sessionLabel(h);
      const cur = out[title] || { best: null, attempts: 0 };
      const band = h.overall_band != null ? Number(h.overall_band) : null;
      out[title] = { attempts: cur.attempts + 1, best: band != null && (cur.best == null || band > cur.best) ? band : cur.best };
    }
    return out;
  }, [history]);

  const inProgress = history.find((h) => h.status === "IN_PROGRESS");

  const start = async () => {
    if (!selected) return;
    const sections = activeSections(config, selected);
    if (!sections.length) return;
    setStarting(true);
    setStartError(null);

    if (selected.source === "builtin") {
      router.push(`/exam/demo?${demoQuery(selected, config)}`);
      return;
    }
    const durations = Object.fromEntries(sections.map((s) => [s, config.minutes[s]]));
    try {
      const res = await apiFetch(`${API}/exam/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exam_set_id: selected.setId ?? null,
          exam_type: sections.length === 1 ? sections[0] : "full",
          exam_mode: config.kind,
          sections,
          session_mode: config.mode,
          durations,
          untimed: config.mode === "practice" && config.untimed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Không tạo được phiên thi");
      router.push(`/exam/${data.session.session_id}`);
    } catch (e: any) {
      if (selected.source === "sample" && !(e?.message || "").startsWith("Đề này")) {
        // Không kết nối được máy chủ: dùng đề mẫu dựng sẵn trong ứng dụng
        router.push(`/exam/demo?${demoQuery({ ...selected, demoType: sections.length === 1 ? sections[0] : "full" }, config)}`);
        return;
      }
      setStartError(e?.message || "Không tạo được phiên thi");
      setStarting(false);
    }
  };

  const testSound = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("This is a sound check. If you can hear this clearly, you are ready.");
    u.lang = "en-GB"; window.speechSynthesis.speak(u);
  };

  const visibleHistory = showAllHistory ? history : history.slice(0, 6);

  return (
    <div className="wrap stagger">
      <header className="page-head">
        <div>
          <h1 className="page-title">Thi thử IELTS</h1>
          <p className="page-sub">Chọn đề, chọn phần thi và thời gian, rồi thi như thật hoặc luyện tập có công cụ hỗ trợ.</p>
        </div>
      </header>

      {inProgress && (
        <div role="status" className="row-wrap" style={{ gap: 14, padding: "14px 18px", borderRadius: "var(--radius-md)", background: "var(--warning-tint)" }}>
          <span className="tile tile-sm tile-warning" aria-hidden="true"><Clock size={18} strokeWidth={1.75} /></span>
          <span style={{ flex: 1, color: "var(--ink)" }}><b style={{ fontWeight: 600 }}>Bạn còn một bài đang làm dở:</b> {sessionLabel(inProgress)}</span>
          <Link className="st-btn st-btn-secondary st-btn-sm" href={`/exam/${inProgress.session_id}`}>Làm tiếp</Link>
        </div>
      )}

      <div className="el-layout">
        <TestLibrary tests={tests} selectedKey={selectedKey} onSelect={(t) => {
          setSelectedKey(t.key); setStartError(null);
          // Màn hẹp: bảng cấu hình nằm dưới danh sách, cuộn tới để chọn chế độ và bắt đầu
          if (window.innerWidth <= 1000) setTimeout(() => document.getElementById("exam-start-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
        }} stats={stats} loading={loadingSets} />
        <StartPanel test={selected} config={config} onChange={updateConfig} agreed={agreed} onAgree={setAgreed}
          onStart={start} onSoundTest={testSound} starting={starting} error={startError} />
      </div>

      {history.length > 0 && (
        <section className="st-card" aria-labelledby="h-h">
          <div className="sec-head"><h2 id="h-h" className="sec-title">Lịch sử làm bài</h2><Link className="link" href="/dashboard">Xem tiến độ</Link></div>
          <div>
            {visibleHistory.map((h) => {
              const done = h.status === "SUBMITTED" || h.status === "AUTO_SUBMITTED";
              const secs: string[] = (h.sections || []).map((s: string) => (SKILL_LABEL as any)[s]).filter(Boolean);
              return (
                <Link key={h.session_id} href={`/exam/${h.session_id}`} className="el-hist">
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="el-hist-title">{sessionLabel(h)}</span>
                    <span className="meta">
                      {h.created_at ? new Date(h.created_at).toLocaleDateString("vi-VN") : ""}
                      {secs.length ? ` · ${secs.length === 4 ? "Cả đề" : secs.join(" + ")}` : ""}
                    </span>
                  </span>
                  <span className={h.session_mode === "practice" ? "st-badge st-badge-accent" : "st-badge st-badge-brand"}>{h.session_mode === "practice" ? "Luyện tập" : "Thi thật"}</span>
                  {done
                    ? <b className="num" style={{ minWidth: 72, textAlign: "right" }}>{h.overall_band != null ? `Band ${Number(h.overall_band).toFixed(1)}` : "Xem lại"}</b>
                    : <span className="st-badge st-badge-warning">{h.status === "IN_PROGRESS" ? "Đang làm" : "Chưa bắt đầu"}</span>}
                </Link>
              );
            })}
          </div>
          {history.length > 6 && (
            <button type="button" className="st-btn st-btn-ghost st-btn-sm" style={{ marginTop: 8 }} onClick={() => setShowAllHistory((v) => !v)}>
              {showAllHistory ? "Thu gọn" : `Xem thêm ${history.length - 6} lượt`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
