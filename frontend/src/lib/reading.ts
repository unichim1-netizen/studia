/**
 * Luyện Reading: tách bài đọc thành đoạn/câu, rút từ khoá câu hỏi, quét vị trí trong bài, phân tích câu phức
 * thành các mệnh đề (kiểu Linearthinking), chấm đáp án và lưu tiến độ ở trình duyệt. Logic thuần, không đụng DOM.
 */

/* ---------- Tách bài đọc ---------- */

export type Para = { label: string | null; sentences: string[] };
export type Passage = { title: string; paras: Para[] };

const HEADER = /^(PASSAGE\s*\d+|READING PASSAGE\s*\d+|Reading|Passage \d+ below\.?)\s*$/i;
const SPEND = /^You should spend about \d+ minutes/i;
const LETTER = /^([A-J])\s*$/;
const LETTER_LEAD = /^([A-J])\s{1,3}(?=[A-Z‘'"“])/;

/**
 * Chuẩn hoá bài đọc lấy từ đề (nhiều bài trích từ PDF: xuống dòng cứng giữa câu, nhãn đoạn A–H đứng riêng một dòng,
 * có dòng hướng dẫn “You should spend about 20 minutes…”). Trả về tiêu đề và danh sách đoạn đã tách câu.
 */
export function parsePassage(raw: string): Passage {
  let lines = raw.replace(/\r/g, "").split("\n").map((l) => l.trim());
  // bỏ dòng tiêu đề phần và câu hướng dẫn (có thể vắt sang dòng sau)
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (HEADER.test(l)) continue;
    if (SPEND.test(l)) { if (!/below\.?\s*$/.test(l) && i + 1 < lines.length && /below\.?\s*$/.test(lines[i + 1])) i++; continue; }
    out.push(l);
  }
  lines = out;
  while (lines.length && !lines[0]) lines.shift();
  const title = (lines.shift() || "").replace(/^\*\*|\*\*$/g, "").trim();

  // độ dài dòng điển hình để nhận ra dòng cuối đoạn (ngắn hơn hẳn) trong văn bản xuống dòng cứng
  const lens = lines.filter((l) => l.length > 30).map((l) => l.length).sort((a, b) => a - b);
  const typical = lens.length > 5 ? lens[Math.floor(lens.length * 0.6)] : 0;
  const hardWrapped = lens.length > 8 && lines.filter((l) => !l).length < lines.length / 12;

  const blocks: { label: string | null; text: string }[] = [];
  let cur: { label: string | null; parts: string[] } = { label: null, parts: [] };
  const flush = () => {
    const text = cur.parts.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ label: cur.label, text });
    cur = { label: null, parts: [] };
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) { flush(); continue; }
    const m = l.match(LETTER);
    if (m) { flush(); cur.label = m[1]; continue; }
    const lead = l.match(LETTER_LEAD);
    if (lead && !cur.parts.length) { cur.label = lead[1]; cur.parts.push(l.slice(lead[0].length)); continue; }
    if (lead && (!cur.parts.length || /[.!?'"’”)]$/.test(cur.parts[cur.parts.length - 1]))) { flush(); cur.label = lead[1]; cur.parts.push(l.slice(lead[0].length)); continue; }
    cur.parts.push(l);
    // xuống dòng cứng: dòng kết thúc câu và ngắn hơn hẳn dòng thường → hết đoạn
    if (hardWrapped && typical && /[.!?'"’”)]$/.test(l) && l.length < typical * 0.72 && /^[A-Z‘'"“(]/.test(lines[i + 1] || "")) flush();
  }
  flush();
  // ghép phần chú thích kiểu "* Presbyterianism: …" vào cuối, không coi là đoạn chính
  const paras = blocks
    .filter((b) => !/^\*\s/.test(b.text))
    .map((b) => ({ label: b.label, sentences: splitSentences(b.text) }))
    .filter((p) => p.sentences.length);
  return { title, paras };
}

const ABBR = /\b(Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|vs|etc|e\.g|i\.e|approx|c|Co|Inc|Ltd|No|Fig|U\.S|U\.K)\.$/i;

/** Tách câu, giữ dấu câu; không cắt sau chữ viết tắt (Dr., e.g.), chữ cái đầu tên (J. Smith) hay số thập phân. */
export function splitSentences(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?]+(?:[.!?]+["'’”)\]]*|$)/g) || [];
  const out: string[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const prev = out[out.length - 1];
    if (prev && (ABBR.test(prev) || /\b[A-Z]\.$/.test(prev) || /\d\.$/.test(prev) && /^\d/.test(p) || /^[a-z]/.test(p))) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
}

/* ---------- Từ khoá ---------- */

export const STOP = new Set(("a an the and or but if then so than that this these those there their they them it its is are was were be been being am "
  + "of in on at to for from by with about into over after before under between through during without within against among "
  + "as not no nor do does did done have has had having can could will would shall should may might must "
  + "i you he she we his her our your my me him us who whom whose which what when where why how all any both each few more most "
  + "other some such only own same too very just also one two first new can't don't isn't wasn't aren't weren't doesn't didn't "
  + "s t up out off again further once here than whether while because although though however").split(" "));

/** Từ hay gặp trong câu hỏi nhưng không giúp định vị (từ của đề bài). */
const QUESTION_NOISE = new Set(("passage paragraph section writer author reviewer according statement statements following information "
  + "mention mentions mentioned refer refers reference describe describes described suggest suggests suggested state states stated "
  + "claim claims claimed believe believes say says said text reading reader article questions question answer "
  + "contain contains containing example examples include includes including give gives given discuss discusses discussing").split(" "));

/** Gốc từ gần đúng để so khớp: bỏ đuôi số nhiều, -ed, -ing, -ly… (đủ dùng cho việc quét, không phải stemmer chuẩn). */
export function stem(w: string): string {
  let s = w.toLowerCase().replace(/[’']s?$/, "");
  if (s.length <= 3) return s;
  for (const [suf, rep] of [["ies", "y"], ["ied", "y"], ["ying", "y"], ["ing", ""], ["edly", ""], ["ed", ""], ["ly", ""], ["es", ""], ["s", ""], ["ment", ""], ["ness", ""], ["ation", "ate"], ["ion", ""], ["al", ""], ["er", ""], ["est", ""]] as const) {
    if (s.endsWith(suf) && s.length - suf.length >= 4) { s = s.slice(0, -suf.length) + rep; break; }
  }
  return s.replace(/e$/, "");
}

export type KwKind = "name" | "number" | "content";
export type Keyword = { text: string; kind: KwKind };

export const KW_LABEL: Record<KwKind, string> = { name: "Tên riêng", number: "Số / năm", content: "Từ nội dung" };

/**
 * Rút từ khoá từ câu hỏi, chia ba loại theo độ dễ quét:
 * - tên riêng, cụm viết hoa: gần như giữ nguyên trong bài, quét nhanh nhất;
 * - số, năm, phần trăm: cũng giữ nguyên (đôi khi viết bằng chữ);
 * - từ nội dung: hay bị paraphrase (đổi từ đồng nghĩa), cần đọc kỹ quanh vị trí tìm được.
 */
export function questionKeywords(question: string): Keyword[] {
  // câu điền từ: chỉ lấy phần quanh chỗ trống nếu câu hỏi dính cả dòng ghi chú phía trước
  // đầu dòng / sau gạch đầu dòng coi như đầu câu (chữ hoa ở đó không phải tên riêng)
  let q = question.replace(/\s*\n\s*|\s*•\s*/g, ". ").replace(/\s+/g, " ").trim();
  const blank = q.search(/_{2,}|\b\d{1,2}\s*_{2,}/);
  if (blank > 120) q = q.slice(Math.max(0, blank - 120));
  q = q.replace(/\d{1,2}\s*_{2,}|_{2,}/g, " ");
  const out: Keyword[] = [];
  const seen = new Set<string>();
  const push = (text: string, kind: KwKind) => {
    const k = text.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text, kind });
  };
  // cụm trong ngoặc kép
  for (const m of Array.from(q.matchAll(/[‘'“"]([^‘'’“”"]{3,40})[’'”"]/g))) if (!/^s\b/.test(m[1])) push(m[1].trim(), "name");
  const toks: string[] = [];
  const initial: boolean[] = []; // từ đứng đầu câu / đầu dòng
  for (const m of Array.from(q.matchAll(/[A-Za-z][A-Za-z'’-]*|\d[\d,.]*%?/g))) {
    toks.push(m[0]);
    initial.push(/(^|[.!?:;]\s*)$/.test(q.slice(0, m.index)));
  }
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (/^\d/.test(t)) { push(t.replace(/[.,]$/, ""), "number"); i++; continue; }
    if (/^[A-Z]/.test(t)) {
      let j = i;
      const words: string[] = [];
      while (j < toks.length && (j === i || !initial[j]) && (/^[A-Z]/.test(toks[j]) || (words.length && /^(of|de|du|von|van|the|and)$/.test(toks[j]) && /^[A-Z]/.test(toks[j + 1] || "")))) words.push(toks[j++]);
      const phrase = words.join(" ").replace(/[’']s$/, "").replace(/^(The|A|An)\s+/, "");
      // một từ viết hoa ở đầu câu thường chỉ là từ thường (The, Most, Trains…): xử lý như từ nội dung
      if (!(initial[i] && words.length === 1) && !STOP.has(phrase.toLowerCase())) {
        if (!/^(TRUE|FALSE|NOT GIVEN|YES|NO)$/.test(phrase)) push(phrase, "name");
        i = j;
        continue;
      }
    }
    const lw = t.toLowerCase().replace(/[’']s$/, "");
    if (lw.length >= 4 && !STOP.has(lw) && !QUESTION_NOISE.has(lw)) push(lw, "content");
    i++;
  }
  // tên riêng, số lên trước
  const order: Record<KwKind, number> = { name: 0, number: 1, content: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 8);
}

const WORD = /[A-Za-z][A-Za-z'’-]*|\d[\d,.]*%?/g;

/** Từ khoá có xuất hiện trong câu không (so theo gốc từ; cụm nhiều từ thì cần đủ các từ có nghĩa). */
export function sentenceHas(sentence: string, kw: Keyword): boolean {
  const toks = (sentence.match(WORD) || []).map((t) => stem(t.replace(/[.,]$/, "")));
  const set = new Set(toks);
  const parts = (kw.text.match(WORD) || []).map((t) => t.replace(/[.,]$/, "")).filter((t) => !STOP.has(t.toLowerCase()));
  if (!parts.length) return false;
  return parts.every((p) => set.has(stem(p)));
}

/** Vị trí các lần khớp của từ khoá trong một câu, để tô màu: [start, end, kind]. */
export function matchRanges(sentence: string, kws: Keyword[]): [number, number, KwKind][] {
  const targets = new Map<string, KwKind>();
  for (const k of kws) for (const p of k.text.match(WORD) || []) if (!STOP.has(p.toLowerCase())) {
    const s = stem(p.replace(/[.,]$/, ""));
    if (!targets.has(s) || k.kind !== "content") targets.set(s, k.kind);
  }
  const out: [number, number, KwKind][] = [];
  for (const m of Array.from(sentence.matchAll(WORD))) {
    const word = m[0].replace(/[.,]+$/, "");
    const kind = targets.get(stem(word));
    if (kind) out.push([m.index as number, (m.index as number) + word.length, kind]);
  }
  return out;
}

export type Ref = { p: number; s: number };
export type Hit = Ref & { score: number; found: string[] };

const WEIGHT: Record<KwKind, number> = { name: 3, number: 3, content: 1 };

/**
 * Quét bài: chấm điểm từng câu theo số từ khoá có mặt (tên riêng, số nặng hơn từ thường), cộng điểm cho câu kề
 * để bắt trường hợp thông tin trải qua hai câu. Trả về các câu điểm cao nhất.
 */
export function scan(pass: Passage, kws: Keyword[], answer?: string, top = 3, onlyPara?: number): Hit[] {
  const hits: Hit[] = [];
  const ans = answer && !/^(TRUE|FALSE|NOT GIVEN|YES|NO|[A-J])$/i.test(answer.trim()) ? answer.trim().toLowerCase() : "";
  pass.paras.forEach((para, p) => para.sentences.forEach((sent, s) => {
    if (onlyPara != null && p !== onlyPara) return;
    const found = kws.filter((k) => sentenceHas(sent, k));
    let score = found.reduce((t, k) => t + WEIGHT[k.kind], 0);
    if (ans && sent.toLowerCase().includes(ans)) score += 6;
    if (score > 0) hits.push({ p, s, score, found: found.map((k) => k.text) });
  }));
  // câu kề cũng có từ khoá thì cộng nửa điểm của nhau
  const by = new Map(hits.map((h) => [`${h.p}:${h.s}`, h]));
  const bonus = hits.map((h) => ((by.get(`${h.p}:${h.s - 1}`)?.score ?? 0) + (by.get(`${h.p}:${h.s + 1}`)?.score ?? 0)) * 0.25);
  return hits.map((h, i) => ({ ...h, score: h.score + bonus[i] })).sort((a, b) => b.score - a.score || a.p - b.p || a.s - b.s).slice(0, top);
}

/**
 * Vị trí ước lượng của đáp án sau khi nộp bài. Dạng "Which paragraph/section contains…" có đáp án chính là nhãn đoạn,
 * nên chỉ tìm trong đoạn đó (không có câu nào khớp thì lấy câu đầu đoạn).
 */
export function estimateLocation(pass: Passage, q: Question, kws: Keyword[]): Hit | null {
  const ans = (q.correct_answer || "").trim();
  const byLabel = /^[A-J]$/.test(ans) && (q.options || []).length > 0 && (q.options || []).every((o) => /^[A-J]$/.test(o.trim()))
    ? pass.paras.findIndex((p) => p.label === ans) : -1;
  if (byLabel >= 0) return scan(pass, kws, undefined, 1, byLabel)[0] || { p: byLabel, s: 0, score: 0, found: [] };
  return scan(pass, kws, ans, 1)[0] || null;
}

/** Đoạn có chứa từ khoá (để người học biết nên quét đoạn nào), kèm số lần khớp. */
export function paragraphsWith(pass: Passage, kws: Keyword[]): { p: number; n: number }[] {
  return pass.paras.map((para, p) => ({ p, n: para.sentences.reduce((t, s) => t + kws.filter((k) => sentenceHas(s, k)).length, 0) })).filter((x) => x.n > 0);
}

/* ---------- Đọc lướt ---------- */

/** Từ khoá nổi bật của mỗi đoạn (xuất hiện nhiều trong đoạn, ít ở đoạn khác) + câu chủ đề (câu đầu). */
export function paragraphMap(pass: Passage, perPara = 4): { topic: string; keywords: string[] }[] {
  const tf = pass.paras.map((para) => {
    const m = new Map<string, { n: number; word: string }>();
    for (const s of para.sentences) for (const w of s.match(/[A-Za-z][A-Za-z'’-]+/g) || []) {
      const lw = w.toLowerCase();
      if (lw.length < 4 || STOP.has(lw)) continue;
      const k = stem(lw);
      const e = m.get(k) || { n: 0, word: /^[A-Z]/.test(w) && !s.startsWith(w) ? w : lw };
      e.n++;
      m.set(k, e);
    }
    return m;
  });
  const df = new Map<string, number>();
  for (const m of tf) for (const k of Array.from(m.keys())) df.set(k, (df.get(k) || 0) + 1);
  const N = pass.paras.length;
  return pass.paras.map((para, i) => ({
    topic: para.sentences[0],
    keywords: Array.from(tf[i].entries())
      .map(([k, e]) => ({ w: e.word, score: e.n * Math.log(1 + N / (df.get(k) || 1)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, perPara)
      .map((x) => x.w),
  }));
}

export const wordsIn = (pass: Passage) => pass.paras.reduce((t, p) => t + p.sentences.reduce((u, s) => u + s.split(/\s+/).length, 0), 0);

/* ---------- Phân tích câu (rút gọn câu phức) ---------- */

export type Rel = "contrast" | "cause" | "result" | "condition" | "time" | "relative" | "addition" | "purpose" | "example" | "compare" | "aside" | "concession";
export type Clause = { text: string; main: boolean; rel?: Rel; marker?: string };

export const REL_LABEL: Record<Rel, string> = {
  contrast: "Đối lập", concession: "Nhượng bộ", cause: "Nguyên nhân", result: "Kết quả", condition: "Điều kiện", time: "Thời gian",
  relative: "Bổ nghĩa", addition: "Bổ sung", purpose: "Mục đích", example: "Ví dụ", compare: "So sánh", aside: "Chú thích",
};

export const REL_HINT: Record<Rel, string> = {
  contrast: "Ý sau ngược với ý trước: đáp án thường nằm ở vế sau từ nối.",
  concession: "Thừa nhận một ý nhưng nhấn mạnh ý chính ở vế còn lại.",
  cause: "Giải thích lý do cho mệnh đề chính.",
  result: "Hệ quả của ý phía trước.",
  condition: "Ý chính chỉ đúng khi điều kiện này xảy ra: cẩn thận với câu TRUE/FALSE.",
  time: "Mốc thời gian cho mệnh đề chính.",
  relative: "Thông tin thêm về danh từ ngay trước: bỏ đi câu vẫn đủ nghĩa.",
  addition: "Thêm một ý cùng chiều.",
  purpose: "Mục đích của hành động.",
  example: "Ví dụ minh hoạ: ít khi là ý chính.",
  compare: "So sánh hai đối tượng: để ý chiều so sánh (hơn/kém).",
  aside: "Chú thích chen giữa: bỏ qua khi tìm ý chính.",
};

/** Từ nối đứng đầu mệnh đề → quan hệ với mệnh đề chính; cụm dài đặt trước để khớp trước. */
const MARKERS: [string, Rel][] = [
  ["even though", "concession"], ["although", "concession"], ["though", "concession"], ["despite", "concession"], ["in spite of", "concession"],
  ["whereas", "contrast"], ["however", "contrast"], ["but", "contrast"], ["yet", "contrast"], ["nevertheless", "contrast"], ["on the other hand", "contrast"], ["instead", "contrast"], ["while", "contrast"],
  ["because of", "cause"], ["because", "cause"], ["since", "cause"], ["due to", "cause"], ["owing to", "cause"], ["thanks to", "cause"],
  ["as a result", "result"], ["consequently", "result"], ["therefore", "result"], ["thus", "result"], ["hence", "result"], ["so that", "purpose"], ["so", "result"], ["leading to", "result"], ["resulting in", "result"],
  ["provided that", "condition"], ["as long as", "condition"], ["unless", "condition"], ["if", "condition"],
  ["whenever", "time"], ["when", "time"], ["before", "time"], ["after", "time"], ["until", "time"], ["once", "time"],
  ["in order to", "purpose"],
  ["for example", "example"], ["for instance", "example"], ["such as", "example"], ["including", "example"],
  ["rather than", "compare"], ["unlike", "compare"], ["compared with", "compare"], ["compared to", "compare"],
  ["in addition", "addition"], ["moreover", "addition"], ["furthermore", "addition"], ["as well as", "addition"], ["not only", "addition"], ["and", "addition"],
  ["which", "relative"], ["who", "relative"], ["whom", "relative"], ["whose", "relative"], ["where", "relative"],
];

function leadingMarker(s: string): [string, Rel] | null {
  const low = s.toLowerCase().replace(/^[\s,;:—–-]+/, "");
  for (const [m, r] of MARKERS) if (low === m || low.startsWith(m + " ") || low.startsWith(m + ",")) return [m, r];
  return null;
}

/**
 * Tách một câu phức thành các mệnh đề: cắt ở dấu phẩy/chấm phẩy/gạch ngang, ngoặc đơn, và trước từ nối chính
 * (although, because, which…) đứng giữa câu. Mệnh đề không mở đầu bằng từ nối phụ thuộc được coi là mệnh đề chính.
 * Trả về các mệnh đề và “câu lõi” (ghép các mệnh đề chính, bỏ chú thích, ví dụ, mệnh đề bổ nghĩa).
 */
export function analyzeSentence(sentence: string): { clauses: Clause[]; core: string } {
  const s = sentence.replace(/\s+/g, " ").trim();
  // tách phần chú thích trong ngoặc / giữa hai gạch ngang trước
  const asides: string[] = [];
  const body = s.replace(/\s*\(([^)]{2,})\)/g, (_m, a: string) => { asides.push(a); return ` ⟦${asides.length - 1}⟧`; })
    .replace(/\s+[—–-]\s+([^—–]{3,}?)\s+[—–-]\s+/g, (_m, a: string) => { asides.push(a); return ` ⟦${asides.length - 1}⟧ `; });
  // cắt ở dấu câu, rồi cắt trước từ nối phụ thuộc giữa câu (không cắt "and"/"so" giữa cụm danh từ ngắn)
  const SPLIT = /\s+(?=(?:although|though|even though|whereas|because|since|unless|provided that|whenever|which|who|whom|whose|while|despite|rather than|so that|in order to)\b)/i;
  const pieces: string[] = [];
  for (const chunk of body.split(/\s*[,;:]\s+|\s+[—–]\s+/)) {
    for (const part of chunk.split(SPLIT)) if (part.trim()) pieces.push(part.trim());
  }
  const clauses: Clause[] = [];
  let carry = "";        // cụm mở đầu ngắn (vd. "In 1846") chờ ghép vào mệnh đề sau
  let carryShort = false; // carry là cụm ngắn thường (không phải từ nối / cụm giới từ mở đầu)
  let listing = false;   // đang ở giữa một danh sách "A, B, and C"
  let tail: Clause | undefined; // mệnh đề nhận phần nối tiếp (phần tử danh sách, cụm ngắn)
  for (const raw of pieces) {
    // mảnh chỉ là chú thích đã tách
    const asideOnly = raw.match(/^⟦(\d+)⟧\.?$/);
    if (asideOnly) { clauses.push({ text: asides[Number(asideOnly[1])], main: false, rel: "aside" }); continue; }
    let text = raw.replace(/⟦(\d+)⟧/g, (_m, n: string) => { clauses.push({ text: asides[Number(n)], main: false, rel: "aside" }); return ""; }).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const origWords = text.split(" ").length;
    const hadCarry = !!carry;
    // chủ ngữ ngắn đang chờ ("The museum's newest exhibition") gặp mệnh đề có từ nối riêng: tách thành mệnh đề chính
    if (carry && carryShort && leadingMarker(text)) { clauses.push({ text: carry, main: true }); tail = clauses[clauses.length - 1]; carry = ""; }
    if (carry) { text = `${carry}${/(but|and|yet|so|or|rather)$/i.test(carry) ? " " : ", "}${text}`; carry = ""; }
    carryShort = false;
    const mk = leadingMarker(text);
    const words = text.split(" ").length;
    const last = clauses[clauses.length - 1];
    // từ nối liên kết câu đứng một mình ("However", "but rather"), cụm giới từ mở đầu câu ("Contrary to popular belief"),
    // hoặc cụm ngắn đi sau chúng ("However, in 1846"): ghép tiếp vào mảnh sau
    const bareLink = mk && /^(however|but|yet|so|and|therefore|thus|moreover|furthermore|nevertheless|instead|consequently|hence|in addition|as a result|on the other hand|for example|for instance)$/.test(mk[0])
      && /^(|rather|also|then|too)$/i.test(text.slice(mk[0].length).replace(/[,\s]+/g, " ").trim());
    const intro = !last && !mk && words <= 6 && /^(contrary to|according to|in|on|at|by|with|for|during|over|under|among|within|throughout|like|unlike|from|after|before)\b/i.test(text);
    if (!/[.!?]$/.test(text) && (bareLink || intro || (hadCarry && !last && origWords <= 3))) {
      carry = text;
      continue;
    }
    // cụm ngắn có từ nối chen giữa (", once fertile,"): chú thích
    if (mk && words <= 3 && last && !/[.!?]$/.test(text) && mk[1] !== "addition" && mk[1] !== "contrast") {
      clauses.push({ text, main: false, rel: "aside" });
      tail = clauses[clauses.length - 1];
      continue;
    }
    // đồng vị ngữ cuối câu (", the capital's historic centre."): cụm danh từ không có động từ → chú thích
    if (!mk && last && /^(the|a|an)\s/i.test(text) && /[.!?]$/.test(text) && words <= 10 && !/\b(is|are|was|were|be|been|has|have|had|do|does|did|can|could|will|would|should|may|might|must)\b|\w{3,}ed\b/i.test(text)) {
      clauses.push({ text, main: false, rel: "aside" });
      continue;
    }
    // ngay sau "such as / including X," là phần còn lại của danh sách ví dụ ("…such as Mumbai, Tokyo and Buenos Aires are…")
    if (!mk && tail && /\b(such as|including|like|e\.g\.)\s+\S+(\s+\S+){0,2}$/i.test(tail.text)) {
      tail.text += `, ${text}`;
      continue;
    }
    // sau mệnh đề bổ nghĩa / chú thích chen giữa, mảnh mở đầu bằng động từ ("draws on letters") là phần còn lại của mệnh đề chủ
    const host = [...clauses].reverse().find((c) => c.rel !== "relative" && c.rel !== "aside" && c.rel !== "example");
    const verbLead = /^(\w+ly\s+)?\w+(s|ed)\s+(on|in|at|to|from|with|for|by|the|a|an|that|how|what|its|their|his|her|up|out|into|about|over|more|less|no|not)\b/i.test(text)
      || /^(had|has|have|is|are|was|were|will|would|can|could|may|might|must|should|do|does|did)\b/i.test(text);
    if (!mk && !listing && verbLead && tail !== host && last && !last.main && (last.rel === "relative" || last.rel === "aside" || last.rel === "example") && host && !/[.!?]$/.test(host.text)) {
      host.text += ` … ${text}`;
      tail = host;
      continue;
    }
    // cụm giới từ giữa câu (", close to the place of harvest,", ", of sucrose…"): bổ ngữ của mệnh đề đang có
    if (!mk && tail && /^(of|in|on|at|by|with|for|from|close to|near|during|over|under|into|between|among|within|throughout|across|along|without|to)\b/i.test(text)) {
      tail.text += `, ${text}`;
      continue;
    }
    // cụm phân từ "-ing" giữa câu (", mostly taking place in…"): bổ nghĩa cho ý trước
    if (!mk && last && /^(\w+ly\s+)?\w{3,}ing\b/i.test(text)) {
      clauses.push({ text, main: false, rel: "relative" });
      tail = clauses[clauses.length - 1];
      continue;
    }
    // cụm ngắn không có từ nối: đầu câu thì chờ ghép vào mệnh đề sau; giữa câu thì là phần tử danh sách
    if (!mk && words <= 4) {
      if (!tail) { carry = text; carryShort = true; continue; }
      tail.text += `, ${text}`; listing = true; continue;
    }
    // "and/or X" kết thúc danh sách
    if (listing && mk && /^(and|or)$/.test(mk[0]) && tail) { tail.text += `, ${text}`; listing = false; continue; }
    listing = false;
    const coord = mk && (mk[1] === "addition" || mk[1] === "contrast" || mk[1] === "result") && /^(and|but|yet|so)$/.test(mk[0]);
    // "and/but/so" nối hai mệnh đề độc lập: vẫn là mệnh đề chính, chỉ ghi quan hệ
    clauses.push({ text, main: !mk || !!coord || ["however", "therefore", "thus", "consequently", "moreover", "furthermore", "nevertheless", "hence", "as a result", "in addition", "on the other hand", "instead"].includes(mk[0]), rel: mk?.[1], marker: mk?.[0] });
    tail = clauses[clauses.length - 1];
  }
  if (carry) clauses.push({ text: carry, main: true });
  if (clauses.length && !clauses.some((c) => c.main)) clauses[clauses.length - 1].main = true;
  const core = clauses.filter((c) => c.main).map((c) => c.text.replace(/^(and|but|yet|so|however|therefore|thus|moreover|furthermore|nevertheless|hence|consequently|instead),?\s+/i, "")).join("; ").replace(/[.!?]+$/, "") + ".";
  return { clauses, core: core.charAt(0).toUpperCase() + core.slice(1) };
}

/* ---------- Câu hỏi và chấm ---------- */

export type Question = {
  number: number; type: string; original_type?: string; question: string; options?: string[] | null; option_keys?: string[] | null;
  group_instruction?: string | null; group_title?: string | null; word_limit?: number | null; passage?: string;
  correct_answer?: string; accepted_answers?: string[];
};

export type QKind = "tfng" | "ynng" | "choice" | "fill";

export function kindOf(q: Question): QKind {
  const t = (q.original_type || q.type || "").toLowerCase();
  if (t.includes("yes_no")) return "ynng";
  if (t.includes("true_false")) return "tfng";
  if (q.options?.length || q.option_keys?.length) return "choice";
  return "fill";
}

export const KIND_LABEL: Record<QKind, string> = { tfng: "TRUE / FALSE / NOT GIVEN", ynng: "YES / NO / NOT GIVEN", choice: "Chọn đáp án / nối", fill: "Điền từ" };

/** Mẹo theo dạng câu hỏi, hiển thị trước khi làm. */
export const KIND_TIP: Record<QKind, string> = {
  tfng: "Câu hỏi đi theo thứ tự bài. Quét tên riêng/số để tìm vị trí, rồi so từng ý: trái ngược → FALSE, bài không nhắc tới → NOT GIVEN.",
  ynng: "Giống TRUE/FALSE nhưng hỏi quan điểm của tác giả: tìm động từ, tính từ thể hiện thái độ (argue, claim, unfortunately…).",
  choice: "Gạch từ khoá trong câu hỏi và từng phương án. Phương án dùng đúng từ trong bài thường là bẫy; đáp án đúng hay được paraphrase.",
  fill: "Đoán trước loại từ cần điền (danh từ, số…). Đáp án lấy nguyên văn từ bài, đúng giới hạn số từ, chính tả phải đúng.",
};

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[.,;:!?"“”]+$/g, "").replace(/\s+/g, " ").trim();
const ALIAS: Record<string, string> = { t: "true", f: "false", ng: "not given", "not-given": "not given", y: "yes", n: "no" };

export function isCorrect(q: Question, answer: string): boolean {
  const a = norm(answer);
  if (!a) return false;
  const acc = (q.accepted_answers?.length ? q.accepted_answers : q.correct_answer ? [q.correct_answer] : []).map(norm);
  const aa = ALIAS[a] || a;
  return acc.some((x) => {
    // đáp án dạng "(the) museum" hoặc "museum/gallery"
    const variants = x.split(/\s*\/\s*|\s+or\s+/).map((v) => v.replace(/\([^)]*\)\s*/g, "").trim());
    const full = x.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
    return aa === x || aa === full || variants.includes(aa) || (ALIAS[x] || x) === aa;
  });
}

/** Ước lượng band cho riêng một passage bằng cách quy về thang 40 câu (chỉ mang tính tham khảo). */
const BANDS: [number, number][] = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5]];
export function bandEstimate(correct: number, total: number): number | null {
  if (!total) return null;
  const scaled = Math.round((correct / total) * 40);
  return BANDS.find(([n]) => scaled >= n)?.[1] ?? 2;
}

/* ---------- Thời gian ---------- */

export const PASSAGE_MINUTES = 20;
export const SKIM_TARGET_SEC = 180;

/** Ngân sách thời gian cho mỗi câu sau khi trừ thời gian đọc lướt. */
export const perQuestionBudget = (n: number, totalSec = PASSAGE_MINUTES * 60, skimSec = SKIM_TARGET_SEC) => (n ? Math.round((totalSec - skimSec) / n) : 0);

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/* ---------- Lưu tiến độ ---------- */

export type Attempt = { at: number; correct: number; total: number; seconds: number; skimSec: number };
export type ReadStore = {
  passages: Record<string, { best: number; total: number; attempts: Attempt[] }>;
  kinds: Record<QKind, { n: number; ok: number }>;
  /** Thời gian trung bình định vị một câu (giây), để theo dõi tốc độ quét. */
  scanSec: { n: number; sum: number };
  settings: { minutes: number; strict: boolean };
  custom: string;
};

const KEY = "studia-reading-v1";
export const EMPTY_READ: ReadStore = {
  passages: {}, kinds: { tfng: { n: 0, ok: 0 }, ynng: { n: 0, ok: 0 }, choice: { n: 0, ok: 0 }, fill: { n: 0, ok: 0 } },
  scanSec: { n: 0, sum: 0 }, settings: { minutes: PASSAGE_MINUTES, strict: false }, custom: "",
};

export function loadRead(): ReadStore {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...EMPTY_READ, ...s, kinds: { ...EMPTY_READ.kinds, ...(s.kinds || {}) }, settings: { ...EMPTY_READ.settings, ...(s.settings || {}) } };
  } catch { return EMPTY_READ; }
}

export function saveRead(s: ReadStore) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

/** Ghi một lượt làm bài: điểm theo passage, độ chính xác theo dạng câu, tốc độ định vị. */
export function recordAttempt(store: ReadStore, id: string, a: Attempt, byKind: { kind: QKind; ok: boolean }[], scanTimes: number[]): ReadStore {
  const prev = store.passages[id];
  const kinds = { ...store.kinds };
  for (const { kind, ok } of byKind) kinds[kind] = { n: kinds[kind].n + 1, ok: kinds[kind].ok + (ok ? 1 : 0) };
  return {
    ...store,
    passages: { ...store.passages, [id]: { best: Math.max(prev?.best ?? 0, a.correct), total: a.total, attempts: [...(prev?.attempts ?? []), a].slice(-10) } },
    kinds,
    scanSec: { n: store.scanSec.n + scanTimes.length, sum: store.scanSec.sum + scanTimes.reduce((t, x) => t + x, 0) },
  };
}
