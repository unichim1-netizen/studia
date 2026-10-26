/**
 * Luyện Speaking IELTS: kho câu hỏi Part 1/2/3 (lấy từ các bộ Cambridge đang mở), khung trả lời I-E-E,
 * phân tích bản ghi âm theo 4 tiêu chí (lưu loát, từ vựng, ngữ pháp, phát âm) và đo mức diễn đạt lại giữa hai lần nói.
 * Logic thuần, không đụng DOM.
 */

import { SYNONYMS } from "@/lib/writingCheck";

export type Part = 1 | 2 | 3;
export type SpkQuestion = { id: string; part: Part; text: string; topic: string; bullets?: string[] };

/* ---------- Kho câu hỏi ---------- */

type RawSpeaking = {
  part1?: { questions?: string[] }; part2?: { cue_card?: string }; part3?: { questions?: string[] };
};

/** Tách thẻ đề Part 2: câu "Describe…" và các gạch đầu dòng "You should say". */
export function parseCueCard(raw: string): { text: string; bullets: string[] } {
  const clean = raw.replace(/\*\*/g, "").replace(/\r/g, "");
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const main = (lines.find((l) => /^describe|^talk about|^tell/i.test(l)) || lines[0] || "").replace(/\s*You should say:?\s*$/i, "").trim();
  const bullets: string[] = [];
  for (const l of lines) {
    const b = l.match(/^[•\-–*]\s*(.+)$/);
    if (b) bullets.push(b[1].trim());
    else if (/^and explain/i.test(l)) bullets.push(l.trim());
  }
  return { text: main, bullets };
}

/** Gạch đầu dòng dự phòng khi thẻ đề trong dữ liệu bị thiếu phần "You should say". */
export const GENERIC_BULLETS = ["what / who / where it is", "when and how you came across it", "what details you remember", "and explain why it matters to you"];

export function questionsFrom(id: string, sp: RawSpeaking): SpkQuestion[] {
  const out: SpkQuestion[] = [];
  const p1 = (sp.part1?.questions || []).filter(Boolean);
  const topic1 = p1[0] ? p1[0].replace(/\?.*$/, "") : "Part 1";
  p1.forEach((q, i) => out.push({ id: `${id}-p1-${i}`, part: 1, text: q, topic: topic1 }));
  if (sp.part2?.cue_card) {
    const c = parseCueCard(sp.part2.cue_card);
    if (c.text && c.text.length > 12) out.push({ id: `${id}-p2`, part: 2, text: c.text, topic: c.text, bullets: c.bullets.length ? c.bullets : GENERIC_BULLETS });
  }
  (sp.part3?.questions || []).filter(Boolean).forEach((q, i) => out.push({ id: `${id}-p3-${i}`, part: 3, text: q, topic: "Part 3" }));
  return out;
}

/** Thời lượng gợi ý (giây) cho mỗi phần. */
export const PART_TARGET: Record<Part, { min: number; ideal: number; max: number; prep: number; label: string; tip: string }> = {
  1: { min: 15, ideal: 30, max: 50, prep: 0, label: "Part 1 · Giới thiệu", tip: "Trả lời 2–4 câu: ý chính + lý do + một chi tiết. Tự nhiên như nói chuyện, đừng trả lời cụt “Yes/No”." },
  2: { min: 75, ideal: 110, max: 125, prep: 60, label: "Part 2 · Nói dài 2 phút", tip: "1 phút chuẩn bị: ghi từ khoá cho từng gạch đầu dòng (bằng tiếng Anh). Nói liền 1,5–2 phút, đi lần lượt các ý và kết bằng phần “explain”." },
  3: { min: 30, ideal: 50, max: 80, prep: 0, label: "Part 3 · Thảo luận", tip: "Câu hỏi trừu tượng hơn: nêu quan điểm (Idea), giải thích vì sao (Explanation), cho ví dụ hoặc so sánh (Example), có thể nhìn nhận mặt ngược lại." },
};

/* ---------- Khung I-E-E ---------- */

export const IEE: { id: "idea" | "explain" | "example"; label: string; hint: string; frames: string[] }[] = [
  { id: "idea", label: "Idea · Ý chính", hint: "Trả lời thẳng câu hỏi trong một câu.", frames: ["Well, I'd say that…", "To be honest, I really…", "I think the main reason is…"] },
  { id: "explain", label: "Explanation · Giải thích", hint: "Vì sao? Điều đó có nghĩa là gì?", frames: ["This is mainly because…", "What I mean is…", "The thing is…"] },
  { id: "example", label: "Example · Ví dụ", hint: "Một trải nghiệm, con số hoặc tình huống cụ thể.", frames: ["For example, last summer I…", "A good example is…", "I remember once…"] },
];

