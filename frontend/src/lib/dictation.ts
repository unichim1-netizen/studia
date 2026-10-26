/**
 * Nghe chép chính tả: ngân hàng đoạn nghe, tách cụm, chấm so sánh từng từ, phát âm bằng giọng đọc của trình duyệt
 * và lưu tiến độ ở trình duyệt. Phần logic thuần (không đụng DOM) để kiểm thử độc lập.
 */

export type Level = "easy" | "mid" | "hard";
export type Segment = { id: string; level: Level; topic: string; text: string };

export const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: "easy", label: "Cơ bản", hint: "Câu ngắn, từ quen thuộc (IELTS 4.5–5.5)" },
  { id: "mid", label: "Trung bình", hint: "Câu ghép, số liệu, từ học thuật vừa (IELTS 5.5–6.5)" },
  { id: "hard", label: "Nâng cao", hint: "Câu dài, từ trừu tượng, nhiều mệnh đề (IELTS 7+)" },
];

/** Mỗi đoạn dài khoảng 25–32 từ, tức 10–15 giây ở tốc độ thường. */
export const SEGMENTS: Segment[] = [
  { id: "e1", level: "easy", topic: "Thư viện", text: "Good morning, everyone. The library opens at eight o'clock and closes at ten at night, so you have plenty of time to study. Please remember to bring your student card." },
  { id: "e2", level: "easy", topic: "Chỉ đường", text: "To get to the station, go straight along this road for about five minutes, then turn left at the traffic lights. The station is next to a small bookshop." },
  { id: "e3", level: "easy", topic: "Thói quen", text: "I usually wake up at half past six, have a quick breakfast, and then take the bus to work. The journey takes around forty minutes if there is no traffic." },
  { id: "e4", level: "easy", topic: "Đặt bàn", text: "I'd like to book a table for four people this Saturday evening at seven thirty, please. We would prefer a table near the window, if that is possible." },
  { id: "e5", level: "easy", topic: "Thời tiết", text: "Tomorrow will start cloudy in the north, but the sun should come out by midday. Temperatures will reach twenty degrees, although it may rain again in the evening." },
  { id: "e6", level: "easy", topic: "Sở thích", text: "My favourite hobby is cooking. At weekends I try new recipes with my sister, and we often invite our neighbours to taste the food we have made." },
  { id: "e7", level: "easy", topic: "Phòng gym", text: "The gym membership costs thirty pounds a month, and that includes the swimming pool and all the group classes. You can cancel at any time with two weeks' notice." },
  { id: "m1", level: "mid", topic: "Ký túc xá", text: "Most students in the first year live in the halls of residence, which are about ten minutes' walk from the main campus, but rooms are limited, so you should apply early." },
  { id: "m2", level: "mid", topic: "Môi trường", text: "Over the last fifty years, the average temperature of the ocean surface has risen steadily, which has caused coral reefs in many tropical regions to lose their colour and die." },
  { id: "m3", level: "mid", topic: "Công việc", text: "Our company has recently introduced flexible working hours, so employees can choose to start between seven and ten in the morning, as long as they complete eight hours." },
  { id: "m4", level: "mid", topic: "Chuyến tham quan", text: "This morning we will visit the old harbour, where fishermen have been selling their catch for over three centuries, and after lunch there will be time to explore the market." },
  { id: "m5", level: "mid", topic: "Khảo sát", text: "The survey found that nearly sixty percent of respondents preferred studying in small groups rather than listening to lectures, although many admitted that they were easily distracted." },
  { id: "m6", level: "mid", topic: "Công nghệ", text: "Because more people are shopping online, delivery companies are investing heavily in electric vans, which are quieter and cheaper to run than traditional diesel vehicles." },
  { id: "m7", level: "mid", topic: "Sức khỏe", text: "Doctors recommend that adults get at least seven hours of sleep each night, since a lack of rest can affect memory, mood, and even the body's ability to fight infections." },
  { id: "m8", level: "mid", topic: "Bài tập lớn", text: "Your assignment should be about two thousand words long and must be submitted online before noon on Friday, otherwise you will lose ten percent of your final mark." },
  { id: "h1", level: "hard", topic: "Lịch sử", text: "Contrary to popular belief, the early settlers did not abandon the region because of the harsh winters, but rather because the soil, once fertile, had gradually become exhausted." },
  { id: "h2", level: "hard", topic: "Kinh tế", text: "Economists argue that the sharp rise in housing prices is largely attributable to a shortage of new homes, rather than to speculation by investors, as many commentators have claimed." },
  { id: "h3", level: "hard", topic: "Khoa học", text: "Although the experiment was originally designed to measure the effect of light on plant growth, the researchers unexpectedly discovered that temperature played a far more significant role." },
  { id: "h4", level: "hard", topic: "Đô thị", text: "Urban planners are increasingly convinced that cities should prioritise pedestrians and cyclists, since reducing car traffic not only improves air quality but also strengthens local businesses." },
  { id: "h5", level: "hard", topic: "Bảo tàng", text: "The museum's newest exhibition, which explores how ordinary people experienced the industrial revolution, draws on letters, photographs, and diaries that had remained undiscovered in a private collection until last year." },
  { id: "h6", level: "hard", topic: "Tâm lý học", text: "Psychologists have found that people who write down their goals are considerably more likely to achieve them, provided that they also review their progress regularly and adjust their plans." },
];

