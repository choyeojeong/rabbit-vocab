// src/pages/OfficialExamPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  fetchWordsInRange,
  fetchWordsByChapters,
  parseChapterInput,
  sampleN,
  ensureArray,
} from '../utils/vocab';
import { isAnswerCorrect } from '../utils/textEval';
import { supabase } from '../utils/supabaseClient';
import { getSession } from '../utils/session';
import useExamFocusGuard from '../hooks/useExamFocusGuard';
import StudentShell from './StudentShell';

const COLORS = {
  bg: '#fff5f8',
  card: '#ffffff',
  text: '#1f2a44',
  sub: '#5d6b82',
  border: '#ffd3e3',
  pink: '#ff6fa3',
  pink2: '#ff8fb7',
  pinkSoft: '#fff0f5',
  ok: '#0a7a3d',
  nok: '#b00020',
};

const styles = {
  topCard: {
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: 16,
    boxShadow: '0 10px 30px rgba(255,111,163,.10)',
    color: COLORS.text,
  },

  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 },

  label: { fontSize: 13, color: COLORS.text, fontWeight: 900, marginBottom: 6 },

  input: {
    width: '100%',
    padding: '12px 14px',
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    outline: 'none',
    fontSize: 14,
    color: COLORS.text,
    background: '#fff',
    fontWeight: 800,
    boxShadow: '0 8px 18px rgba(31,42,68,0.06)',
  },

  // ✅ 전역 button CSS 영향 방지: 항상 이 스타일로 고정
  btn: {
    padding: '12px 16px',
    borderRadius: 12,
    border: 'none',
    color: '#fff',
    fontWeight: 900,
    cursor: 'pointer',
    background: COLORS.pink,
    boxShadow: '0 10px 20px rgba(255,111,163,.18)',
  },
  ghostBtn: {
    padding: '12px 16px',
    borderRadius: 12,
    border: `1px solid ${COLORS.border}`,
    color: COLORS.text,
    fontWeight: 900,
    cursor: 'pointer',
    background: '#fff',
    boxShadow: '0 10px 20px rgba(31,42,68,0.06)',
  },

  term: { fontSize: 28, fontWeight: 900, color: COLORS.text, textAlign: 'center', marginTop: 10 },
  timer: { fontSize: 14, color: COLORS.pink, textAlign: 'center', marginTop: 6, fontWeight: 900 },
  info: { fontSize: 13, color: COLORS.sub, fontWeight: 800, marginTop: 4 },

  warn: {
    background: COLORS.pinkSoft,
    border: `1px solid ${COLORS.border}`,
    padding: '10px 12px',
    borderRadius: 12,
    marginTop: 12,
    color: COLORS.nok,
    fontWeight: 900,
  },

  metaLine: { display: 'flex', justifyContent: 'space-between', gap: 10, color: COLORS.text, fontWeight: 900 },
  metaCenter: { marginTop: 6, fontSize: 12, color: COLORS.sub, textAlign: 'center', fontWeight: 800 },
};

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

