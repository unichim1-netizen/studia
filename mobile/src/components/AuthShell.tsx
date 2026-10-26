import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Coal } from "./Coal";
import { Card, Screen, Text } from "./ui";
import type { Sprite } from "@/lib/mascot";

/** Khung chung cho đăng nhập / đăng ký / quên mật khẩu. */
export function AuthShell({ title, subtitle, sprite = "hello", children }: { title: string; subtitle?: string; sprite?: Sprite; children: ReactNode }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen edges={["top", "bottom"]} contentStyle={{ maxWidth: 460, paddingTop: 32 }}>
        <View style={{ alignItems: "center", gap: 8 }}>
          <Coal sprite={sprite} size={112} />
          <Text variant="caption" tone="accent" style={{ textTransform: "uppercase", letterSpacing: 1.5 }}>Studia</Text>
          <Text variant="title" style={{ textAlign: "center" }}>{title}</Text>
          {subtitle ? <Text tone="secondary" style={{ textAlign: "center" }}>{subtitle}</Text> : null}
        </View>
        <Card style={{ gap: 16 }}>{children}</Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
