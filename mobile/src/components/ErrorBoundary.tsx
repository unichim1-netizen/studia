import { Component, type ErrorInfo, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";

/**
 * Lưới an toàn toàn app: một màn hình ném lỗi khi render thì hiện thông báo và nút "Thử lại" thay vì trắng màn hình.
 * Không dùng theme/context (có thể chính chúng hỏng), chỉ màu cố định.
 */
type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Studia] Lỗi giao diện:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <CrashView error={this.state.error} retry={() => this.setState({ error: null })} />;
  }
}

export function CrashView({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: "#f8f6f2" }}>
      <Image source={require("../../assets/coal/wet2.webp")} style={{ width: 120, height: 117 }} resizeMode="contain" />
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#0e1630", textAlign: "center" }}>Ứng dụng gặp lỗi</Text>
      <Text style={{ fontSize: 15, color: "#3a4260", textAlign: "center", maxWidth: 340 }}>
        Coal bị ướt mất rồi. Bấm “Thử lại” để mở lại màn hình. Nếu lỗi lặp lại, hãy đóng hẳn app rồi mở lại.
      </Text>
      {__DEV__ ? <Text style={{ fontSize: 12, color: "#c0281c", textAlign: "center" }}>{String(error?.message || error)}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{ backgroundColor: "#2344c9", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14, marginTop: 8 }}
      >
        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>Thử lại</Text>
      </Pressable>
    </View>
  );
}
