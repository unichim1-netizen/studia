import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

/** Token màu lấy từ frontend/src/app/globals.css (:root và [data-theme='dark']). */
const light = {
  canvas: "#f8f6f2", surface: "#ffffff", surfaceRaised: "#ffffff", surfaceSunken: "#f1eee8",
  hairline: "#e5e0d8", borderControl: "#80869e",
  ink: "#0e1630", inkSecondary: "#3a4260", inkMuted: "#5e6480",
  brand: "#2344c9", brandHover: "#1a3399", brandTint: "#e9eefd", onBrand: "#ffffff",
  navy: "#0f1f4d", onNavy: "#f8f6f2",
  accent: "#f2611f", accentStrong: "#c2410c", accentTint: "#ffede3", onAccent: "#0e1630",
  success: "#0d7a5f", successTint: "#e1f4ec", danger: "#c0281c", dangerTint: "#fde8e6",
  warning: "#a15c00", warningTint: "#fff3d6", plum: "#9b2c6f", scrim: "rgba(14, 22, 48, 0.48)",
};
export type Colors = typeof light;

const dark: Colors = {
  canvas: "#0b1022", surface: "#131a33", surfaceRaised: "#1a2242", surfaceSunken: "#090d1c",
  hairline: "#273055", borderControl: "#636e96",
  ink: "#edf0f8", inkSecondary: "#c2c8dc", inkMuted: "#949bb8",
  brand: "#7d9bff", brandHover: "#a3b8ff", brandTint: "#1c2752", onBrand: "#0b1022",
  navy: "#1b2a5e", onNavy: "#f8f6f2",
  accent: "#ff8a4f", accentStrong: "#ff9f6e", accentTint: "#3a2117", onAccent: "#0b1022",
  success: "#4ccfa6", successTint: "#0f2e27", danger: "#ff8577", dangerTint: "#3a1714",
  warning: "#f2b451", warningTint: "#33270f", plum: "#f08cc0", scrim: "rgba(3, 6, 16, 0.64)",
};

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;
/** Bo góc theo cấp: điều khiển hình viên thuốc, khối lớn tròn nhiều, hàng bên trong tròn ít hơn. */
export const radius = { xs: 8, sm: 12, md: 16, lg: 24, xl: 28, full: 999 } as const;

/** Thời lượng chuyển động (DESIGN.md: chỉ transform/opacity, vào màn fade-up 8px xếp tầng 60ms). */
export const motion = { fast: 160, base: 240, stagger: 60, rise: 8 } as const;

/** Tên font sau khi nạp bằng expo-font (xem app/_layout.tsx). Chưa nạp xong thì RN tự dùng font hệ thống. */
export const fonts = {
  regular: "BeVietnamPro_400Regular",
  medium: "BeVietnamPro_600SemiBold", // bớt 1 tệp font để mở app nhanh hơn
  semibold: "BeVietnamPro_600SemiBold",
  bold: "BeVietnamPro_700Bold",
  display: "BricolageGrotesque_700Bold",
  displayBold: "BricolageGrotesque_700Bold",
};

export type ThemeMode = "system" | "light" | "dark";
type Ctx = { mode: ThemeMode; setMode: (m: ThemeMode) => void; scheme: "light" | "dark"; c: Colors };

const ThemeCtx = createContext<Ctx>({ mode: "system", setMode: () => {}, scheme: "light", c: light });
const KEY = "studia-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => { if (v === "light" || v === "dark" || v === "system") setModeState(v); })
      .catch(() => {});
  }, []);

  const value = useMemo<Ctx>(() => {
    const scheme = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
    return {
      mode,
      scheme,
      c: scheme === "dark" ? dark : light,
      setMode: (m) => {
        setModeState(m);
        AsyncStorage.setItem(KEY, m).catch(() => {});
      },
    };
  }, [mode, system]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/** Trộn hai màu hex (t = 0 → a, t = 1 → b), dùng cho ô lịch đậm dần theo số phút học. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Màu theo band IELTS. */
export const bandColor = (c: Colors, band: number) =>
  band >= 7 ? c.success : band >= 6 ? c.brand : band >= 5 ? c.warning : c.danger;
