// src/pages/MockExamPage.jsx
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
import StudentShell from './StudentShell';

const styles = {
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 },
  input: { width: '100%', padding: '12px 14px', border: '1px solid #ffd3e3', borderRadius: 10, outline: 'none', fontSize: 14 },
  btn: { padding: '12px 16px', borderRadius: 10, border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', background: '#ff8fb7' },
  card: { border: '1px solid #ffd3e3', borderRadius: 12, padding: 20, marginTop: 12 },
  term: { fontSize: 28, fontWeight: 900, color: '#333', textAlign: 'center' },
  timer: { fontSize: 14, color: '#ff6fa3', textAlign: 'center', marginTop: 6 },
  resultBox: { marginTop: 16, borderTop: '1px dashed #ffd3e3', paddingTop: 12 },
  item: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ffd3e3', background: '#fff', marginTop: 10 },
  ok: { color: '#0a7a3d', fontWeight: 700 },
  nok: { color: '#b00020', fontWeight: 700 },
  warn: { background: '#fff0f5', border: '1px solid #ffd3e3', padding: '10px 12px', borderRadius: 10, marginTop: 12, color: '#b00020' },
};

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
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

        // 혹시 start/end로 넘어오는 형태도 지원
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

export default function MockExamPage() {
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

  // 설정 단계
  const [numQ, setNumQ] = useState(30);
  const [cutMiss, setCutMiss] = useState(3);

  // 로드된 전체 단어
  const [words, setWords] = useState([]);

  const [phase, setPhase] = useState('config'); // config | exam | done
  const [reviewOpen, setReviewOpen] = useState(false);

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

  // 결과
  const [corrects, setCorrects] = useState(0);
  const [results, setResults] = useState([]);

  // 상단 표시 텍스트
  const headerText = useMemo(() => {
    if (mode === 'none') return '';
    if (mode === 'wrong') return `오답 파일 ${wrongBookIds.length}개 선택`;
    const list = selections.map((s) => selectionToText(s, legacy._rawChaptersParam)).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return `${list.length}권 선택: ${list.join(' / ')}`;
  }, [mode, selections, legacy._rawChaptersParam, wrongBookIds.length]);

  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  // ✅ 단어 로드: 오답모드 or 정규모드
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // 잘못된 접근
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
        console.error('MockExamPage: load failed', e);
        if (!mounted) return;
        setWords([]);
      }
    })();

    return () => { mounted = false; };
  }, [mode, selections, legacy._rawChaptersParam, wrongBookIds]);

  // 시험 시작
  function startExam() {
    if (!words.length) {
      return alert(mode === 'wrong' ? '선택한 오답 파일에 단어가 없습니다.' : '선택한 범위에 단어가 없습니다.');
    }

    const n = Math.max(1, Math.min(Number(numQ) || 0, 999));
    const c = Math.max(0, Math.min(Number(cutMiss) || 0, 999));
    if (n !== numQ) setNumQ(n);
    if (c !== cutMiss) setCutMiss(c);

    const chosen = sampleN(words, n);
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

  // 문항 전환 시 입력 초기화
  useEffect(() => {
    if (phase === 'exam') {
      submittedRef.current = false;
      setInputKey((k) => k + 1);
      setIsComposing(false);
    }
  }, [phase, i]);

  // 6초 타이머
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

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line
  }, [phase, i]);

  // ✅ 연습/모의는 오답 저장(로그 저장) 자체를 안 함
  async function log(action, word) {
    return;
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
    if (ok) {
      setCorrects((s) => s + 1);
      log('got_right', word);
    } else {
      log('got_wrong', word);
    }

    setResults((arr) => [...arr, { word, your, ok }]);
    setAnswer('');
    answerRef.current = '';

    if (i + 1 >= seq.length) {
      setPhase('done');
      setReviewOpen(false);
    } else {
      setI((x) => x + 1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function passOrFail() {
    const miss = (seq.length || 0) - corrects;
    return miss <= cutMiss ? '통과' : '불통과';
  }

  if (mode === 'none') {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width:'100%' }}>
          <div className="student-container">
            <div className="student-card">잘못된 접근입니다.</div>
          </div>
        </div>
      </StudentShell>
    );
  }

  // 상단 현재 문항 메타
  const currentMetaText = useMemo(() => {
    const w = seq[i];
    if (!w) return '';
    const b = w?.book || '';
    const ch = Number.isFinite(Number(w?.chapter)) ? `${w.chapter}강` : '';
    return [b, ch].filter(Boolean).join(' | ');
  }, [seq, i]);

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width:'100%' }}>
        <div className="student-container">
          <div className="student-card">
            {/* 상단 간략 정보 */}
            <div style={{ color:'#444', marginBottom: 6, fontSize:13 }}>
              <div style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {headerText || (selections[0] ? selectionToText(selections[0], legacy._rawChaptersParam) : '')}
              </div>
              {phase === 'exam' && currentMetaText && (
                <div style={{ fontSize:12, color:'#777', marginTop:2 }}>
                  현재: {currentMetaText}
                </div>
              )}
            </div>

            {/* 설정 */}
            {phase === 'config' && (
              <>
                <div className="grid" style={styles.row}>
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
                    <div style={{ fontSize: 13, color: '#444' }}>커트라인(-X컷에서 X)</div>
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

            {/* 시험 */}
            {phase === 'exam' && (
              <div style={styles.card}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <div>문항 {i + 1} / {seq.length}</div>
                  <div>맞춘 개수: {corrects}</div>
                </div>
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
                        if (isComposing) return;
                        submitCurrent(answer);
                      }
                    }}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>

                <div style={{ marginTop: 12 }}>
                  <button style={styles.btn} onClick={() => submitCurrent(answerRef.current)}>
                    제출(Enter)
                  </button>
                </div>
              </div>
            )}

            {/* 종료 & 리뷰 */}
            {phase === 'done' && (
              <div style={styles.card}>
                <div><b>결과:</b> {passOrFail()} ✅</div>
                <div>맞춘 개수: {corrects} / {seq.length} (오답: {(seq.length - corrects)}, 커트라인: -{cutMiss}컷)</div>

                {!reviewOpen ? (
                  <>
                    <div style={styles.warn} >
                      <b>안내</b><br />
                      모의시험은 AI가 채점하기 때문에 오류가 있을 수 있습니다. 반드시 정답과 오답을 한번 더 숙지 후 공식시험을 응시해주세요.
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <button className="btn" style={styles.btn} onClick={() => setReviewOpen(true)}>확인</button>
                    </div>
                  </>
                ) : (
                  <div style={styles.resultBox}>
                    <div><b>전체 문제 리뷰</b> (정답/내 답/정오)</div>
                    {results.map((r, idx) => (
                      <div key={idx} style={styles.item}>
                        <div>
                          <b>{idx + 1}. {r.word.term_en}</b> — {r.ok ? <span style={styles.ok}>정답</span> : <span style={styles.nok}>오답</span>}
                          {r.word?.book && (
                            <span style={{ marginLeft: 8, fontSize: 12, color:'#777' }}>
                              ({r.word.book}{Number.isFinite(Number(r.word.chapter)) ? ` ${r.word.chapter}강` : ''})
                            </span>
                          )}
                        </div>
                        <div>정답: {r.word.meaning_ko}</div>
                        <div>내 답: {r.your || '(무응답)'}</div>
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                      <button style={styles.btn} onClick={() => nav('/study')}>범위 다시 고르기</button>
                      <button style={styles.btn} onClick={() => nav('/dashboard')}>대시보드로</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
