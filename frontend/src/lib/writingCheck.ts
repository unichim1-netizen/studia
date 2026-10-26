/**
 * Soát bài Writing ngay trên trình duyệt (không cần AI): cấu trúc 4 đoạn, độ dài, chép đề, lặp từ, từ nối,
 * văn phong, độ dài câu và các lỗi ngữ pháp/từ vựng phổ biến của người Việt. Kèm khung dàn ý và nhận dạng dạng đề Task 2.
 */

export type Task = "task1" | "task2";

/* ---------- Dạng đề và dàn ý ---------- */

export type EssayType = "opinion" | "discussion" | "advantages" | "problem" | "two_part" | "unknown";

export const ESSAY_LABEL: Record<EssayType, string> = {
  opinion: "Nêu quan điểm (agree/disagree)", discussion: "Thảo luận hai quan điểm", advantages: "Ưu và nhược điểm",
  problem: "Nguyên nhân / vấn đề và giải pháp", two_part: "Câu hỏi hai phần", unknown: "Chưa rõ dạng đề",
};

/** Câu luận điểm cần có trong mở bài, theo dạng đề. */
export const THESIS_HINT: Record<EssayType, string> = {
  opinion: "Nêu rõ bạn đồng ý / không đồng ý ở mức nào ngay trong mở bài, và giữ nguyên quan điểm đến kết bài.",
  discussion: "Giới thiệu cả hai quan điểm và cho biết bạn nghiêng về bên nào (nếu đề hỏi ý kiến).",
  advantages: "Cho biết bài sẽ bàn cả ưu và nhược; nếu đề hỏi “outweigh” thì phải nói bên nào lớn hơn.",
  problem: "Báo trước bài sẽ nêu nguyên nhân/vấn đề rồi đến giải pháp.",
  two_part: "Trả lời ngắn gọn cả hai câu hỏi ngay trong mở bài; mỗi thân bài trả lời một câu.",
  unknown: "Viết lại đề bằng từ của bạn và nêu hướng trả lời trong mở bài.",
};

export function essayType(prompt: string): EssayType {
  const p = prompt.toLowerCase();
  if (/discuss both|both (these )?views|both sides/.test(p)) return "discussion";
  if (/advantages?.*disadvantages?|outweigh|benefits?.*drawbacks?/.test(p)) return "advantages";
  if (/to what extent|agree or disagree|do you agree/.test(p)) return "opinion";
  if (/(problems?|causes?|reasons?).*(solutions?|measures?|solve|tackle|be done)/.test(p)) return "problem";
  if ((p.match(/\?/g) || []).length >= 2) return "two_part";
  if (/positive or negative|good or bad/.test(p)) return "opinion";
  return "unknown";
}

export type OutlinePart = { id: string; title: string; hint: string; frames: string[] };

