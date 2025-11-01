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

export default function MockExamPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const q = useQuery();

  // 쿼리 파라미터(레거시) 및 state(신규) 모두 지원
  const bookFromQuery = q.get('book');
  const chaptersParam = q.get('chapters'); // "4-8,10" 형태
  const startParam = q.get('start');
  const endParam = q.get('end');

  const book =
    (loc.state && loc.state.book) ||
    (bookFromQuery || '');

  const chaptersFromState = ensureArray(loc.state?.chapters); // number[] or []
  const chaptersFromQuery = parseChapterInput(chaptersParam); // number[] or []

  // 범위 방식을 위한 start/end (숫자 or NaN)
  const start = Number(startParam);
  const end = Number(endParam);

  const me = getSession();

  // 설정 단계
  const [numQ, setNumQ] = useState(30);
  const [cutMiss, setCutMiss] = useState(3);
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

  // 실제 사용할 챕터 배열(우선순위: state > query > 없음)
  const chapterList = useMemo(() => {
    if (chaptersFromState.length) return chaptersFromState;
    if (chaptersFromQuery.length) return chaptersFromQuery;
    return [];
  }, [chaptersFromState, chaptersFromQuery]);

  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  // 단어 로드: chapterList가 있으면 in(...) 조회, 아니면 start~end 범위 조회
  useEffect(() => {
    (async () => {
      if (!book) return setWords([]);

      // chapter 방식
      if (chapterList.length > 0) {
        const range = await fetchWordsByChapters(book, chapterList);
        setWords(range || []);
        return;
      }

      // 범위 방식(둘 다 정상 숫자일 때만)
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const range = await fetchWordsInRange(book, start, end);
        setWords(range || []);
        return;
      }

      // 둘 다 아니면 빈 배열
      setWords([]);
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapterList.join(','), start, end]);

  // 시험 시작
  function startExam() {
    if (!words.length) return alert('선택한 범위에 단어가 없습니다.');
    // 입력 유효화
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

  async function log(action, word) {
    try {
      await supabase.from('study_logs').insert([
        {
          student_id: me?.id,
          book,
          chapter: word?.chapter,
          word_id: word?.id,
          action,
          payload: { mode: 'mock' },
        },
      ]);
    } catch (e) {
      console.warn('log fail', e);
    }
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

  if (!book) {
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

  // 상단 표시용 챕터 텍스트
  const chapterText = chaptersParam
    ? chaptersParam
    : (chapterList.length ? chapterList.join(', ') : '');

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width:'100%' }}>
        <div className="student-container">
          <div className="student-card">
            {/* 상단 간략 정보 */}
            <div style={{ color:'#444', marginBottom: 6, fontSize:13 }}>
              책: <b>{book}</b> | {chapterList.length
                ? <>챕터: <b>{chapterText}</b></>
                : (Number.isFinite(start) && Number.isFinite(end)
                    ? <>범위: <b>{start}~{end}강</b></>
                    : <>범위: <b>미지정</b></>)}
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
                        <div><b>{idx + 1}. {r.word.term_en}</b> — {r.ok ? <span style={styles.ok}>정답</span> : <span style={styles.nok}>오답</span>}</div>
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
