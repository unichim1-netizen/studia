import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Coal } from "@/components/Coal";
import { PressScale, Reveal } from "@/components/motion";
import { Button, Chip, FeatureOff, Row, Text } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { askTutor } from "@/lib/studia";
import { fonts, radius, space, useTheme } from "@/lib/theme";

type Msg = { id: string; role: "user" | "assistant"; content: string; failed?: boolean };

const STORE = "studia-tutor-chat";
const STARTERS = [
  "Phân biệt “affect” và “effect”?",
  "Cách mở bài Writing Task 2 dạng Opinion",
  "Mẹo làm True/False/Not Given",
  "Gợi ý từ vựng chủ đề Environment",
];
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function Tutor() {
  const { on } = useConfig();
  if (!on("tutor")) return <FeatureOff name="Gia sư Coal" />;
  return <Chat />;
}

function Chat() {
  const { c } = useTheme();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const restored = useRef(false);

  // Giữ cuộc trò chuyện gần nhất trên máy
  useEffect(() => {
    AsyncStorage.getItem(STORE)
      .then((raw) => {
        if (!raw) return;
        const d = JSON.parse(raw) as { sessionId?: unknown; messages?: unknown };
        if (typeof d.sessionId === "string") setSessionId(d.sessionId);
        if (Array.isArray(d.messages)) {
          setMessages(d.messages.filter((m): m is Msg => !!m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant")).slice(-40));
        }
      })
      .catch(() => {})
      .finally(() => { restored.current = true; });
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    AsyncStorage.setItem(STORE, JSON.stringify({ sessionId, messages: messages.filter((m) => !m.failed).slice(-40) })).catch(() => {});
  }, [messages, sessionId]);

  const send = async (text: string, retryOf?: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setFollowUps([]);
    setInput("");
    setMessages((m) => {
      const base = retryOf ? m.filter((x) => x.id !== retryOf) : [...m, { id: uid(), role: "user" as const, content: q }];
      return base;
    });
    try {
      const res = await askTutor(q, sessionId);
      if (res.session_id) setSessionId(res.session_id);
      setMessages((m) => [...m, { id: uid(), role: "assistant", content: res.answer }]);
      setFollowUps(res.follow_ups);
    } catch (e) {
      setMessages((m) => [...m, { id: `err-${uid()}|${q}`, role: "assistant", content: errorMessage(e), failed: true }]);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setSessionId(null);
    setFollowUps([]);
    AsyncStorage.removeItem(STORE).catch(() => {});
  };

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: c.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}>
        <Row style={[styles.header, { borderColor: c.hairline }]}>
          <Coal sprite="smile" size={40} still />
          <View style={{ flex: 1 }}>
            <Text variant="heading">Hỏi Coal</Text>
            <Text variant="caption" tone="muted">Gia sư IELTS, hỏi gì cũng được</Text>
          </View>
          {messages.length ? <Button small variant="ghost" title="Cuộc mới" onPress={reset} disabled={busy} /> : null}
        </Row>

        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {!messages.length ? (
            <View style={{ alignItems: "center", gap: space[3], paddingTop: space[6] }}>
              <Coal sprite="hello" size={110} />
              <Text variant="heading" style={{ textAlign: "center" }}>Chào bạn! Mình là Coal.</Text>
              <Text tone="secondary" style={{ textAlign: "center", maxWidth: 320 }}>Hỏi mình về ngữ pháp, từ vựng, cách làm bài IELTS… Mình trả lời bằng tiếng Việt.</Text>
              <View style={{ gap: space[2], alignSelf: "stretch" }}>
                {STARTERS.map((s) => <Chip key={s} label={s} onPress={() => send(s)} />)}
              </View>
            </View>
          ) : null}

          {messages.map((m) => {
            const mine = m.role === "user";
            return (
              <Reveal key={m.id} style={mine ? styles.mine : styles.theirs}>
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs, {
                backgroundColor: mine ? c.navy : m.failed ? c.dangerTint : c.surface,
                borderColor: mine ? c.navy : m.failed ? c.dangerTint : c.hairline,
              }]}>
                <Text selectable style={{ color: mine ? c.onNavy : m.failed ? c.danger : c.ink }}>{m.content}</Text>
                {m.failed ? (
                  <Pressable accessibilityRole="button" onPress={() => send(m.id.split("|").slice(1).join("|"), m.id)} disabled={busy} hitSlop={8}>
                    <Text variant="label" tone="danger" style={{ textDecorationLine: "underline", marginTop: 6 }}>Gửi lại</Text>
                  </Pressable>
                ) : null}
              </View>
              </Reveal>
            );
          })}

          {busy ? (
            <Row style={[styles.bubble, styles.theirs, { backgroundColor: c.surface, borderColor: c.hairline }]}>
              <Coal sprite="focus" size={32} talking />
              <Text tone="muted">Coal đang nghĩ…</Text>
            </Row>
          ) : null}

          {followUps.length && !busy ? (
            <View style={{ gap: space[2], marginTop: space[2] }}>
              <Text variant="caption" tone="muted">Hỏi tiếp</Text>
              {followUps.map((s) => <Chip key={s} label={s} onPress={() => send(s)} />)}
            </View>
          ) : null}
        </ScrollView>

        <Row style={[styles.inputBar, { backgroundColor: c.surface, borderColor: c.hairline }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Nhập câu hỏi…"
            placeholderTextColor={c.inkMuted}
            multiline
            maxLength={2000}
            style={[styles.input, { color: c.ink, backgroundColor: c.surfaceSunken }]}
            accessibilityLabel="Câu hỏi cho Coal"
          />
          <PressScale
            accessibilityRole="button"
            accessibilityLabel="Gửi"
            disabled={busy || !input.trim()}
            onPress={() => send(input)}
            scaleTo={0.88}
            style={[styles.send, { backgroundColor: c.brand, opacity: busy || !input.trim() ? 0.4 : 1 }]}
          >
            <Ionicons name="arrow-up" size={22} color={c.onBrand} />
          </PressScale>
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space[4], paddingVertical: space[2], gap: space[3], borderBottomWidth: 1 },
  list: { padding: space[4], gap: space[3], paddingBottom: space[6], width: "100%", maxWidth: 720, alignSelf: "center" },
  bubble: { maxWidth: "88%", borderRadius: radius.lg + 2, borderWidth: 1, paddingHorizontal: space[4], paddingVertical: space[3], gap: space[2] },
  mine: { alignSelf: "flex-end", borderBottomRightRadius: 6 },
  theirs: { alignSelf: "flex-start", borderBottomLeftRadius: 6 },
  inputBar: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[2], borderTopWidth: 1, alignItems: "flex-end" },
  input: { flex: 1, borderRadius: 22, paddingHorizontal: space[3], paddingTop: 12, paddingBottom: 12, maxHeight: 140, fontSize: 15, fontFamily: fonts.regular },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
});
