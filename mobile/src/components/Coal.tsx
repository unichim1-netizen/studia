import { Image, type ImageSource } from "expo-image";
import { useEffect, useRef } from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";
import { nativeDriver, useReducedMotion } from "./motion";
import { spriteFor, type Level, type Mood, type Sprite } from "@/lib/mascot";

/** Ảnh tư thế của Coal, chép từ frontend/public/coal (Metro cần require tĩnh từng tệp). */
const SPRITES: Record<Sprite, ImageSource | number> = {
  hello: require("../../assets/coal/hello.webp"),
  happy: require("../../assets/coal/happy.webp"),
  cheer: require("../../assets/coal/cheer.webp"),
  love: require("../../assets/coal/love.webp"),
  focus: require("../../assets/coal/focus.webp"),
  surprised: require("../../assets/coal/surprised.webp"),
  sleepy: require("../../assets/coal/sleepy.webp"),
  sad: require("../../assets/coal/sad.webp"),
  lost: require("../../assets/coal/lost.webp"),
  fireM: require("../../assets/coal/fireM.webp"),
  smile: require("../../assets/coal/smile.webp"),
  excited: require("../../assets/coal/excited.webp"),
  fire0: require("../../assets/coal/fire0.webp"),
  fire1: require("../../assets/coal/fire1.webp"),
  fire2: require("../../assets/coal/fire2.webp"),
  fire3: require("../../assets/coal/fire3.webp"),
  fire4: require("../../assets/coal/fire4.webp"),
  wet0: require("../../assets/coal/wet0.webp"),
  wet1: require("../../assets/coal/wet1.webp"),
  wet2: require("../../assets/coal/wet2.webp"),
  wet3: require("../../assets/coal/wet3.webp"),
  wet4: require("../../assets/coal/wet4.webp"),
  "happy-alt": require("../../assets/coal/happy-alt.webp"),
  "love-alt": require("../../assets/coal/love-alt.webp"),
  "cheer-alt": require("../../assets/coal/cheer-alt.webp"),
};

/** Khung chung của mọi tư thế (đáy thẳng hàng). */
const W = 221, H = 216;

type Props = {
  mood?: Mood;
  wet?: Level;
  fire?: Level;
  sprite?: Sprite;
  size?: number;
  /** Nhún nhẹ liên tục: chỉ khi Coal đang "nói" hoặc đang nghĩ, còn lại đứng yên (chuyển động tiết chế). */
  talking?: boolean;
  /** Giữ để tương thích, Coal mặc định đã đứng yên. */
  still?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
};

export function Coal({ mood = "hello", wet = 0, fire = 0, sprite, size = 120, talking = false, label, style }: Props) {
  const name = sprite ?? spriteFor(mood, wet, wet > 0 ? 0 : fire);
  const reduce = useReducedMotion();
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!talking || reduce) { bob.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 280, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
        Animated.timing(bob, { toValue: 0, duration: 280, easing: Easing.inOut(Easing.quad), useNativeDriver: nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, talking, reduce]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label ?? "Coal, người bạn học của Studia"}
      style={[{ width: size, height: Math.round((size * H) / W), transform: [{ translateY }] }, style]}
    >
      {/* expo-image giải mã ảnh ngoài luồng chính và đổi tư thế bằng hiệu ứng mờ chéo */}
      <Image source={SPRITES[name]} style={{ width: "100%", height: "100%" }} contentFit="contain" transition={180} priority="high" />
    </Animated.View>
  );
}