/** Khung dàn ý 4 đoạn: Task 1 đi từ tổng quan (overview) xuống chi tiết; Task 2 theo Idea – Explanation – Example. */
export function outlineFor(task: Task, type: EssayType): OutlinePart[] {
  if (task === "task1") return [
    { id: "intro", title: "Mở bài", hint: "Viết lại đề bằng từ của bạn (đối tượng, nơi chốn, thời gian). Không chép nguyên câu đề.", frames: ["The chart illustrates…", "The diagram gives information about…"] },
    { id: "overview", title: "Tổng quan", hint: "2–3 đặc điểm nổi bật nhất (xu hướng chung, cao nhất/thấp nhất, giai đoạn chính). Không đưa số liệu chi tiết.", frames: ["Overall, …", "It is clear that…", "In general, the most noticeable feature is…"] },
    { id: "body1", title: "Thân bài 1", hint: "Nhóm số liệu thứ nhất, có số liệu và so sánh cụ thể.", frames: ["In 2000, … accounted for…", "…, compared with…", "…rose sharply to…"] },
    { id: "body2", title: "Thân bài 2", hint: "Nhóm số liệu còn lại hoặc giai đoạn còn lại, tiếp tục so sánh.", frames: ["By contrast, …", "Meanwhile, …", "…remained stable at…"] },
  ];
  const bodies: Record<EssayType, [string, string]> = {
    opinion: ["Lý do chính ủng hộ quan điểm của bạn", "Lý do thứ hai (hoặc phản bác ý ngược lại)"],
    discussion: ["Quan điểm thứ nhất và lý do người ta nghĩ vậy", "Quan điểm thứ hai, kèm ý kiến của bạn"],
    advantages: ["Ưu điểm", "Nhược điểm"],
    problem: ["Nguyên nhân / vấn đề", "Giải pháp tương ứng"],
    two_part: ["Trả lời câu hỏi thứ nhất", "Trả lời câu hỏi thứ hai"],
    unknown: ["Ý chính thứ nhất", "Ý chính thứ hai"],
  };
  const iee = "Idea (câu chủ đề) → Explanation (giải thích vì sao) → Example (ví dụ cụ thể).";
  return [
    { id: "intro", title: "Mở bài", hint: `Viết lại đề + câu luận điểm. ${THESIS_HINT[type]}`, frames: ["It is often argued that…", "This essay will argue that…", "In my opinion, …"] },
    { id: "body1", title: `Thân bài 1: ${bodies[type][0]}`, hint: iee, frames: ["The main reason is that…", "This is because…", "For example, …"] },
    { id: "body2", title: `Thân bài 2: ${bodies[type][1]}`, hint: iee, frames: ["On the other hand, …", "As a result, …", "A good illustration of this is…"] },
    { id: "concl", title: "Kết bài", hint: "Nhắc lại quan điểm và tóm tắt hai ý chính. Không đưa ý mới.", frames: ["In conclusion, …", "To sum up, although…, I believe…"] },
  ];
}

/** Gợi ý chia thời gian (phút) cho mỗi task. */
export const TIME_PLAN: Record<Task, { total: number; steps: [string, number][] }> = {
  task1: { total: 20, steps: [["Đọc đề, tìm đặc điểm chính", 3], ["Viết", 14], ["Soát lỗi", 3]] },
  task2: { total: 40, steps: [["Phân tích đề, lập dàn ý", 5], ["Viết", 30], ["Soát lỗi", 5]] },
};
export const MIN_WORDS: Record<Task, number> = { task1: 150, task2: 250 };

/* ---------- Tiện ích ---------- */

