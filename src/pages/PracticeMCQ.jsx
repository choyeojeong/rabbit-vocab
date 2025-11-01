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

export default function PracticeMCQ() {
  const nav = useNavigate();
  const loc = useLocation();
  const q = useQuery();

  // 레거시 쿼리
  const bookFromQuery = q.get('book') || '';
  const chaptersParam = q.get('chapters'); // "4-8,10,12"
  const startParam = q.get('start');
  const endParam = q.get('end');

  // state 우선
  const book = (loc.state?.book) || bookFromQuery;
  const chaptersFromState = ensureArray(loc.state?.chapters);   // number[] or []
  const chaptersFromQuery = parseChapterInput(chaptersParam);    // number[]

  const start = Number(startParam);
  const end = Number(endParam);

  const [phase, setPhase] = useState('play'); // 'play' | 'done'
  const [words, setWords] = useState([]);
  const [allPool, setAllPool] = useState([]);
  const [i, setI] = useState(0);
  const [opts, setOpts] = useState([]);
  const [ansIdx, setAnsIdx] = useState(-1);
  const [chosen, setChosen] = useState(-1);
  const [score, setScore] = useState(0);
  const [wrongs, setWrongs] = useState([]);

  // 🔊 모바일 오디오 unlock 상태
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('sound_enabled') === 'true';
  });

  const current = words[i];
  const me = getSession();

  // 사용할 챕터 배열 (우선순위: state > query > [])
  const chapterList = useMemo(() => {
    if (chaptersFromState.length) return chaptersFromState;
    if (chaptersFromQuery.length) return chaptersFromQuery;
    return [];
  }, [chaptersFromState, chaptersFromQuery]);

  // 데이터 로딩
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!book) {
          if (mounted) { setWords([]); setAllPool([]); }
          return;
        }

        // 1) 챕터 모드
        if (chapterList.length > 0) {
          const range = await fetchWordsByChapters(book, chapterList);
          if (!mounted) return;
          setWords(range || []);
          setI(0); setScore(0); setChosen(-1); setWrongs([]); setPhase('play');
        }
        // 2) 범위 모드
        else if (Number.isFinite(start) && Number.isFinite(end)) {
          const range = await fetchWordsInRange(book, start, end);
          if (!mounted) return;
          setWords(range || []);
          setI(0); setScore(0); setChosen(-1); setWrongs([]); setPhase('play');
        }
        // 3) 아무것도 없으면 빈 배열
        else {
          if (mounted) { setWords([]); setAllPool([]); }
          return;
        }

        // 보기 풀(책 전체) 로드, 실패 시 range로 폴백
        try {
          const poolAll = await fetchWordsInBook(book);
          if (!mounted) return;
          setAllPool((poolAll && poolAll.length) ? poolAll : (words.length ? words : []));
        } catch (e) {
          console.warn('MCQ: book pool load failed, fallback to range', e);
          if (!mounted) return;
          setAllPool(words.length ? words : []);
        }
      } catch (e) {
        console.error('MCQ: load failed', e);
        if (!mounted) return;
        setWords([]);
        setAllPool([]);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapterList.join(','), start, end]);

  // 보기 생성
  useEffect(() => {
    if (!current || allPool.length === 0) return;
    const { options, answerIndex } = buildMCQOptions(current, allPool, words);
    setOpts(options);
    setAnsIdx(answerIndex);
    setChosen(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, current?.id, allPool.length]);

  // 문제 변경 시 자동 발음 (🔊 soundEnabled 일 때만)
  useEffect(() => {
    if (!current?.term_en) return;
    if (!soundEnabled) return;
    speakWord(current.term_en);
    return () => speakCancel();
  }, [current?.id, soundEnabled]);

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

  // 보기 클릭(발음 없음)
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

  if (!book) {
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

  // 상단 표시 텍스트
  const chapterText = chapterList.length
    ? chapterList.join(', ')
    : (chaptersParam
        ? chaptersParam
        : (Number.isFinite(start) && Number.isFinite(end)
            ? `${Math.min(start, end)}~${Math.max(start, end)}강`
            : '미지정'));

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
            <div style={{ display: 'flex', justifyContent: 'space-between', color:'#444', fontSize:13 }}>
              <div>{book} | {chapterText.startsWith('미지정') ? '범위: 미지정' : `챕터/범위: ${chapterText}`}</div>
              <div>{phase === 'play' ? `${i + 1}/${words.length}` : `${words.length}문제 완료`} | 점수 {score}</div>
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
      </div>
    </StudentShell>
  );
}