const VI_CHARS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
/** Ghi chú có tiếng Việt không (nhắc người học nghĩ bằng tiếng Anh). */
export const hasVietnamese = (s: string) => VI_CHARS.test(s);

/* ---------- Phân tích bản ghi ---------- */

export type Recording = {
  transcript: string;           // lời nhận dạng được
  confidences: number[];        // độ tin cậy của từng đoạn nhận dạng (0–1, có thể trống)
  durationSec: number;          // thời lượng ghi âm
  voiced: [number, number][];   // các khoảng có tiếng nói (giây, tính từ lúc bắt đầu ghi)
};

export type Pause = { at: number; len: number };
export type Indicator = { key: "fluency" | "lexical" | "grammar" | "pron"; label: string; level: 1 | 2 | 3; summary: string; notes: string[] };
export type Analysis = {
  words: number; speechSec: number; wpm: number;
  pauses: Pause[]; longestPause: number; startDelay: number;
  fillers: { word: string; n: number }[]; repeats: string[];
  uniqueRatio: number; advanced: string[]; overused: { word: string; n: number; alt: string[] }[];
  structures: string[]; tenses: string[];
  iee: { idea: boolean; explain: boolean; example: boolean };
  bullets: { text: string; covered: boolean }[];
  lengthVerdict: { level: "short" | "ok" | "long"; text: string };
  indicators: Indicator[];
};

export const LONG_PAUSE = 1.2;
const FILLERS = ["um", "uh", "er", "erm", "ah", "hmm", "like", "you know", "i mean", "kind of", "sort of", "basically", "actually", "literally", "so yeah"];

/** Khoảng lặng giữa các đoạn có tiếng (bỏ đoạn đầu trước khi bắt đầu nói). */
export function pausesOf(voiced: [number, number][], min = LONG_PAUSE): Pause[] {
  const out: Pause[] = [];
  for (let i = 1; i < voiced.length; i++) {
    const len = voiced[i][0] - voiced[i - 1][1];
    if (len >= min) out.push({ at: voiced[i - 1][1], len });
  }
  return out;
}

/** Ghép các đoạn có tiếng sát nhau (cách < 0.25s) để không đếm nhịp thở ngắn thành ngập ngừng. */
export function mergeVoiced(v: [number, number][], gap = 0.25): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of v) {
    const last = out[out.length - 1];
    if (last && a - last[1] < gap) last[1] = b;
    else out.push([a, b]);
  }
  return out.filter(([a, b]) => b - a >= 0.12);
}

// từ rất thông dụng: không tính là "từ vựng nâng cao"
const COMMON = new Set(("the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us very really thing things lot lots much many more great nice bad big small little long place home family friend friends school job city country food money life world feel love enjoy usually sometimes always often never maybe probably quite pretty kind sort different same important interesting fun happy").split(" "));

