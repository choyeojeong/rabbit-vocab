// src/pages/PracticeMCQ.jsx
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  fetchWordsInRange,
  fetchWordsInBook,
  fetchWordsByChapters,
  parseChapterInput,
  buildMCQOptions,
  ensureArray,
} from '../utils/vocab';
import { supabase } from '../utils/supabaseClient';
import { getSession } from '../utils/session';
import { speakWord, speakCancel } from '../utils/speech';
import StudentShell from './StudentShell';

const COLORS = {
  bg: '#fff5f8',
  card: '#ffffff',
  text: '#1f2a44',
  sub: '#5d6b82',
  border: '#ffd3e3',
  pink: '#ff6fa3',
  pinkHover: '#ff3e8d',
  pinkSoft: '#fff0f5',
  blue: '#2b59ff',
  okBg: '#e7fff3',
  okBd: '#b3f0d0',
  badBg: '#ffe3ea',
  badBd: '#ffb8c9',
  danger: '#b00020',
};

const styles = {
  // ✅ 풀스크린 + 중앙 정렬(상단 붙는 문제 해결)
  pageWrap: {
    minHeight: '100dvh',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
    paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
    paddingLeft: 16,
    paddingRight: 16,
    background: COLORS.bg,
    color: COLORS.text,
  },

  // ✅ 화면 전체를 쓰되 너무 넓게 퍼지지 않게(원하면 900~1100으로 조정)
  container: {
    width: '100%',
    maxWidth: 720,
  },

  // ✅ 기존 흰 네모(topCard) 제거 → 투명/핑크Soft 패널로
  panel: {
    width: '100%',
    background: 'transparent',
    color: COLORS.text,
  },

  // 상단 정보 바(가벼운 패널)
  headBar: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: 12,
    background: 'rgba(255,255,255,0.35)',
    backdropFilter: 'blur(6px)',
  },

  // 문제/종료 섹션 패널(흰 카드 느낌 제거)
  section: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 16,
    padding: 16,
    background: COLORS.pinkSoft,
    boxShadow: '0 10px 24px rgba(255,111,163,.10)',
    color: COLORS.text,
  },

  termRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  term: {
    fontSize: 28,
    fontWeight: 900,
    color: COLORS.text,
    textAlign: 'center',
    letterSpacing: -0.2,
  },

  btns: { display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 14 },

  optBtn: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: `1px solid ${COLORS.border}`,
    background: 'rgba(255,255,255,0.55)', // ✅ 완전 흰색 제거
    cursor: 'pointer',
    textAlign: 'left',
    color: COLORS.text,
    fontWeight: 800,
    boxShadow: '0 8px 18px rgba(31,42,68,0.05)',
  },
  correct: { background: COLORS.okBg, borderColor: COLORS.okBd },
  wrong: { background: COLORS.badBg, borderColor: COLORS.badBd },

  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  info: { fontSize: 13, color: COLORS.sub, fontWeight: 800 },

  primaryBtn: {
    padding: '10px 14px',
    background: COLORS.pink,
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 10px 20px rgba(255,111,163,.20)',
  },
  primaryDisabled: { opacity: 0.6, cursor: 'not-allowed' },

  ghostBtn: {
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.55)',
    color: COLORS.text,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 10px 20px rgba(31,42,68,0.05)',
  },

  wrongItem: {
    padding: '10px 12px',
    borderRadius: 12,
    border: `1px solid ${COLORS.border}`,
    background: 'rgba(255,255,255,0.55)',
    marginTop: 10,
    color: COLORS.text,
  },
  tagWrong: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    background: COLORS.badBg,
    color: COLORS.danger,
    fontSize: 12,
    marginLeft: 6,
    fontWeight: 900,
    border: `1px solid ${COLORS.badBd}`,
  },
  btnRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 },

  speakerBtn: {
    border: `1px solid ${COLORS.border}`,
    background: 'rgba(255,255,255,0.6)',
    borderRadius: 12,
    padding: '8px 10px',
    cursor: 'pointer',
    boxShadow: '0 8px 18px rgba(255,111,163,.08)',
  },

  unlockBar: {
    background: 'rgba(255,255,255,0.55)',
    border: '1px dashed #ff9fc0',
    padding: '10px 12px',
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
    color: COLORS.text,
  },
  unlockBtn: {
    padding: '8px 12px',
    borderRadius: 10,
    border: '1px solid #ff9fc0',
    background: '#ffeff6',
    fontWeight: 900,
    cursor: 'pointer',
    color: COLORS.text,
    whiteSpace: 'nowrap',
  },
};

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

function SpeakerIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3 10v4h4l5 4V6L7 10H3zm13.5 2a4.5 4.5 0 0 0-3-4.243v8.486A4.5 4.5 0 0 0 16.5 12zm0-7a9.5 9.5 0 0 1 0 14m-3-12a7 7 0 0 1 0 10"
        fill="none"
        stroke={COLORS.pink}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * ✅ 입력 정규화
 * 1) 오답모드: loc.state.wrong_book_ids 존재 시
 * 2) 정규모드: loc.state.selections 또는 레거시 단일
 */
function normalizeInput({ locState, query }) {
  const wrongIds = ensureArray(locState?.wrong_book_ids).filter(Boolean);

  if (wrongIds.length) {
    return {
      mode: 'wrong',
      wrong_book_ids: wrongIds,
      selections: [],
      legacy: { book: '', chapters: [], start: NaN, end: NaN, _rawChaptersParam: '' },
    };
  }

  const qBook = query.get('book') || '';
  const qChapters = query.get('chapters');
  const qStart = query.get('start');
  const qEnd = query.get('end');

  const legacy = {
    book: locState?.book || qBook || '',
    chapters: (() => {
      const st = ensureArray(locState?.chapters);
      if (st?.length) return st;
      const parsed = parseChapterInput(qChapters);
      return parsed?.length ? parsed : [];
    })(),
    start: Number(qStart),
    end: Number(qEnd),
    _rawChaptersParam: qChapters || '',
  };

  const rawSelections = ensureArray(locState?.selections);

  if (rawSelections.length) {
    const normalized = rawSelections
      .map((s) => {
        const book = (s?.book || '').trim();
        if (!book) return null;
        const chaptersText = (s?.chaptersText ?? s?.chapters ?? '').toString().trim();
        const chapters = chaptersText ? parseChapterInput(chaptersText) : [];
        const start = Number(s?.start);
        const end = Number(s?.end);
        return { book, chaptersText, chapters, start, end, raw: s };
      })
      .filter(Boolean);

    if (normalized.length) return { mode: 'multi', selections: normalized, legacy, wrong_book_ids: [] };
  }

  if (!legacy.book) return { mode: 'none', selections: [], legacy, wrong_book_ids: [] };

  return {
    mode: 'single',
    selections: [
      {
        book: legacy.book,
        chaptersText: legacy._rawChaptersParam || '',
        chapters: legacy.chapters,
        start: legacy.start,
        end: legacy.end,
        raw: null,
      },
    ],
    legacy,
    wrong_book_ids: [],
  };
}

function selectionToText(sel, legacyRawChaptersParam = '') {
  const book = sel.book;
  const chapters = ensureArray(sel.chapters)
    .filter((n) => Number.isFinite(Number(n)))
    .map(Number);
  const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

  if (chapters.length) return `${book} (${sel.chaptersText || chapters.join(', ')})`;
  if (legacyRawChaptersParam && !chapters.length) return `${book} (${legacyRawChaptersParam})`;
  if (hasRange) return `${book} (${Math.min(sel.start, sel.end)}~${Math.max(sel.start, sel.end)}강)`;
  return `${book}`;
}

/**
 * ✅ 오답 단어 로드 (FIXED)
 * - wrong_book_items 스키마에는 book/chapter 컬럼이 없음
 * - meaning_ko가 비어있는 경우 vocab_words로 폴백해서 채움
 */
async function fetchWrongWords(wrongBookIds) {
  const ids = ensureArray(wrongBookIds).filter(Boolean);
  if (!ids.length) return [];

  const { data: items, error: e1 } = await supabase
    .from('wrong_book_items')
    .select('wrong_book_id, word_id, term_en, meaning_ko, pos, accepted_ko')
    .in('wrong_book_id', ids)
    .order('created_at', { ascending: true });

  if (e1) {
    console.warn('[wrong_book_items select fail]', e1);
    return [];
  }

  const rows = items || [];
  if (!rows.length) return [];

  const needFillIds = rows
    .filter((r) => !r?.meaning_ko || String(r.meaning_ko).trim() === '')
    .map((r) => r.word_id)
    .filter(Boolean);

  let vocabMap = new Map();
  if (needFillIds.length) {
    const uniq = Array.from(new Set(needFillIds));
    const chunkSize = 200;
    for (let i = 0; i < uniq.length; i += chunkSize) {
      const slice = uniq.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('vocab_words')
        .select('id, book, chapter, term_en, meaning_ko, pos, accepted_ko')
        .in('id', slice);
      if (error) {
        console.warn('[vocab_words fallback fail]', error);
        continue;
      }
      for (const w of data || []) vocabMap.set(w.id, w);
    }
  }

  const normalized = rows
    .map((r) => {
      const vw = vocabMap.get(r.word_id);
      const term_en = r.term_en || vw?.term_en || '';
      const meaning_ko = r.meaning_ko || vw?.meaning_ko || '';
      const pos = r.pos ?? vw?.pos ?? null;
      const accepted_ko = r.accepted_ko ?? vw?.accepted_ko ?? null;

      return {
        id: r.word_id || null,
        word_id: r.word_id || null,
        term_en,
        meaning_ko,
        pos,
        accepted_ko,
        book: vw?.book || '오답',
        chapter: vw?.chapter ?? null,
      };
    })
    .filter((w) => w.term_en && w.meaning_ko);

  return normalized;
}

