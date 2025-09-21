// src/pages/OfficialExamPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchWordsInRange, fetchWordsByChapters, parseChapterInput, sampleN } from '../utils/vocab';
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

export default function OfficialExamPage() {
  const nav = useNavigate();
  const q = useQuery();
  const book = q.get('book');
  const start = Number(q.get('start'));
  const end = Number(q.get('end'));
  const chaptersParam = q.get('chapters'); // 권장
  const me = getSession();

  // 설정
  const [numQ, setNumQ] = useState(30);
  const [cutMiss, setCutMiss] = useState(3);
  const [words, setWords] = useState([]);
  const [phase, setPhase] = useState('config'); // config | exam | submitted

  // 진행
  const [seq, setSeq] = useState([]);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState('');
  const answerRef = useRef('');
  const submittedRef = useRef(false);
  const [inputKey, setInputKey] = useState(0);
  const [remaining, setRemaining] = useState(6);
  const timerRef = useRef(null);
  const inputRef = useRef(null);

  // 결과/세션
  const [corrects, setCorrects] = useState(0);
  const [results, setResults] = useState([]); // [{word, your, ok}]
  const [sessionId, setSessionId] = useState(null); // 포커스 이탈 로그용

  useEffect(() => { answerRef.current = answer; }, [answer]);

  // 단어 로드
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
      setWords(range || []);
    })();
  }, [book, start, end, chaptersParam]);

  // 포커스 이탈 감지 훅 (sessionId가 생기면 활성화)
  useExamFocusGuard({
    sessionId,
    studentId: me?.id,
    enableAlert: true
  });

  function computeChapterBounds() {
    if (chaptersParam) {
      const list = parseChapterInput(chaptersParam);
      if (list.length) return { chapter_start: Math.min(...list), chapter_end: Math.max(...list) };
    }
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return { chapter_start: Math.min(start, end), chapter_end: Math.max(start, end) };
    }
    throw new Error('챕터 범위를 계산할 수 없습니다. (입력 형식 확인)');
  }

  async function startExam() {
    if (!words.length) return alert('선택한 범위에 단어가 없습니다.');
    const n = Math.max(1, Math.min(numQ, words.length));
    const chosen = sampleN(words, n);

    // 세션을 먼저 생성해 sessionId 확보 (이탈 로그 위해 필요)
    let bounds, chaptersText;
    try {
      bounds = computeChapterBounds();
      chaptersText = chaptersParam ? chaptersParam : `${start}~${end}강`;
    } catch (e) {
      return alert(e.message);
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

    try {
      const { data, error } = await supabase
        .from('test_sessions')
        .insert([{
          mode: 'official',
          status: 'draft',           // ✅ 시작은 draft
          student_id: me?.id,
          student_name: profileName,
          teacher_name: profileTeacher,
          book,
          chapters_text: chaptersText,
          chapter_start: bounds.chapter_start,
          chapter_end: bounds.chapter_end,
          num_questions: n,
          cutoff_miss: cutMiss,
          duration_sec: 6,
          auto_score: null,
          auto_pass: null
        }])
        .select('id')
        .single();

      if (error) throw error;
      if (!data?.id) throw new Error('SESSION_INSERT_OK_BUT_NO_ID');

      setSessionId(data.id);
    } catch (err) {
      console.error('[OfficialExam] pre-create session failed:', err);
      alert('시험 세션 생성 중 오류가 발생했습니다. 다시 시도해 주세요.');
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

  useEffect(() => {
    if (phase === 'exam') {
      submittedRef.current = false;
      setInputKey((k) => k + 1);
    }
  }, [phase, i]);

  // 타이머 (만료 시 자동 제출)
  useEffect(() => {
    if (phase !== 'exam') return;
    setRemaining(6);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          submitCurrent(answerRef.current);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line
  }, [phase, i]);

  async function log(action, word) {
    try {
      await supabase.from('study_logs').insert([
        { student_id: me?.id, book, chapter: word?.chapter, word_id: word?.id, action, payload: { mode: 'official' } },
      ]);
    } catch {}
  }

  // 한 문항 제출
  function submitCurrent(forcedAnswer) {
    if (phase !== 'exam') return;
    if (submittedRef.current) return;
    submittedRef.current = true;

    inputRef.current?.blur();
    clearInterval(timerRef.current);

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
      finalizeAndSend(next); // 비동기 저장
    } else {
      setI((x) => x + 1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function finalizeAndSend(finalResults) {
    // 이미 startExam에서 sessionId를 만들었으므로, 여기서는 UPDATE + items INSERT만 수행
    let sid = sessionId;

    // 혹시나 세션이 없으면(에러 복구용) 생성 (draft로)
    if (!sid) {
      try {
        const bounds = computeChapterBounds();
        const chaptersText = chaptersParam ? chaptersParam : `${start}~${end}강`;

        // 프로필
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

        const { data, error } = await supabase
          .from('test_sessions')
          .insert([{
            mode: 'official',
            status: 'draft', // ✅ fallback도 draft로
            student_id: me?.id,
            student_name: profileName,
            teacher_name: profileTeacher,
            book,
            chapters_text: chaptersText,
            chapter_start: bounds.chapter_start,
            chapter_end: bounds.chapter_end,
            num_questions: seq.length,
            cutoff_miss: cutMiss,
            duration_sec: 6,
            auto_score: null,
            auto_pass: null
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
    const autoPass = (seq.length - autoScore) <= cutMiss;

    // 1) 세션 UPDATE: 제출 시점에만 submitted로 전환
    try {
      const { error } = await supabase
        .from('test_sessions')
        .update({
          status: 'submitted',        // ✅ 여기서만 submitted
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
        word_id: r?.word?.id ?? null,
        term_en: r?.word?.term_en ?? '',
        meaning_ko: r?.word?.meaning_ko ?? '',
        student_answer: r?.your ?? '',
        auto_ok: !!r?.ok,
        final_ok: null
      }));
      const { error } = await supabase.from('test_items').insert(rows);
      if (error) throw error;
    } catch (err) {
      console.error('[OfficialExam] items insert failed:', err);
      alert(`제출 중 오류(문항 저장): ${err?.message || err}`);
      setPhase('submitted');
      return;
    }

    setPhase('submitted');
  }

  // 잘못된 진입 처리
  if (!book) {
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

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
        <div className="student-container">
          <div className="student-card stack">
            {/* config 단계: 책/범위/문항수/컷 설정 */}
            {phase === 'config' && (
              <>
                <div className="student-row">
                  <div>
                    <div style={{ fontSize: 13, color: '#444' }}>책 / 범위</div>
                    <div style={styles.info}>
                      {book} | {chaptersParam ? `챕터: ${chaptersParam}` : `${start}~${end}강`}
                    </div>
                  </div>
                  <div />
                  <div>
                    <div style={{ fontSize: 13, color: '#444' }}>문제 수</div>
                    <input
                      style={styles.input}
                      value={numQ}
                      onChange={(e) => setNumQ(Number(e.target.value || 0))}
                      type="number"
                      min={1}
                      max={999}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#444' }}>커트라인(-X컷)</div>
                    <input
                      style={styles.input}
                      value={cutMiss}
                      onChange={(e) => setCutMiss(Number(e.target.value || 0))}
                      type="number"
                      min={0}
                      max={999}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <button className="btn" style={styles.btn} onClick={startExam}>시작하기</button>
                </div>
              </>
            )}

            {/* exam 단계: 타이머 + 제출 */}
            {phase === 'exam' && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
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
                    onKeyDown={(e) => { if (e.key === 'Enter') submitCurrent(answer); }}
                  />
                </div>

                <div style={{ marginTop: 12 }}>
                  <button className="btn" style={styles.btn} onClick={() => submitCurrent(answerRef.current)}>
                    제출(Enter)
                  </button>
                </div>
              </div>
            )}

            {/* submitted 단계: 안내 */}
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
