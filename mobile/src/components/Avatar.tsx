import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";
import { Text } from "./ui";
import { hueIndex, initials } from "@/lib/friends";
import { fonts, useTheme } from "@/lib/theme";

/** Ảnh đại diện bằng chữ cái đầu, màu cố định theo tên. `lit` = hôm nay đã học: viền cam kèm ngọn lửa nhỏ. */
export function Avatar({ name, size = 44, lit = false }: { name: string; size?: number; lit?: boolean }) {
  const { c } = useTheme();
  const tints = [
    [c.brandTint, c.brand],
    [c.accentTint, c.accentStrong],
    [c.successTint, c.success],
    [c.warningTint, c.warning],
    [c.surfaceSunken, c.plum],
  ];
  const [bg, fg] = tints[hueIndex(name, tints.length)];
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${name}${lit ? ", hôm nay đã học" : ""}`}>
      <View
        style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center",
          borderWidth: lit ? 3 : 0, borderColor: c.accent,
        }}
      >
        <Text style={{ color: fg, fontFamily: fonts.bold, fontSize: size * 0.36, lineHeight: size * 0.5 }}>{initials(name)}</Text>
      </View>
      {lit ? (
        <View
          style={{
            position: "absolute", right: -2, bottom: -2, width: size * 0.38, height: size * 0.38, borderRadius: size * 0.19,
            backgroundColor: c.accent, borderWidth: 2, borderColor: c.canvas, alignItems: "center", justifyContent: "center",
          }}
        >
          <Ionicons name="flame" size={size * 0.22} color={c.onAccent} />
        </View>
      ) : null}
    </View>
  );
}
