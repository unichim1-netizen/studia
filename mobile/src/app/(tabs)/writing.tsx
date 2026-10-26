import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { Coal } from "@/components/Coal";
import { ProgressBar, Reveal } from "@/components/motion";
import { Banner, Button, Card, Chip, FeatureOff, Field, Row, Screen, Text } from "@/components/ui";
import { ApiError, errorMessage } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { countWords, CRIT_ORDER, CRIT_VI, gradeWriting, ISSUE_LABEL, type GradeResult } from "@/lib/studia";
import { bandColor, radius, space, useTheme } from "@/lib/theme";

const DRAFT_KEY = "studia-writing-draft";
const MIN_TO_GRADE = 30;
const MIN_WORDS = { task1: 150, task2: 250 } as const;

export default function Writing() {
  const { on } = useConfig();
  if (!on("writing")) return <FeatureOff name="Chấm Writing" />;
  return <Grader />;
}

function Grader() {
  const [task, setTask] = useState<"task1" | "task2">("task2");
  const [prompt, setPrompt] = useState("");
  const [essay, setEssay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; unavailable: boolean } | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const restored = useRef(false);

  // Giữ bản nháp trên máy để lỡ thoát app không mất bài
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (!raw) return;
        const d = JSON.parse(raw) as { task?: string; prompt?: string; essay?: string };
        if (d.task === "task1" || d.task === "task2") setTask(d.task);
        if (typeof d.prompt === "string") setPrompt(d.prompt);
        if (typeof d.essay === "string") setEssay(d.essay);
      })
      .catch(() => {})
      .finally(() => { restored.current = true; });
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => AsyncStorage.setItem(DRAFT_KEY, JSON.stringify({ task, prompt, essay })).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [task, prompt, essay]);

  const words = countWords(essay);

  const submit = async () => {
    if (busy) return;
    if (words < MIN_TO_GRADE) return setError({ text: `Bài viết cần ít nhất ${MIN_TO_GRADE} từ để chấm (hiện có ${words} từ).`, unavailable: false });
    setBusy(true);
    setError(null);
    try {
      setResult(await gradeWriting(task, prompt.trim(), essay.trim()));
    } catch (e) {
      setError({ text: errorMessage(e), unavailable: e instanceof ApiError && (e.status === 503 || e.kind === "timeout") });
    } finally {
      setBusy(false);
    }
  };

  if (result) return <Result r={result} onBack={() => setResult(null)} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <View>
          <Text variant="title">Chấm Writing</Text>
          <Text tone="secondary">Dán bài Task 1 hoặc Task 2, Coal chấm theo 4 tiêu chí band và sửa từng câu.</Text>
        </View>

        <Row gap={space[2]}>
          <Chip label="Task 1" active={task === "task1"} onPress={() => setTask("task1")} />
          <Chip label="Task 2" active={task === "task2"} onPress={() => setTask("task2")} />
        </Row>

        <Field label="Đề bài (không bắt buộc)" value={prompt} onChangeText={setPrompt} multiline maxLength={2000} style={{ minHeight: 80 }}
          placeholder={task === "task2" ? "Some people think that…" : "The chart below shows…"} />
        <Field label="Bài viết" value={essay} onChangeText={setEssay} multiline style={{ minHeight: 260 }} placeholder="Dán hoặc gõ bài viết tiếng Anh ở đây…" autoCorrect={false} spellCheck={false} />

        <Row style={{ justifyContent: "space-between" }}>
          <Text variant="small" tone={words >= MIN_WORDS[task] ? "success" : "muted"} style={{ flex: 1 }}>{words} từ, cần tối thiểu {MIN_WORDS[task]} từ cho {task === "task1" ? "Task 1" : "Task 2"}</Text>
          {essay ? <Button small variant="ghost" title="Xoá bài" onPress={() => { setEssay(""); setError(null); }} /> : null}
        </Row>

        {error ? (
          error.unavailable ? (
            <Card tone="sunken" style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <Coal sprite="sleepy" size={64} still />
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="label">Coal chưa chấm được lúc này</Text>
                <Text variant="small" tone="secondary">{error.text} Bài của bạn vẫn được lưu nháp trên máy.</Text>
              </View>
            </Card>
          ) : <Banner text={error.text} />
        ) : null}

        <Button title={busy ? "Coal đang chấm bài…" : "Chấm bài"} onPress={submit} loading={busy} disabled={!essay.trim()} />
        {busy ? <Text variant="small" tone="muted" style={{ textAlign: "center" }}>Thường mất 20–60 giây. Đừng thoát màn hình nhé.</Text> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Result({ r, onBack }: { r: GradeResult; onBack: () => void }) {
  const { c } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const changed = r.sentences.filter((s) => s.changed);
  const list = showAll ? r.sentences : changed;

  return (
    <Screen>
      <Row style={{ justifyContent: "space-between" }}>
        <Text variant="title">Kết quả</Text>
        <Button small variant="secondary" title="Sửa bài, chấm lại" onPress={onBack} />
      </Row>

      <Reveal index={0}>
      <Card tone="navy" style={{ flexDirection: "row", alignItems: "center", gap: space[4], borderRadius: radius.xl }}>
        <Coal mood={r.overall >= 7 ? "cheer" : r.overall >= 6 ? "happy" : "focus"} size={90} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" style={{ color: c.onNavy, opacity: 0.8 }}>Band dự kiến, {r.task === "task1" ? "Task 1" : "Task 2"}</Text>
          <Text variant="display" style={{ color: c.onNavy, fontSize: 44, lineHeight: 50 }}>{r.overall.toFixed(1)}</Text>
          <Text variant="small" style={{ color: c.onNavy, opacity: 0.85 }}>{r.words} từ, {r.issue_count} lỗi cần sửa</Text>
        </View>
      </Card>
      </Reveal>

      {r.under_length ? <Banner tone="warning" text={`Bài mới có ${r.words} từ, dưới mức ${r.min_words} từ của đề. Giám khảo sẽ trừ điểm tiêu chí hoàn thành yêu cầu.`} /> : null}

      {r.summary_vi ? <Card><Text variant="heading">Nhận xét chung</Text><Text tone="secondary">{r.summary_vi}</Text></Card> : null}

      {r.priorities_vi.length ? (
        <Card tone="accent">
          <Text variant="heading">Nên sửa trước</Text>
          {r.priorities_vi.map((p, i) => <Text key={i}>{i + 1}. {p}</Text>)}
        </Card>
      ) : null}

      {CRIT_ORDER.map((k, i) => {
        const cr = r.criteria[k];
        const col = bandColor(c, cr.band);
        return (
          <Reveal key={k} index={i + 1}>
          <Card>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text variant="heading">{CRIT_VI[k]}</Text>
                {cr.name ? <Text variant="caption" tone="muted">{cr.name}</Text> : null}
              </View>
              <Text variant="title" style={{ color: col }}>{cr.band.toFixed(1)}</Text>
            </Row>
            <ProgressBar value={cr.band / 9} color={col} track={c.surfaceSunken} height={6} />
            {cr.comment_vi ? <Text tone="secondary">{cr.comment_vi}</Text> : null}
            {cr.strengths.map((s, i) => <Text key={`s${i}`} variant="small"><Text variant="small" tone="success">＋ </Text>{s}</Text>)}
            {cr.improvements.map((s, i) => <Text key={`i${i}`} variant="small"><Text variant="small" tone="danger">－ </Text>{s}</Text>)}
          </Card>
          </Reveal>
        );
      })}

      <Row style={{ justifyContent: "space-between" }}>
        <Text variant="heading">Sửa từng câu</Text>
        {r.sentences.length !== changed.length ? (
          <Button small variant="ghost" title={showAll ? "Chỉ câu cần sửa" : "Hiện tất cả câu"} onPress={() => setShowAll((v) => !v)} />
        ) : null}
      </Row>
      {!list.length ? <Text tone="secondary">Không có câu nào cần sửa. Tuyệt vời!</Text> : null}
      {list.map((s) => (
        <Card key={s.index} style={{ gap: space[2] }}>
          {s.changed ? (
            <>
              <Text variant="small" tone="muted" style={{ textDecorationLine: s.corrected !== s.original ? "line-through" : "none" }}>{s.original}</Text>
              {s.corrected !== s.original ? <Text style={{ color: c.success }}>{s.corrected}</Text> : null}
              {s.issues.map((iss, j) => (
                <View key={j} style={[styles.issue, { backgroundColor: c.surfaceSunken }]}>
                  <Text variant="caption" tone="brand">{ISSUE_LABEL[iss.type] || "Lỗi"}</Text>
                  {iss.text || iss.suggestion ? (
                    <Text variant="small">
                      {iss.text ? <Text variant="small" tone="danger">{iss.text}</Text> : null}
                      {iss.text && iss.suggestion ? " → " : ""}
                      {iss.suggestion ? <Text variant="small" tone="success">{iss.suggestion}</Text> : null}
                    </Text>
                  ) : null}
                  {iss.explanation_vi ? <Text variant="small" tone="secondary">{iss.explanation_vi}</Text> : null}
                </View>
              ))}
            </>
          ) : (
            <Text variant="small" tone="secondary">{s.original}</Text>
          )}
        </Card>
      ))}
      <Text variant="small" tone="muted" style={{ textAlign: "center" }}>Điểm do AI ước lượng theo tiêu chí IELTS, chỉ để tham khảo.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { height: 6, borderRadius: radius.full, overflow: "hidden" },
  issue: { borderRadius: radius.sm, padding: space[3], gap: 4 },
});
