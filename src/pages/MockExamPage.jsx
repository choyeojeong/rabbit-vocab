// src/pages/MockExamPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchWordsInRange, fetchWordsByChapters, parseChapterInput, sampleN } from '../utils/vocab';
import { isAnswerCorrect } from '../utils/textEval';
import { supabase } from '../utils/supabaseClient';
import { getSession } from '../utils/session';

const styles = {
  page: { minHeight: '100vh', background: '#fff5f8', padding: 24 },
  box: { maxWidth: 900, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 8px 24px rgba(255,192,217,0.35)' },
  title: { fontSize: 22, fontWeight: 800, color: '#ff6fa3', marginBottom: 8 },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 },
  input: { width: '100%', padding: '12px 14px', border: '1px solid #ffd3e3', borderRadius: 10, outline: 'none', fontSize: 14 },
  btn: { padding: '12px 16px', borderRadius: 10, border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer', background: '#ff8fb7' },
  card: { marginTop: 18, border: '1px solid #ffd3e3', borderRadius: 12, padding: 20 },
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
  const q = useQuery();
  const book = q.get('book');
  const start = Number(q.get('start'));
  const end = Number(q.get('end'));
  const chaptersParam = q.get('chapters');
  const me = getSession();

  // 설정 단계
  const [numQ, setNumQ] = useState(30);
  const [cutMiss, setCutMiss] = useState(3);
  const [words, setWords] = useState([]);
  const [phase, setPhase] = useState('config'); // config | exam | done
  const [reviewOpen, setReviewOpen] = useState(false); // done에서 "확인" 후 true

  // 진행
  const [seq, setSeq] = useState([]);  // 출제 목록
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState('');
  const answerRef = useRef('');
  const submittedRef = useRef(false);   // 문항당 1회 제출 잠금
  const [isComposing, setIsComposing] = useState(false); // 한글 조합 상태
  const [inputKey, setInputKey] = useState(0);           // 입력칸 강제 재마운트 키
  const [remaining, setRemaining] = useState(6);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  // 결과
  const [corrects, setCorrects] = useState(0);
  const [results, setResults] = useState([]); // [{word, your, ok}]

  useEffect(() => { answerRef.current = answer; }, [answer]);

  useEffect(() => {
    (async () => {
      if (!book || (!chaptersParam && (!start || !end))) return;
      let range = [];
      if (chaptersParam) {
        const list = parseChapterInput(chaptersParam);
        range = await fetchWordsByChapters(book, list);
      } else {
        range = await fetchWordsInRange(book, start, end);
      }
      setWords(range);
    })();
  }, [book, start, end, chaptersParam]);

  function startExam() {
    if (!words.length) return alert('선택한 범위에 단어가 없습니다.');
    const chosen = sampleN(words, numQ);
    setSeq(chosen);
    setI(0);
    setCorrects(0);
    setResults([]);
    setPhase('exam');
    setAnswer('');
    answerRef.current = '';
    submittedRef.current = false;
    setInputKey((k) => k + 1); // 입력칸 재마운트
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // 새 문항 시작할 때마다 잠금 해제 + 입력칸 재마운트
  useEffect(() => {
    if (phase === 'exam') {
      submittedRef.current = false;
      setInputKey((k) => k + 1); // IME 잔상 제거
      setIsComposing(false);
    }
  }, [phase, i]);

  // 6초 타이머 (시간 만료 시, 그때까지 입력한 답을 기록)
  useEffect(() => {
    if (phase !== 'exam') return;
    setRemaining(6);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          submitCurrent(answerRef.current); // 최신 입력으로 제출
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line
  }, [phase, i]);

  // 응답 로그
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

  // 제출 공통 함수 (중복 제출 방지 + IME 종료)
  function submitCurrent(forcedAnswer) {
    if (phase !== 'exam') return;
    if (submittedRef.current) return;
    submittedRef.current = true;

    setIsComposing(false);
    inputRef.current?.blur();     // 조합 강제 종료
    clearInterval(timerRef.current);

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

    // 다음
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

  if (!book) return <div style={styles.page}><div style={styles.box}>잘못된 접근입니다.</div></div>;

  return (
    <div style={styles.page}>
      <div style={styles.box}>
        <h1 style={styles.title}>모의시험 (6초 주관식)</h1>

        {phase === 'config' && (
          <>
            <div>
              책: <b>{book}</b> | {chaptersParam ? <>챕터: <b>{chaptersParam}</b></> : <>범위: <b>{start}~{end}강</b></>}
            </div>
            <div className="grid" style={styles.row}>
              <div>
                <div style={{ fontSize: 13, color: '#444' }}>문제 수</div>
                <input style={styles.input} value={numQ} onChange={(e) => setNumQ(Number(e.target.value || 0))} type="number" min={1} max={999} />
              </div>
              <div>
                <div style={{ fontSize: 13, color: '#444' }}>커트라인(-X컷에서 X)</div>
                <input style={styles.input} value={cutMiss} onChange={(e) => setCutMiss(Number(e.target.value || 0))} type="number" min={0} max={999} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn" style={styles.btn} onClick={startExam}>시작하기</button>
            </div>
          </>
        )}

        {phase === 'exam' && (
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>문항 {i + 1} / {seq.length}</div>
              <div>맞춘 개수: {corrects}</div>
            </div>
            <div style={styles.term}>{seq[i]?.term_en}</div>
            <div style={styles.timer}>남은 시간: {remaining}초</div>

            <div style={{ marginTop: 14 }}>
              <input
                key={inputKey} // ✅ 문항 바뀔 때마다 입력칸 재생성
                ref={inputRef}
                style={styles.input}
                placeholder="뜻을 입력하세요 (예: 달리다)"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={(e) => { setIsComposing(false); setAnswer(e.currentTarget.value); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (isComposing) return; // 조합 중 Enter 무시
                    submitCurrent(answer);
                  }
                }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <button style={styles.btn} onClick={() => submitCurrent(answerRef.current)}>
                제출(Enter)
              </button>
            </div>
          </div>
        )}

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
  );
}
