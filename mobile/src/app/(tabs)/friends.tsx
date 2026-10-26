import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { Coal } from "@/components/Coal";
import { MomentCard } from "@/components/MomentCard";
import { PressScale, Reveal } from "@/components/motion";
import { Banner, Button, EmptyView, ErrorView, FeatureOff, LoadingView, Row, Screen, Text } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setBadge } from "@/lib/badges";
import { useConfig } from "@/lib/config";
import { fetchFeed, fetchFriends, react, setMyName, setShared, type FeedItem, type ReactionKind } from "@/lib/friends";
import { dismissPrompt, promptDismissed } from "@/lib/push";
import { usePush } from "@/lib/usePush";
import { radius, space, useTheme } from "@/lib/theme";
import { useLoad } from "@/lib/useLoad";

export default function FriendsTab() {
  const { on } = useConfig();
  if (!on("friends")) return <FeatureOff name="Kết bạn" />;
  return <FriendsHome />;
}

function FriendsHome() {
  const { c } = useTheme();
  const { name } = useAuth();
  const friends = useLoad(fetchFriends, [], { cacheKey: "friends" });
  const feed = useLoad(() => fetchFeed(), [], { cacheKey: "feed" });
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const push = usePush();
  const [hidePrompt, setHidePrompt] = useState(true); // true tới khi đọc xong lựa chọn "Để sau" đã lưu, tránh nháy thẻ
  useEffect(() => { promptDismissed().then((d) => setHidePrompt(d)); }, []);

  // Quay lại từ màn chụp ảnh hay màn quản lý bạn bè thì làm mới nhẹ
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    friends.silentReload();
    feed.silentReload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  // Lần đầu: đặt tên hiển thị = tên tài khoản để bạn bè nhận ra mình
  const named = useRef(false);
  useEffect(() => {
    const me = friends.data?.me;
    if (!me || named.current || me.display_name || !name) return;
    named.current = true;
    setMyName(name).then(() => friends.silentReload()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends.data?.me.display_name, name]);

  // Số lời mời đang chờ hiện trên icon tab
  useEffect(() => { if (friends.data) setBadge("friends", friends.data.incoming.length); }, [friends.data]);

  const updateItem = (id: string, fn: (m: FeedItem) => FeedItem | null) =>
    feed.setData((d) => (d ? { ...d, items: d.items.flatMap((m) => (m.id === id ? (fn(m) ? [fn(m) as FeedItem] : []) : [m])) } : d));

  const onReact = async (item: FeedItem, kind: ReactionKind | null) => {
    const before = item;
    setNotice(null);
    updateItem(item.id, (m) => {
      const r = { ...m.reactions };
      if (m.my_reaction) r[m.my_reaction] = Math.max(0, r[m.my_reaction] - 1);
      if (kind) r[kind] += 1;
      return { ...m, reactions: r, my_reaction: kind };
    });
    try {
      await react(item.id, kind);
    } catch (e) {
      updateItem(item.id, () => before);
      setNotice(errorMessage(e));
    }
  };

  const onUnshare = async (item: FeedItem) => {
    setNotice(null);
    try {
      await setShared(item.id, false);
      updateItem(item.id, () => null);
    } catch (e) {
      setNotice(errorMessage(e));
    }
  };

  const loadMore = async () => {
    const next = feed.data?.next;
    if (!next || more) return;
    setMore(true);
    try {
      const page = await fetchFeed(next);
      feed.setData((d) => (d ? { items: [...d.items, ...page.items.filter((p) => !d.items.some((x) => x.id === p.id))], next: page.next } : d));
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setMore(false);
    }
  };

  if ((friends.loading && !friends.data) || (feed.loading && !feed.data)) return <Screen scroll={false}><LoadingView text="Đang mở bảng tin" /></Screen>;
  if (!friends.data || !feed.data) {
    return <Screen scroll={false}><ErrorView message={friends.error || feed.error || "Không tải được bảng tin."} onRetry={() => { friends.reload(); feed.reload(); }} /></Screen>;
  }

  const { friends: list, incoming, me } = friends.data;
  const items = feed.data.items;
  const err = friends.error || feed.error;

  return (
    <Screen refreshing={friends.refreshing || feed.refreshing} onRefresh={() => { friends.refresh(); feed.refresh(); }}>
      <Reveal index={0}>
        <Row style={{ justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text variant="title">Bạn bè</Text>
            <Text tone="secondary">{list.length ? `${list.length} bạn học cùng bạn` : "Học cùng nhau vui hơn học một mình"}</Text>
          </View>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={incoming.length ? `Thêm bạn, ${incoming.length} lời mời đang chờ` : "Thêm bạn"}
            onPress={() => router.push("/manage-friends")}
            scaleTo={0.9}
            style={[styles.iconBtn, { backgroundColor: c.surfaceSunken }]}
          >
            <Ionicons name="person-add-outline" size={20} color={c.inkSecondary} />
            {incoming.length ? <View style={[styles.dot, { backgroundColor: c.accent, borderColor: c.canvas }]} /> : null}
          </PressScale>
        </Row>
      </Reveal>

      {err ? <Banner tone="warning" text={`${err} Đang hiện dữ liệu đã lưu.`} onRetry={() => { friends.refresh(); feed.refresh(); }} /> : null}
      {notice ? <Banner text={notice} /> : null}
      {incoming.length ? (
        <Banner tone="info" text={`${incoming.length} lời mời kết bạn đang chờ bạn.`} actionLabel="Xem" onRetry={() => router.push("/manage-friends")} />
      ) : null}

      {push.status === "ask" && !hidePrompt ? (
        <Reveal index={1}>
          <View style={[styles.promptCard, { backgroundColor: c.brandTint }]}>
            <Ionicons name="notifications" size={24} color={c.brand} />
            <View style={{ flex: 1, gap: space[3] }}>
              <Text variant="label">Bật thông báo để biết ngay khi có lời mời kết bạn hoặc ảnh mới của bạn bè.</Text>
              {push.error ? <Text variant="small" tone="danger">{push.error}</Text> : null}
              <Row gap={space[2]}>
                <Button small title="Bật thông báo" onPress={push.enable} loading={push.busy} />
                <Button small variant="ghost" title="Để sau" disabled={push.busy} onPress={() => { setHidePrompt(true); dismissPrompt(); }} />
              </Row>
            </View>
          </View>
        </Reveal>
      ) : null}

      <Reveal index={1}>
        <PressScale
          accessibilityRole="button"
          accessibilityLabel="Chụp khoảnh khắc học và gửi cho bạn bè"
          onPress={() => router.push("/share-moment")}
          style={[styles.cta, { backgroundColor: c.navy }]}
        >
          <Coal sprite="smile" size={64} still />
          <View style={{ flex: 1 }}>
            <Text variant="heading" style={{ color: c.onNavy }}>Hôm nay bạn học gì?</Text>
            <Text variant="small" style={{ color: c.onNavy, opacity: 0.75 }}>Chụp một tấm gửi bạn bè, giữ chuỗi ngày luôn.</Text>
          </View>
          <View style={[styles.shutter, { backgroundColor: c.accent }]}>
            <Ionicons name="camera" size={22} color={c.onAccent} />
          </View>
        </PressScale>
      </Reveal>

      {list.length ? (
        <Reveal index={2}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[4], paddingVertical: space[1] }}>
            {list.map((f) => (
              <View key={f.id} style={styles.story} accessible accessibilityLabel={`${f.name}, chuỗi ${f.streak} ngày${f.today_done ? ", hôm nay đã học" : ""}`}>
                <Avatar name={f.name} size={56} lit={f.today_done} />
                <Text variant="caption" numberOfLines={1} style={{ maxWidth: 64 }}>{f.name.split(" ").slice(-1)[0]}</Text>
                <Text variant="caption" tone={f.streak ? "accent" : "muted"}>{f.streak ? `${f.streak} ngày` : "chưa có"}</Text>
              </View>
            ))}
          </ScrollView>
        </Reveal>
      ) : null}

      {!list.length && !items.length ? (
        <EmptyView
          sprite="hello"
          title="Chưa có ai học cùng bạn"
          text={`Gửi mã ${me.code} cho một người bạn, hoặc nhập mã của họ để kết bạn.`}
          action={<Button title="Thêm bạn" onPress={() => router.push("/manage-friends")} style={{ marginTop: space[2] }} />}
        />
      ) : null}

      {list.length && !items.length ? (
        <EmptyView sprite="smile" title="Chưa có khoảnh khắc nào" text="Hãy là người chia sẻ đầu tiên. Bạn bè sẽ thấy ngay trong bảng tin." />
      ) : null}

      {items.map((m, i) => (
        <Reveal key={m.id} index={Math.min(i, 3)}>
          <MomentCard item={m} onReact={(k) => onReact(m, k)} onUnshare={m.is_me ? () => onUnshare(m) : undefined} />
        </Reveal>
      ))}

      {feed.data.next ? <Button title="Xem thêm" variant="secondary" onPress={loadMore} loading={more} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 6, right: 6, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  cta: { flexDirection: "row", alignItems: "center", gap: space[3], borderRadius: radius.xl, paddingVertical: space[4], paddingLeft: space[4], paddingRight: space[5] },
  shutter: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  story: { alignItems: "center", gap: 4, width: 64 },
  promptCard: { flexDirection: "row", alignItems: "flex-start", gap: space[3], borderRadius: radius.lg, padding: space[4] },
});
