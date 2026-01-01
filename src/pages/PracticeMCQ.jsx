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

const styles = {
  card: { border: '1px solid #ffd3e3', borderRadius: 12, padding: 20 },
  termRow: { display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginBottom: 8 },
  term: { fontSize: 28, fontWeight: 900, color: '#333', textAlign: 'center' },
  btns: { display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 16 },
  opt: { padding: '12px 14px', borderRadius: 10, border: '1px solid #ffd3e3', background: '#fff', cursor: 'pointer', textAlign: 'left', color: '#000' },
  correct: { background: '#e7fff3', borderColor: '#b3f0d0' },
  wrong: { background: '#ffe3ea', borderColor: '#ffb8c9' },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  next: { padding: '10px 14px', background: '#ff8fb7', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' },
  info: { fontSize: 13, color: '#777' },
  wrongItem: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ffd3e3', background: '#fff', marginTop: 10 },
  tagWrong: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#ffe3ea', color: '#b00020', fontSize: 12, marginLeft: 6 },
  btnRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 },
  speakerBtn: { border: '1px solid #ffd0e1', background: '#fff5f8', borderRadius: 12, padding: '8px 10px', cursor: 'pointer' },
  unlockBar: { background:'#fff0f5', border:'1px dashed #ff9fc0', padding:'10px 12px', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:12 },
  unlockBtn: { padding:'8px 12px', borderRadius:10, border:'1px solid #ff9fc0', background:'#ffeff6', fontWeight:700, cursor:'pointer' },
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
        stroke="#ff6fa3"
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

  // ✅ 오답 모드 우선
  if (wrongIds.length) {
    return {
      mode: 'wrong',
      wrong_book_ids: wrongIds,
      selections: [],
      legacy: { book: '', chapters: [], start: NaN, end: NaN, _rawChaptersParam: '' },
    };
  }

  // ----- 기존(정규) 로직 -----
  const qBook = query.get('book') || '';
  const qChapters = query.get('chapters'); // "4-8,10,12"
  const qStart = query.get('start');
  const qEnd = query.get('end');

  const legacy = {
    book: (locState?.book) || qBook || '',
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

  // ✅ 다중 selections 우선
  if (rawSelections.length) {
    const normalized = rawSelections
      .map((s) => {
        const book = (s?.book || '').trim();
        if (!book) return null;

        // BookRangePage는 chaptersText를 넘김
        const chaptersText = (s?.chaptersText ?? s?.chapters ?? '').toString().trim();
        const chapters = chaptersText ? parseChapterInput(chaptersText) : [];

        const start = Number(s?.start);
        const end = Number(s?.end);

        return {
          book,
          chaptersText,
          chapters,
          start,
          end,
          raw: s,
        };
      })
      .filter(Boolean);

    if (normalized.length) return { mode: 'multi', selections: normalized, legacy, wrong_book_ids: [] };
  }

  // 레거시 단일
  if (!legacy.book) return { mode: 'none', selections: [], legacy, wrong_book_ids: [] };
  return {
    mode: 'single',
    selections: [{
      book: legacy.book,
      chaptersText: legacy._rawChaptersParam || '',
      chapters: legacy.chapters,
      start: legacy.start,
      end: legacy.end,
      raw: null
    }],
    legacy,
    wrong_book_ids: []
  };
}

// 표시용: 각 selection 요약 텍스트
function selectionToText(sel, legacyRawChaptersParam = '') {
  const book = sel.book;
  const chapters = ensureArray(sel.chapters).filter((n) => Number.isFinite(Number(n))).map(Number);
  const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

  if (chapters.length) return `${book} (${sel.chaptersText || chapters.join(', ')})`;
  if (legacyRawChaptersParam && !chapters.length) return `${book} (${legacyRawChaptersParam})`;
  if (hasRange) return `${book} (${Math.min(sel.start, sel.end)}~${Math.max(sel.start, sel.end)}강)`;
  return `${book}`;
}

/**
 * ✅ 오답 단어 로드
 * - 1차: wrong_book_items에서 단어 정보를 직접 가져오려고 시도
 * - 2차(폴백): wrong_book_items에 word_id만 있을 수도 있으니 vocab_words로 재조회
 */
async function fetchWrongWords(wrongBookIds) {
  const ids = ensureArray(wrongBookIds).filter(Boolean);
  if (!ids.length) return [];

  // 1) wrong_book_items에서 가능한 컬럼을 최대한 뽑아본다
  const { data: items, error: e1 } = await supabase
    .from('wrong_book_items')
    .select('wrong_book_id, word_id, term_en, meaning_ko, book, chapter, pos, accepted_ko')
    .in('wrong_book_id', ids);

  if (e1) {
    console.warn('[wrong_book_items select fail]', e1);
    return [];
  }

  const rows = items || [];

  // 이미 term_en/meaning_ko가 들어있으면 그걸로 사용
  const hasFull = rows.some(r => (r?.term_en && r?.meaning_ko));
  if (hasFull) {
    return rows
      .map((r) => ({
        id: r.word_id || r.id || null,
        word_id: r.word_id || null,
        term_en: r.term_en,
        meaning_ko: r.meaning_ko,
        book: r.book || '오답',
        chapter: r.chapter ?? null,
        pos: r.pos ?? null,
        accepted_ko: r.accepted_ko ?? null,
      }))
      .filter(w => w.term_en && w.meaning_ko);
  }

  // 2) 폴백: word_id만 있다면 vocab_words에서 가져온다
  const wordIds = Array.from(new Set(rows.map(r => r.word_id).filter(Boolean)));
  if (!wordIds.length) return [];

  // IN이 너무 길어질 수 있으니 chunk
  const chunkSize = 200;
  const out = [];
  for (let i = 0; i < wordIds.length; i += chunkSize) {
    const slice = wordIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('vocab_words')
      .select('id, book, chapter, term_en, meaning_ko, pos, accepted_ko')
      .in('id', slice);
    if (error) {
      console.warn('[vocab_words fallback fail]', error);
      continue;
    }
    out.push(...(data || []));
  }
  return out.map(w => ({ ...w, word_id: w.id }));
}

export default function PracticeMCQ() {
  const nav = useNavigate();
  const loc = useLocation();
  const q = useQuery();

  const me = getSession();

  const input = useMemo(() => {
    return normalizeInput({ locState: loc.state, query: q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.state, loc.search]);

  const mode = input.mode;
  const selections = input.selections || [];
  const legacy = input.legacy || {};
  const wrongBookIds = input.wrong_book_ids || [];

  const [phase, setPhase] = useState('play'); // 'play' | 'done'
  const [words, setWords] = useState([]);     // 문제로 낼 단어들(합쳐진 배열)
  const [i, setI] = useState(0);
  const [opts, setOpts] = useState([]);
  const [ansIdx, setAnsIdx] = useState(-1);
  const [chosen, setChosen] = useState(-1);
  const [score, setScore] = useState(0);
  const [wrongs, setWrongs] = useState([]);

  // ✅ 로딩 상태(단어 없어요 깜빡임 방지)
  const [loading, setLoading] = useState(true);

  // book별 보기 풀: { [book]: word[] }
  const [bookPools, setBookPools] = useState({});

  // 🔊 모바일 오디오 unlock 상태
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('sound_enabled') === 'true';
  });

  const current = words[i];

  // 상단 표시 텍스트
  const headerText = useMemo(() => {
    if (mode === 'none') return '';
    if (mode === 'wrong') return `오답 파일 ${wrongBookIds.length}개 선택`;
    const list = selections.map((s) => selectionToText(s, legacy._rawChaptersParam)).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return `${list.length}권 선택: ${list.join(' / ')}`;
  }, [mode, selections, legacy._rawChaptersParam, wrongBookIds.length]);

  // 훅 안전: 가벼운 계산은 그냥
  const currentMetaText = (() => {
    const b = current?.book || '';
    const ch = Number.isFinite(Number(current?.chapter)) ? `${current.chapter}강` : '';
    return [b, ch].filter(Boolean).join(' | ');
  })();

  /**
   * ✅ 데이터 로딩
   * - 오답 모드: wrong_book_items → words
   * - 정규 모드: selections 기반 words + bookPools
   */
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);

        // 0) 잘못된 접근
        if (mode === 'none') {
          if (mounted) {
            setWords([]);
            setBookPools({});
          }
          return;
        }

        // ✅ 1) 오답 모드
        if (mode === 'wrong') {
          const list = await fetchWrongWords(wrongBookIds);

          if (!mounted) return;

          const normalized = (list || []).map((w) => ({
            ...w,
            book: w.book || '오답',
          }));

          setWords(normalized);
          setBookPools({});
          setI(0);
          setScore(0);
          setChosen(-1);
          setWrongs([]);
          setPhase('play');
          return;
        }

        // ✅ 2) 정규 모드(기존)
        if (!selections.length) {
          if (mounted) {
            setWords([]);
            setBookPools({});
          }
          return;
        }

        // 2-1) selections별 문제 단어 로드 후 합치기
        const chunks = [];
        for (const sel of selections) {
          const book = sel.book;
          const chapters = ensureArray(sel.chapters).filter((n) => Number.isFinite(Number(n))).map(Number);
          const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

          let range = [];
          if (chapters.length > 0) range = await fetchWordsByChapters(book, chapters);
          else if (hasRange) range = await fetchWordsInRange(book, sel.start, sel.end);

          const withBook = (range || []).map((w) => ({
            ...w,
            book: w.book || book,
          }));

          chunks.push(...withBook);
        }

        if (!mounted) return;

        setWords(chunks || []);
        setI(0);
        setScore(0);
        setChosen(-1);
        setWrongs([]);
        setPhase('play');

        // 2-2) bookPools 로드 (각 book 전체 풀)
        const uniqueBooks = Array.from(new Set(selections.map((s) => s.book).filter(Boolean)));
        const poolMap = {};

        for (const b of uniqueBooks) {
          try {
            const pool = await fetchWordsInBook(b);
            poolMap[b] = (pool && pool.length)
              ? pool.map((w) => ({ ...w, book: w.book || b }))
              : [];
          } catch (e) {
            console.warn('MCQ: book pool load failed for', b, e);
            poolMap[b] = [];
          }
        }

        // 풀 비었으면(로드 실패) 해당 book의 문제 range에서라도 풀백
        const byBookFromChunks = {};
        for (const w of (chunks || [])) {
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

    return () => { mounted = false; };
  }, [mode, selections, legacy._rawChaptersParam, wrongBookIds]);

  // 보기 생성
  useEffect(() => {
    if (!current) return;

    // ✅ 오답 모드: words 전체를 풀로 사용
    if (mode === 'wrong') {
      if (!words || words.length === 0) return;
      const { options, answerIndex } = buildMCQOptions(current, words, words);
      setOpts(options);
      setAnsIdx(answerIndex);
      setChosen(-1);
      return;
    }

    // 정규 모드: 현재 문제의 book 풀로 보기 만들기
    const b = current?.book;
    const pool = (b && bookPools[b] && bookPools[b].length) ? bookPools[b] : [];
    const effectivePool = pool.length ? pool : words;
    if (!effectivePool || effectivePool.length === 0) return;

    const { options, answerIndex } = buildMCQOptions(current, effectivePool, words);
    setOpts(options);
    setAnsIdx(answerIndex);
    setChosen(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, i, current?.id, current?.book, Object.keys(bookPools).length, words.length]);

  // 문제 변경 시 자동 발음
  useEffect(() => {
    if (!current?.term_en) return;
    if (!soundEnabled) return;
    speakWord(current.term_en);
    return () => speakCancel();
  }, [current?.id, soundEnabled]);

  // ✅ 연습/오답연습은 DB 기록(오답 저장)하지 않음
  async function record(action) {
    return;
  }

  async function choose(idx) {
    if (chosen >= 0 || phase !== 'play') return;
    setChosen(idx);

    const correct = idx === ansIdx;
    if (correct) setScore((s) => s + 1);
    else setWrongs((w) => [...w, { word: current, your: opts[idx], correct: opts[ansIdx] }]);

    // ✅ 기록 안 함
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

  // 🔊 오디오 잠금 해제
  async function enableSoundOnce() {
    try {
      try { window.speechSynthesis?.resume?.(); } catch {}
      try { window.speechSynthesis?.cancel?.(); } catch {}
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

  // 잘못된 접근
  if (mode === 'none') {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
          <div className="student-container">
            <div className="student-card">잘못된 접근입니다.</div>
          </div>
        </div>
      </StudentShell>
    );
  }

  // 로딩 중
  if (loading) {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
          <div className="student-container">
            <div className="student-card">불러오는 중…</div>
          </div>
        </div>
      </StudentShell>
    );
  }

  // 단어 없음
  if (!words.length) {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
          <div className="student-container">
            <div className="student-card">
              {mode === 'wrong'
                ? '선택한 오답 파일에 단어가 없어요.'
                : '선택한 범위에 단어가 없어요.'}
            </div>
          </div>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
        <div className="student-container">
          {/* 🔊 소리 켜기(한번) 안내 바 */}
          {!soundEnabled && (
            <div className="student-card" style={styles.unlockBar} role="region" aria-label="소리 사용 안내">
              <div style={{fontSize:13, color:'#444'}}>
                모바일에서는 자동재생이 차단될 수 있어요. <b>소리 켜기</b>를 한 번 눌러주세요.
              </div>
              <button type="button" onClick={enableSoundOnce} style={styles.unlockBtn}>
                🔊 소리 켜기(한번)
              </button>
            </div>
          )}

          <div className="student-card" style={{ marginTop: 12 }}>
            {/* 진행 정보 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', color:'#444', fontSize:13, gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {headerText || (selections[0] ? selectionToText(selections[0], legacy._rawChaptersParam) : '')}
                </div>
                {currentMetaText && (
                  <div style={{ fontSize:12, color:'#777', marginTop:2 }}>
                    현재: {currentMetaText}
                  </div>
                )}
              </div>
              <div style={{ whiteSpace:'nowrap' }}>
                {phase === 'play' ? `${i + 1}/${words.length}` : `${words.length}문제 완료`} | 점수 {score}
              </div>
            </div>

            {/* 문제 카드 */}
            {phase === 'play' && (
              <div style={styles.card}>
                {/* 영어 단어 + 스피커 버튼 */}
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

                {/* 보기(뜻) */}
                <div style={styles.btns}>
                  {opts.map((op, idx) => {
                    const picked = chosen === idx;
                    const isCorrect = idx === ansIdx;
                    let st = styles.opt;
                    if (chosen >= 0) {
                      if (isCorrect) st = { ...st, ...styles.correct };
                      else if (picked && !isCorrect) st = { ...st, ...styles.wrong };
                    }
                    return (
                      <button key={idx} onClick={() => choose(idx)} style={st}>
                        {idx + 1}. {op}
                      </button>
                    );
                  })}
                </div>

                <div style={styles.footer}>
                  <div style={styles.info}>
                    {chosen >= 0
                      ? (chosen === ansIdx ? '정답!' : `오답 😿  정답: ${opts[ansIdx]}`)
                      : '보기 중 하나를 선택하세요.'}
                  </div>
                  <button style={styles.next} onClick={next} disabled={chosen < 0}>다음</button>
                </div>
              </div>
            )}

            {/* 종료 카드 */}
            {phase === 'done' && (
              <div style={styles.card}>
                <div><b>연습 종료!</b> 점수: {score} / {words.length}</div>

                {wrongs.length > 0 ? (
                  <>
                    <div style={{ marginTop: 12, fontWeight: 700 }}>오답 목록 (정답 포함)</div>
                    {wrongs.map((w, idx) => (
                      <div key={idx} style={styles.wrongItem}>
                        <div>
                          <b>{idx + 1}. {w.word.term_en}</b>
                          <span style={styles.tagWrong}>오답</span>
                          {w.word?.book && (
                            <span style={{ marginLeft: 8, fontSize: 12, color:'#777' }}>
                              ({w.word.book}{Number.isFinite(Number(w.word.chapter)) ? ` ${w.word.chapter}강` : ''})
                            </span>
                          )}
                        </div>
                        <div>정답: {w.correct}</div>
                        <div>내 답: {w.your || '(무응답)'}</div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ marginTop: 12 }}>오답이 없어요. 훌륭해요! 🐰</div>
                )}

                <div style={styles.btnRow}>
                  <button style={styles.next} onClick={() => nav('/study')}>범위 선택으로</button>
                  <button style={styles.next} onClick={() => nav('/dashboard')}>대시보드</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
