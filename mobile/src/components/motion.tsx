import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo, Animated, Easing, Platform, Pressable,
  type PressableProps, type StyleProp, type ViewStyle,
} from "react-native";
import { motion, useTheme } from "@/lib/theme";

/** Chuyển động chạy trên luồng giao diện (native driver) nên không giật khi JS đang bận tải dữ liệu. */
export const nativeDriver = Platform.OS !== "web";

let reduced = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduced = v; }).catch(() => {});

/** Tôn trọng cài đặt "Giảm chuyển động" của máy. */
export function useReducedMotion(): boolean {
  const [v, setV] = useState(reduced);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((x) => { reduced = x; if (alive) setV(x); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (x) => { reduced = x; setV(x); });
    return () => { alive = false; sub.remove(); };
  }, []);
  return v;
}

/**
 * Vào màn: mờ dần và nhích lên 8px, xếp tầng theo `index` (60ms mỗi bậc). Chỉ chạy một lần khi khối xuất hiện,
 * kéo để làm mới không chạy lại.
 */
export function Reveal({ index = 0, children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const t = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) { t.setValue(1); return; }
    Animated.timing(t, {
      toValue: 1,
      duration: motion.base + 80,
      delay: Math.min(index, 6) * motion.stagger,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [motion.rise, 0] });
  return <Animated.View style={[style, { opacity: t, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Nút nhấn co nhẹ còn 0.97 rồi bật lại (lò xo), phản hồi ngay dưới ngón tay. Kiểu dáng (kể cả kích thước, flex) áp thẳng lên vùng chạm. */
export function PressScale({
  children, style, scaleTo = 0.97, ...rest
}: Omit<PressableProps, "style" | "children"> & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.spring(s, { toValue: v, speed: 40, bounciness: v === 1 ? 6 : 0, useNativeDriver: nativeDriver }).start();
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => { if (!rest.disabled) to(scaleTo); rest.onPressIn?.(e); }}
      onPressOut={(e) => { to(1); rest.onPressOut?.(e); }}
      style={[style, { transform: [{ scale: s }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Thanh tiến độ: co giãn theo trục ngang bằng transform (mượt, không tính lại bố cục). */
export function ProgressBar({ value, color, track, height = 8 }: { value: number; color: string; track: string; height?: number }) {
  const v = Math.max(0, Math.min(1, value || 0));
  const a = useRef(new Animated.Value(v)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: v, duration: motion.base + 160, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
  }, [a, v]);
  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{ height, borderRadius: height, backgroundColor: track, overflow: "hidden" }}
    >
      <Animated.View style={{ height: "100%", width: "100%", borderRadius: height, backgroundColor: color, transformOrigin: "left", transform: [{ scaleX: a }] }} />
    </Animated.View>
  );
}

/** Khối giữ chỗ khi chưa có dữ liệu, nhịp mờ chậm (thay cho vòng quay). */
export function Skeleton({ height, width = "100%", radius = 16, style }: { height: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const { c } = useTheme();
  const a = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: nativeDriver }),
      Animated.timing(a, { toValue: 0.55, duration: 700, useNativeDriver: nativeDriver }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [a, reduce]);
  return <Animated.View style={[{ height, width, borderRadius: radius, opacity: a, backgroundColor: c.hairline }, style]} />;
}
