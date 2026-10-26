import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import { Avatar } from "./Avatar";
import { PressScale } from "./motion";
import { Row, Text } from "./ui";
import { REACTIONS, timeAgo, type FeedItem, type ReactionKind } from "@/lib/friends";
import { radius, space, useTheme } from "@/lib/theme";

/**
 * Một khoảnh khắc trong bảng tin: ảnh vuông bo tròn, lời nhắn nằm trên ảnh, chuỗi ngày của người chụp,
 * bên dưới là ba biểu cảm (cháy / thích / giỏi lắm). Chạm biểu cảm đang chọn để bỏ.
 */
export function MomentCard({
  item, onReact, onUnshare,
}: { item: FeedItem; onReact: (kind: ReactionKind | null) => void; onUnshare?: () => void }) {
  const { c } = useTheme();
  const when = timeAgo(item.created_at);

  return (
    <View style={styles.card}>
      <Row gap={space[3]}>
        <Avatar name={item.name} size={40} />
        <View style={{ flex: 1 }}>
          <Text variant="label" numberOfLines={1}>{item.is_me ? "Bạn" : item.name}</Text>
          <Text variant="caption" tone="muted">{when}{item.meta.minutes ? `, đã học ${item.meta.minutes} phút` : ""}</Text>
        </View>
        {item.is_me && onUnshare ? (
          <PressScale accessibilityRole="button" accessibilityLabel="Ngừng chia sẻ khoảnh khắc này" onPress={onUnshare} hitSlop={8} style={styles.more}>
            <Ionicons name="eye-off-outline" size={18} color={c.inkMuted} />
          </PressScale>
        ) : null}
      </Row>

      <View style={[styles.photo, { backgroundColor: c.surfaceSunken }]}>
        {item.url ? (
          <Image
            source={{ uri: item.url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={220}
            recyclingKey={item.id}
            accessibilityLabel={item.caption ? `Ảnh của ${item.name}: ${item.caption}` : `Ảnh học của ${item.name}`}
          />
        ) : (
          <View style={styles.gone}>
            <Ionicons name="image-outline" size={32} color={c.inkMuted} />
            <Text variant="small" tone="muted">Ảnh không còn hiển thị</Text>
          </View>
        )}
        {item.meta.streak >= 2 ? (
          <View style={[styles.chip, { backgroundColor: "rgba(15,31,77,0.72)" }]}>
            <Ionicons name="flame" size={14} color={c.accent} />
            <Text variant="caption" style={{ color: "#f8f6f2" }}>{item.meta.streak} ngày</Text>
          </View>
        ) : null}
        {item.caption ? (
          <View style={[styles.caption, { backgroundColor: "rgba(15,31,77,0.72)" }]}>
            <Text variant="label" style={{ color: "#f8f6f2" }} numberOfLines={3}>{item.caption}</Text>
          </View>
        ) : null}
      </View>

      <Row gap={space[2]}>
        {REACTIONS.map((r) => {
          const on = item.my_reaction === r.kind;
          const n = item.reactions[r.kind];
          return (
            <PressScale
              key={r.kind}
              accessibilityRole="button"
              accessibilityLabel={`${r.label}${n ? `, ${n} người` : ""}${on ? ", bạn đã chọn" : ""}`}
              accessibilityState={{ selected: on }}
              onPress={() => onReact(on ? null : r.kind)}
              scaleTo={0.9}
              style={[styles.react, { backgroundColor: on ? c.accentTint : c.surfaceSunken }]}
            >
              <Ionicons name={on ? r.icon : (`${r.icon}-outline` as "flame-outline")} size={18} color={on ? c.accentStrong : c.inkSecondary} />
              {n ? <Text variant="label" style={{ color: on ? c.accentStrong : c.inkSecondary }}>{n}</Text> : null}
            </PressScale>
          );
        })}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  more: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  photo: { width: "100%", aspectRatio: 1, borderRadius: radius.xl, overflow: "hidden" },
  gone: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[2] },
  chip: { position: "absolute", top: space[3], left: space[3], flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: 6 },
  caption: { position: "absolute", left: space[3], right: space[3], bottom: space[3], borderRadius: radius.lg, paddingHorizontal: space[4], paddingVertical: space[3] },
  react: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.full, paddingHorizontal: space[4], height: 38 },
});
