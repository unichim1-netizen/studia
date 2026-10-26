import { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { PressScale, Reveal } from "@/components/motion";
import { Banner, Button, EmptyView, ErrorView, FeatureOff, LoadingView, Row, Screen, Text } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { setBadge } from "@/lib/badges";
import { useConfig } from "@/lib/config";
import { fetchDueCards, reviewCard, type Flashcard } from "@/lib/studia";
import { radius, space, useTheme } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";

const RATINGS: { value: 1 | 2 | 3 | 4; label: string; hint: string; tone: "danger" | "warning" | "brand" | "success" }[] = [
  { value: 1, label: "Quên", hint: "Ôn lại sớm", tone: "danger" },
  { value: 2, label: "Khó", hint: "Nhớ lờ mờ", tone: "warning" },
  { value: 3, label: "Nhớ", hint: "Hơi nghĩ", tone: "brand" },
  { value: 4, label: "Dễ", hint: "Nhớ ngay", tone: "success" },
];

export default function Flashcards() {
  const { on } = useConfig();
  if (!on("flashcards")) return <FeatureOff name="Flashcard" />;
  return <Review />;
}

function Review() {
  const { c } = useTheme();
  const load = useLoad(() => fetchDueCards(20));
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const shownAt = useRef(Date.now());
  const spin = useRef(new Animated.Value(0)).current;

  const cards: Flashcard[] = load.data?.cards ?? [];
  useEffect(() => { if (load.data) setBadge("flashcards", load.data.count); }, [load.data]);
  const card = cards[idx];

  useEffect(() => {
    shownAt.current = Date.now();
    setFlipped(false);
    spin.setValue(0);
  }, [idx, load.data, spin]);

  const flip = () => {
    const to = flipped ? 0 : 1;
    setFlipped(!flipped);
    Animated.spring(spin, { toValue: to, friction: 8, tension: 60, useNativeDriver: Platform.OS !== "web" }).start();
  };

  const rate = async (r: 1 | 2 | 3 | 4) => {
    if (!card || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reviewCard(card.id, r, Date.now() - shownAt.current);
      setReviewed((n) => n + 1);
      setIdx((i) => i + 1);
      setBadge("flashcards", Math.max(0, (load.data?.count ?? cards.length) - idx - 1));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setIdx(0);
    setReviewed(0);
    setError(null);
    load.reload();
  };

  if (load.loading) return <Screen scroll={false}><LoadingView text="Đang lấy thẻ đến hạn…" /></Screen>;
  if (load.error && !load.data) return <Screen scroll={false}><ErrorView message={load.error} onRetry={restart} /></Screen>;

  if (!cards.length) {
    return (
      <Screen refreshing={load.refreshing} onRefresh={restart}>
        <Header />
        <EmptyView sprite="happy" title="Không có thẻ nào đến hạn" text="Thẻ mới sẽ xuất hiện khi tới lịch ôn. Kéo xuống để kiểm tra lại." />
      </Screen>
    );
  }

  if (!card) {
    return (
      <Screen>
        <Header />
        <EmptyView
          sprite="cheer"
          title={`Xong ${reviewed} thẻ rồi!`}
          text="Coal sẽ nhắc bạn ôn lại đúng lúc sắp quên. Còn thẻ đến hạn thì tải thêm nhé."
          action={<Button title="Tải thêm thẻ" onPress={restart} style={{ marginTop: space[2] }} />}
        />
      </Screen>
    );
  }

  const frontRot = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const backRot = spin.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] });

  return (
    <Screen>
      <Header />
      <Row style={{ justifyContent: "space-between" }}>
        <Text variant="label" tone="muted">Thẻ {idx + 1}/{cards.length}</Text>
        {card.topic ? <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1, textAlign: "right", marginLeft: space[3] }}>{card.topic}</Text> : null}
      </Row>
      <View style={[styles.progress, { backgroundColor: c.surfaceSunken }]}>
        <View style={{ width: `${(idx / cards.length) * 100}%`, height: "100%", backgroundColor: c.brand }} />
      </View>

      <Reveal index={0} key={card.id}>
      <Pressable accessibilityRole="button" accessibilityLabel={flipped ? `Mặt sau: ${card.back}` : `Mặt trước: ${card.front}. Chạm để lật thẻ`} onPress={flip} style={styles.stage}>
        <Animated.View style={[styles.face, { backgroundColor: c.surface, borderColor: c.hairline, transform: [{ perspective: 1000 }, { rotateY: frontRot }] }]}>
          <Text variant="title" style={styles.faceText}>{card.front}</Text>
          <Text variant="small" tone="muted">Chạm để lật</Text>
        </Animated.View>
        <Animated.View style={[styles.face, styles.back, { backgroundColor: c.brandTint, borderColor: c.brand, transform: [{ perspective: 1000 }, { rotateY: backRot }] }]}>
          <Text variant="heading" style={styles.faceText}>{card.back}</Text>
        </Animated.View>
      </Pressable>
      </Reveal>

      {error ? <Banner text={error} /> : null}

      {flipped ? (
        <View style={{ gap: space[2] }}>
          <Text variant="label" tone="secondary" style={{ textAlign: "center" }}>Bạn nhớ thẻ này thế nào?</Text>
          <Row gap={space[2]}>
            {RATINGS.map((r) => {
              const fg = r.tone === "danger" ? c.danger : r.tone === "warning" ? c.warning : r.tone === "success" ? c.success : c.brand;
              const bg = r.tone === "danger" ? c.dangerTint : r.tone === "warning" ? c.warningTint : r.tone === "success" ? c.successTint : c.brandTint;
              return (
                <PressScale
                  key={r.value}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.label}: ${r.hint}`}
                  disabled={busy}
                  onPress={() => rate(r.value)}
                  scaleTo={0.94}
                  style={[styles.rate, { backgroundColor: bg, opacity: busy ? 0.5 : 1 }]}
                >
                  <Text variant="label" style={{ color: fg }}>{r.label}</Text>
                  <Text variant="caption" style={{ color: fg, opacity: 0.85, textAlign: "center" }}>{r.hint}</Text>
                </PressScale>
              );
            })}
          </Row>
        </View>
      ) : (
        <Button title="Lật thẻ" onPress={flip} />
      )}
    </Screen>
  );
}

function Header() {
  return (
    <View>
      <Text variant="title">Ôn flashcard</Text>
      <Text tone="secondary">Nhớ lại trước khi lật, rồi chấm mức độ nhớ để Coal xếp lịch ôn.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { height: 6, borderRadius: radius.full, overflow: "hidden" },
  stage: { height: 300 },
  face: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.xl, borderWidth: 1, padding: space[6],
    alignItems: "center", justifyContent: "center", gap: space[4], backfaceVisibility: "hidden",
  },
  back: { borderWidth: 2 },
  faceText: { textAlign: "center" },
  rate: { flex: 1, borderRadius: radius.lg, paddingVertical: space[3], paddingHorizontal: 4, alignItems: "center", gap: 2 },
});
