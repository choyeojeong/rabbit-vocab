// src/pages/BookRangePage.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBooks, fetchChapters } from '../utils/vocab';
import StudentShell from './StudentShell';

export default function BookRangePage({ mode = 'practice' }) {
  const nav = useNavigate();
  const [books, setBooks] = useState([]);
  const [book, setBook] = useState('');
  const [chapters, setChapters] = useState([]);       // 유효 챕터 안내용
  const [chapterInput, setChapterInput] = useState(''); // "4-8, 10, 12" 형식

  const isOfficial = mode === 'official';

  useEffect(() => {
    (async () => {
      const bs = await fetchBooks();
      setBooks(bs);
      if (bs && bs.length) setBook(bs[0]);
    })();
  }, []);

  useEffect(() => {
    if (!book) return;
    (async () => {
      const cs = await fetchChapters(book);
      setChapters(cs);
      if (!chapterInput && cs.length) {
        const first = cs[0];
        const last = cs[cs.length - 1];
        setChapterInput(`${first}-${last}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  function guard() {
    if (!book || !chapterInput.trim()) {
      alert('책과 챕터 입력을 확인해 주세요.');
      return false;
    }
    return true;
  }

  function goMCQ() {
    if (!guard()) return;
    nav(`/practice/mcq?book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`);
  }
  function goMock() {
    if (!guard()) return;
    nav(`/practice/mock?book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`);
  }
  function goOfficial() {
    if (!guard()) return;
    nav(`/exam/official?book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`);
  }

  return (
    <StudentShell title={isOfficial ? '공식시험 준비' : '단어책 선택 & 챕터 직접 입력'}>
      {/* ✅ 모바일에서 select/input이 삐져나오지 않도록
          .student-row(그리드 1fr 1fr) + 내부 필드 width:100% 를 사용 */}
      <div className="student-text">
        <div className="student-row">
          <div>
            <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>단어책</div>
            <select
              className="student-field"
              value={book}
              onChange={(e) => setBook(e.target.value)}
              style={fieldStyle}
            >
              {books.length === 0 ? (
                <option value="" disabled>불러오는 중…</option>
              ) : (
                books.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))
              )}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>챕터 (콤마/범위 입력 가능)</div>
            <input
              className="student-field"
              style={fieldStyle}
              value={chapterInput}
              onChange={(e) => setChapterInput(e.target.value)}
              placeholder="예: 4-8, 10, 12"
              inputMode="numeric"
            />
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#888', marginTop: 8, wordBreak: 'keep-all' }}>
          유효 챕터: {chapters.join(', ') || '없음'}<br />
          예시 입력: <code>4-8</code>, <code>1, 3, 5</code>, <code>2-4, 7, 9-10</code>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          {isOfficial ? (
            <button className="button-lg" onClick={goOfficial}>시험보기(공식)</button>
          ) : (
            <>
              <button className="button-lg" onClick={goMCQ}>연습하기 → 객관식</button>
              <button
                className="button-lg"
                onClick={goMock}
                style={{ background: '#fff', color: '#ff6fa3', border: '2px solid #ff8fb7' }}
              >
                연습하기 → 모의시험(6초)
              </button>
            </>
          )}
        </div>
      </div>
    </StudentShell>
  );
}

/* 인라인 최소 스타일(모바일 overflow 방지용) */
const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  border: '1px solid #ffd3e3',
  borderRadius: 10,
  outline: 'none',
  fontSize: 14,
  background: '#fff',
};
