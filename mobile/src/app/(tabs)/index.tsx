import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Coal } from "@/components/Coal";
import { nativeDriver, PressScale, ProgressBar, Reveal } from "@/components/motion";
import { Banner, Button, ErrorView, LoadingView, Row, Screen, Text } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setBadge } from "@/lib/badges";
import { prefetch } from "@/lib/cache";
import { useConfig } from "@/lib/config";
import { daysBetween, monthEnd, monthStart, prettyDate, todayIso, WEEKDAYS_SHORT, weekdayIdx } from "@/lib/dates";
import { pickMood } from "@/lib/mascot";
import {
  fetchDueCards, fetchProfile, fetchStreak, fetchSummary, fetchToday, setTaskStatus, taskDone, taskMeta,
  type PlanTask, type ProfileInfo, type Streak, type TodayPlan,
} from "@/lib/studia";
import { radius, space, useTheme } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";

type HomeData = {
  plan: TodayPlan | null;
  streak: Streak | null;
  profile: ProfileInfo | null;
  due: number | null;
  partialError: string | null;
};

function greeting(h = new Date().getHours()) {
  return h < 11 ? "Chào buổi sáng" : h < 14 ? "Chào buổi trưa" : h < 18 ? "Chào buổi chiều" : "Chào buổi tối";
}