export default function PracticeMCQ() {
  const nav = useNavigate();
  const loc = useLocation();
  const q = useQuery();

  const me = getSession();

  const originMode = loc?.state?.mode === 'official' ? 'official' : 'practice';
  const backToRangePath = originMode === 'official' ? '/official' : '/study';

  const input = useMemo(() => {
    return normalizeInput({ locState: loc.state, query: q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.state, loc.search]);

  const mode = input.mode;
  const selections = input.selections || [];
  const legacy = input.legacy || {};
  const wrongBookIds = input.wrong_book_ids || [];

  const [phase, setPhase] = useState('play'); // 'play' | 'done'
  const [words, setWords] = useState([]);
  const [i, setI] = useState(0);
  const [opts, setOpts] = useState([]);
  const [ansIdx, setAnsIdx] = useState(-1);
  const [chosen, setChosen] = useState(-1);
  const [score, setScore] = useState(0);
  const [wrongs, setWrongs] = useState([]);

  const [loading, setLoading] = useState(true);
  const [bookPools, setBookPools] = useState({});

  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('sound_enabled') === 'true';
  });

  const current = words[i];

  const headerText = useMemo(() => {
    if (mode === 'none') return '';
    if (mode === 'wrong') return `오답 파일 ${wrongBookIds.length}개 선택`;
    const list = selections.map((s) => selectionToText(s, legacy._rawChaptersParam)).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return `${list.length}권 선택: ${list.join(' / ')}`;
  }, [mode, selections, legacy._rawChaptersParam, wrongBookIds.length]);

  const currentMetaText = (() => {
    const b = current?.book || '';
    const ch = Number.isFinite(Number(current?.chapter)) ? `${current.chapter}강` : '';
    return [b, ch].filter(Boolean).join(' | ');
  })();

  useEffect(() => {
    if (!me?.id) {
      alert('로그인이 필요합니다. 다시 로그인해 주세요.');
      nav('/');
    }
  }, [me, nav]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);

        if (mode === 'none') {
          if (mounted) {
            setWords([]);
            setBookPools({});
          }
          return;
        }

        if (mode === 'wrong') {
          const list = await fetchWrongWords(wrongBookIds);
          if (!mounted) return;

          const normalized = (list || []).map((w) => ({ ...w, book: w.book || '오답' }));

          setWords(normalized);
          setBookPools({});
          setI(0);
          setScore(0);
          setChosen(-1);
          setWrongs([]);
          setPhase('play');
          return;
        }

        if (!selections.length) {
          if (mounted) {
            setWords([]);
            setBookPools({});
          }
          return;
        }

        const chunks = [];
        for (const sel of selections) {
          const book = sel.book;
          const chapters = ensureArray(sel.chapters)
            .filter((n) => Number.isFinite(Number(n)))
            .map(Number);
          const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

          let range = [];
          if (chapters.length > 0) range = await fetchWordsByChapters(book, chapters);
          else if (hasRange) range = await fetchWordsInRange(book, sel.start, sel.end);

          chunks.push(...(range || []).map((w) => ({ ...w, book: w.book || book })));
        }

        if (!mounted) return;

        setWords(chunks || []);
        setI(0);
        setScore(0);
        setChosen(-1);
        setWrongs([]);
        setPhase('play');

        const uniqueBooks = Array.from(new Set(selections.map((s) => s.book).filter(Boolean)));
        const poolMap = {};

        for (const b of uniqueBooks) {
          try {
            const pool = await fetchWordsInBook(b);
            poolMap[b] = pool && pool.length ? pool.map((w) => ({ ...w, book: w.book || b })) : [];
          } catch (e) {
            console.warn('MCQ: book pool load failed for', b, e);
            poolMap[b] = [];
          }
        }

        const byBookFromChunks = {};
        for (const w of chunks || []) {
          const b = w.book || '';
          if (!b) continue;
          if (!byBookFromChunks[b]) byBookFromChunks[b] = [];
          byBookFromChunks[b].push(w);
        }

        for (const b of uniqueBooks) {
          if (!poolMap[b] || poolMap[b].length === 0) {
            poolMap[b] = byBookFromChunks[b] || [];
          }
        }

        if (!mounted) return;
        setBookPools(poolMap);
      } catch (e) {
        console.error('MCQ: load failed', e);
        if (!mounted) return;
        setWords([]);
        setBookPools({});
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [mode, selections, legacy._rawChaptersParam, wrongBookIds]);

  useEffect(() => {
    if (!current) return;

    if (mode === 'wrong') {
      if (!words || words.length === 0) return;
      const { options, answerIndex } = buildMCQOptions(current, words, words);
      setOpts(options);
      setAnsIdx(answerIndex);
      setChosen(-1);
      return;
    }

    const b = current?.book;
    const pool = b && bookPools[b] && bookPools[b].length ? bookPools[b] : [];
    const effectivePool = pool.length ? pool : words;
    if (!effectivePool || effectivePool.length === 0) return;

    const { options, answerIndex } = buildMCQOptions(current, effectivePool, words);
    setOpts(options);
    setAnsIdx(answerIndex);
    setChosen(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, i, current?.id, current?.book, words.length, Object.keys(bookPools).length]);

  useEffect(() => {
    if (!current?.term_en) return;
    if (!soundEnabled) return;
    speakWord(current.term_en);
    return () => speakCancel();
  }, [current?.id, soundEnabled]);

  async function record() {
    return;
  }

  async function choose(idx) {
    if (chosen >= 0 || phase !== 'play') return;
    setChosen(idx);

    const correct = idx === ansIdx;
    if (correct) setScore((s) => s + 1);
    else setWrongs((w) => [...w, { word: current, your: opts[idx], correct: opts[ansIdx] }]);

    await record(correct ? 'got_right' : 'got_wrong');
  }

  function next() {
    if (phase !== 'play') return;
    if (i + 1 >= words.length) {
      setPhase('done');
      return;
    }
    setI((x) => x + 1);
  }

  async function enableSoundOnce() {
    try {
      try {
        window.speechSynthesis?.resume?.();
      } catch {}
      try {
        window.speechSynthesis?.cancel?.();
      } catch {}
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          if (ctx.state === 'suspended') await ctx.resume();
          const buffer = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          src.start(0);
        }
      } catch {}

      setSoundEnabled(true);
      localStorage.setItem('sound_enabled', 'true');
      if (current?.term_en) speakWord(current.term_en);
    } catch (e) {
      console.warn('enableSoundOnce fail', e);
    }
  }

  // ✅ 잘못된 접근
  if (mode === 'none') {
    return (
      <StudentShell>
        <div style={styles.pageWrap}>
          <div style={styles.container}>
            <div style={styles.section}>잘못된 접근입니다.</div>
          </div>
        </div>
      </StudentShell>
    );
  }

  // ✅ 로딩
  if (loading) {
    return (
      <StudentShell>
        <div style={styles.pageWrap}>
          <div style={styles.container}>
            <div style={styles.section}>(불러오는 중…)</div>
          </div>
        </div>
      </StudentShell>
    );
  }

  // ✅ 단어 없음
  if (!words.length) {
    return (
      <StudentShell>
        <div style={styles.pageWrap}>
          <div style={styles.container}>
            <div style={styles.section}>
              {mode === 'wrong' ? '선택한 오답 파일에 단어가 없어요.' : '선택한 범위에 단어가 없어요.'}
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={styles.primaryBtn} onClick={() => nav(backToRangePath)}>
                  범위 다시 선택
                </button>
                <button type="button" style={styles.ghostBtn} onClick={() => nav('/dashboard')}>
                  대시보드
                </button>
              </div>
            </div>
          </div>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell>
      {/* ✅ 중앙 + 풀스크린 */}
      <div style={styles.pageWrap}>
        <div style={styles.container}>
          <div style={styles.panel}>
            {/* 🔊 소리 안내 */}
            {!soundEnabled && (
              <div style={styles.unlockBar}>
                <div style={{ fontSize: 13, color: COLORS.text, fontWeight: 800 }}>
                  모바일에서는 자동재생이 차단될 수 있어요. <b>소리 켜기</b>를 한 번 눌러주세요.
                </div>
                <button type="button" onClick={enableSoundOnce} style={styles.unlockBtn}>
                  🔊 소리 켜기(한번)
                </button>
              </div>
            )}

            {/* 진행 정보 */}
            <div style={styles.headBar}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 900 }}>
                    {headerText || (selections[0] ? selectionToText(selections[0], legacy._rawChaptersParam) : '')}
                  </div>
                  {currentMetaText && (
                    <div style={{ fontSize: 12, color: COLORS.sub, marginTop: 2, fontWeight: 700 }}>
                      현재: {currentMetaText}
                    </div>
                  )}
                </div>
                <div style={{ whiteSpace: 'nowrap', fontWeight: 900, color: COLORS.text }}>
                  {phase === 'play' ? `${i + 1}/${words.length}` : `${words.length}문제 완료`} | 점수 {score}
                </div>
              </div>
            </div>

            {/* 문제 */}
            {phase === 'play' && (
              <div style={{ ...styles.section, marginTop: 14 }}>
                <div style={styles.termRow}>
                  <div style={styles.term}>{current?.term_en}</div>
                  <button
                    type="button"
                    aria-label="발음 듣기"
                    title="발음 듣기"
                    style={styles.speakerBtn}
                    onClick={() => current?.term_en && speakWord(current.term_en)}
                  >
                    <SpeakerIcon />
                  </button>
                </div>

                <div style={styles.btns}>
                  {opts.map((op, idx) => {
                    const picked = chosen === idx;
                    const isCorrect = idx === ansIdx;

                    let st = { ...styles.optBtn };
                    if (chosen >= 0) {
                      if (isCorrect) st = { ...st, ...styles.correct };
                      else if (picked && !isCorrect) st = { ...st, ...styles.wrong };
                    }

                    return (
                      <button key={idx} type="button" onClick={() => choose(idx)} style={st}>
                        {idx + 1}. {op}
                      </button>
                    );
                  })}
                </div>

                <div style={styles.footer}>
                  <div style={styles.info}>
                    {chosen >= 0
                      ? chosen === ansIdx
                        ? '정답! 🐰'
                        : `오답 😿  정답: ${opts[ansIdx]}`
                      : '보기 중 하나를 선택하세요.'}
                  </div>
                  <button
                    type="button"
                    style={{ ...styles.primaryBtn, ...(chosen < 0 ? styles.primaryDisabled : null) }}
                    onClick={next}
                    disabled={chosen < 0}
                  >
                    다음
                  </button>
                </div>
              </div>
            )}

            {/* 종료 */}
            {phase === 'done' && (
              <div style={{ ...styles.section, marginTop: 14 }}>
                <div style={{ fontWeight: 900, color: COLORS.text }}>
                  연습 종료! 점수: {score} / {words.length}
                </div>

                {wrongs.length > 0 ? (
                  <>
                    <div style={{ marginTop: 12, fontWeight: 900, color: COLORS.text }}>오답 목록 (정답 포함)</div>
                    {wrongs.map((w, idx) => (
                      <div key={idx} style={styles.wrongItem}>
                        <div style={{ color: COLORS.text }}>
                          <b>
                            {idx + 1}. {w.word.term_en}
                          </b>
                          <span style={styles.tagWrong}>오답</span>
                          {w.word?.book && (
                            <span style={{ marginLeft: 8, fontSize: 12, color: COLORS.sub, fontWeight: 700 }}>
                              ({w.word.book}
                              {Number.isFinite(Number(w.word.chapter)) ? ` ${w.word.chapter}강` : ''})
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: 4, color: COLORS.text, fontWeight: 700 }}>정답: {w.correct}</div>
                        <div style={{ color: COLORS.text, fontWeight: 700 }}>내 답: {w.your || '(무응답)'}</div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ marginTop: 12, color: COLORS.text, fontWeight: 900 }}>
                    오답이 없어요. 훌륭해요! 🐰
                  </div>
                )}

                <div style={styles.btnRow}>
                  <button type="button" style={styles.primaryBtn} onClick={() => nav(backToRangePath)}>
                    범위 선택으로
                  </button>
                  <button type="button" style={styles.ghostBtn} onClick={() => nav('/dashboard')}>
                    대시보드
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