/* ---------- Tách văn bản ---------- */

/** Tốc độ đọc trung bình của giọng TTS ở 1× (từ/giây), dùng để ước lượng thời lượng. */
const WORDS_PER_SEC = 2.6;
const MAX_SEG_WORDS = 36; // ≈ 14 giây
const MIN_SEG_WORDS = 22; // ≈ 8,5 giây

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
export const estimateSeconds = (text: string, rate: number) => wordCount(text) / (WORDS_PER_SEC * rate);

/** Tách thành câu, giữ dấu câu cuối. */
function sentencesOf(text: string): string[] {
  return (text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*["')\]]*/g) || []).map((s) => s.trim()).filter(Boolean);
}

/** Tách thành cụm nghe (kết thúc ở dấu phẩy, chấm phẩy, hai chấm hoặc dấu kết câu); gộp cụm quá ngắn (<3 từ) vào cụm kề. */
export function chunksOf(text: string): string[] {
  const raw = (text.replace(/\s+/g, " ").trim().match(/[^,;:.!?]+[,;:.!?]*/g) || []).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let carry = "";
  for (const piece of raw) {
    const joined = carry ? `${carry} ${piece}` : piece;
    if (wordCount(joined) < 3) { carry = joined; continue; }
    out.push(joined);
    carry = "";
  }
  if (carry) {
    if (out.length) out[out.length - 1] += ` ${carry}`;
    else out.push(carry);
  }
  return out;
}

/** Cắt văn bản dán vào thành các đoạn nghe 10–15 giây: gom câu cho tới ~36 từ, câu quá dài thì cắt ở dấu phẩy. */
export function splitIntoSegments(text: string): string[] {
  const units: string[] = [];
  for (const s of sentencesOf(text)) {
    if (wordCount(s) <= MAX_SEG_WORDS) { units.push(s); continue; }
    let buf = "";
    for (const c of chunksOf(s)) {
      if (buf && wordCount(`${buf} ${c}`) > MAX_SEG_WORDS) { units.push(buf); buf = c; }
      else buf = buf ? `${buf} ${c}` : c;
    }
    if (buf) units.push(buf);
  }
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    const joined = cur ? wordCount(`${cur} ${u}`) : 0;
    // đoạn đang gom còn quá ngắn (<15 từ) thì cho vượt nhẹ trần để không tạo đoạn chỉ vài giây
    if (cur && joined > MAX_SEG_WORDS && !(wordCount(cur) < 15 && joined <= 42)) { out.push(cur); cur = u; }
    else cur = cur ? `${cur} ${u}` : u;
    if (wordCount(cur) >= MIN_SEG_WORDS && wordCount(cur) <= MAX_SEG_WORDS && /[.!?]["')\]]*$/.test(cur)) { out.push(cur); cur = ""; }
  }
  if (cur) {
    // phần dư quá ngắn thì nối vào đoạn trước nếu còn vừa
    if (out.length && wordCount(cur) < 8 && wordCount(`${out[out.length - 1]} ${cur}`) <= MAX_SEG_WORDS + 6) out[out.length - 1] += ` ${cur}`;
    else out.push(cur);
  }
  return out;
}

/* ---------- Transcript có mốc thời gian (YouTube) ---------- */

export type Timed = { text: string; start: number; end: number };

const TS = /^\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\.\d+)?\]?\s*(.*)$/;
const toSec = (ts: string) => ts.split(":").reduce((s, p) => s * 60 + Number(p), 0);

/**
 * Đọc transcript chép từ YouTube ("Hiện bản chép lời"): mỗi mốc "0:12" hoặc "1:02:03" đứng riêng một dòng
 * hoặc ở đầu dòng, theo sau là lời. Trả về null nếu không có mốc thời gian nào.
 */
export function parseTimedTranscript(raw: string): Timed[] | null {
  const cues: { start: number; text: string }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(TS);
    if (m) cues.push({ start: toSec(m[1]), text: m[2].trim() });
    else if (line.trim() && cues.length) cues[cues.length - 1].text += ` ${line.trim()}`;
  }
  const out = cues
    .map((c, i) => ({ text: c.text.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim(), start: c.start, end: cues[i + 1]?.start ?? c.start + Math.max(2, wordCount(c.text) / WORDS_PER_SEC) }))
    .filter((c) => c.text && c.end > c.start);
  return out.length ? out : null;
}