export default function Today() {
  const { c } = useTheme();
  const { name } = useAuth();
  const { on, announcement } = useConfig();
  const cardsOn = on("flashcards");
  const planOn = on("plan");

  const load = useLoad<HomeData>(async () => {
    const [plan, streak, profile, due] = await Promise.allSettled([
      fetchToday(),
      fetchStreak(),
      fetchProfile(),
      cardsOn ? fetchDueCards(50) : Promise.resolve(null),
    ]);
    const all = cardsOn ? [plan, streak, profile, due] : [plan, streak, profile];
    const failed = all.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // Hỏng hết (thường là mất mạng): báo lỗi thay vì trang trống
    if (failed.length === all.length) throw failed[0].reason;
    const val = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
    return {
      plan: val(plan),
      streak: val(streak),
      profile: val(profile),
      due: val(due)?.count ?? null,
      partialError: failed.length ? `Một phần dữ liệu chưa tải được: ${errorMessage(failed[0].reason)}` : null,
    };
  }, [cardsOn], { cacheKey: "home" });

  // Số thẻ đến hạn hiện trên icon tab Ôn thẻ
  useEffect(() => { if (load.data?.due != null) setBadge("flashcards", load.data.due); }, [load.data?.due]);

  // Tải trước lịch tháng này khi màn hình đã yên, để mở tab Lịch học là có ngay
  useEffect(() => {
    if (!load.data || !planOn) return;
    const t = setTimeout(() => {
      const m = monthStart(todayIso());
      prefetch(`summary:${m}`, () => fetchSummary(m, monthEnd(m)));
      prefetch("streak", fetchStreak);
    }, 800);
    return () => clearTimeout(t);
  }, [load.data, planOn]);

  // Quay lại tab (vd sau khi ôn thẻ) thì làm mới nhẹ, bỏ qua lần đầu vì useLoad đã tải.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    load.silentReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);

  if (load.loading && !load.data) return <Screen scroll={false}><LoadingView text="Đang chuẩn bị ngày học của bạn" /></Screen>;
  if (!load.data) return <Screen scroll={false}><ErrorView message={load.error || "Không tải được dữ liệu."} onRetry={load.reload} /></Screen>;

  const { plan, streak, profile, due, partialError } = load.data;
  const tasks = plan?.tasks ?? [];
  const done = tasks.filter(taskDone).length;
  const mascot = pickMood(streak);
  const examLeft = profile?.examDate ? daysBetween(todayIso(), profile.examDate) : null;

  const toggle = async (idx: number, t: PlanTask) => {
    if (!plan || busyIdx !== null) return;
    const next = taskDone(t) ? "pending" : "completed";
    const before = plan.tasks;
    setTaskError(null);
    setBusyIdx(idx);
    load.setData((d) => d && d.plan ? { ...d, plan: { ...d.plan, tasks: d.plan.tasks.map((x, i) => (i === idx ? { ...x, status: next } : x)) } } : d);
    try {
      const res = await setTaskStatus(plan.plan_date, idx, next);
      if (res.tasks.length) load.setData((d) => d && d.plan ? { ...d, plan: { ...d.plan, tasks: res.tasks } } : d);
      // Hoàn thành nhiệm vụ có thể đổi streak và tư thế của Coal
      fetchStreak().then((s) => load.setData((d) => (d ? { ...d, streak: s } : d))).catch(() => {});
    } catch (e) {
      load.setData((d) => d && d.plan ? { ...d, plan: { ...d.plan, tasks: before } } : d);
      setTaskError(errorMessage(e));
    } finally {
      setBusyIdx(null);
    }
  };

  const examLabel = examLeft === null ? "Chưa đặt ngày thi" : examLeft < 0 ? "Kỳ thi đã qua" : examLeft === 0 ? "Thi hôm nay" : "ngày đến kỳ thi";

  return (
    <Screen refreshing={load.refreshing} onRefresh={load.refresh}>
      <Reveal index={0}>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="small" tone="muted">{prettyDate(todayIso()).replace(/, \d{4}$/, "")}</Text>
            <Text variant="title" numberOfLines={1}>{greeting()}, {name}</Text>
          </View>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Cài đặt"
            onPress={() => router.push("/settings")}
            hitSlop={10}
            scaleTo={0.9}
            style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}
          >
            <Ionicons name="settings-outline" size={20} color={c.inkSecondary} />
          </PressScale>
        </Row>
      </Reveal>

      {announcement ? <Banner tone={announcement.level === "warning" ? "warning" : "info"} text={announcement.text} /> : null}
      {partialError ? <Banner tone="warning" text={partialError} onRetry={load.reload} /> : null}
      {load.error ? <Banner text={`${load.error} Đang hiện dữ liệu đã lưu.`} onRetry={load.refresh} /> : null}

      <Reveal index={1}>
        <View style={[styles.hero, { backgroundColor: c.navy }]}>
          <Row gap={space[3]} style={{ alignItems: "flex-end" }}>
            <Coal mood={mascot.mood} wet={mascot.wet} fire={mascot.fire} size={108} />
            <View style={[styles.bubble, { backgroundColor: "rgba(255,255,255,0.09)" }]}>
              <Text variant="small" style={{ color: c.onNavy }} accessibilityLiveRegion="polite">{mascot.line}</Text>
            </View>
          </Row>
          <View style={[styles.heroStats, { borderTopColor: "rgba(255,255,255,0.12)" }]}>
            <View style={styles.heroStat}>
              <Row gap={6}>
                <Ionicons name="flame" size={20} color={c.accent} />
                <Text variant="display" style={{ color: c.onNavy, fontSize: 28, lineHeight: 32 }}>{streak?.current ?? "–"}</Text>
              </Row>
              <Text variant="caption" style={{ color: c.onNavy, opacity: 0.72 }}>ngày liên tiếp</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: "rgba(255,255,255,0.12)" }]} />
            <View style={styles.heroStat}>
              <Row gap={6}>
                <Ionicons name="flag" size={18} color={c.onNavy} style={{ opacity: 0.85 }} />
                <Text variant="display" style={{ color: c.onNavy, fontSize: 28, lineHeight: 32 }}>{examLeft === null ? "–" : Math.max(0, examLeft)}</Text>
              </Row>
              <Text variant="caption" style={{ color: c.onNavy, opacity: 0.72 }}>{examLabel}</Text>
            </View>
          </View>
          {streak?.week.length ? (
            <Row style={{ justifyContent: "space-between" }} accessibilityLabel="Bảy ngày gần nhất">
              {streak.week.map((d) => {
                const isToday = d.date === streak.today;
                return (
                  <View key={d.date} style={{ alignItems: "center", gap: 6, flex: 1 }}>
                    <View style={[styles.dot, { backgroundColor: d.active ? c.accent : "rgba(255,255,255,0.1)" }, isToday && { borderWidth: 2, borderColor: c.onNavy }]}>
                      {d.active ? <Ionicons name="flame" size={13} color={c.onAccent} /> : null}
                    </View>
                    <Text variant="caption" style={{ color: c.onNavy, opacity: isToday ? 1 : 0.6 }}>{WEEKDAYS_SHORT[weekdayIdx(d.date)]}</Text>
                  </View>
                );
              })}
            </Row>
          ) : null}
        </View>
      </Reveal>

      <Reveal index={2}>
        <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <Row style={{ justifyContent: "space-between" }}>
            <Text variant="heading">Nhiệm vụ hôm nay</Text>
            {tasks.length ? <Text variant="label" tone={done === tasks.length ? "success" : "muted"}>{done}/{tasks.length} xong</Text> : null}
          </Row>
          {tasks.length ? (
            <>
              <ProgressBar value={done / tasks.length} color={done === tasks.length ? c.success : c.brand} track={c.surfaceSunken} />
              {taskError ? <Banner text={taskError} /> : null}
              <View style={{ gap: space[2] }}>
                {tasks.map((t, i) => (
                  <TaskRow key={i} task={t} busy={busyIdx === i} onPress={() => toggle(i, t)} />
                ))}
              </View>
            </>
          ) : (
            <Text tone="secondary">
              Hôm nay chưa có nhiệm vụ trong lộ trình. Ôn vài thẻ hoặc chấm một bài Writing để giữ chuỗi nhé.
            </Text>
          )}
        </View>
      </Reveal>

      {cardsOn ? (
        <Reveal index={3}>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={due ? `${due} thẻ đến hạn ôn. Ôn ngay` : "Mở ôn thẻ"}
            onPress={() => router.push("/flashcards")}
            style={[styles.dueRow, { backgroundColor: due ? c.accentTint : c.surfaceSunken }]}
          >
            <View style={[styles.dueIcon, { backgroundColor: due ? c.accent : c.hairline }]}>
              <Ionicons name="albums" size={20} color={due ? c.onAccent : c.inkMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label">{due === null ? "Ôn flashcard" : due > 0 ? `${due} thẻ đến hạn ôn` : "Đã ôn hết thẻ hôm nay"}</Text>
              <Text variant="small" tone="secondary">{due ? "Khoảng " + Math.max(1, Math.round(due * 0.25)) + " phút" : "Thẻ mới sẽ tới đúng lúc sắp quên"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={c.inkMuted} />
          </PressScale>
        </Reveal>
      ) : null}
    </Screen>
  );
}

