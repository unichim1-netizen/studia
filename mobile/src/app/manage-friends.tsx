import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { Coal } from "@/components/Coal";
import { Reveal } from "@/components/motion";
import { Banner, Button, Card, ErrorView, Field, LoadingView, Row, Screen, Text } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { acceptRequest, dropRequest, fetchFriends, sendRequest, unfriend, type Friend } from "@/lib/friends";
import { radius, space, useTheme } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";

/** Mã của tôi, nhập mã bạn, lời mời đến/đi và danh sách bạn bè. */
export default function ManageFriends() {
  const { c } = useTheme();
  const load = useLoad(fetchFriends, [], { cacheKey: "friends" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (load.loading && !load.data) return <Screen edges={[]} scroll={false}><LoadingView /></Screen>;
  if (!load.data) return <Screen edges={[]} scroll={false}><ErrorView message={load.error || "Không tải được danh sách bạn bè."} onRetry={load.reload} /></Screen>;

  const { me, friends, incoming, outgoing, maxFriends } = load.data;
  const pretty = me.code ? `${me.code.slice(0, 3)} ${me.code.slice(3)}` : "";

  const run = async (key: string, fn: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(key);
    setMsg(null);
    try {
      const ok = await fn();
      if (ok) setMsg({ tone: "success", text: ok });
      await load.silentReload();
    } catch (e) {
      setMsg({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(me.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setMsg({ tone: "danger", text: `Không sao chép được. Mã của bạn là ${me.code}.` });
    }
  };

  const invite = async () => {
    try {
      await Share.share({ message: `Kết bạn với mình trên Studia để học IELTS cùng nhau nhé! Mở tab Bạn bè, bấm biểu tượng thêm bạn và nhập mã ${me.code}.` });
    } catch {
      copy();
    }
  };

  const add = () => run("add", async () => {
    const clean = code.replace(/[^a-zA-Z0-9]/g, "");
    if (clean.length !== 6) throw new Error("Mã kết bạn gồm 6 ký tự, kiểm tra lại nhé.");
    const r = await sendRequest(clean);
    setCode("");
    return r.status === "accepted" ? `Bạn và ${r.name} đã là bạn bè.` : `Đã gửi lời mời cho ${r.name}. Chờ bạn ấy chấp nhận nhé.`;
  });

  return (
    <Screen edges={[]} refreshing={load.refreshing} onRefresh={load.refresh}>
      {load.error ? <Banner tone="warning" text={`${load.error} Đang hiện dữ liệu đã lưu.`} onRetry={load.refresh} /> : null}
      {msg ? <Banner tone={msg.tone} text={msg.text} /> : null}

      <Reveal index={0}>
        <Card tone="navy" style={{ alignItems: "center", gap: space[3] }}>
          <Coal sprite="hello" size={72} still />
          <Text variant="small" style={{ color: c.onNavy, opacity: 0.75 }}>Mã kết bạn của bạn</Text>
          <Text accessibilityLabel={`Mã của bạn: ${me.code.split("").join(" ")}`} style={[styles.code, { color: c.onNavy }]}>{pretty}</Text>
          <Row gap={space[2]}>
            <Button small variant="accent" title={copied ? "Đã sao chép" : "Sao chép"} onPress={copy} icon={<Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={c.onAccent} />} />
            <Button small variant="secondary" title="Gửi lời mời" onPress={invite} icon={<Ionicons name="share-outline" size={16} color={c.ink} />} />
          </Row>
        </Card>
      </Reveal>

      <Reveal index={1}>
        <Card>
          <Text variant="heading">Nhập mã của bạn bè</Text>
          <Field
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="K7Q 3M2"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            onSubmitEditing={add}
            returnKeyType="send"
            accessibilityLabel="Mã kết bạn"
          />
          <Button title="Gửi lời mời" onPress={add} loading={busy === "add"} disabled={code.replace(/[^a-zA-Z0-9]/g, "").length < 6} />
        </Card>
      </Reveal>

      {incoming.length ? (
        <Reveal index={2}>
          <Card>
            <Text variant="heading">Lời mời gửi tới bạn</Text>
            {incoming.map((r) => (
              <View key={r.id} style={styles.row}>
                <Avatar name={r.name} size={44} />
                <View style={{ flex: 1 }}>
                  <Text variant="label" numberOfLines={1}>{r.name}</Text>
                  <Text variant="caption" tone="muted">muốn kết bạn với bạn</Text>
                </View>
                <Button small title="Chấp nhận" disabled={!!busy} loading={busy === r.id} onPress={() => run(r.id, async () => { await acceptRequest(r.id); return `Bạn và ${r.name} đã là bạn bè.`; })} />
                <Button small variant="ghost" title="Từ chối" disabled={!!busy} onPress={() => run(`d${r.id}`, async () => { await dropRequest(r.id); })} />
              </View>
            ))}
          </Card>
        </Reveal>
      ) : null}

      {outgoing.length ? (
        <Reveal index={3}>
          <Card>
            <Text variant="heading">Đang chờ bạn ấy chấp nhận</Text>
            {outgoing.map((r) => (
              <View key={r.id} style={styles.row}>
                <Avatar name={r.name} size={44} />
                <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{r.name}</Text>
                <Button small variant="ghost" title="Huỷ lời mời" disabled={!!busy} onPress={() => run(`d${r.id}`, async () => { await dropRequest(r.id); })} />
              </View>
            ))}
          </Card>
        </Reveal>
      ) : null}

      <Reveal index={4}>
        <Card>
          <Row style={{ justifyContent: "space-between" }}>
            <Text variant="heading">Bạn bè</Text>
            <Text variant="small" tone="muted">{friends.length}/{maxFriends}</Text>
          </Row>
          {friends.length ? friends.map((f) => (
            <FriendRow
              key={f.id}
              f={f}
              confirming={confirmId === f.user_id}
              busy={busy === `u${f.user_id}`}
              onAsk={() => setConfirmId(f.user_id)}
              onCancel={() => setConfirmId(null)}
              onConfirm={() => run(`u${f.user_id}`, async () => { await unfriend(f.user_id); setConfirmId(null); })}
            />
          )) : <Text tone="secondary">Chưa có ai. Gửi mã của bạn hoặc nhập mã của bạn bè ở trên.</Text>}
        </Card>
      </Reveal>
    </Screen>
  );
}

function FriendRow({ f, confirming, busy, onAsk, onCancel, onConfirm }: { f: Friend; confirming: boolean; busy: boolean; onAsk: () => void; onCancel: () => void; onConfirm: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <View style={styles.row}>
        <Avatar name={f.name} size={44} lit={f.today_done} />
        <View style={{ flex: 1 }}>
          <Text variant="label" numberOfLines={1}>{f.name}</Text>
          <Text variant="caption" tone="muted">{f.streak ? `Chuỗi ${f.streak} ngày` : "Chưa có chuỗi"}{f.today_done ? ", hôm nay đã học" : ""}</Text>
        </View>
        {!confirming ? <Button small variant="ghost" title="Bỏ kết bạn" onPress={onAsk} /> : null}
      </View>
      {confirming ? (
        <View style={[styles.confirm, { backgroundColor: c.surfaceSunken }]}>
          <Text variant="small" style={{ flex: 1 }}>Bỏ kết bạn với {f.name}? Hai bạn sẽ không thấy khoảnh khắc của nhau nữa.</Text>
          <Button small variant="danger" title="Bỏ kết bạn" onPress={onConfirm} loading={busy} />
          <Button small variant="ghost" title="Giữ lại" onPress={onCancel} disabled={busy} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 40, lineHeight: 48, letterSpacing: 6, fontFamily: "BricolageGrotesque_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" },
  confirm: { flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap", borderRadius: radius.md, padding: space[3] },
});
