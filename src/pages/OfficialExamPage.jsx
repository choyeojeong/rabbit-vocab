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

const styles = {
  input: { width: '100%', padding: '12px 14px', border: '1px solid #ffd3e3', borderRadius: 10, outline: 'none', fontSize: 14 },
  btn: { padding: '12px 16px', borderRadius: 10, border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', background: '#ff6fa3' },
  term: { fontSize: 28, fontWeight: 900, color: '#333', textAlign: 'center' },
  timer: { fontSize: 14, color: '#ff6fa3', textAlign: 'center', marginTop: 6 },
  info: { fontSize: 13, color: '#777' },
  warn: { background: '#fff0f5', border: '1px solid #ffd3e3', padding: '10px 12px', borderRadius: 10, marginTop: 12, color: '#b00020' },
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

  // ----- 기존(정규) 로직 -----
  const qBook = query.get('book') || '';
  const qChapters = query.get('chapters'); // "4-6,8,10"
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

  // ✅ 다중 selections 우선 처리
  if (rawSelections.length) {
    const normalized = rawSelections
      .map((s) => {
        const book = (s?.book || '').trim();
        if (!book) return null;

        // ✅ BookRangePage는 chaptersText를 넘김
        const chaptersText = (s?.chaptersText ?? s?.chapters ?? '').toString().trim();

        // chapters 배열 만들기
        let chapters = [];
        if (Array.isArray(s?.chapters)) {
          chapters = s.chapters
            .filter((n) => Number.isFinite(Number(n)))
            .map(Number);
        } else if (chaptersText) {
          chapters = parseChapterInput(chaptersText);
        } else {
          chapters = [];
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

  // ✅ chaptersText가 있으면 사용자가 입력한 그대로 보여주기
  if (chapters.length) return `${book} (${sel.chaptersText || chapters.join(', ')})`;
  if (legacyRawChaptersParam && !chapters.length) return `${book} (${legacyRawChaptersParam})`;
  if (hasRange) return `${book} (${Math.min(sel.start, sel.end)}~${Math.max(sel.start, sel.end)})`;
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

  const { data: items, error: e1 } = await supabase
    .from('wrong_book_items')
    .select('wrong_book_id, word_id, term_en, meaning_ko, book, chapter, pos, accepted_ko')
    .in('wrong_book_id', ids);

  if (e1) {
    console.warn('[wrong_book_items select fail]', e1);
    return [];
  }

  const rows = items || [];
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

  const wordIds = Array.from(new Set(rows.map(r => r.word_id).filter(Boolean)));
  if (!wordIds.length) return [];

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

export default function OfficialExamPage() {
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

  // 로그인/세션 가드
  useEffect(() => {
    if (!me?.id) {
      alert('로그인이 필요합니다. 다시 로그인해 주세요.');
      nav('/');
    }
  }, [me, nav]);

  // 설정
  const [numQ, setNumQ] = useState(30);
  const [cutMiss, setCutMiss] = useState(3);
  const [words, setWords] = useState([]); // 문제 풀(정규: 다중 책 합침 / 오답: 오답파일 합침)
  const [phase, setPhase] = useState('config'); // config | exam | submitted

  // 진행
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

  // 결과/세션
  const [corrects, setCorrects] = useState(0);
  const [results, setResults] = useState([]); // [{word, your, ok}]
  const [sessionId, setSessionId] = useState(null); // 포커스 이탈 로그용

  // ✅ 이탈 이벤트 기록용
  const [profileMeta, setProfileMeta] = useState({ name: '', teacher_name: null });
  const lastFocusEventAtRef = useRef(0);

  // 상단 표시 텍스트
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

        // ✅ 오답 모드
        if (mode === 'wrong') {
          const list = await fetchWrongWords(wrongBookIds);
          if (!mounted) return;

          const normalized = (list || []).map((w) => ({
            ...w,
            book: w.book || '오답',
          }));

          setWords(normalized);
          return;
        }

        // ✅ 정규 모드
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
          if (chapters.length > 0) {
            range = await fetchWordsByChapters(book, chapters);
          } else if (hasRange) {
            range = await fetchWordsInRange(book, sel.start, sel.end);
          } else {
            range = [];
          }

          const withBook = (range || []).map((w) => ({ ...w, book: w.book || book }));
          chunks.push(...withBook);
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

  // 포커스 이탈 감지 훅 (기존 로컬 알림/가드 유지)
  useExamFocusGuard({
    sessionId,
    studentId: me?.id,
    enableAlert: true,
  });

  // ✅ 관리자에게 이탈 이벤트 기록
  async function reportFocusEvent(eventType, detail = {}) {
    try {
      if (!me?.id) return;
      if (!sessionId) return;       // 세션ID 생긴 뒤부터 기록
      if (phase !== 'exam') return; // 시험 중일 때만

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
    } catch {
      // 기록 실패는 시험 진행을 막지 않음
    }
  }

  // ✅ 실제 이탈 감지 이벤트 바인딩
  useEffect(() => {
    if (phase !== 'exam') return;
    if (!sessionId) return;

    const onVis = () => {
      if (document.visibilityState === 'hidden') reportFocusEvent('hidden');
    };
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

  // ✅ chapters_text 생성
  function computeChaptersText() {
    if (mode === 'wrong') {
      const ids = ensureArray(wrongBookIds).filter(Boolean);
      return `WRONG:${ids.join(',')}`;
    }

    const parts = (selections || [])
      .map((sel) => {
        const book = (sel?.book || '').trim();
        if (!book) return null;

        const chapters = ensureArray(sel.chapters)
          .filter((n) => Number.isFinite(Number(n)))
          .map(Number);

        const hasRange = Number.isFinite(sel.start) && Number.isFinite(sel.end);

        // ✅ chaptersText 우선(사용자 입력 보존)
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

  // ✅ chapter_start/end: 전체 words에서 최소~최대로 저장(호환용)
  function computeGlobalChapterBoundsFromWords() {
    const chs = (words || [])
      .map((w) => Number(w?.chapter))
      .filter((n) => Number.isFinite(n));
    if (!chs.length) throw new Error('챕터 범위를 계산할 수 없습니다. (선택 범위에 단어가 없음)');
    return { chapter_start: Math.min(...chs), chapter_end: Math.max(...chs) };
  }

  async function startExam() {
    if (!me?.id) {
      alert('로그인이 필요합니다. 다시 로그인해 주세요.');
      return nav('/');
    }
    if (mode === 'none') return alert('잘못된 접근입니다. (범위 정보 없음)');
    if (!words.length) return alert(mode === 'wrong' ? '선택한 오답 파일에 단어가 없습니다.' : '선택한 범위에 단어가 없습니다.');

    // 입력 유효화
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

    // 프로필(학생 이름/담임)
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

    // ✅ 세션 생성(draft)
    try {
      const payload = {
        mode: 'official',
        status: 'draft',
        student_id: me?.id,
        student_name: profileName,
        teacher_name: profileTeacher,
        // ✅ 대표 book(정규=첫 선택, 오답=오답)
        book: (mode === 'wrong') ? '오답' : (selections?.[0]?.book || legacy.book || null),
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
      alert(
        `시험 세션 생성 중 오류가 발생했습니다. 다시 시도해 주세요.\n` +
        (err?.message ? `\n(detail: ${err.message})` : '')
      );
      return;
    }

    // 시험 상태 진입
    setSeq(chosen);
    setI(0);
    setCorrects(0);
    setResults([]);
    setPhase('exam');
    setAnswer('');
    answerRef.current = '';
    submittedRef.current = false;
    setInputKey(k => k + 1);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // 문항 전환 시 입력 초기화
  useEffect(() => {
    if (phase === 'exam') {
      submittedRef.current = false;
      setInputKey(k => k + 1);
      setIsComposing(false);
    }
  }, [phase, i]);

  // 타이머 (만료 시 자동 제출)
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
      await supabase.from('study_logs').insert([
        {
          student_id: me?.id,
          book: word?.book || (mode === 'wrong' ? '오답' : (selections?.[0]?.book || legacy.book)) || null,
          chapter: word?.chapter ?? null,
          word_id: word?.id ?? word?.word_id ?? null,
          action,
          payload: {
            mode: 'official',
            source: mode === 'wrong' ? 'wrong' : 'regular',
            wrong_book_ids: mode === 'wrong' ? wrongBookIds : null,
          },
        },
      ]);
    } catch {
      // 로깅 실패는 치명적이지 않음
    }
  }

  // 한 문항 제출
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

    if (i + 1 >= seq.length) {
      // ✅ 마지막 문항 누락 방지 패턴 유지
      finalizeAndSend(next);
    } else {
      setI((x) => x + 1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function finalizeAndSend(finalResults) {
    let sid = sessionId;

    // 예외 복구: 세션이 없다면(draft로) 즉시 생성
    if (!sid) {
      try {
        const bounds = computeGlobalChapterBoundsFromWords();
        const chaptersText = computeChaptersText();

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

        const { data, error } = await supabase
          .from('test_sessions')
          .insert([{
            mode: 'official',
            status: 'draft',
            student_id: me?.id,
            student_name: profileName,
            teacher_name: profileTeacher,
            book: (mode === 'wrong') ? '오답' : (selections?.[0]?.book || legacy.book || null),
            chapters_text: chaptersText,
            chapter_start: bounds.chapter_start,
            chapter_end: bounds.chapter_end,
            num_questions: (finalResults?.length || seq.length || 0) || 1,
            cutoff_miss: Number.isFinite(cutMiss) ? cutMiss : 3,
            duration_sec: 6,
            auto_score: 0,
            auto_pass: null,
          }])
          .select('id')
          .single();

        if (error) throw error;
        sid = data?.id || null;
        setSessionId(sid);
      } catch (err) {
        console.error('[OfficialExam] fallback session insert failed:', err);
        alert(`제출 중 오류(세션 저장): ${err?.message || err}`);
        setPhase('submitted');
        return;
      }
    }

    // 자동 점수/통과 계산
    const autoScore = (finalResults || []).reduce((acc, r) => acc + (r.ok ? 1 : 0), 0);
    const total = seq.length || (finalResults?.length ?? 0);
    const autoPass = (total - autoScore) <= (Number.isFinite(cutMiss) ? cutMiss : 3);

    // 1) 세션 UPDATE: 제출 시점에만 submitted로 전환
    try {
      const { error } = await supabase
        .from('test_sessions')
        .update({
          status: 'submitted',
          auto_score: autoScore,
          auto_pass: autoPass,
        })
        .eq('id', sid);
      if (error) throw error;
    } catch (err) {
      console.error('[OfficialExam] session update failed:', err);
      alert(`제출 중 오류(세션 업데이트): ${err?.message || err}`);
      setPhase('submitted');
      return;
    }

    // 2) 문항 저장
    try {
      const rows = (finalResults || []).map((r, idx) => ({
        session_id: sid,
        order_index: idx + 1,
        question_type: 'subjective',
        word_id: r?.word?.id ?? r?.word?.word_id ?? null,
        term_en: r?.word?.term_en ?? '',
        meaning_ko: r?.word?.meaning_ko ?? '',
        student_answer: r?.your ?? '',
        auto_ok: !!r?.ok,
        final_ok: null,
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from('test_items').insert(rows);
        if (error) throw error;
      }
    } catch (err) {
      console.error('[OfficialExam] items insert failed:', err);
      alert(`제출 중 오류(문항 저장): ${err?.message || err}`);
      setPhase('submitted');
      return;
    }

    setPhase('submitted');
  }

  if (mode === 'none') {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
          <div className="student-container">
            <div className="student-card stack">잘못된 접근입니다.</div>
          </div>
        </div>
      </StudentShell>
    );
  }

  // config 화면 표시용: 현재 선택 요약
  const rangeTextForConfig = headerText ||
    (mode === 'wrong'
      ? `오답 파일 ${wrongBookIds.length}개 선택`
      : selectionToText(
          selections?.[0] || { book: legacy.book, chapters: legacy.chapters, start: legacy.start, end: legacy.end, chaptersText: legacy._rawChaptersParam },
          legacy._rawChaptersParam
        ));

  // exam 화면 표시용: 현재 문항 book/chapter
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
          <div className="student-card stack">
            {/* config 단계 */}
            {phase === 'config' && (
              <>
                <div className="student-row">
                  <div>
                    <div style={{ fontSize: 13, color: '#444' }}>책 / 범위</div>
                    <div style={styles.info}>{rangeTextForConfig}</div>
                  </div>
                  <div />
                  <div>
                    <div style={{ fontSize: 13, color: '#444' }}>문제 수</div>
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
                    <div style={{ fontSize: 13, color: '#444' }}>커트라인(-X컷)</div>
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
                <div style={{ marginTop: 12 }}>
                  <button className="btn" style={styles.btn} onClick={startExam}>시작하기</button>
                </div>
              </>
            )}

            {/* exam 단계 */}
            {phase === 'exam' && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>문항 {i + 1} / {seq.length}</div>
                  <div>맞춘 개수: {corrects}</div>
                </div>

                {currentMetaText && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#777', textAlign: 'center' }}>
                    {currentMetaText}
                  </div>
                )}

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

                <div style={{ marginTop: 12 }}>
                  <button className="btn" style={styles.btn} onClick={() => submitCurrent(answerRef.current)}>
                    제출(Enter)
                  </button>
                </div>
              </div>
            )}

            {/* submitted 단계 */}
            {phase === 'submitted' && (
              <div>
                <div style={styles.warn}>
                  <b>제출 완료</b><br />
                  시험 결과는 선생님 검수 후 전달됩니다. 잠시만 기다려 주세요.
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" style={styles.btn} onClick={() => nav('/study')}>다른 범위로 공부</button>
                  <button className="btn" style={styles.btn} onClick={() => nav('/dashboard')}>대시보드</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