/** Một nhiệm vụ: chạm để đánh dấu xong; ô tick bật nhẹ khi đổi trạng thái. */
function TaskRow({ task, busy, onPress }: { task: PlanTask; busy: boolean; onPress: () => void }) {
  const { c } = useTheme();
  const isDone = taskDone(task);
  const pop = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    pop.setValue(0.6);
    Animated.spring(pop, { toValue: 1, speed: 22, bounciness: 14, useNativeDriver: nativeDriver }).start();
  }, [isDone, pop]);

  return (
    <PressScale
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isDone, busy }}
      accessibilityLabel={`${task.topic_name}, ${taskMeta(task)}`}
      onPress={onPress}
      disabled={busy}
      style={[styles.task, { backgroundColor: isDone ? c.successTint : c.surfaceSunken, opacity: busy ? 0.6 : 1 }]}
    >
      <Animated.View style={[styles.check, { borderColor: isDone ? c.success : c.borderControl, backgroundColor: isDone ? c.success : "transparent", transform: [{ scale: pop }] }]}>
        {isDone ? <Ionicons name="checkmark" size={16} color={c.surface} /> : null}
      </Animated.View>
      <View style={{ flex: 1 }}>
        <Text variant="label" style={isDone ? { color: c.inkSecondary } : undefined}>{task.topic_name}</Text>
        <Text variant="small" tone="muted">{taskMeta(task)}{task.status === "skipped" ? ", đã bỏ qua" : ""}</Text>
      </View>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  hero: { borderRadius: radius.xl, padding: space[5], gap: space[4] },
  bubble: { flex: 1, borderRadius: radius.lg, borderBottomLeftRadius: 6, padding: space[3], marginBottom: space[3] },
  heroStats: { flexDirection: "row", alignItems: "stretch", borderTopWidth: 1, paddingTop: space[4] },
  heroStat: { flex: 1, gap: 2 },
  divider: { width: 1, marginHorizontal: space[4] },
  dot: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  section: { borderRadius: radius.lg, borderWidth: 1, padding: space[5], gap: space[4] },
  task: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3], paddingHorizontal: space[4], borderRadius: radius.md },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  dueRow: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[4], borderRadius: radius.lg },
  dueIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
