// src/pages/PracticeMCQ.jsx
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  fetchWordsInRange,
  fetchWordsInBook,
  fetchWordsByChapters,
  parseChapterInput,
  buildMCQOptions,
} from '../utils/vocab';
import { supabase } from '../utils/supabaseClient';
import { getSession } from '../utils/session';
import { speakWord, speakCancel } from '../utils/speech';

const styles = {
  page: { minHeight: '100vh', background: '#fff5f8', padding: 24 },
  box: { maxWidth: 900, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 8px 24px rgba(255,192,217,0.35)' },
  title: { fontSize: 22, fontWeight: 800, color: '#ff6fa3', marginBottom: 8 },
  card: { marginTop: 18, border: '1px solid #ffd3e3', borderRadius: 12, padding: 20 },
  termRow: { display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginBottom: 8 },
  term: { fontSize: 28, fontWeight: 900, color: '#333', textAlign: 'center' },
  btns: { display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 16 },
  opt: { padding: '12px 14px', borderRadius: 10, border: '1px solid #ffd3e3', background: '#fff', cursor: 'pointer', textAlign: 'left' },
  correct: { background: '#e7fff3', borderColor: '#b3f0d0' },
  wrong: { background: '#ffe3ea', borderColor: '#ffb8c9' },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  next: { padding: '10px 14px', background: '#ff8fb7', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' },
  info: { fontSize: 13, color: '#777' },
  wrongItem: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ffd3e3', background: '#fff', marginTop: 10 },
  tagWrong: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: '#ffe3ea', color: '#b00020', fontSize: 12, marginLeft: 6 },
  btnRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 },
  speakerBtn: { border: '1px solid #ffd0e1', background: '#fff5f8', borderRadius: 12, padding: '8px 10px', cursor: 'pointer' },
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

export default function PracticeMCQ() {
  const nav = useNavigate();
  const q = useQuery();
  const book = q.get('book');
  const start = Number(q.get('start'));
  const end = Number(q.get('end'));
  const chaptersParam = q.get('chapters'); // "4-8,10,12"

  const [phase, setPhase] = useState('play'); // 'play' | 'done'
  const [words, setWords] = useState([]);
  const [allPool, setAllPool] = useState([]);
  const [i, setI] = useState(0);
  const [opts, setOpts] = useState([]);
  const [ansIdx, setAnsIdx] = useState(-1);
  const [chosen, setChosen] = useState(-1);
  const [score, setScore] = useState(0);
  const [wrongs, setWrongs] = useState([]);

  const current = words[i];
  const me = getSession();

  // 데이터 로딩
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!book) return;

        let range = [];
        if (chaptersParam) {
          const list = parseChapterInput(chaptersParam);
          range = await fetchWordsByChapters(book, list);
        } else if (start && end) {
          range = await fetchWordsInRange(book, start, end);
        }

        if (!mounted) return;
        setWords(range);
        setI(0);
        setScore(0);
        setChosen(-1);
        setWrongs([]);
        setPhase('play');

        try {
          const poolAll = await fetchWordsInBook(book);
          if (!mounted) return;
          setAllPool((poolAll && poolAll.length) ? poolAll : range);
        } catch (e) {
          console.warn('MCQ: book pool load failed, fallback to range', e);
          if (!mounted) return;
          setAllPool(range);
        }
      } catch (e) {
        console.error('MCQ: load failed', e);
        if (!mounted) return;
        setWords([]);
        setAllPool([]);
      }
    })();
    return () => { mounted = false; };
  }, [book, start, end, chaptersParam]);

  // 보기 생성
  useEffect(() => {
    if (!current || allPool.length === 0) return;
    const { options, answerIndex } = buildMCQOptions(current, allPool, words);
    setOpts(options);
    setAnsIdx(answerIndex);
    setChosen(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, current, allPool]);

  // 문제 변경 시 자동 발음
  useEffect(() => {
    if (!current?.term_en) return;
    speakWord(current.term_en);
    return () => speakCancel();
  }, [current?.id]);

  // 정오 저장
  async function record(action) {
    try {
      await supabase.from('study_logs').insert([
        {
          student_id: me?.id,
          book,
          chapter: current?.chapter,
          word_id: current?.id,
          action,
          payload: { mode: 'mcq' },
        },
      ]);
    } catch (e) {
      console.warn('log fail', e);
    }
  }

  // 보기 클릭: 더 이상 발음하지 않음
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

  if (!book) return <div style={styles.page}><div style={styles.box}>잘못된 접근입니다.</div></div>;
  if (!words.length) return <div style={styles.page}><div style={styles.box}>선택한 범위에 단어가 없어요.</div></div>;

  return (
    <div style={styles.page}>
      <div style={styles.box}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h1 style={styles.title}>객관식 연습</h1>
          <div style={styles.info}>
            {book} | {chaptersParam ? `챕터: ${chaptersParam}` : `${start}~${end}강`} | {phase === 'play' ? `${i + 1}/${words.length}` : `${words.length}문제 완료`} | 점수 {score}
          </div>
        </div>

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

        {phase === 'done' && (
          <div style={styles.card}>
            <div><b>연습 종료!</b> 점수: {score} / {words.length}</div>

            {wrongs.length > 0 ? (
              <>
                <div style={{ marginTop: 12, fontWeight: 700 }}>오답 목록 (정답 포함)</div>
                {wrongs.map((w, idx) => (
                  <div key={idx} style={styles.wrongItem}>
                    <div><b>{idx + 1}. {w.word.term_en}</b> <span style={styles.tagWrong}>오답</span></div>
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
  );
}