/** Gom các dòng transcript thành đoạn nghe 10–15 giây, ưu tiên cắt ở cuối câu. */
export function segmentsFromTimed(cues: Timed[]): Timed[] {
  const out: Timed[] = [];
  let cur: Timed | null = null;
  for (const c of cues) {
    if (cur && (wordCount(`${cur.text} ${c.text}`) > MAX_SEG_WORDS + 4 || c.end - cur.start > 18)) { out.push(cur); cur = null; }
    cur = cur ? { text: `${cur.text} ${c.text}`, start: cur.start, end: c.end } : { ...c };
    const dur = cur.end - cur.start;
    if ((dur >= 10 || wordCount(cur.text) >= MIN_SEG_WORDS) && /[.!?]["')\]]*$/.test(cur.text)) { out.push(cur); cur = null; }
  }
  if (cur) {
    const last = out[out.length - 1];
    if (last && cur.end - cur.start < 4) out[out.length - 1] = { text: `${last.text} ${cur.text}`, start: last.start, end: cur.end };
    else out.push(cur);
  }
  return out;
}

/** Lấy mã video từ link YouTube (watch?v=, youtu.be/, shorts/, embed/) hoặc chính mã 11 ký tự. */
export function youtubeId(url: string): string | null {
  const s = url.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/* ---------- Nghe tăng dần ---------- */

export type Ladder = "off" | "speed" | "content";
export const LADDER_STEPS = [0.25, 0.5, 0.75, 1] as const;

/** Một lượt nghe: đọc `text` ở tốc độ `rate`; `share` là tỉ lệ nội dung (0–1] tính từ đầu đoạn, để cắt audio thật theo thời gian. */
export type Round = { text: string; rate: number; share: number; from?: number };

/** Vị trí (tỉ lệ 0–1 theo số từ) của từng cụm trong đoạn, để phát riêng một cụm của audio thật. */
export function chunkSpans(text: string): { from: number; to: number }[] {
  const cs = chunksOf(text);
  const total = cs.reduce((s, c) => s + wordCount(c), 0) || 1;
  let acc = 0;
  return cs.map((c) => { const from = acc / total; acc += wordCount(c); return { from, to: acc / total }; });
}

/**
 * Kế hoạch các lượt nghe tăng dần 25% → 50% → 75% → 100%:
 * - "speed": nghe cả đoạn ở 0.25× → 0.5× → 0.75× → 1×;
 * - "content": ở tốc độ đang chọn, nghe 25% đầu đoạn, rồi 50%, 75%, cả đoạn (cắt ở ranh giới cụm).
 */
export function ladderRounds(text: string, mode: Ladder, rate: number, times = 1): Round[] {
  if (mode === "speed") return LADDER_STEPS.map((r) => ({ text, rate: r, share: 1 }));
  if (mode === "content") {
    const words = text.replace(/\s+/g, " ").trim().split(" ");
    const total = words.length || 1;
    // ranh giới cụm (số từ tính từ đầu đoạn), để ưu tiên dừng ở chỗ ngắt hơi tự nhiên
    const bounds: number[] = [];
    let acc = 0;
    for (const c of chunksOf(text)) bounds.push((acc += wordCount(c)));
    const seen = new Set<number>();
    const rounds: Round[] = [];
    for (const p of LADDER_STEPS) {
      const target = Math.max(1, Math.round(p * total));
      const near = bounds.reduce((best, b) => (Math.abs(b - target) < Math.abs(best - target) ? b : best), bounds[0] ?? total);
      const n = p === 1 ? total : Math.abs(near - target) <= 3 ? near : target;
      if (seen.has(n)) continue;
      seen.add(n);
      rounds.push({ text: words.slice(0, n).join(" "), rate, share: n / total });
    }
    return rounds;
  }
  return Array.from({ length: Math.max(1, times) }, () => ({ text, rate, share: 1 }));
}

/* ---------- Nối âm, nuốt âm, dạng yếu ---------- */

export type LinkKind = "link" | "link-r" | "elide" | "assim" | "reduce" | "weak";
export type LinkNote = { phrase: string; kind: LinkKind; sound: string; note: string };

export const LINK_LABEL: Record<LinkKind, string> = {
  link: "Nối âm", "link-r": "Nối âm /r/", elide: "Nuốt âm", assim: "Biến âm", reduce: "Rút gọn", weak: "Dạng yếu",
};

const VOWEL_START_EXCEPT = /^(uni|use|usu|uti|eu|ewe|one|once|ufo)/; // chữ nguyên âm nhưng đọc /j/, /w/
const H_SILENT = /^(hour|honest|honou?r|heir)/;
const NO_CONS_END = /^(the|he|she|we|be|me|ye)$/;
const startsVowelSound = (w: string) => !VOWEL_START_EXCEPT.test(w) && (/^[aeiou]/.test(w) || H_SILENT.test(w));
/** /t/, /d/ cuối từ đứng sau một phụ âm (next, last, and, kind) — hay bị nuốt khi từ sau bắt đầu bằng phụ âm. */
const elidable = (w: string) => w.length > 2 && /[bcfghjklmnpsvxz][td]$/.test(w) && !/(nt|rd|rt|ed)$/.test(w) || /^(and|kind|want|went|don't|can't|isn't|wasn't)$/.test(w);
/** Từ kết thúc bằng phụ âm khi đọc (tính cả "e" câm như make, take). */
const endsConsSound = (w: string) => !NO_CONS_END.test(w) && (/[bcdfgklmnpstvxz]$/.test(w) || /[^aeiou]e$/.test(w) || /(ck|ng|sh|ch|th)$/.test(w)) && !/(ough|igh)$/.test(w);
const endsR = (w: string) => /(er|or|ar|ur|ir|ere|ore|are|ure|ire|ear|air|oor|our)$/.test(w);

/** Cụm hay đọc rút gọn trong văn nói. */
const REDUCTIONS: [RegExp, string, string][] = [
  [/^want to$/, "/ˈwɒnə/ (wanna)", "“want to” thường đọc liền thành wanna."],
  [/^going to$/, "/ˈɡʌnə/ (gonna)", "“going to” chỉ tương lai hay đọc thành gonna."],
  [/^got to$/, "/ˈɡɒtə/ (gotta)", "“got to” đọc nhanh thành gotta."],
  [/^have to$/, "/ˈhæftə/", "“have” trước “to” đổi /v/ thành /f/: hafta."],
  [/^has to$/, "/ˈhæstə/", "“has” trước “to” đổi /z/ thành /s/: hasta."],
  [/^(let me|lemme)$/, "/ˈlemi/ (lemme)", "“let me” nuốt /t/: lemme."],
  [/^give me$/, "/ˈɡɪmi/ (gimme)", "“give me” nuốt /v/: gimme."],
  [/^kind of$/, "/ˈkaɪndə/ (kinda)", "“of” yếu đi còn /ə/: kinda."],
  [/^sort of$/, "/ˈsɔːtə/ (sorta)", "“of” yếu đi còn /ə/: sorta."],
  [/^a lot of$/, "/əˈlɒtə/", "“of” còn /ə/, nối với lot: a-lotta."],
  [/^out of$/, "/ˈaʊtə/", "“of” còn /ə/: outta."],
  [/^(do not|don't) know$/, "/dəˈnəʊ/ (dunno)", "“don't know” đọc nhanh thành dunno."],
  [/^(would|could|should) have$/, "/ˈwʊdəv/", "“have” sau would/could/should gần như chỉ còn /əv/ hoặc /ə/."],
];

/** Dạng yếu của từ chức năng khi không được nhấn. */
const WEAK: Record<string, string> = {
  to: "/tə/", of: "/əv/", and: "/ən/ hoặc /n/", for: "/fə/", from: "/frəm/", at: "/ət/", can: "/kən/",
  was: "/wəz/", were: "/wə/", are: "/ə/", have: "/əv/", has: "/əz/", them: "/ðəm/", than: "/ðən/",
  but: "/bət/", some: "/səm/", there: "/ðə/", you: "/jə/", your: "/jə/", as: "/əz/", that: "/ðət/",
};

/**
 * Tìm các chỗ nối âm, nuốt âm, biến âm và rút gọn trong đoạn (quy tắc gần đúng, đủ để người học biết nghe chỗ nào).
 * Mỗi loại một vài ví dụ tiêu biểu, tối đa `limit` ghi chú.
 */
export function connectedSpeech(text: string, limit = 12): LinkNote[] {
  const words = text.replace(/[’‘]/g, "'").split(/\s+/).filter(Boolean);
  const clean = words.map((w) => w.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ""));
  // không nối qua dấu câu (dấu phẩy, chấm…) vì người đọc ngắt hơi ở đó
  const pause = words.map((w) => /[,.;:!?)"]$/.test(w));
  const notes: LinkNote[] = [];
  const used = new Set<string>();
  const add = (n: LinkNote) => {
    const key = n.phrase.toLowerCase();
    if (used.has(key)) return;
    used.add(key);
    notes.push(n);
  };
  const shown = (i: number, n: number) => words.slice(i, i + n).join(" ").replace(/[,.;:!?"]+$/, "");

  const covered = new Set<number>(); // vị trí đã nằm trong một cụm rút gọn, không ghi chú thêm
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i], b = clean[i + 1], c = clean[i + 2];
    if (!a) continue;
    // rút gọn 2–3 từ
    for (const [re, sound, note] of REDUCTIONS) {
      for (const n of [3, 2]) {
        const ph = clean.slice(i, i + n).join(" ");
        if (!covered.has(i) && clean.slice(i, i + n - 1).every((_, k) => !pause[i + k]) && re.test(ph)) {
          add({ phrase: shown(i, n), kind: "reduce", sound, note });
          for (let k = 0; k < n; k++) covered.add(i + k);
        }
      }
    }
    if (!b || pause[i] || covered.has(i)) continue;
    // biến âm: /t/, /d/ + you/your → /tʃ/, /dʒ/
    if (/^(you|your|you're|yourself)$/.test(b) && /[td]$/.test(a)) {
      const ch = a.endsWith("t") ? "/tʃ/" : "/dʒ/";
      add({ phrase: shown(i, 2), kind: "assim", sound: `${a}‿${b} → ${ch}`, note: `/${a.slice(-1)}/ gặp /j/ của “${b}” hoà thành ${ch}.` });
      continue;
    }
    // nuốt âm: /t/, /d/ kẹp giữa hai phụ âm (next day, last night, and then)
    if (elidable(a) && /^[bcdfgjklmnpqrstvwxz]/.test(b)) {
      add({ phrase: shown(i, 2), kind: "elide", sound: `${a.slice(0, -1)}(${a.slice(-1)}) ${b}`, note: `Âm /${a.slice(-1)}/ cuối “${a}” kẹp giữa hai phụ âm nên gần như bị nuốt.` });
      continue;
    }
    // nối /r/ (giọng Anh): far away, there is
    if (endsR(a) && startsVowelSound(b)) {
      add({ phrase: shown(i, 2), kind: "link-r", sound: `${a}‿${b}`, note: `“${a}” vốn không đọc /r/, nhưng trước nguyên âm thì /r/ hiện ra để nối sang “${b}”.` });
      continue;
    }
    // nối phụ âm cuối với nguyên âm đầu: turn left at, take it
    if (endsConsSound(a) && startsVowelSound(b) && a.length > 1) {
      const tail = c && !pause[i + 1] && endsConsSound(b) && startsVowelSound(c) ? 3 : 2;
      for (let k = 1; k < tail - 1; k++) covered.add(i + k); // từ giữa chuỗi nối không tạo ghi chú riêng
      add({ phrase: shown(i, tail), kind: "link", sound: clean.slice(i, i + tail).join("‿"), note: `Phụ âm cuối của “${a}” chuyển sang đầu “${b}”, nghe như một từ.` });
      continue;
    }
  }
  // dạng yếu: chỉ ghi từ chức năng xuất hiện giữa câu, mỗi từ một lần
  for (let i = 1; i < clean.length - 1; i++) {
    const w = clean[i];
    if (WEAK[w] && !pause[i] && !covered.has(i)) add({ phrase: pause[i - 1] ? shown(i, 2) : shown(i - 1, 3), kind: "weak", sound: `${w} → ${WEAK[w]}`, note: `“${w}” không được nhấn nên đọc rất nhẹ, dễ nghe sót.` });
  }
  const order: LinkKind[] = ["reduce", "assim", "link", "link-r", "elide", "weak"];
  // lấy xen kẽ các loại để danh sách không bị một loại chiếm hết
  const byKind = order.map((k) => notes.filter((n) => n.kind === k));
  const out: LinkNote[] = [];
  for (let r = 0; out.length < limit && byKind.some((l) => l[r]); r++) for (const l of byKind) if (l[r] && out.length < limit) out.push(l[r]);
  return out;
}

/* ---------- Shadowing ---------- */

/** Tốc độ nói (từ/phút). */
export const wpm = (text: string, seconds: number) => (seconds > 0 ? Math.round((wordCount(text) / seconds) * 60) : 0);

/** Nhận xét nhịp so với mẫu: tỉ lệ người học / mẫu. */
export function paceVerdict(user: number, model: number): { ratio: number; label: string; tone: "ok" | "warn" } {
  if (!user || !model) return { ratio: 0, label: "Chưa đo được nhịp", tone: "warn" };
  const ratio = user / model;
  if (ratio < 0.85) return { ratio, label: `Chậm hơn mẫu ${Math.round((1 - ratio) * 100)}%. Thử nói liền các cụm, đừng ngắt sau từng từ.`, tone: "warn" };
  if (ratio > 1.15) return { ratio, label: `Nhanh hơn mẫu ${Math.round((ratio - 1) * 100)}%. Bám theo nhịp của người đọc, giữ các chỗ ngắt hơi.`, tone: "warn" };
  return { ratio, label: "Nhịp khớp với mẫu. Tốt lắm!", tone: "ok" };
}

/** Gợi ý chữ cái đầu: "Good morning," → "G___ m______,". */
export function maskText(text: string): string {
  return text.replace(/([A-Za-z])([A-Za-z']*)/g, (_m, a: string, b: string) => a + b.replace(/[A-Za-z]/g, "_"));
}

/* ---------- Chấm ---------- */

const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const TENS: Record<string, string> = { "30": "thirty", "40": "forty", "50": "fifty", "60": "sixty", "70": "seventy", "80": "eighty", "90": "ninety", "100": "hundred" };

function normToken(w: string): string {
  if (/^\d+$/.test(w)) {
    const n = Number(w);
    if (n <= 20) return NUM_WORDS[n];
    if (TENS[w]) return TENS[w];
  }
  return w;
}

/** Hạ chữ thường, bỏ dấu câu, đổi số 0–20 và các chục thành chữ; dấu nháy trong từ (I'd, students') được giữ. */
export function tokenize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean)
    .map(normToken);
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** Gõ gần đúng (sai 1 ký tự; 2 ký tự với từ ≥5 ký tự có cùng chữ cái đầu): coi là lỗi chính tả chứ không phải nghe sai. */
export function isNear(ref: string, got: string): boolean {
  const len = Math.max(ref.length, got.length);
  if (ref === got || len < 4) return false;
  const d = lev(ref, got);
  return d <= 1 || (len >= 5 && d <= 2 && ref[0] === got[0]);
}

export type CellKind = "ok" | "typo" | "wrong" | "missing" | "extra";
export type Cell = { kind: CellKind; ref?: string; got?: string };
export type Compared = {
  cells: Cell[];
  score: number; // 0–100; lỗi chính tả tính nửa điểm
  counts: Record<CellKind, number>;
  total: number;
};

export function compare(reference: string, answer: string): Compared {
  const R = tokenize(reference);
  const U = tokenize(answer);
  const n = R.length, m = U.length;
  const L = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0) as number[]);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = R[i] === U[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const cells: Cell[] = [];
  const flushGap = (refGap: string[], userGap: string[]) => {
    let j = 0;
    for (const r of refGap) {
      const k = userGap.findIndex((u, idx) => idx >= j && isNear(r, u));
      if (k >= 0) {
        for (let x = j; x < k; x++) cells.push({ kind: "extra", got: userGap[x] });
        cells.push({ kind: "typo", ref: r, got: userGap[k] });
        j = k + 1;
      } else if (j < userGap.length) {
        cells.push({ kind: "wrong", ref: r, got: userGap[j++] });
      } else {
        cells.push({ kind: "missing", ref: r });
      }
    }
    for (; j < userGap.length; j++) cells.push({ kind: "extra", got: userGap[j] });
  };
  let i = 0, j = 0, rg: string[] = [], ug: string[] = [];
  while (i < n || j < m) {
    if (i < n && j < m && R[i] === U[j]) {
      flushGap(rg, ug); rg = []; ug = [];
      cells.push({ kind: "ok", ref: R[i], got: U[j] });
      i++; j++;
    } else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) rg.push(R[i++]);
    else ug.push(U[j++]);
  }
  flushGap(rg, ug);
  const counts: Record<CellKind, number> = { ok: 0, typo: 0, wrong: 0, missing: 0, extra: 0 };
  for (const c of cells) counts[c.kind]++;
  const score = n ? Math.max(0, Math.round(((counts.ok + 0.5 * counts.typo - 0.25 * counts.extra) / n) * 100)) : 0;
  return { cells, score: Math.min(100, score), counts, total: n };
}

/** Từ cần ôn: những từ nghe sai, thiếu hoặc viết sai chính tả. */
export const missedWords = (c: Compared) =>
  Array.from(new Set(c.cells.filter((x) => x.kind !== "ok" && x.kind !== "extra" && x.ref).map((x) => x.ref as string)));

/* ---------- Phát âm (giọng đọc của trình duyệt) ---------- */

let token = 0;

export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export function listVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
}

/** Danh sách giọng nạp bất đồng bộ trên Chrome; gọi lại khi có thay đổi. */
export function watchVoices(cb: () => void): () => void {
  if (!speechSupported()) return () => {};
  window.speechSynthesis.addEventListener("voiceschanged", cb);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", cb);
}

export type PlayOpts = {
  text: string;
  rate: number;
  voiceURI?: string;
  times?: number;      // số lần lặp
  gapMs?: number;      // nghỉ giữa các lần lặp
  rounds?: Round[];    // nếu có: thay text/rate/times, mỗi lượt một nội dung và tốc độ riêng (nghe tăng dần)
  onWord?: (charIndex: number) => void; // vị trí từ đang đọc trong lượt hiện tại (nếu giọng đọc hỗ trợ)
  onStartRound?: () => void;            // giọng đọc thực sự bắt đầu phát lượt hiện tại
  onRound?: (round: number) => void;
  onEnd?: (completed: boolean) => void;
};

export function stopSpeech() {
  token++;
  if (speechSupported()) try { window.speechSynthesis.cancel(); } catch {}
}

/** Đọc `text` rồi lặp lại `times` lần. Gọi hàm trả về (hoặc stopSpeech) để dừng; lần phát mới tự ngắt lần cũ. */
export function play(o: PlayOpts): () => void {
  if (!speechSupported()) { o.onEnd?.(false); return () => {}; }
  const synth = window.speechSynthesis;
  const mine = ++token;
  synth.cancel();
  const voice = o.voiceURI ? synth.getVoices().find((v) => v.voiceURI === o.voiceURI) : undefined;
  const rounds = o.rounds?.length ? o.rounds : Array.from({ length: Math.max(1, o.times || 1) }, () => ({ text: o.text, rate: o.rate, share: 1 }));
  let round = 0;
  const once = () => {
    if (mine !== token) return;
    const r = rounds[round++];
    o.onRound?.(round);
    const u = new SpeechSynthesisUtterance(r.text);
    u.lang = voice?.lang || "en-GB";
    if (voice) u.voice = voice;
    u.rate = r.rate;
    u.onstart = () => { if (mine === token) o.onStartRound?.(); };
    u.onboundary = (e) => { if (mine === token && e.name !== "sentence") o.onWord?.(e.charIndex); };
    u.onend = () => {
      if (mine !== token) return;
      if (round < rounds.length) setTimeout(once, o.gapMs ?? 1500);
      else o.onEnd?.(true);
    };
    u.onerror = (e) => {
      if (mine !== token || e.error === "interrupted" || e.error === "canceled") return;
      o.onEnd?.(false);
    };
    synth.speak(u);
  };
  setTimeout(once, 60); // Chrome bỏ qua speak() gọi ngay sau cancel()
  return () => { if (mine === token) stopSpeech(); };
}

/* ---------- Lưu tiến độ ---------- */

export type Settings = { rate: number; voiceURI: string; times: number; gapSec: number; examMode: boolean; ladder: Ladder };
export type Store = {
  settings: Settings;
  done: Record<string, { best: number; attempts: number; last: number }>;
  weak: Record<string, number>;
  days: Record<string, { n: number; sum: number }>;
  custom: string;
  /** Link YouTube đi kèm transcript ở mục “Của bạn”; có link + mốc thời gian thì nghe audio thật thay vì giọng máy. */
  customVideo: string;
  /** Shadowing: điểm khớp lời tốt nhất theo đoạn, và số lượt theo ngày. */
  shadow: Record<string, { best: number; attempts: number }>;
  shadowDays: Record<string, number>;
};

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25] as const;
export const EXAM_MAX_PLAYS = 2;

const KEY = "studia-dictation-v1";
export const EMPTY_STORE: Store = {
  settings: { rate: 1, voiceURI: "", times: 1, gapSec: 3, examMode: false, ladder: "off" },
  done: {}, weak: {}, days: {}, custom: "", customVideo: "", shadow: {}, shadowDays: {},
};

export function loadStore(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...EMPTY_STORE, ...s, settings: { ...EMPTY_STORE.settings, ...(s.settings || {}) } };
  } catch { return EMPTY_STORE; }
}

export function saveStore(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Ghi kết quả một lượt chấm: điểm tốt nhất của đoạn, thống kê theo ngày và bộ đếm từ hay nghe sai. */
export function recordResult(store: Store, segId: string | null, score: number, missed: string[]): Store {
  const next: Store = { ...store, done: { ...store.done }, weak: { ...store.weak }, days: { ...store.days } };
  if (segId) {
    const prev = next.done[segId];
    next.done[segId] = { best: Math.max(prev?.best ?? 0, score), attempts: (prev?.attempts ?? 0) + 1, last: score };
  }
  const k = dayKey();
  const d = next.days[k] || { n: 0, sum: 0 };
  next.days[k] = { n: d.n + 1, sum: d.sum + score };
  for (const w of missed) next.weak[w] = (next.weak[w] || 0) + 1;
  return next;
}

/** Ghi một lượt shadowing. */
export function recordShadow(store: Store, segId: string, score: number): Store {
  const prev = store.shadow[segId];
  const k = dayKey();
  return {
    ...store,
    shadow: { ...store.shadow, [segId]: { best: Math.max(prev?.best ?? 0, score), attempts: (prev?.attempts ?? 0) + 1 } },
    shadowDays: { ...store.shadowDays, [k]: (store.shadowDays[k] || 0) + 1 },
  };
}
