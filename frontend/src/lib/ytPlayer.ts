/**
 * Phát một khoảng thời gian của video YouTube qua IFrame Player API: đặt tốc độ, tua tới đầu đoạn,
 * tự dừng ở cuối đoạn, lặp theo danh sách lượt. Dùng cho nghe chép chính tả và shadowing với audio thật.
 */

export type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  setPlaybackRate(r: number): void;
  getCurrentTime(): number;
  destroy(): void;
};

type YTNamespace = { Player: new (el: HTMLElement, o: Record<string, unknown>) => YTPlayer };
declare global {
  interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void }
}

let apiReady: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT as YTNamespace); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { apiReady = null; reject(new Error("Không tải được trình phát YouTube.")); };
    document.head.appendChild(s);
  });
  return apiReady;
}

/** Tạo trình phát trong `el`; trả về hàm huỷ. `onError` nhận mã lỗi YouTube (vd. 101/150: chủ video chặn nhúng). */
export function createPlayer(el: HTMLElement, videoId: string, onReady: (p: YTPlayer) => void, onError: (msg: string) => void): () => void {
  let player: YTPlayer | null = null;
  let dead = false;
  loadApi().then((YT) => {
    if (dead) return;
    player = new YT.Player(el, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: { rel: 0, modestbranding: 1, playsinline: 1, cc_load_policy: 0, iv_load_policy: 3 },
      events: {
        onReady: () => { if (!dead && player) onReady(player); },
        // lệnh dừng gửi lúc video đang tải có thể bị bỏ qua: nếu video tự phát ngay sau khi dừng thì dừng lại
        onStateChange: (e: { data: number }) => { if (e.data === 1 && Date.now() - stoppedAt < 3000) try { player?.pauseVideo(); } catch {} },
        onError: (e: { data: number }) => onError(
          e.data === 101 || e.data === 150 ? "Chủ video không cho phép phát nhúng. Hãy chọn video khác."
            : e.data === 100 ? "Video không tồn tại hoặc đã bị gỡ."
            : "YouTube báo lỗi khi phát video này."),
      },
    });
  }).catch((e: Error) => onError(e.message));
  return () => { dead = true; try { player?.destroy(); } catch {} };
}

let token = 0;
let stoppedAt = 0;

export type YTRound = { start: number; end: number; rate: number };

/** Dừng mọi lượt phát YouTube đang chạy. */
export function stopYT(p?: YTPlayer | null) {
  token++;
  if (p) stoppedAt = Date.now();
  try { p?.pauseVideo(); } catch {}
}

/** Phát lần lượt các khoảng [start, end) ở tốc độ của từng lượt, nghỉ `gapMs` giữa các lượt. */
export function playYT(p: YTPlayer, rounds: YTRound[], o: { gapMs?: number; onRound?: (n: number) => void; onStartRound?: () => void; onEnd?: (completed: boolean) => void } = {}): () => void {
  const mine = ++token;
  stoppedAt = 0;
  let i = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const next = () => {
    if (mine !== token) return;
    const r = rounds[i++];
    o.onRound?.(i);
    try {
      p.setPlaybackRate(r.rate);
      p.seekTo(r.start, true);
      p.playVideo();
    } catch { o.onEnd?.(false); return; }
    let started = false;
    timer = setInterval(() => {
      if (mine !== token) { clearInterval(timer); return; }
      let t = 0;
      try { t = p.getCurrentTime(); } catch {}
      if (!started && t >= r.start - 0.05 && t < r.end) { started = true; o.onStartRound?.(); }
      if (t >= r.end - 0.05) {
        clearInterval(timer);
        try { p.pauseVideo(); } catch {}
        if (i < rounds.length) setTimeout(next, o.gapMs ?? 1500);
        else o.onEnd?.(true);
      }
    }, 80);
  };
  next();
  return () => { if (mine === token) { clearInterval(timer); stopYT(p); } };
}
