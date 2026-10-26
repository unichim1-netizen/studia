import { useState, type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text as RNText, TextInput,
  View, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewProps, type ViewStyle,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { Coal } from "./Coal";
import { PressScale, Skeleton } from "./motion";
import type { Sprite } from "@/lib/mascot";
import { fonts, radius, space, useTheme } from "@/lib/theme";

// ---------------------------------------------------------------- chữ
type Variant = "display" | "title" | "heading" | "body" | "small" | "label" | "caption";
const VARIANT: Record<Variant, TextStyle> = {
  display: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 24 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.2 },
};

export function Text({ variant = "body", tone, style, ...rest }: TextProps & { variant?: Variant; tone?: "secondary" | "muted" | "brand" | "danger" | "success" | "accent" | "onBrand" }) {
  const { c } = useTheme();
  const color =
    tone === "secondary" ? c.inkSecondary : tone === "muted" ? c.inkMuted : tone === "brand" ? c.brand
    : tone === "danger" ? c.danger : tone === "success" ? c.success : tone === "accent" ? c.accentStrong
    : tone === "onBrand" ? c.onBrand : c.ink;
  return <RNText {...rest} style={[VARIANT[variant], { color }, style]} />;
}

// ---------------------------------------------------------------- khung màn hình
export function Screen({
  children, scroll = true, refreshing, onRefresh, edges = ["top"], contentStyle,
}: {
  children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; edges?: Edge[]; contentStyle?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.canvas }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.brand} colors={[c.brand]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style, tone }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: "brand" | "accent" | "navy" | "sunken" }) {
  const { c } = useTheme();
  const bg = tone === "brand" ? c.brandTint : tone === "accent" ? c.accentTint : tone === "navy" ? c.navy : tone === "sunken" ? c.surfaceSunken : c.surface;
  return <View style={[styles.card, { backgroundColor: bg, borderColor: tone ? "transparent" : c.hairline }, style]}>{children}</View>;
}

// ---------------------------------------------------------------- nút
export function Button({
  title, onPress, variant = "primary", loading, disabled, small, style, icon,
}: {
  title: string; onPress?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  loading?: boolean; disabled?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; icon?: ReactNode;
}) {
  const { c } = useTheme();
  const bg = variant === "primary" ? c.brand : variant === "accent" ? c.accent : variant === "danger" ? c.dangerTint : variant === "secondary" ? c.surfaceSunken : "transparent";
  const fg = variant === "primary" ? c.onBrand : variant === "accent" ? c.onAccent : variant === "danger" ? c.danger : variant === "secondary" ? c.ink : c.brand;
  const off = disabled || loading;
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={!!off}
      onPress={onPress}
      style={[
        styles.btn,
        { backgroundColor: bg, minHeight: small ? 38 : 52, paddingHorizontal: small ? space[4] : space[6], opacity: off ? 0.5 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon}
      <Text variant="label" style={{ color: fg, fontSize: small ? 13 : 15 }}>{title}</Text>
    </PressScale>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  const { c } = useTheme();
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? c.brand : c.surfaceSunken }]}
    >
      <Text variant="caption" style={{ color: active ? c.onBrand : c.inkSecondary, fontSize: 13 }}>{label}</Text>
    </PressScale>
  );
}

// ---------------------------------------------------------------- ô nhập
export function Field({ label, hint, error, style, ...rest }: TextInputProps & { label?: string; hint?: string; error?: string | null }) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.inkMuted}
        {...rest}
        onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
        style={[
          styles.input,
          { color: c.ink, backgroundColor: c.surface, borderColor: error ? c.danger : focus ? c.brand : c.borderControl },
          rest.multiline && { minHeight: 120, textAlignVertical: "top", paddingTop: 12 },
          style,
        ]}
      />
      {error ? <Text variant="small" tone="danger">{error}</Text> : hint ? <Text variant="small" tone="muted">{hint}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- trạng thái
export function Banner({ text, tone = "danger", onRetry, actionLabel = "Thử lại" }: { text: string; tone?: "danger" | "warning" | "info" | "success"; onRetry?: () => void; actionLabel?: string }) {
  const { c } = useTheme();
  const bg = tone === "danger" ? c.dangerTint : tone === "warning" ? c.warningTint : tone === "success" ? c.successTint : c.brandTint;
  const fg = tone === "danger" ? c.danger : tone === "warning" ? c.warning : tone === "success" ? c.success : c.brand;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: bg }]}>
      <Text variant="small" style={{ color: fg, flex: 1 }}>{text}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
          <Text variant="label" style={{ color: fg, textDecorationLine: "underline" }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Khung giữ chỗ trong lúc tải lần đầu (lần sau đã có dữ liệu lưu sẵn nên hiện ngay). */
export function LoadingView({ text = "Đang tải" }: { text?: string }) {
  return (
    <View style={styles.skeleton} accessibilityLabel={text} accessibilityLiveRegion="polite">
      <Skeleton height={28} width="55%" radius={10} />
      <Skeleton height={168} radius={radius.xl} />
      <Skeleton height={64} radius={radius.lg} />
      <Skeleton height={64} radius={radius.lg} />
      <Skeleton height={64} radius={radius.lg} />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Coal sprite="wet2" size={110} still />
      <Text variant="heading" style={{ textAlign: "center" }}>Có trục trặc rồi</Text>
      <Text tone="secondary" style={{ textAlign: "center", maxWidth: 320 }}>{message}</Text>
      {onRetry ? <Button title="Thử lại" onPress={onRetry} style={{ marginTop: space[2] }} /> : null}
    </View>
  );
}

export function EmptyView({ title, text, sprite = "smile", action }: { title: string; text?: string; sprite?: Sprite; action?: ReactNode }) {
  return (
    <View style={[styles.center, { paddingVertical: space[8] }]}>
      <Coal sprite={sprite} size={100} still />
      <Text variant="heading" style={{ textAlign: "center" }}>{title}</Text>
      {text ? <Text tone="secondary" style={{ textAlign: "center", maxWidth: 320 }}>{text}</Text> : null}
      {action}
    </View>
  );
}

export function FeatureOff({ name }: { name: string }) {
  return (
    <Screen>
      <EmptyView sprite="sleepy" title={`${name} đang tạm tắt`} text="Quản lý Studia đang tạm tắt tính năng này. Bạn quay lại sau nhé." />
    </Screen>
  );
}

export function Row({ children, gap = space[2], style, ...rest }: ViewProps & { gap?: number }) {
  return <View {...rest} style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  content: { padding: space[4], paddingBottom: space[10], gap: space[4], width: "100%", maxWidth: 720, alignSelf: "center" },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space[5], gap: space[3] },
  btn: { borderRadius: radius.full, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2] },
  chip: { borderRadius: radius.full, paddingHorizontal: space[4], paddingVertical: 9 },
  input: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space[4], minHeight: 52, fontSize: 15, fontFamily: fonts.regular },
  banner: { borderRadius: radius.md, paddingVertical: space[3], paddingHorizontal: space[4], flexDirection: "row", alignItems: "center", gap: space[3] },
  skeleton: { padding: space[4], gap: space[4], width: "100%", maxWidth: 720, alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3], padding: space[6], minHeight: 320 },
});