const STRUCTS: [string, RegExp][] = [
  ["Mệnh đề quan hệ (which/who/where)", /\b(which|who|whom|whose|where)\b/],
  ["Câu điều kiện (if/unless)", /\b(if|unless|as long as)\b/],
  ["Nhượng bộ (although/even though)", /\b(although|even though|though|whereas|despite)\b/],
  ["Nguyên nhân (because/since)", /\b(because|since|due to|that's why)\b/],
  ["Bị động", /\b(is|are|was|were|been|be|being) (\w+ed|made|done|built|taken|given|known|seen|grown|taught|written)\b/],
  ["So sánh", /\b(\w+er than|more \w+ than|less \w+ than|the (most|best|worst)|as \w+ as)\b/],
  ["Câu giả định (would/could)", /\b(would|could|might) (be|have|like|probably|definitely|say|go|do)\b/],
];
const TENSES: [string, RegExp][] = [
  ["Hiện tại đơn", /\b(i|we|they|you|people) (usually |often |always )?(go|like|enjoy|think|have|live|work|study|prefer)\b/],
  ["Quá khứ", /\b(was|were|did|went|had|got|saw|made|took|\w+ed)\b/],
  ["Hiện tại hoàn thành", /\b(have|has|i've|we've|they've) (been|never|already|just|ever|\w+ed|seen|done|gone|had|made)\b/],
  ["Tương lai", /\b(will|i'll|we'll|planning to|(going to|gonna) (be|have|do|go|get|make|see|try|visit|take|buy|start|travel|study|work|live))\b/],
];

const EXPLAIN = /\b(because|since|the reason|that's why|this is why|so that|which means|what i mean|i mean|the thing is|as a result)\b/;
const EXAMPLE = /\b(for example|for instance|such as|like when|i remember|once|last (week|month|year|summer|time)|when i was|a good example|in my case|my (friend|mother|father|brother|sister))\b/;

const level = (good: boolean, ok: boolean): 1 | 2 | 3 => (good ? 3 : ok ? 2 : 1);

export function analyze(rec: Recording, part: Part, bullets: string[] = []): Analysis {
  const text = rec.transcript.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();
  const toks = text ? text.split(" ") : [];
  const words = toks.length;
  const voiced = mergeVoiced(rec.voiced);
  const startDelay = voiced[0]?.[0] ?? 0;
  const speechSec = voiced.length ? voiced[voiced.length - 1][1] - voiced[0][0] : rec.durationSec;
  const wpm = speechSec > 2 ? Math.round((words / speechSec) * 60) : 0;
  const pauses = pausesOf(voiced);
  const longestPause = pauses.reduce((m, p) => Math.max(m, p.len), 0);

  // từ đệm (lưu ý: trình duyệt hay bỏ "um/uh" khỏi lời nhận dạng, nên khoảng lặng mới là chỉ số chính)
  const fillers = FILLERS.map((f) => ({ word: f, n: (` ${text} `.match(new RegExp(` ${f} `, "g")) || []).length })).filter((f) => f.n > 0 && !(f.word === "like" && f.n < 3));
  const repeats: string[] = [];
  for (let i = 1; i < toks.length; i++) if (toks[i] === toks[i - 1] && toks[i].length > 1 && !["very", "really", "so", "that", "had"].includes(toks[i])) repeats.push(`${toks[i]} ${toks[i]}`);

  // từ vựng
  const content = toks.filter((w) => w.length > 3 && !COMMON.has(w));
  const uniqueRatio = words ? new Set(toks).size / words : 0;
  const advanced = Array.from(new Set(content.filter((w) => w.length >= 7))).slice(0, 12);
  const freq = new Map<string, number>();
  for (const w of toks) if (SYNONYMS[w] || ["really", "nice", "thing", "stuff", "lot"].includes(w)) freq.set(w, (freq.get(w) || 0) + 1);
  const overused = Array.from(freq.entries()).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])
    .map(([w, n]) => ({ word: w, n, alt: SYNONYMS[w] || (w === "really" ? ["genuinely", "truly", "extremely"] : w === "nice" ? ["pleasant", "lovely", "enjoyable"] : w === "lot" ? ["plenty of", "a great deal of"] : ["aspect", "factor"]) }));

  // ngữ pháp: độ đa dạng cấu trúc và thì
  const structures = STRUCTS.filter(([, re]) => re.test(text)).map(([n]) => n);
  const tenses = TENSES.filter(([, re]) => re.test(text)).map(([n]) => n);

  // I-E-E
  const iee = { idea: words >= 5, explain: EXPLAIN.test(text), example: EXAMPLE.test(text) };

  // Part 2: phủ các gạch đầu dòng (theo từ có nghĩa trong mỗi gạch)
  const set = new Set(toks.map((w) => w.replace(/(ing|ed|es|s)$/, "")));
  const bulletCov = bullets.map((b) => {
    const keys = (b.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 3 && !["what", "where", "when", "which", "explain", "whether", "this", "that", "with", "were", "your", "about", "would", "there"].includes(w));
    const hit = keys.filter((k) => set.has(k.replace(/(ing|ed|es|s)$/, ""))).length;
    return { text: b, covered: keys.length ? hit / keys.length >= 0.34 : false };
  });

  // độ dài
  const T = PART_TARGET[part];
  const lengthVerdict = speechSec < T.min
    ? { level: "short" as const, text: `Hơi ngắn (${Math.round(speechSec)} giây). Mục tiêu khoảng ${T.ideal} giây: thêm giải thích hoặc ví dụ.` }
    : speechSec > T.max
      ? { level: "long" as const, text: `Khá dài (${Math.round(speechSec)} giây). ${part === 2 ? "Giám khảo sẽ ngắt ở 2 phút." : "Part này nên gọn hơn, tránh lan man."}` }
      : { level: "ok" as const, text: `Độ dài phù hợp (${Math.round(speechSec)} giây).` };

  // 4 chỉ số tham khảo
  const pausesPerMin = speechSec > 0 ? pauses.length / (speechSec / 60) : 0;
  const fillerCount = fillers.reduce((t, f) => t + f.n, 0);
  const flu: Indicator = {
    key: "fluency", label: "Fluency & Coherence · Lưu loát",
    level: level(wpm >= 110 && (pausesPerMin <= 3 || pauses.length <= 1) && longestPause < 3, wpm >= 80 && (pausesPerMin <= 6 || pauses.length <= 2)),
    summary: `${wpm || "—"} từ/phút · ${pauses.length} lần ngập ngừng ≥ ${LONG_PAUSE}s${longestPause ? ` (lâu nhất ${longestPause.toFixed(1)}s)` : ""}`,
    notes: [
      ...(wpm && wpm < 90 ? ["Nói còn chậm. Luyện nói liền cụm (chunk) thay vì từng từ; người bản xứ khoảng 120–160 từ/phút."] : []),
      ...(pausesPerMin > 4 && pauses.length >= 2 ? ["Ngập ngừng nhiều: dùng cụm câu “câu giờ” tự nhiên (Well, let me think…, That's an interesting question…) thay vì im lặng."] : []),
      ...(startDelay > 3 ? [`Mất ${startDelay.toFixed(1)}s mới bắt đầu nói. Tập vào câu bằng “Well, …” ngay khi nghe xong câu hỏi.`] : []),
      ...(fillerCount > 4 ? [`Dùng nhiều từ đệm (${fillers.map((f) => f.word).join(", ")}).`] : []),
      ...(repeats.length >= 2 ? [`Lặp từ khi nói (${repeats.slice(0, 3).join(", ")}): dấu hiệu đang tìm từ.`] : []),
      ...(!iee.explain ? ["Chưa thấy phần giải thích (because, the reason is…): câu trả lời dễ bị cụt ý."] : []),
    ],
  };
  const lex: Indicator = {
    key: "lexical", label: "Lexical Resource · Từ vựng",
    level: level(uniqueRatio >= 0.55 && advanced.length >= 4 && !overused.length, uniqueRatio >= 0.45 && advanced.length >= 2),
    summary: `${Math.round(uniqueRatio * 100)}% từ khác nhau · ${advanced.length} từ ít phổ biến`,
    notes: [
      ...overused.map((o) => `Lặp “${o.word}” ×${o.n} → thử: ${o.alt.slice(0, 3).join(", ")}.`),
      ...(advanced.length < 2 && words > 30 ? ["Từ vựng còn cơ bản. Chuẩn bị cụm từ theo chủ đề (collocation, idiom nhẹ) và dùng lại khi nói."] : []),
    ],
  };
  const gra: Indicator = {
    key: "grammar", label: "Grammatical Range · Ngữ pháp",
    level: level(structures.length >= 3 && tenses.length >= 2, structures.length >= 1),
    summary: structures.length ? `${structures.length} kiểu câu phức · ${tenses.length} thì` : "Chủ yếu câu đơn",
    notes: [
      ...(structures.length < 2 ? ["Thêm câu phức: mệnh đề quan hệ (which/who), điều kiện (if), nhượng bộ (although)."] : []),
      ...(part === 2 && !tenses.includes("Quá khứ") ? ["Part 2 thường kể trải nghiệm: dùng thì quá khứ cho đúng."] : []),
      "Bản nhận dạng giọng nói tự sửa một phần ngữ pháp, nên hãy nghe lại bản ghi để tự bắt lỗi chia động từ, mạo từ, số ít/số nhiều.",
    ],
  };
  const confs = rec.confidences.filter((c) => c > 0);
  const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  const pron: Indicator = {
    key: "pron", label: "Pronunciation · Phát âm",
    level: confs.length ? level(avgConf >= 0.85, avgConf >= 0.7) : 2,
    summary: confs.length ? `Máy nhận dạng chắc chắn ${Math.round(avgConf * 100)}%` : "Không có số đo độ tin cậy từ trình duyệt",
    notes: [
      ...(confs.length && avgConf < 0.75 ? ["Máy khó nhận ra lời bạn: chú ý âm cuối (-s, -ed, -t), trọng âm từ và nói rõ hơn."] : []),
      "So bản nhận dạng với ý bạn muốn nói: từ bị nhận sai thường là từ bạn phát âm chưa chuẩn. Luyện lại ở mục Shadowing.",
    ],
  };

  return {
    words, speechSec, wpm, pauses, longestPause, startDelay, fillers, repeats, uniqueRatio, advanced, overused, structures, tenses,
    iee, bullets: bulletCov, lengthVerdict, indicators: [flu, lex, gra, pron],
  };
}

/* ---------- Diễn đạt lại ---------- */

const trigrams = (s: string) => {
  const t = s.toLowerCase().match(/[a-z']+/g) || [];
  const g = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3).join(" "));
  return g;
};

/** Mức trùng nguyên cụm 3 từ giữa hai lần nói: càng thấp càng là diễn đạt lại (không học thuộc). */
export function overlap(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((g) => { if (B.has(g)) hit++; });
  return hit / Math.min(A.size, B.size);
}

/**
 * Ý chính của câu gốc (từ có nghĩa) để người học tự kiểm tra câu nói lại còn đủ ý không. Máy chỉ biết từ nào được giữ nguyên
 * (hoặc có từ đồng nghĩa trong bảng); từ đã đổi cách nói thì để người học tự xác nhận, vì diễn đạt lại vốn phải đổi từ.
 */
export function keyIdeas(source: string, said: string): { word: string; same: boolean }[] {
  const norm = (w: string) => w.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "");
  const words = Array.from(new Set((source.match(/[A-Za-z]+/g) || []).filter((w) => w.length > 3 && !COMMON.has(w.toLowerCase()) && !["have", "made", "with", "their", "them", "when", "they"].includes(w.toLowerCase()))));
  const saidSet = new Set((said.toLowerCase().match(/[a-z]+/g) || []).map(norm));
  const syn = (k: string) => (SYNONYMS[k] || []).some((s) => s.split(" ").every((p) => saidSet.has(norm(p))));
  return words.map((w) => ({ word: w, same: saidSet.has(norm(w.toLowerCase())) || syn(w.toLowerCase()) }));
}

/** Câu mẫu để luyện diễn đạt lại (chủ đề hay gặp trong Speaking). */
export const PARAPHRASE_BANK: { topic: string; text: string }[] = [
  { topic: "Công nghệ", text: "Smartphones have made it much easier for people to stay in touch with their friends and family." },
  { topic: "Giáo dục", text: "Many students find it difficult to concentrate when they study at home." },
  { topic: "Môi trường", text: "Using public transport is one of the best ways to reduce air pollution in big cities." },
  { topic: "Sức khoẻ", text: "Doing regular exercise not only keeps you fit but also helps reduce stress." },
  { topic: "Công việc", text: "These days a lot of young people prefer working for themselves rather than for a large company." },
  { topic: "Du lịch", text: "Travelling abroad is a great opportunity to learn about different cultures." },
  { topic: "Thành phố", text: "Living in the city is convenient, but the cost of housing is extremely high." },
  { topic: "Đọc sách", text: "Children who read regularly usually develop a wider vocabulary." },
  { topic: "Mua sắm", text: "Online shopping is popular because it saves time and offers more choice." },
  { topic: "Gia đình", text: "In my country, grandparents often play an important role in raising children." },
  { topic: "Âm nhạc", text: "I usually listen to music when I want to relax after a long day at work." },
  { topic: "Thể thao", text: "Watching sports on television is less exciting than seeing a match in person." },
  { topic: "Ẩm thực", text: "Fast food is cheap and quick, but it is not very good for your health." },
  { topic: "Mạng xã hội", text: "Social media can make young people feel anxious about how they look." },
  { topic: "Học ngoại ngữ", text: "The best way to improve your speaking is to practise with native speakers." },
];

/* ---------- Lưu tiến độ ---------- */

export type SpkAttempt = {
  at: number; qid: string; part: Part; question: string; transcript: string; seconds: number; wpm: number; pauses: number;
  levels: number[]; selfNote?: string; corrected?: string; paraphrase?: number; aiBand?: number;
};
const KEY = "studia-speaking-v1";
export function loadAttempts(): SpkAttempt[] { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
export function saveAttempts(a: SpkAttempt[]) { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-80))); } catch {} }
