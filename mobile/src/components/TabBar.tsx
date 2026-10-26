import Ionicons from "@expo/vector-icons/Ionicons";
import type { BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { nativeDriver, useReducedMotion } from "./motion";
import { Text } from "./ui";
import { useBadge } from "@/lib/badges";
import { fonts, radius, space, useTheme } from "@/lib/theme";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** Icon từng tab (nét khi chưa chọn, đặc khi đang chọn). Tên tab đọc cho trình đọc màn hình lấy từ `title`. */
export const TAB_ICONS: Record<string, [IconName, IconName]> = {
  index: ["sunny-outline", "sunny"],
  flashcards: ["albums-outline", "albums"],
  schedule: ["calendar-clear-outline", "calendar-clear"],
  friends: ["people-outline", "people"],
  writing: ["create-outline", "create"],
  tutor: ["chatbubble-ellipses-outline", "chatbubble-ellipses"],
};

const BAR_H = 64;
const PAD = 6;

/**
 * Thanh điều hướng nổi, bo tròn, chỉ có icon. Nền của tab đang chọn trượt sang tab mới
 * (giống thanh bên của web) bằng lò xo chạy trên luồng giao diện.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { c, scheme } = useTheme();
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  const routes = state.routes;
  const itemW = width ? (width - PAD * 2) / routes.length : 0;
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!itemW) return;
    const to = state.index * itemW;
    if (reduce) x.setValue(to);
    else Animated.spring(x, { toValue: to, speed: 18, bounciness: 5, useNativeDriver: nativeDriver }).start();
  }, [state.index, itemW, reduce, x]);

  return (
    <View style={[styles.wrap, { backgroundColor: c.canvas, paddingBottom: Math.max(insets.bottom, space[3]) }]}>
      <View
        role="tablist"
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (!width) x.setValue(state.index * ((w - PAD * 2) / routes.length));
          setWidth(w);
        }}
        style={[
          styles.bar,
          {
            backgroundColor: scheme === "dark" ? c.surfaceRaised : c.surface,
            borderColor: c.hairline,
            shadowColor: c.navy,
          },
        ]}
      >
        {itemW ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, { width: itemW, backgroundColor: c.brandTint, transform: [{ translateX: x }] }]}
          />
        ) : null}
        {routes.map((route, i) => {
          const focused = i === state.index;
          const { options } = descriptors[route.key];
          const icons = TAB_ICONS[route.name] ?? ["ellipse-outline", "ellipse"];
          const title = typeof options.title === "string" ? options.title : route.name;
          const onPress = () => {
            const ev = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !ev.defaultPrevented) navigateToTab(route.key);
          };
          return (
            <TabButton
              key={route.key}
              tab={route.name}
              title={title}
              focused={focused}
              icon={focused ? icons[1] : icons[0]}
              color={focused ? c.brand : c.inkMuted}
              onPress={onPress}
              onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabButton({
  tab, title, focused, icon, color, onPress, onLongPress,
}: { tab: string; title: string; focused: boolean; icon: IconName; color: string; onPress: () => void; onLongPress: () => void }) {
  const { c } = useTheme();
  const badge = useBadge(tab);
  const s = useRef(new Animated.Value(1)).current;
  const press = (v: number) => Animated.spring(s, { toValue: v, speed: 40, bounciness: v === 1 ? 8 : 0, useNativeDriver: nativeDriver }).start();

  return (
    <Pressable
      role="tab"
      accessibilityRole="tab"
      accessibilityLabel={badge ? `${title}, ${badge} mục mới` : title}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => press(0.88)}
      onPressOut={() => press(1)}
      hitSlop={4}
      style={styles.item}
    >
      <Animated.View style={{ transform: [{ scale: s }] }}>
        <Ionicons name={icon} size={24} color={color} />
        {badge ? (
          <View style={[styles.badge, { backgroundColor: c.accent, borderColor: c.surface }]}>
            <Text style={[styles.badgeText, { color: c.onAccent }]}>{badge > 9 ? "9+" : badge}</Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space[5], paddingTop: space[2] },
  bar: {
    height: BAR_H, borderRadius: radius.full, borderWidth: 1, flexDirection: "row", alignItems: "center", padding: PAD,
    width: "100%", maxWidth: 480, alignSelf: "center",
    shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  pill: { position: "absolute", left: PAD, top: PAD, bottom: PAD, borderRadius: radius.full },
  item: { flex: 1, height: "100%", alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute", top: -6, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: "center", justifyContent: "center", borderWidth: 2,
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 12 },
});
