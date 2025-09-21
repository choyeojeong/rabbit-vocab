// src/utils/vocab.js
import { supabase } from './supabaseClient';

/** 어떤 값이든 배열로 보장 */
export function ensureArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

/** 배열 셔플 (입력이 비배열이면 빈 배열) */
export function shuffle(arr) {
  if (!Array.isArray(arr)) return [];
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 랜덤 샘플 n개 (n > length면 전체 셔플) */
export function sampleN(arr, n) {
  const base = Array.isArray(arr) ? arr : [];
  const s = shuffle(base);
  return s.slice(0, Math.min(n, s.length));
}

/** accepted_ko 파싱 (; , | 모두 구분자로 인식) */
export function parseAccepted(str) {
  if (!str) return [];
  return str
    .split(/[,;|]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 책 목록(중복 제거) */
export async function fetchBooks() {
  const { data, error } = await supabase
    .from('vocab_words')
    .select('book')
    .order('book', { ascending: true });
  if (error) throw error;
  const uniq = Array.from(new Set((data || []).map((d) => d.book).filter(Boolean)));
  return uniq;
}

/** 특정 책의 챕터 목록(숫자 오름차순) */
export async function fetchChapters(book) {
  const { data, error } = await supabase
    .from('vocab_words')
    .select('chapter')
    .eq('book', book)
    .order('chapter', { ascending: true });
  if (error) throw error;
  const uniq = Array.from(new Set((data || []).map((d) => Number(d.chapter)).filter(Number.isFinite)))
    .sort((a, b) => a - b);
  return uniq;
}

/** 범위 내 단어 가져오기 (start/end 정규화) */
export async function fetchWordsInRange(book, start, end) {
  let s = parseInt(start, 10);
  let e = parseInt(end, 10);
  if (!Number.isFinite(s) || !Number.isFinite(e) || !book) return [];
  if (s > e) [s, e] = [e, s];

  const { data, error } = await supabase
    .from('vocab_words')
    .select('id, term_en, meaning_ko, pos, accepted_ko, chapter')
    .eq('book', book)
    .gte('chapter', s)
    .lte('chapter', e);
  if (error) throw error;
  return data || [];
}

/** 챕터 입력 파싱: "1-4, 7, 10" → [1,2,3,4,7,10] (항상 number[]) */
export function parseChapterInput(input) {
  if (input === undefined || input === null) return [];
  // 유니코드 정규화 + 기호 통일
  let s = String(input)
    .trim()
    .normalize('NFKC')
    .replace(/[–—~〜]/g, '-')   // en/em dash, 틸드 → 하이픈
    .replace(/[，、ㆍ]/g, ','); // CJK 쉼표/가운뎃점 → 콤마

  if (!s) return [];

  const tokens = s.split(',').map((t) => t.trim()).filter(Boolean);
  const out = new Set();

  for (const tok of tokens) {
    const m = tok.match(/^(\d+)\s*-\s*(\d+)$/); // 1-4, 10 - 12
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
        if (a > b) [a, b] = [b, a];
        for (let x = a; x <= b; x++) out.add(x);
      }
      continue;
    }
    const n = parseInt(tok, 10);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** 특정 책의 모든 단어(보기 후보용 풀) */
export async function fetchWordsInBook(book) {
  if (!book) return [];
  const { data, error } = await supabase
    .from('vocab_words')
    .select('id, term_en, meaning_ko, pos, accepted_ko, chapter')
    .eq('book', book);
  if (error) throw error;
  return data || [];
}

/** 특정 책에서 여러 챕터에 해당하는 단어들 불러오기 (chapters 어떤 형태든 OK) */
export async function fetchWordsByChapters(book, chapters = []) {
  if (!book) return [];
  const list = ensureArray(chapters)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
  if (list.length === 0) return [];

  const { data, error } = await supabase
    .from('vocab_words')
    .select('id, term_en, meaning_ko, pos, accepted_ko, chapter')
    .eq('book', book)
    .in('chapter', list);
  if (error) throw error;
  return data || [];
}

/** 같은 책/같은 품사에서 오답 2개 뽑기 (부족하면 범위 → 책 전체로 보완) */
export function buildMCQOptions(current, pool = [], rangePool = []) {
  const correct = current.meaning_ko;
  const pos = current.pos || null;

  const bookPool = ensureArray(pool);
  const range = ensureArray(rangePool);

  // 1순위: 책 전체에서 같은 품사 & 다른 단어
  let candidates = bookPool.filter(
    (w) => w && w.id !== current.id && (pos ? w.pos === pos : true)
  );

  // 2순위: 같은 범위에서 같은 품사
  if (candidates.length < 2) {
    const rangeCand = range.filter(
      (w) => w && w.id !== current.id && (pos ? w.pos === pos : true)
    );
    const ids = new Set(candidates.map((x) => x.id));
    for (const x of rangeCand) if (x && !ids.has(x.id)) candidates.push(x);
  }

  // 3순위: 책 전체 아무 품사
  if (candidates.length < 2) {
    const extra = bookPool.filter((w) => w && w.id !== current.id);
    const ids = new Set(candidates.map((x) => x.id));
    for (const x of extra) if (x && !ids.has(x.id)) candidates.push(x);
  }

  const wrongs = sampleN(
    Array.from(new Set(candidates.map((x) => x.meaning_ko))).filter((m) => m && m !== correct),
    2
  );

  const options = shuffle([correct, ...wrongs]);
  const answerIndex = options.indexOf(correct);
  return { options, answerIndex };
}
