/**
 * Coal — luật chọn tư thế và lời nhắn theo streak, chép từ web:
 * frontend/src/components/mascot/Mascot.tsx (spriteFor, fireLevel, wetLevel) và frontend/src/lib/mascot.ts (pickMood).
 * Sửa luật ở web thì sửa cả ở đây.
 */
import type { Streak } from "./studia";

export type Mood = "hello" | "happy" | "cheer" | "fire" | "love" | "focus" | "worried" | "sleepy" | "sad" | "lost";
export type Level = 0 | 1 | 2 | 3 | 4;
export type Sprite =
  | "hello" | "happy" | "cheer" | "love" | "focus" | "surprised" | "sleepy" | "sad" | "lost" | "fireM" | "smile" | "excited"
  | "fire0" | "fire1" | "fire2" | "fire3" | "fire4" | "wet0" | "wet1" | "wet2" | "wet3" | "wet4" | "happy-alt" | "love-alt" | "cheer-alt";

export const MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];

const BASE: Record<Mood, Sprite> = {
  hello: "hello", happy: "happy", cheer: "cheer", fire: "fireM", love: "love",
  focus: "focus", worried: "surprised", sleepy: "sleepy", sad: "sad", lost: "lost",
};
const FIRE: Record<1 | 2 | 3 | 4, Sprite> = { 1: "fire0", 2: "fire2", 3: "fire3", 4: "fire4" };

/** Thứ tự ưu tiên: ướt (lửa đã tắt) > cháy > cảm xúc. */
export function spriteFor(mood: Mood, wet: Level = 0, fire: Level = 0): Sprite {
  if (wet > 0) return wet === 1 ? (mood === "sleepy" ? "wet1" : "wet0") : (`wet${wet}` as Sprite);
  if (fire > 0) return mood === "cheer" ? "fire1" : FIRE[fire as 1 | 2 | 3 | 4];
  return BASE[mood];
}

export function fireLevel(streak: number): Level {
  return streak >= 30 ? 4 : streak >= 14 ? 3 : streak >= 7 ? 2 : streak >= 3 ? 1 : 0;
}

export function wetLevel(daysSince: number | null | undefined, hadActivity = true): Level {
  if (daysSince == null) return hadActivity ? 4 : 0;
  return daysSince >= 14 ? 4 : daysSince >= 7 ? 3 : daysSince >= 3 ? 2 : daysSince >= 1 ? 1 : 0;
}

export function missedDays(s: Streak): number {
  const past = s.week.slice(0, -1);
  let n = 0;
  for (let i = past.length - 1; i >= 0 && !past[i].active; i--) n++;
  return past.length && n === past.length ? 7 : n;
}

export type Pick = { mood: Mood; line: string; wet: Level; fire: Level };

export function pickMood(s: Streak | null, hour = new Date().getHours()): Pick {
  if (!s) return { mood: "hello", wet: 0, fire: 0, line: "Chào bạn! Mình là Coal, cục than nhỏ muốn thành kim cương. Mình sẽ học cùng bạn mỗi ngày." };
  if (s.total_days === 0) return { mood: "hello", wet: 0, fire: 0, line: "Chào bạn mới! Hoàn thành một bài đầu tiên để mình bắt đầu đếm streak nhé." };

  const fire = fireLevel(s.current);

  if (s.today_done) {
    if (MILESTONES.includes(s.current)) {
      return { mood: "cheer", wet: 0, fire: Math.max(fire, 2) as Level, line: `${s.current} ngày liên tiếp! Mình nóng cả người rồi, bạn quá đỉnh, ăn mừng nào!` };
    }
    if (fire === 4) return { mood: "fire", wet: 0, fire, line: `Chuỗi ${s.current} ngày, mình cháy cả người luôn rồi! Cục than nào chịu nóng giỏi thế này sẽ thành kim cương đó.` };
    if (fire === 3) return { mood: "fire", wet: 0, fire, line: `Chuỗi ${s.current} ngày, lửa lan khắp người mình rồi. Bạn giữ lửa giỏi quá!` };
    if (fire === 2) return { mood: "fire", wet: 0, fire, line: `Chuỗi ${s.current} ngày đang cháy rực. Đừng để lửa tắt nha!` };
    if (fire === 1) return { mood: "happy", wet: 0, fire, line: `Hôm nay xong rồi, chuỗi ${s.current} ngày. Đầu mình bắt đầu bốc lửa rồi nè!` };
    return { mood: "happy", wet: 0, fire, line: s.current > 1 ? `Hôm nay xong rồi, chuỗi ${s.current} ngày. Mình tự hào về bạn!` : "Bước đầu tiên hoàn thành. Mai mình học tiếp nhé!" };
  }

  if (s.at_risk) {
    return hour >= 20
      ? { mood: "worried", wet: 0, fire, line: `Sắp hết ngày rồi mà chuỗi ${s.current} ngày chưa được giữ. Học 5 phút thôi cũng được, mình ngồi cạnh bạn!` }
      : { mood: "focus", wet: 0, fire, line: `Chuỗi ${s.current} ngày đang chờ bạn. Làm một nhiệm vụ nhỏ để giữ lửa nhé!` };
  }

  const gap = s.days_since_active === undefined ? missedDays(s) : s.days_since_active;
  const wet = wetLevel(gap);
  if (wet >= 4) return { mood: "lost", wet, fire: 0, line: "Mình ngập nước, ướt sũng từ đầu đến chân rồi... nhưng mình vẫn ở đây chờ bạn. Quay lại học 5 phút thôi, mình sẽ khô dần." };
  if (wet === 3) return { mood: "lost", wet, fire: 0, line: "Lâu quá không gặp, mình ướt sũng và đứng trong vũng nước rồi. Quay lại học một chút nhé, không sao đâu." };
  if (wet === 2) return { mood: "sad", wet, fire: 0, line: `Bạn vắng ${gap} ngày rồi, mình ướt cả người và lửa tắt mất. Bắt đầu lại nhẹ nhàng nhé?` };
  return { mood: "sleepy", wet: (wet || 1) as Level, fire: 0, line: "Chuỗi bị đứt rồi, mình ngủ gật, người ươn ướt. Học hôm nay để mình khô và bắt đầu chuỗi mới nhé!" };
}
