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
  loadingCard: { border:'1px solid #ffd3e3', borderRadius:12, padding:16, background:'#fff', color:'#444' },
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
 * selections 정규화
 * - 다중 책: loc.state.selections = [{ book, chaptersText }]
 * - 레거시(단일): book + (chapters|start/end) 호환
 */
function normalizeSelections({ locState, query }) {
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

    if (normalized.length) return { mode: 'multi', selections: normalized, legacy };
  }

  if (!legacy.book) return { mode: 'none', selections: [], legacy };
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
    legacy
  };
}

function selectionToText(sel, legacyRawChaptersParam = '') {
  const book = sel.book;
  const chapters = ensureArray(sel.chapters).filter((n) => Number.isFinite(Number(n))).map(Number);
  const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

  if (chapters.length) return `${book} (${sel.chaptersText || chapters.join(', ')})`;
  if (legacyRawChaptersParam && !chapters.length) return `${book} (${legacyRawChaptersParam})`;
  if (hasRange) return `${book} (${Math.min(sel.start, sel.end)}~${Math.max(sel.start, sel.end)}강)`;
  return `${book}`;
}

export default function PracticeMCQ() {
  const nav = useNavigate();
  const loc = useLocation();
  const q = useQuery();

  const me = getSession();

  const { mode, selections, legacy } = useMemo(() => {
    return normalizeSelections({ locState: loc.state, query: q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.state, loc.search]);

  const [phase, setPhase] = useState('play'); // 'play' | 'done'
  const [words, setWords] = useState([]);     // 문제 단어들
  const [i, setI] = useState(0);
  const [opts, setOpts] = useState([]);
  const [ansIdx, setAnsIdx] = useState(-1);
  const [chosen, setChosen] = useState(-1);
  const [score, setScore] = useState(0);
  const [wrongs, setWrongs] = useState([]);

  const [bookPools, setBookPools] = useState({});

  // ✅ 깜빡임 제거용 로딩 상태
  const [loadingWords, setLoadingWords] = useState(true);

  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('sound_enabled') === 'true';
  });

  const current = words[i];

  const headerText = useMemo(() => {
    if (mode === 'none') return '';
    const list = selections.map((s) => selectionToText(s, legacy._rawChaptersParam)).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return `${list.length}권 선택: ${list.join(' / ')}`;
  }, [mode, selections, legacy._rawChaptersParam]);

  // 데이터 로딩
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoadingWords(true);

        if (mode === 'none' || !selections.length) {
          if (mounted) {
            setWords([]);
            setBookPools({});
          }
          return;
        }

        const chunks = [];
        for (const sel of selections) {
          const book = sel.book;
          const chapters = ensureArray(sel.chapters).filter((n) => Number.isFinite(Number(n))).map(Number);
          const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

          let range = [];
          if (chapters.length > 0) range = await fetchWordsByChapters(book, chapters);
          else if (hasRange) range = await fetchWordsInRange(book, sel.start, sel.end);
          else range = [];

          const withBook = (range || []).map((w) => ({ ...w, book: w.book || book }));
          chunks.push(...withBook);
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
            poolMap[b] = (pool && pool.length)
              ? pool.map((w) => ({ ...w, book: w.book || b }))
              : [];
          } catch (e) {
            console.warn('MCQ: book pool load failed for', b, e);
            poolMap[b] = [];
          }
        }

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
        if (mounted) setLoadingWords(false);
      }
    })();

    return () => { mounted = false; };
  }, [mode, selections, legacy._rawChaptersParam]);

  // 보기 생성
  useEffect(() => {
    if (!current) return;

    const b = current?.book;
    const pool = (b && bookPools[b] && bookPools[b].length) ? bookPools[b] : [];
    const effectivePool = pool.length ? pool : words;
    if (!effectivePool || effectivePool.length === 0) return;

    const { options, answerIndex } = buildMCQOptions(current, effectivePool, words);
    setOpts(options);
    setAnsIdx(answerIndex);
    setChosen(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, current?.id, current?.book, Object.keys(bookPools).length, words.length]);

  // 자동 발음
  useEffect(() => {
    if (!current?.term_en) return;
    if (!soundEnabled) return;
    speakWord(current.term_en);
    return () => speakCancel();
  }, [current?.id, soundEnabled]);

  async function record(action) {
    try {
      await supabase.from('study_logs').insert([
        {
          student_id: me?.id,
          book: current?.book || selections?.[0]?.book || legacy.book || null,
          chapter: current?.chapter ?? null,
          word_id: current?.id ?? null,
          action,
          payload: { mode: 'mcq' },
        },
      ]);
    } catch (e) {
      console.warn('log fail', e);
    }
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

  // ✅ 로딩 중에는 "단어 없음" 대신 로딩 카드
  if (loadingWords) {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
          <div className="student-container">
            <div className="student-card" style={styles.loadingCard}>
              단어 불러오는 중…
            </div>
          </div>
        </div>
      </StudentShell>
    );
  }

  // ✅ 로딩 끝났는데도 단어가 없을 때만 표시
  if (!words.length) {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
          <div className="student-container">
            <div className="student-card">선택한 범위에 단어가 없어요.</div>
          </div>
        </div>
      </StudentShell>
    );
  }

  const currentMetaText = useMemo(() => {
    const b = current?.book || '';
    const ch = Number.isFinite(Number(current?.chapter)) ? `${current.chapter}강` : '';
    return [b, ch].filter(Boolean).join(' | ');
  }, [current?.book, current?.chapter]);

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
        <div className="student-container">
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
            <div style={{ display: 'flex', justifyContent: 'space-between', color:'#444', fontSize:13, gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {headerText || selectionToText(selections[0], legacy._rawChaptersParam)}
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

            {phase === 'play' && (
              <div style={styles.card}>
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