export const countWords = (t: string) => (t.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
export const paragraphsOf = (t: string) => t.replace(/\r/g, "").split(/\n\s*\n|\n(?=\s{2,}|\t)/).map((p) => p.trim()).filter(Boolean);
export function sentencesOf(t: string): string[] {
  return (t.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || []).map((s) => s.trim()).filter((s) => countWords(s) > 0);
}

const STOP = new Set(("a an the and or but if so of in on at to for from by with about into over after before under between through during "
  + "as is are was were be been being am do does did have has had can could will would shall should may might must "
  + "i you he she we they it me him her us them my your his its our their this that these those there here not no "
  + "which who whom whose what when where why how all any both each few more most other some such only own same than too very "
  + "also just one two can't don't isn't it's").split(" "));

/** Từ hay bị lặp và gợi ý thay thế. */
export const SYNONYMS: Record<string, string[]> = {
  important: ["crucial", "essential", "vital", "significant"], good: ["beneficial", "positive", "valuable", "favourable"],
  bad: ["harmful", "detrimental", "negative", "damaging"], big: ["substantial", "considerable", "major", "large-scale"],
  increase: ["rise", "grow", "climb", "go up"], decrease: ["fall", "decline", "drop", "go down"],
  show: ["illustrate", "indicate", "reveal", "demonstrate"], people: ["individuals", "citizens", "the public", "residents"],
  think: ["believe", "argue", "maintain", "consider"], problem: ["issue", "challenge", "difficulty", "concern"],
  help: ["assist", "support", "enable", "facilitate"], many: ["numerous", "a large number of", "a great deal of", "countless"],
  thing: ["factor", "aspect", "element", "issue"], get: ["obtain", "gain", "acquire", "receive"],
  make: ["create", "produce", "generate", "lead to"], use: ["utilise", "employ", "make use of", "rely on"],
  change: ["shift", "transformation", "alteration", "fluctuate"], number: ["figure", "amount", "proportion", "quantity"],
  very: ["extremely", "highly", "remarkably", "considerably"], benefit: ["advantage", "merit", "gain", "upside"],
  government: ["the authorities", "policymakers", "the state", "officials"], children: ["young people", "youngsters", "minors", "the younger generation"],
  society: ["the community", "the public", "modern life", "communities"], job: ["occupation", "career", "profession", "employment"],
};

/** Nhóm từ nối, để xem bài dùng đa dạng chưa. */
export const LINKERS: Record<string, string[]> = {
  "Bổ sung": ["moreover", "furthermore", "in addition", "additionally", "besides", "also"],
  "Đối lập": ["however", "nevertheless", "on the other hand", "in contrast", "by contrast", "whereas", "although", "while", "despite", "yet"],
  "Nguyên nhân / kết quả": ["because", "since", "therefore", "as a result", "consequently", "thus", "hence", "due to", "leads to", "this means"],
  "Ví dụ": ["for example", "for instance", "such as", "a case in point", "to illustrate"],
  "Kết luận": ["in conclusion", "to sum up", "overall", "in summary", "to conclude"],
  "Trình tự": ["firstly", "first", "secondly", "finally", "then", "subsequently", "meanwhile", "after that"],
};

/* ---------- Kết quả soát ---------- */

export type Level = "ok" | "warn" | "bad";
export type Finding = { level: Level; title: string; detail: string; quote?: string; fix?: string };
export type CheckResult = {
  words: number; minWords: number; paragraphs: { text: string; words: number }[]; sentences: number;
  avgSentence: number; longSentences: string[];
  structure: Finding[]; vocabulary: Finding[]; grammar: Finding[]; style: Finding[];
  repeated: { word: string; n: number; alt: string[] }[];
  linkers: { group: string; used: string[] }[];
  promptOverlap: number;
};

/** Lỗi hay gặp: [mẫu, sửa thành, giải thích]. Mẫu là regex không phân biệt hoa thường, áp dụng trên từng câu. */
const RULES: [RegExp, string, string, "grammar" | "vocabulary" | "style"][] = [
  [/\b(\w+) \1\b/i, "bỏ từ lặp", "Một từ bị gõ hai lần liền nhau.", "grammar"],
  [/\ba ([aeio]\w+)/i, "an $1", "Dùng “an” trước từ bắt đầu bằng nguyên âm.", "grammar"],
  [/\ban ([bcdfgjklmnpqrstvwxz]\w+)/i, "a $1", "Dùng “a” trước từ bắt đầu bằng phụ âm (trừ âm h câm như “an hour”).", "grammar"],
  [/\bmore (better|worse|bigger|smaller|easier|harder|higher|lower|cheaper|faster)\b/i, "$1", "So sánh hơn đã có đuôi -er, không thêm “more”.", "grammar"],
  [/\bmost (best|worst|biggest|easiest|highest|lowest)\b/i, "$1", "So sánh nhất đã có sẵn, không thêm “most”.", "grammar"],
  [/\bpeople (is|was|has)\b/i, "people are/were/have", "“People” là danh từ số nhiều.", "grammar"],
  [/\b(it|he|she|this) (create|make|have|do|go|cause|need|want|become|seem|lead|help|give|take|mean|allow|provide|affect|show|increase|reduce)\b(?! to\b)/i, "thêm -s/-es (vd. it creates, it has)", "Chủ ngữ số ít ở hiện tại đơn thì động từ thêm -s/-es.", "grammar"],
  [/\b(informations|advices|knowledges|researches|equipments|furnitures|homeworks|evidences|feedbacks|traffics)\b/i, "dạng không đếm được (information, advice…)", "Danh từ không đếm được, không thêm -s.", "grammar"],
  [/\b(discuss|emphasise|emphasize|mention) about\b/i, "$1", "Động từ này không đi với “about”.", "grammar"],
  [/\bdespite of\b/i, "despite / in spite of", "“Despite” không đi với “of”.", "grammar"],
  [/\bin the other hand\b/i, "on the other hand", "Cụm cố định là “on the other hand”.", "grammar"],
  [/\baccording to me\b/i, "in my opinion / I believe", "“According to me” không tự nhiên trong văn viết học thuật.", "style"],
  [/\b(although|though)\b[^.]*,\s*but\b/i, "bỏ “but”", "Đã có “although” thì không dùng thêm “but” trong cùng câu.", "grammar"],
  [/\bbecause\b[^.]*,\s*so\b/i, "bỏ “so”", "Đã có “because” thì không dùng thêm “so”.", "grammar"],
  [/\b(can|could|should|must|will|would|may|might) (to \w+|(?!(?:always|sometimes|perhaps|nevertheless|thus|less|this|its|his|towards|news|series|means|as|us|has been|is)\b)(?:\w+ied|\w{2,}[^e\W]ed|has|does|goes|\w+[^su\W]s))\b/i, "động từ nguyên mẫu sau động từ khuyết thiếu", "Sau can/should/must… là động từ nguyên mẫu không “to”, không chia.", "grammar"],
  [/\bthe (society|nature|people in general)\b/i, "$1 (không “the”)", "“Society/nature” mang nghĩa chung thường không dùng “the”.", "grammar"],
  [/\b(lots of|a lot of)\b/i, "many / much / a large number of", "Hơi thân mật; trong bài học thuật nên dùng many, much, a great deal of.", "vocabulary"],
  [/\b(kids?)\b/i, "children / a child", "Từ thân mật.", "vocabulary"],
  [/\b(stuff|things like that|and so on|etc\.?)\b/i, "liệt kê cụ thể", "Mơ hồ, nên nêu rõ ví dụ.", "vocabulary"],
  [/\b(gonna|wanna|gotta)\b/i, "going to / want to / have to", "Văn nói, không dùng trong bài viết.", "style"],
  [/\b(don't|doesn't|didn't|can't|won't|isn't|aren't|wasn't|weren't|it's|that's|there's|I'm|they're|we're|I've|shouldn't|wouldn't)\b/i, "viết đầy đủ (do not, cannot…)", "Bài học thuật không dùng dạng viết tắt.", "style"],
  [/^(and|but|so)\b/i, "Moreover / However / Therefore", "Không nên mở đầu câu bằng and/but/so trong bài học thuật.", "style"],
  [/\bnowadays,? (in modern society|in today's world)\b/i, "chọn một cụm", "Lặp ý “ngày nay”.", "style"],
  [/(^|[.!?]\s+)i\b/, "I", "Đại từ “I” luôn viết hoa.", "grammar"],
  [/^[a-z][a-z']*/, "viết hoa chữ cái đầu", "Đầu câu phải viết hoa.", "grammar"],
];

const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tỉ lệ cụm 4 từ của bài trùng với đề (đo mức chép đề trong mở bài). */
function ngramOverlap(a: string, b: string, n = 4): number {
  const toks = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) || [];
  const grams = (t: string[]) => { const g = new Set<string>(); for (let i = 0; i + n <= t.length; i++) g.add(t.slice(i, i + n).join(" ")); return g; };
  const A = grams(toks(a)), B = grams(toks(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((g) => { if (B.has(g)) hit++; });
  return hit / A.size;
}

export function checkEssay(task: Task, prompt: string, essay: string): CheckResult {
  const minWords = MIN_WORDS[task];
  const words = countWords(essay);
  const paras = paragraphsOf(essay).map((text) => ({ text, words: countWords(text) }));
  const sents = sentencesOf(essay);
  const lower = essay.toLowerCase();
  const structure: Finding[] = [], vocabulary: Finding[] = [], grammar: Finding[] = [], style: Finding[] = [];

  /* Độ dài và cấu trúc */
  if (words < minWords) structure.push({ level: "bad", title: `Thiếu ${minWords - words} từ`, detail: `Tối thiểu ${minWords} từ; viết thiếu bị trừ điểm tiêu chí ${task === "task1" ? "Task Achievement" : "Task Response"}.` });
  else if (words > minWords * 1.6) structure.push({ level: "warn", title: `Bài khá dài (${words} từ)`, detail: "Viết quá dài dễ hết giờ và sinh thêm lỗi. Khoảng " + (task === "task1" ? "170–200" : "270–320") + " từ là vừa." });
  else structure.push({ level: "ok", title: `Độ dài ổn (${words} từ)`, detail: "" });

  if (paras.length < 3) structure.push({ level: "bad", title: `Chỉ có ${paras.length} đoạn`, detail: "Nên chia 4 đoạn (mở bài – 2 thân bài – kết bài/tổng quan), mỗi đoạn cách nhau một dòng trống." });
  else if (paras.length !== 4) structure.push({ level: "warn", title: `Có ${paras.length} đoạn`, detail: "Cấu trúc 4 đoạn dễ kiểm soát nhất. Nhiều đoạn quá ngắn làm mạch bài rời rạc." });
  else structure.push({ level: "ok", title: "Đủ 4 đoạn", detail: "" });

  const tiny = paras.filter((p, i) => p.words < (i === 0 || i === paras.length - 1 ? 25 : 45) && paras.length > 1);
  if (tiny.length) structure.push({ level: "warn", title: `${tiny.length} đoạn quá ngắn`, detail: "Thân bài nên có câu chủ đề, giải thích và ví dụ (khoảng 70–100 từ).", quote: tiny[0].text.slice(0, 120) });

  if (task === "task1") {
    if (!/\b(overall|in general|generally|it is clear that|the most (noticeable|striking))\b/.test(lower))
      structure.push({ level: "bad", title: "Chưa thấy đoạn tổng quan (overview)", detail: "Task 1 bắt buộc có câu tổng quan nêu xu hướng chính (thường mở đầu bằng “Overall, …”). Thiếu overview khó vượt band 5 tiêu chí Task Achievement." });
    if (/\b(i think|i believe|in my opinion|i feel)\b/.test(lower)) structure.push({ level: "bad", title: "Có ý kiến cá nhân", detail: "Task 1 chỉ mô tả số liệu, không nêu quan điểm." });
    if (!/\d/.test(essay)) structure.push({ level: "warn", title: "Không có số liệu", detail: "Thân bài Task 1 cần dẫn số liệu cụ thể để so sánh (nếu đề có số liệu)." });
  } else {
    const intro = (paras[0]?.text || "").toLowerCase();
    const type = essayType(prompt);
    if ((type === "opinion" || type === "discussion" || type === "advantages") && !/\b(i (strongly )?(believe|agree|disagree|think|feel|would argue)|in my (view|opinion)|this essay will|i am convinced|outweigh)\b/.test(intro))
      structure.push({ level: "warn", title: "Mở bài chưa rõ quan điểm", detail: THESIS_HINT[type] });
    const last = (paras[paras.length - 1]?.text || "").toLowerCase();
    if (paras.length >= 3 && !/\b(in conclusion|to (sum up|conclude)|in summary|overall|all in all)\b/.test(last))
      structure.push({ level: "warn", title: "Kết bài chưa có tín hiệu kết luận", detail: "Mở đầu đoạn cuối bằng “In conclusion, …” và nhắc lại quan điểm." });
    const bodies = paras.slice(1, -1);
    const noExample = bodies.filter((b) => !/\b(for (example|instance)|such as|a case in point|to illustrate|in (vietnam|my country)|research|stud(y|ies)|survey|%|\d{4})\b/i.test(b.text));
    if (bodies.length && noExample.length) structure.push({ level: "warn", title: `${noExample.length} thân bài chưa có ví dụ`, detail: "Theo I-E-E, mỗi thân bài cần một ví dụ cụ thể (số liệu, trường hợp thực tế, kinh nghiệm).", quote: noExample[0].text.slice(0, 120) });
  }

  /* Chép đề */
  const promptOverlap = prompt.trim() ? ngramOverlap(paras[0]?.text || "", prompt) : 0;
  if (promptOverlap > 0.35) structure.push({ level: "bad", title: `Mở bài chép đề ${Math.round(promptOverlap * 100)}%`, detail: "Giám khảo không tính các cụm chép nguyên văn từ đề. Hãy viết lại bằng từ đồng nghĩa và đổi cấu trúc câu." });
  else if (promptOverlap > 0.18) structure.push({ level: "warn", title: `Mở bài trùng đề ${Math.round(promptOverlap * 100)}%`, detail: "Thử diễn đạt lại nhiều hơn (đổi từ loại, chủ động ↔ bị động)." });

  /* Lặp từ */
  const freq = new Map<string, number>();
  for (const w of lower.match(/[a-z]+(?:'[a-z]+)?/g) || []) {
    if (w.length < 4 || STOP.has(w)) continue;
    const base = w.replace(/(ies)$/, "y").replace(/(es|s)$/, "").replace(/(ing|ed)$/, "");
    freq.set(base, (freq.get(base) || 0) + 1);
  }
  const limit = Math.max(3, Math.round(words / 70));
  const repeated = Array.from(freq.entries())
    .filter(([w, n]) => n > limit || (SYNONYMS[w] && n >= 3))
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([w, n]) => ({ word: w, n, alt: SYNONYMS[w] || [] }));
  if (repeated.length) vocabulary.push({ level: repeated[0].n > limit + 2 ? "bad" : "warn", title: `Lặp từ: ${repeated.slice(0, 4).map((r) => `${r.word} ×${r.n}`).join(", ")}`, detail: "Lặp từ nhiều làm giảm điểm Lexical Resource. Xem gợi ý thay thế bên dưới (chọn từ hợp ngữ cảnh)." });
  const ttr = new Set(lower.match(/[a-z]+/g) || []).size / Math.max(1, words);
  if (words > 80) vocabulary.push(ttr < 0.42 ? { level: "warn", title: "Vốn từ chưa đa dạng", detail: `Tỉ lệ từ khác nhau ${Math.round(ttr * 100)}%. Thử dùng cụm từ (collocation) và từ đồng nghĩa.` } : { level: "ok", title: "Vốn từ khá đa dạng", detail: `Tỉ lệ từ khác nhau ${Math.round(ttr * 100)}%.` });

  /* Từ nối */
  const linkers = Object.entries(LINKERS).map(([group, list]) => ({ group, used: list.filter((l) => new RegExp(`\\b${rx(l)}\\b`, "i").test(essay)) }));
  const missingGroups = linkers.filter((l) => !l.used.length && l.group !== "Trình tự" && !(task === "task1" && l.group === "Ví dụ"));
  if (missingGroups.length >= 2) style.push({ level: "warn", title: "Từ nối còn ít", detail: `Chưa dùng nhóm: ${missingGroups.map((g) => g.group).join(", ")}. Từ nối rõ ràng giúp điểm Coherence & Cohesion.` });
  const overused = (essay.match(/\b(moreover|furthermore|in addition|however|firstly|secondly)\b/gi) || []).length;
  if (overused > Math.max(5, sents.length / 2)) style.push({ level: "warn", title: "Lạm dụng từ nối đầu câu", detail: "Dùng từ nối ở hầu hết các câu nghe máy móc; hãy nối ý bằng đại từ, mệnh đề quan hệ." });

  /* Câu */
  const lens = sents.map(countWords);
  const avgSentence = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const longSentences = sents.filter((s) => countWords(s) > 38);
  if (longSentences.length) grammar.push({ level: "warn", title: `${longSentences.length} câu quá dài`, detail: "Câu trên ~38 từ dễ sai cấu trúc; tách thành 2 câu.", quote: longSentences[0].slice(0, 160) });
  if (avgSentence && avgSentence < 11 && sents.length > 5) grammar.push({ level: "warn", title: "Câu ngắn và đơn giản", detail: "Thêm câu phức (although, which, if, because) để tăng điểm Grammatical Range." });
  const complex = sents.filter((s) => /\b(although|though|whereas|while|which|who|whose|if|unless|because|since|when|that)\b/i.test(s)).length;
  if (sents.length > 4) grammar.push(complex / sents.length < 0.3
    ? { level: "warn", title: "Ít câu phức", detail: `${complex}/${sents.length} câu có mệnh đề phụ. Nên có khoảng một nửa.` }
    : { level: "ok", title: "Có đa dạng câu phức", detail: `${complex}/${sents.length} câu có mệnh đề phụ.` });
  const starts = new Map<string, number>();
  for (const s of sents) { const w = (s.match(/^[A-Za-z']+/)?.[0] || "").toLowerCase(); if (w) starts.set(w, (starts.get(w) || 0) + 1); }
  const sameStart = Array.from(starts.entries()).find(([w, n]) => n >= 4 && !["the"].includes(w));
  if (sameStart) style.push({ level: "warn", title: `${sameStart[1]} câu mở đầu bằng “${sameStart[0]}”`, detail: "Đổi cách mở câu cho đa dạng." });

  /* Quy tắc lỗi phổ biến */
  const seen = new Set<string>();
  for (const s of sents) {
    for (const [re, fix, why, cat] of RULES) {
      const m = s.match(re);
      if (!m) continue;
      // "a" trước từ như "university", "one", "user" đọc là /j/, /w/; "an" trước "hour", "honest"
      if (/^a [aeio]/i.test(m[0]) && /^a (one|once|euro|use)/i.test(m[0])) continue;
      if (/^an /i.test(m[0]) && /^an (h(our|onest|onou?r|eir)|[A-Z]{2,})/i.test(m[0])) continue;
      if (/^(\w+) \1$/i.test(m[0]) && /^(that that|had had)$/i.test(m[0])) continue;
      const key = `${why}|${m[0].toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const target = cat === "grammar" ? grammar : cat === "vocabulary" ? vocabulary : style;
      target.push({ level: cat === "grammar" ? "bad" : "warn", title: `“${m[0]}”`, detail: why, quote: s.length > 160 ? `${s.slice(0, 160)}…` : s, fix: m[0].replace(re, fix) });
    }
  }
  if (/\bi (think|believe)\b/gi.test(essay) && (essay.match(/\bi (think|believe)\b/gi) || []).length >= 3) style.push({ level: "warn", title: "Lặp “I think / I believe”", detail: "Dùng thêm: It could be argued that…, There is a strong case for…, From my perspective…" });

  return { words, minWords, paragraphs: paras, sentences: sents.length, avgSentence, longSentences, structure, vocabulary, grammar, style, repeated, linkers, promptOverlap };
}

/* ---------- Bản nháp và lịch sử ---------- */

export type WritingHistory = { at: number; task: Task; words: number; band: number | null; seconds: number; promptHead: string }[];
const HKEY = "studia_writing_history";
export function loadHistory(): WritingHistory { try { return JSON.parse(localStorage.getItem(HKEY) || "[]"); } catch { return []; } }
export function pushHistory(e: WritingHistory[number]) { try { localStorage.setItem(HKEY, JSON.stringify([...loadHistory(), e].slice(-30))); } catch {} }
