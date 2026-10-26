import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { PressScale, Reveal } from "@/components/motion";
import { Banner, Card, FeatureOff, Row, Screen, Text } from "@/components/ui";
import { useConfig } from "@/lib/config";
import { addDays, addMonths, fmtMinutes, monthEnd, monthLabel, monthStart, todayIso, WEEKDAYS_SHORT, weekdayIdx } from "@/lib/dates";
import { fetchStreak, fetchSummary, type DayStat } from "@/lib/studia";
import { mix, radius, space, useTheme } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";

/** Mức tô đậm ô lịch theo số phút đã học (giống heat() của web). */
const heat = (s: DayStat | undefined) => (!s?.active ? 0 : s.minutes <= 20 ? 1 : s.minutes <= 45 ? 2 : s.minutes <= 90 ? 3 : 4);
const HEAT_ALPHA = [0, 0.28, 0.5, 0.75, 1];

export default function Schedule() {
  const { on } = useConfig();
  if (!on("plan")) return <FeatureOff name="Lịch học" />;
  return <Calendar />;
}

function Calendar() {
  const { c } = useTheme();
  const today = todayIso();
  const [month, setMonth] = useState(monthStart(today));
  const streak = useLoad(fetchStreak, [], { cacheKey: "streak" });
  const summary = useLoad(() => fetchSummary(month, monthEnd(month)), [month], { cacheKey: `summary:${month}` });

  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    streak.silentReload();
    summary.silentReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const days = summary.data ?? {};
  const lead = weekdayIdx(month);
  const count = Number(monthEnd(month).slice(8, 10));
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => addDays(month, i))];
  while (cells.length % 7) cells.push(null);

  const monthStats = Object.values(days);
  const activeDays = monthStats.filter((d) => d.active).length;
  const minutes = monthStats.reduce((n, d) => n + d.minutes, 0);
  const s = streak.data;

  return (
    <Screen refreshing={summary.refreshing || streak.refreshing} onRefresh={() => { streak.refresh(); summary.refresh(); }}>
      <Reveal index={0}>
        <Text variant="title">Lịch học</Text>
        <Text tone="secondary">Chạm vào một ngày để xem chi tiết. Ngày đã qua chỉ xem được.</Text>
      </Reveal>

      {streak.error && !s ? <Banner text={streak.error} onRetry={streak.reload} /> : null}
      <Reveal index={1}>
      <Row gap={space[3]}>
        <Stat label="Chuỗi hiện tại" value={s ? `${s.current} ngày` : streak.loading ? "…" : "—"} tone={c.accentStrong} />
        <Stat label="Dài nhất" value={s ? `${s.longest} ngày` : streak.loading ? "…" : "—"} tone={c.brand} />
      </Row>
      </Reveal>
      {s?.next_milestone ? (
        <Text variant="small" tone="muted">Còn {s.to_next_milestone} ngày nữa tới mốc {s.next_milestone} ngày. {s.today_done ? "Hôm nay đã giữ lửa." : "Hôm nay chưa học."}</Text>
      ) : null}

      <Reveal index={2}>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Tháng trước" hitSlop={10} onPress={() => setMonth((m) => addMonths(m, -1))} style={styles.nav}>
            <Ionicons name="chevron-back" size={22} color={c.brand} />
          </Pressable>
          <Row>
            <Text variant="heading">{monthLabel(month)}</Text>
            {summary.loading ? <ActivityIndicator size="small" color={c.brand} /> : null}
          </Row>
          <Pressable accessibilityRole="button" accessibilityLabel="Tháng sau" hitSlop={10} onPress={() => setMonth((m) => addMonths(m, 1))} style={styles.nav}>
            <Ionicons name="chevron-forward" size={22} color={c.brand} />
          </Pressable>
        </Row>

        {summary.error ? <Banner text={summary.error} onRetry={summary.reload} /> : null}

        <View style={styles.grid}>
          {WEEKDAYS_SHORT.map((w) => (
            <View key={w} style={styles.cell}><Text variant="caption" tone="muted">{w}</Text></View>
          ))}
          {cells.map((d, i) => {
            if (!d) return <View key={`b${i}`} style={styles.cell} />;
            const st = days[d];
            const h = heat(st);
            const isToday = d === today;
            const past = d < today;
            return (
              <View key={d} style={styles.cell}>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={`Ngày ${Number(d.slice(8))}${st?.active ? `, đã học ${st.minutes} phút` : ""}`}
                  onPress={() => router.push(`/day/${d}`)}
                  scaleTo={0.9}
                  style={[styles.day, { backgroundColor: h ? mix(c.surface, c.accent, HEAT_ALPHA[h]) : c.surfaceSunken }, isToday && { borderWidth: 2, borderColor: c.brand }]}
                >
                  <Text variant="label" style={{ color: h >= 3 ? c.onAccent : past ? c.inkMuted : c.ink }}>{Number(d.slice(8))}</Text>
                  {st && st.slots > 0 && !st.active ? <View style={[styles.mark, { backgroundColor: c.brand }]} /> : null}
                </PressScale>
              </View>
            );
          })}
        </View>

        <Row style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <Row gap={4}>
            <Text variant="caption" tone="muted">Ít</Text>
            {HEAT_ALPHA.map((a, i) => (
              <View key={i} style={[styles.legend, { backgroundColor: i ? mix(c.surface, c.accent, a) : c.surfaceSunken }]} />
            ))}
            <Text variant="caption" tone="muted">Nhiều</Text>
          </Row>
          <Row gap={4}>
            <View style={[styles.mark, { backgroundColor: c.brand, position: "relative", bottom: 0 }]} />
            <Text variant="caption" tone="muted">có lịch</Text>
          </Row>
        </Row>
      </Card>
      </Reveal>

      <Reveal index={3}>
        <Card tone="sunken">
          <Text variant="label">Tháng này</Text>
          <Text tone="secondary">{activeDays} ngày có học, tổng {fmtMinutes(minutes)}</Text>
        </Card>
      </Reveal>
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text variant="title" style={{ color: tone }}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  nav: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3, alignItems: "center", justifyContent: "center" },
  day: { width: "100%", height: "100%", borderRadius: radius.md, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  mark: { position: "absolute", bottom: 4, width: 5, height: 5, borderRadius: 3 },
  legend: { width: 14, height: 14, borderRadius: 4 },
});
