import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Banner, Button, Card, Chip, ErrorView, Field, LoadingView, Row, Screen, Text } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { fmtMinutes, isHHMM, isIsoDay, prettyDate, todayIso } from "@/lib/dates";
import {
  createSlot, deleteSlot, fetchDay, setTaskStatus, skillLabel, SKILLS, taskDone, taskMeta, updateSlotStatus,
  type Skill, type Slot,
} from "@/lib/studia";
import { radius, space, useTheme } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";

export default function DayScreen() {
  const params = useLocalSearchParams<{ day: string }>();
  const day = typeof params.day === "string" ? params.day : "";
  if (!isIsoDay(day)) {
    return <Screen edges={[]} scroll={false}><ErrorView message="Ngày không hợp lệ." /></Screen>;
  }
  return <DayDetail day={day} />;
}

function DayDetail({ day }: { day: string }) {
  const { c } = useTheme();
  const today = todayIso();
  const past = day < today;
  const load = useLoad(() => fetchDay(day), [day], { cacheKey: `day:${day}` });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (load.loading && !load.data) return <Screen edges={[]} scroll={false}><LoadingView /></Screen>;
  if (!load.data) return <Screen edges={[]} scroll={false}><ErrorView message={load.error || "Không tải được ngày này."} onRetry={load.reload} /></Screen>;

  const d = load.data;
  const tasks = d.plan?.tasks ?? [];

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleTask = (i: number) => run(`t${i}`, async () => {
    const t = tasks[i];
    const res = await setTaskStatus(day, i, taskDone(t) ? "pending" : "completed");
    load.setData((x) => (x && x.plan ? { ...x, plan: { ...x.plan, tasks: res.tasks.length ? res.tasks : x.plan.tasks, status: res.status } } : x));
  });

  const setSlot = (s: Slot, status: Slot["status"]) => run(s.id, async () => {
    const updated = await updateSlotStatus(s.id, status);
    load.setData((x) => (x ? { ...x, slots: x.slots.map((y) => (y.id === s.id ? updated ?? { ...y, status } : y)) } : x));
  });

  const removeSlot = (s: Slot) => run(s.id, async () => {
    await deleteSlot(s.id);
    load.setData((x) => (x ? { ...x, slots: x.slots.filter((y) => y.id !== s.id) } : x));
  });

  return (
    <Screen edges={[]} refreshing={load.refreshing} onRefresh={load.refresh}>
      <Stack.Screen options={{ title: day === today ? "Hôm nay" : prettyDate(day).split(",")[0] }} />
      <View>
        <Text variant="title">{prettyDate(day)}</Text>
        {past ? <Text tone="muted">Ngày đã qua: chỉ xem, không thêm hay sửa được.</Text> : null}
      </View>

      {load.error ? <Banner text={load.error} onRetry={load.refresh} /> : null}
      {actionError ? <Banner text={actionError} /> : null}

      <Row gap={space[3]}>
        <Card style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" tone="muted">Đã học</Text>
          <Text variant="heading">{fmtMinutes(d.stats.minutes)}</Text>
        </Card>
        <Card style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" tone="muted">Nhiệm vụ</Text>
          <Text variant="heading">{d.stats.tasks_done}/{d.stats.tasks_total || tasks.length}</Text>
        </Card>
      </Row>

      <Card>
        <Text variant="heading">Nhiệm vụ trong lộ trình</Text>
        {tasks.length ? tasks.map((t, i) => {
          const isDone = taskDone(t);
          const editable = day === today;
          return (
            <Pressable
              key={i}
              disabled={!editable || !!busy}
              accessibilityRole={editable ? "checkbox" : undefined}
              accessibilityState={{ checked: isDone }}
              onPress={() => toggleTask(i)}
              style={[styles.line, { borderColor: c.hairline, opacity: busy === `t${i}` ? 0.5 : 1 }]}
            >
              <Ionicons name={isDone ? "checkmark-circle" : t.status === "skipped" ? "remove-circle-outline" : "ellipse-outline"} size={22} color={isDone ? c.success : c.inkMuted} />
              <View style={{ flex: 1 }}>
                <Text variant="label">{t.topic_name}</Text>
                <Text variant="small" tone="muted">{taskMeta(t)}</Text>
              </View>
            </Pressable>
          );
        }) : <Text tone="secondary">Ngày này không có nhiệm vụ trong lộ trình.</Text>}
      </Card>

      <Card>
        <Text variant="heading">Khung giờ học</Text>
        {d.slots.length ? d.slots.map((s) => (
          <View key={s.id} style={[styles.slot, { borderColor: c.hairline, opacity: busy === s.id ? 0.5 : 1 }]}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text variant="label" tone="brand">{s.start}–{s.end}</Text>
              <Text variant="caption" tone={s.status === "done" ? "success" : "muted"}>
                {s.status === "done" ? "Đã học" : s.status === "skipped" ? "Bỏ qua" : "Dự định"}, {skillLabel(s.skill)}
              </Text>
            </Row>
            <Text variant="label">{s.title}</Text>
            {s.note ? <Text variant="small" tone="secondary">{s.note}</Text> : null}
            {!past ? (
              <Row gap={space[2]} style={{ flexWrap: "wrap" }}>
                {s.status !== "done" ? <Button small title="Đã học" variant="secondary" onPress={() => setSlot(s, "done")} disabled={!!busy} /> : null}
                {s.status !== "planned" ? <Button small title="Đặt lại" variant="secondary" onPress={() => setSlot(s, "planned")} disabled={!!busy} /> : null}
                {s.status === "planned" ? <Button small title="Bỏ qua" variant="ghost" onPress={() => setSlot(s, "skipped")} disabled={!!busy} /> : null}
                <Button small title="Xoá" variant="danger" onPress={() => removeSlot(s)} disabled={!!busy} />
              </Row>
            ) : null}
          </View>
        )) : <Text tone="secondary">{past ? "Ngày này không có khung giờ nào." : "Chưa có khung giờ nào. Thêm một khung bên dưới nhé."}</Text>}
      </Card>

      {!past ? <AddSlot day={day} onAdded={(s) => load.setData((x) => (x ? { ...x, slots: [...x.slots, s].sort((a, b) => a.start.localeCompare(b.start)) } : x))} /> : null}

      {d.moments.length ? (
        <Card>
          <Text variant="heading">Khoảnh khắc</Text>
          {d.moments.map((m) => (
            <View key={m.id} style={{ gap: 6 }}>
              {m.url ? <Image source={{ uri: m.url }} style={[styles.photo, { backgroundColor: c.surfaceSunken }]} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
              {m.caption ? <Text variant="small" tone="secondary">{m.caption}</Text> : null}
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function AddSlot({ day, onAdded }: { day: string; onAdded: (s: Slot) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("20:00");
  const [end, setEnd] = useState("20:30");
  const [skill, setSkill] = useState<Skill>("reading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return <Button title="Thêm khung giờ học" variant="secondary" onPress={() => setOpen(true)} />;

  const submit = async () => {
    if (!title.trim()) return setError("Đặt tên cho khung giờ nhé, vd “Luyện Reading”.");
    if (!isHHMM(start) || !isHHMM(end)) return setError("Giờ cần dạng HH:MM, vd 20:00.");
    if (end <= start) return setError("Giờ kết thúc phải sau giờ bắt đầu.");
    setBusy(true);
    setError(null);
    try {
      const s = await createSlot({ day, start, end, title: title.trim(), note: "", skill, remind: true });
      if (s) onAdded(s);
      setTitle("");
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text variant="heading">Thêm khung giờ</Text>
      {error ? <Banner text={error} /> : null}
      <Field label="Tên" value={title} onChangeText={setTitle} placeholder="Luyện Reading" maxLength={120} />
      <Row gap={space[3]}>
        <View style={{ flex: 1 }}><Field label="Bắt đầu" value={start} onChangeText={setStart} placeholder="20:00" maxLength={5} keyboardType="numbers-and-punctuation" /></View>
        <View style={{ flex: 1 }}><Field label="Kết thúc" value={end} onChangeText={setEnd} placeholder="20:30" maxLength={5} keyboardType="numbers-and-punctuation" /></View>
      </Row>
      <Text variant="label">Kỹ năng</Text>
      <Row gap={space[2]} style={{ flexWrap: "wrap" }}>
        {SKILLS.map((s) => <Chip key={s.id} label={s.label} active={skill === s.id} onPress={() => setSkill(s.id)} />)}
      </Row>
      <Row gap={space[2]}>
        <Button title="Lưu" onPress={submit} loading={busy} style={{ flex: 1 }} />
        <Button title="Huỷ" variant="ghost" onPress={() => { setOpen(false); setError(null); }} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2], borderTopWidth: 1 },
  slot: { gap: 6, paddingTop: space[3], borderTopWidth: 1 },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md },
});