/**
 * ✅ 입력 정규화
 * 1) 오답모드: loc.state.wrong_book_ids 존재 시 최우선
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

        let chapters = [];
        if (Array.isArray(s?.chapters)) {
          chapters = s.chapters.filter((n) => Number.isFinite(Number(n))).map(Number);
        } else if (chaptersText) {
          chapters = parseChapterInput(chaptersText);
        }

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

function selectionToText(sel, legacyRawChaptersParam = '') {
  const book = sel.book;
  const chapters = ensureArray(sel.chapters).filter((n) => Number.isFinite(Number(n))).map(Number);
  const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

  if (chapters.length) return `${book} (${sel.chaptersText || chapters.join(', ')})`;
  if (legacyRawChaptersParam && !chapters.length) return `${book} (${legacyRawChaptersParam})`;
  if (hasRange) return `${book} (${Math.min(sel.start, sel.end)}~${Math.max(sel.start, sel.end)})`;
  return `${book}`;
}

/**
 * ✅ 오답 단어 로드 (FIXED)
 * - wrong_book_items에는 book/chapter 없음
 * - meaning_ko 비어있으면 vocab_words에서 word_id로 폴백해서 채움
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

  // meaning_ko가 비어있는 항목은 vocab_words로 채움
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

export default function OfficialExamPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const q = useQuery();

  const me = getSession();

  // ✅ 이 페이지로 들어올 때의 "원래 모드"(practice/official)
  // BookRangePage가 nav(path, { state: { mode, ... } })로 넘겨준 mode를 사용
  const originMode = (loc?.state?.mode === 'official') ? 'official' : 'practice';
  const backToRangePath = originMode === 'official' ? '/official' : '/study';

  const input = useMemo(() => {
    return normalizeInput({ locState: loc.state, query: q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.state, loc.search]);

  const mode = input.mode; // 'wrong' | 'multi' | 'single' | 'none'
  const selections = input.selections || [];
  const legacy = input.legacy || {};
  const wrongBookIds = input.wrong_book_ids || [];

  useEffect(() => {
    if (!me?.id) {
      alert('로그인이 필요합니다. 다시 로그인해 주세요.');
      nav('/');
    }
  }, [me, nav]);

  const [numQ, setNumQ] = useState(30);
  const [cutMiss, setCutMiss] = useState(3);
  const [words, setWords] = useState([]);
  const [phase, setPhase] = useState('config'); // config | exam | submitted

  const [seq, setSeq] = useState([]);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState('');
  const answerRef = useRef('');
  const submittedRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [remaining, setRemaining] = useState(6);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  const [corrects, setCorrects] = useState(0);
  const [results, setResults] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  const [profileMeta, setProfileMeta] = useState({ name: '', teacher_name: null });
  const lastFocusEventAtRef = useRef(0);

  const headerText = useMemo(() => {
    if (mode === 'none') return '';
    if (mode === 'wrong') return `오답 파일 ${wrongBookIds.length}개 선택`;
    const list = selections.map((s) => selectionToText(s, legacy._rawChaptersParam)).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return `${list.length}권 선택: ${list.join(' / ')}`;
  }, [mode, selections, legacy._rawChaptersParam, wrongBookIds.length]);

  useEffect(() => { answerRef.current = answer; }, [answer]);

  // ✅ 단어 로드: 오답모드 or 정규모드
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        if (mode === 'none') {
          if (mounted) setWords([]);
          return;
        }

        if (mode === 'wrong') {
          const list = await fetchWrongWords(wrongBookIds);
          if (!mounted) return;
          setWords((list || []).map((w) => ({ ...w, book: w.book || '오답' })));
          return;
        }

        if (!selections.length) {
          if (mounted) setWords([]);
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

          chunks.push(...(range || []).map((w) => ({ ...w, book: w.book || book })));
        }

        if (!mounted) return;
        setWords(chunks || []);
      } catch (e) {
        console.error('[OfficialExam] load failed:', e);
        if (mounted) setWords([]);
      }
    })();

    return () => { mounted = false; };
  }, [mode, selections, legacy._rawChaptersParam, wrongBookIds]);

  useExamFocusGuard({
    sessionId,
    studentId: me?.id,
    enableAlert: true,
  });

  async function reportFocusEvent(eventType, detail = {}) {
    try {
      if (!me?.id) return;
      if (!sessionId) return;
      if (phase !== 'exam') return;

      const now = Date.now();
      if (now - lastFocusEventAtRef.current < 800) return;
      lastFocusEventAtRef.current = now;

      const curWord = seq?.[i];
      await supabase.from('focus_events').insert([{
        session_id: sessionId,
        student_id: me?.id,
        student_name: profileMeta?.name || me?.name || '',
        teacher_name: profileMeta?.teacher_name ?? null,
        event_type: eventType,
        detail: {
          ...detail,
          book: curWord?.book || null,
          at_question: (i + 1) || null,
          total_questions: seq?.length || null,
          visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
          href: typeof window !== 'undefined' ? window.location?.href : null,
        },
      }]);
    } catch {}
  }

  useEffect(() => {
    if (phase !== 'exam') return;
    if (!sessionId) return;

    const onVis = () => { if (document.visibilityState === 'hidden') reportFocusEvent('hidden'); };
    const onBlur = () => reportFocusEvent('blur');
    const onPageHide = (e) => reportFocusEvent('pagehide', { persisted: !!e?.persisted });

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sessionId, i, (seq?.length || 0), profileMeta?.name, profileMeta?.teacher_name]);

  function computeChaptersText() {
    if (mode === 'wrong') {
      const ids = ensureArray(wrongBookIds).filter(Boolean);
      return `WRONG:${ids.join(',')}`;
    }

    const parts = (selections || [])
      .map((sel) => {
        const book = (sel?.book || '').trim();
        if (!book) return null;

        const chapters = ensureArray(sel.chapters).filter((n) => Number.isFinite(Number(n))).map(Number);
        const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

        let rangeText = (sel?.chaptersText || '').trim();
        if (!rangeText) {
          if (chapters.length) rangeText = chapters.join(', ');
          else if (sel?.raw && typeof sel.raw?.chapters === 'string' && sel.raw.chapters.trim()) rangeText = sel.raw.chapters.trim();
          else if (legacy._rawChaptersParam && book === legacy.book && !chapters.length) rangeText = legacy._rawChaptersParam.trim();
          else if (hasRange) rangeText = `${Math.min(sel.start, sel.end)}~${Math.max(sel.start, sel.end)}`;
          else rangeText = '미지정';
        }

        return `${book}:${rangeText}`;
      })
      .filter(Boolean);

    return parts.join(' | ');
  }

  function computeGlobalChapterBoundsFromWords() {
    const chs = (words || []).map((w) => Number(w?.chapter)).filter((n) => Number.isFinite(n));
    if (!chs.length) throw new Error('챕터 범위를 계산할 수 없습니다. (선택 범위에 단어가 없음)');
    return { chapter_start: Math.min(...chs), chapter_end: Math.max(...chs) };
  }

  async function startExam() {
    if (!me?.id) { alert('로그인이 필요합니다.'); return nav('/'); }
    if (mode === 'none') return alert('잘못된 접근입니다. (범위 정보 없음)');
    if (!words.length) return alert(mode === 'wrong' ? '선택한 오답 파일에 단어가 없습니다.' : '선택한 범위에 단어가 없습니다.');

    const n = Math.max(1, Math.min(Number(numQ) || 0, words.length));
    if (n !== numQ) setNumQ(n);

    const c = Math.max(0, Math.min(Number(cutMiss) || 0, 999));
    if (c !== cutMiss) setCutMiss(c);

    const chosen = sampleN(words, n);

    let bounds, chaptersText;
    try {
      bounds = computeGlobalChapterBoundsFromWords();
      chaptersText = computeChaptersText();
      if (!chaptersText) throw new Error('챕터 표기 생성 실패');
    } catch (e) {
      return alert(e.message || '범위 계산 중 오류');
    }

    let profileName = '', profileTeacher = null;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, teacher_name')
        .eq('id', me?.id)
        .maybeSingle();
      profileName = profile?.name || me?.name || '';
      profileTeacher = profile?.teacher_name || null;
    } catch {}

    setProfileMeta({ name: profileName || '', teacher_name: profileTeacher ?? null });

    try {
      const payload = {
        mode: 'official',
        status: 'draft',
        student_id: me?.id,
        student_name: profileName,
        teacher_name: profileTeacher,
        book: mode === 'wrong' ? '오답' : (selections?.[0]?.book || legacy.book || null),
        chapters_text: chaptersText,
        chapter_start: bounds.chapter_start,
        chapter_end: bounds.chapter_end,
        num_questions: n,
        cutoff_miss: c,
        duration_sec: 6,
        auto_score: 0,
        auto_pass: null,
      };

      const { data, error } = await supabase
        .from('test_sessions')
        .insert([payload])
        .select('id')
        .single();

      if (error) throw error;
      if (!data?.id) throw new Error('SESSION_INSERT_OK_BUT_NO_ID');
      setSessionId(data.id);
    } catch (err) {
      console.error('[OfficialExam] session insert error:', err);
      alert(`시험 세션 생성 중 오류\n${err?.message ? `(detail: ${err.message})` : ''}`);
      return;
    }

    setSeq(chosen);
    setI(0);
    setCorrects(0);
    setResults([]);
    setPhase('exam');
    setAnswer('');
    answerRef.current = '';
    submittedRef.current = false;
    setInputKey((k) => k + 1);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  useEffect(() => {
    if (phase === 'exam') {
      submittedRef.current = false;
      setInputKey((k) => k + 1);
      setIsComposing(false);
    }
  }, [phase, i]);

  useEffect(() => {
    if (phase !== 'exam') return;
    setRemaining(6);
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          submitCurrent(answerRef.current);
          return 0;
        }
        return r - 1;
      });
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line
  }, [phase, i]);

  async function log(action, word) {
    try {
      await supabase.from('study_logs').insert([{
        student_id: me?.id,
        book: word?.book || (mode === 'wrong' ? '오답' : (selections?.[0]?.book || legacy.book)) || null,
        chapter: word?.chapter ?? null,
        word_id: word?.id ?? word?.word_id ?? null,
        action,
        payload: { mode: 'official', source: mode === 'wrong' ? 'wrong' : 'regular', wrong_book_ids: mode === 'wrong' ? wrongBookIds : null },
      }]);
    } catch {}
  }

  function submitCurrent(forcedAnswer) {
    if (phase !== 'exam') return;
    if (submittedRef.current) return;
    submittedRef.current = true;

    setIsComposing(false);
    inputRef.current?.blur();
    if (timerRef.current) clearInterval(timerRef.current);

    const word = seq[i];
    const your = (forcedAnswer ?? answerRef.current ?? '').toString();
    const ok = isAnswerCorrect(your, word);

    if (ok) { setCorrects((s) => s + 1); log('got_right', word); }
    else { log('got_wrong', word); }

    const next = [...results, { word, your, ok }];
    setResults(next);
    setAnswer('');
    answerRef.current = '';

    if (i + 1 >= seq.length) finalizeAndSend(next);
    else {
      setI((x) => x + 1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function finalizeAndSend(finalResults) {
    // ✅ 여기 본문은 네 프로젝트 원본 finalizeAndSend를 그대로 유지해서 붙여 넣으면 됨
    // (draft 생성 폴백/제출/문항 저장 등)
    setPhase('submitted');
  }

  if (mode === 'none') {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
          <div className="student-container">
            <div className="student-card" style={{ ...styles.topCard, textAlign: 'center' }}>
              잘못된 접근입니다.
            </div>
          </div>
        </div>
      </StudentShell>
    );
  }

  const rangeTextForConfig = headerText ||
    (mode === 'wrong'
      ? `오답 파일 ${wrongBookIds.length}개 선택`
      : selectionToText(
          selections?.[0] || { book: legacy.book, chapters: legacy.chapters, start: legacy.start, end: legacy.end, chaptersText: legacy._rawChaptersParam },
          legacy._rawChaptersParam
        ));

  const currentMetaText = useMemo(() => {
    const w = seq?.[i];
    if (!w) return '';
    const b = w?.book || '';
    const ch = Number.isFinite(Number(w?.chapter)) ? `${w.chapter}강` : '';
    return [b, ch].filter(Boolean).join(' | ');
  }, [seq, i]);

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
        <div className="student-container">
          <div className="student-card" style={styles.topCard}>
            {phase === 'config' && (
              <>
                <div className="student-row">
                  <div>
                    <div style={styles.label}>책 / 범위</div>
                    <div style={styles.info}>{rangeTextForConfig}</div>
                  </div>
                  <div />
                  <div>
                    <div style={styles.label}>문제 수</div>
                    <input
                      style={styles.input}
                      value={numQ}
                      onChange={(e) => setNumQ(e.target.value)}
                      type="number"
                      min={1}
                      max={999}
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <div style={styles.label}>커트라인(-X컷)</div>
                    <input
                      style={styles.input}
                      value={cutMiss}
                      onChange={(e) => setCutMiss(e.target.value)}
                      type="number"
                      min={0}
                      max={999}
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={styles.btn} onClick={startExam}>
                    시작하기
                  </button>

                  {/* ✅ 여기 핵심: 원래 들어온 모드에 맞춰 /official 또는 /study 로 복귀 */}
                  <button type="button" style={styles.ghostBtn} onClick={() => nav(backToRangePath)}>
                    범위 다시 선택
                  </button>
                </div>
              </>
            )}

            {phase === 'exam' && (
              <div style={{ marginTop: 6 }}>
                <div style={styles.metaLine}>
                  <div>문항 {i + 1} / {seq.length}</div>
                  <div>맞춘 개수: {corrects}</div>
                </div>

                {currentMetaText && <div style={styles.metaCenter}>{currentMetaText}</div>}

                <div style={styles.term}>{seq[i]?.term_en}</div>
                <div style={styles.timer}>남은 시간: {remaining}초</div>

                <div style={{ marginTop: 14 }}>
                  <input
                    key={inputKey}
                    ref={inputRef}
                    style={styles.input}
                    placeholder="뜻을 입력하세요 (예: 달리다)"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={(e) => { setIsComposing(false); setAnswer(e.currentTarget.value); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (!isComposing) submitCurrent(answer);
                      }
                    }}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>

                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={styles.btn} onClick={() => submitCurrent(answerRef.current)}>
                    제출(Enter)
                  </button>
                </div>
              </div>
            )}

            {phase === 'submitted' && (
              <div>
                <div style={styles.warn}>
                  <b>제출 완료</b><br />
                  시험 결과는 선생님 검수 후 전달됩니다. 잠시만 기다려 주세요.
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {/* ✅ 여기 핵심: 공식에서 들어온 경우 다시 /official로 */}
                  <button type="button" style={styles.btn} onClick={() => nav(backToRangePath)}>
                    다른 범위로 공부
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
