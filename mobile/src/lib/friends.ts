/**
 * Bạn bè và khoảnh khắc chia sẻ (backend/app/api/v1/friends.py). Mọi hàm normalize* nhận `unknown`
 * và luôn trả đối tượng đầy đủ trường để màn hình không crash khi API thiếu dữ liệu.
 */
import { Platform } from "react-native";
import { api } from "./api";
import { setBadge } from "./badges";
import { writeCache } from "./cache";
import { arr, bool, num, obj, str } from "./safe";

export type ReactionKind = "flame" | "heart" | "clap";
export const REACTIONS: { kind: ReactionKind; icon: "flame" | "heart" | "thumbs-up"; label: string }[] = [
  { kind: "flame", icon: "flame", label: "Cháy quá" },
  { kind: "heart", icon: "heart", label: "Thích" },
  { kind: "clap", icon: "thumbs-up", label: "Giỏi lắm" },
];
const isKind = (v: unknown): v is ReactionKind => v === "flame" || v === "heart" || v === "clap";

// ---------------------------------------------------------------- bạn bè và lời mời
export type Friend = { id: string; user_id: string; name: string; code: string; since: string; streak: number; today_done: boolean; minutes_today: number };
export type Request = { id: string; user_id: string; name: string; code: string; created_at: string };
export type Me = { user_id: string; code: string; display_name: string };
export type FriendsData = { me: Me; friends: Friend[]; incoming: Request[]; outgoing: Request[]; maxFriends: number };

const person = (x: unknown) => {
  const o = obj(x);
  return { id: str(o.id), user_id: str(o.user_id), name: str(o.name, "Bạn học"), code: str(o.code) };
};

export function normalizeFriends(raw: unknown): FriendsData {
  const o = obj(raw);
  const me = obj(o.me);
  const reqs = (v: unknown): Request[] => arr(v).map((r) => ({ ...person(r), created_at: str(obj(r).created_at) })).filter((r) => r.id);
  return {
    me: { user_id: str(me.user_id), code: str(me.code), display_name: str(me.display_name) },
    friends: arr(o.friends).map((f) => {
      const x = obj(f);
      return { ...person(f), since: str(x.since), streak: num(x.streak), today_done: bool(x.today_done), minutes_today: num(x.minutes_today) };
    }).filter((f) => f.id),
    incoming: reqs(o.incoming),
    outgoing: reqs(o.outgoing),
    maxFriends: num(obj(o.limits).max_friends, 50),
  };
}

export const fetchFriends = async () => normalizeFriends(await api("/friends"));

/** Tải lại danh sách bạn, cập nhật số lời mời trên icon tab và bộ đệm. Im lặng khi lỗi. */
export function refreshFriendBadge() {
  fetchFriends()
    .then((d) => { setBadge("friends", d.incoming.length); writeCache("friends", d); })
    .catch(() => {});
}
export const setMyName = (display_name: string) => api("/friends/me", { method: "PUT", body: { display_name } });
export async function sendRequest(code: string): Promise<{ status: "pending" | "accepted"; name: string }> {
  const o = obj(await api("/friends/requests", { method: "POST", body: { code } }));
  return { status: o.status === "accepted" ? "accepted" : "pending", name: str(o.name, "bạn này") };
}
export const acceptRequest = (id: string) => api(`/friends/requests/${id}/accept`, { method: "POST" });
export const dropRequest = (id: string) => api(`/friends/requests/${id}`, { method: "DELETE" });
export const unfriend = (userId: string) => api(`/friends/${userId}`, { method: "DELETE" });

// ---------------------------------------------------------------- khoảnh khắc
export type FeedItem = {
  id: string; user_id: string; is_me: boolean; name: string; caption: string; url: string | null;
  day: string; created_at: string; shared: boolean;
  meta: { streak: number; minutes: number; tasks_done: number; tasks_total: number };
  reactions: Record<ReactionKind, number>; my_reaction: ReactionKind | null;
};

export function normalizeMoment(raw: unknown): FeedItem | null {
  const o = obj(raw);
  const id = str(o.id);
  if (!id) return null;
  const meta = obj(o.meta);
  const r = obj(o.reactions);
  return {
    id, user_id: str(o.user_id), is_me: bool(o.is_me), name: str(o.name, "Bạn học"), caption: str(o.caption),
    url: str(o.url) || null, day: str(o.day), created_at: str(o.created_at), shared: bool(o.shared, true),
    meta: { streak: num(meta.streak), minutes: num(meta.minutes), tasks_done: num(meta.tasks_done), tasks_total: num(meta.tasks_total) },
    reactions: { flame: num(r.flame), heart: num(r.heart), clap: num(r.clap) },
    my_reaction: isKind(o.my_reaction) ? o.my_reaction : null,
  };
}

export type Feed = { items: FeedItem[]; next: string | null };

export async function fetchFeed(before?: string | null): Promise<Feed> {
  const o = obj(await api(`/friends/feed${before ? `?before=${encodeURIComponent(before)}` : ""}`));
  return {
    items: arr(o.items).map(normalizeMoment).filter((m): m is FeedItem => !!m),
    next: str(o.next_before) || null,
  };
}

export async function react(id: string, kind: ReactionKind | null) {
  if (kind) await api(`/friends/moments/${id}/reaction`, { method: "PUT", body: { kind } });
  else await api(`/friends/moments/${id}/reaction`, { method: "DELETE" });
}

export async function setShared(id: string, shared: boolean) {
  return normalizeMoment(obj(await api(`/friends/moments/${id}`, { method: "PATCH", body: { shared } })).moment);
}

/** Gửi ảnh (đã chọn bằng camera/thư viện) kèm lời nhắn; backend thu nhỏ ảnh và lưu vào khoảnh khắc hôm nay. */
export async function postMoment(uri: string, caption: string): Promise<FeedItem | null> {
  const form = new FormData();
  form.append("caption", caption);
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, "moment.jpg");
  } else {
    // React Native nhận một object {uri, name, type} làm tệp
    form.append("file", { uri, name: "moment.jpg", type: "image/jpeg" } as unknown as Blob);
  }
  return normalizeMoment(obj(await api("/friends/moments", { method: "POST", body: form, timeoutMs: 60_000 })).moment);
}

// ---------------------------------------------------------------- hiển thị
/** "vừa xong", "5 phút trước", "2 giờ trước", "hôm qua", "3 ngày trước". */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  return d === 1 ? "hôm qua" : `${d} ngày trước`;
}

export const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const pick = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2);
  return pick.toUpperCase();
};

/** Chỉ số màu ổn định theo tên để mỗi người luôn cùng một màu. */
export const hueIndex = (name: string, n: number) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % n;
};
