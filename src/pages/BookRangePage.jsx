// src/pages/BookRangePage.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBooks, fetchChapters } from '../utils/vocab';

const styles = {
  page: { minHeight: '100vh', background: '#fff5f8', padding: 24 },
  box: {
    maxWidth: 900,
    margin: '0 auto',
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    boxShadow: '0 8px 24px rgba(255,192,217,0.35)',
  },
  title: { fontSize: 22, fontWeight: 800, color: '#ff6fa3', marginBottom: 8 },
  row: { display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 12, marginTop: 12 },
  label: { fontSize: 13, color: '#444' },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ffd3e3',
    borderRadius: 10,
    outline: 'none',
    fontSize: 14,
    background: '#fff',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #ffd3e3',
    borderRadius: 10,
    outline: 'none',
    fontSize: 14,
    background: '#fff',
  },
  hint: { fontSize: 12, color: '#888', marginTop: 6 },
  btns: { marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap' },
  btn: { padding: '12px 16px', borderRadius: 10, border: 'none', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  pink: { background: '#ff8fb7' },
  outline: { background: '#fff', color: '#ff6fa3', border: '2px solid #ff8fb7' },
  strongPink: { background: '#ff6fa3' },
};

export default function BookRangePage({ mode = 'practice' }) {
  const nav = useNavigate();
  const [books, setBooks] = useState([]);
  const [book, setBook] = useState('');
  const [chapters, setChapters] = useState([]); // 유효 챕터 안내용
  const [chapterInput, setChapterInput] = useState(''); // "4-8, 10, 12" 형식

  const isOfficial = mode === 'official';

  useEffect(() => {
    (async () => {
      const bs = await fetchBooks();
      setBooks(bs);
      if (bs[0]) setBook(bs[0]);
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
    <div style={styles.page}>
      <div style={styles.box}>
        <h1 style={styles.title}>{isOfficial ? '공식시험 준비' : '단어책 선택 & 챕터 직접 입력'}</h1>

        <div style={styles.row}>
          <div>
            <div style={styles.label}>단어책</div>
            <select style={styles.select} value={book} onChange={(e) => setBook(e.target.value)}>
              {books.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={styles.label}>챕터 (콤마/범위 입력 가능)</div>
            <input
              style={styles.input}
              value={chapterInput}
              onChange={(e) => setChapterInput(e.target.value)}
              placeholder="예: 4-8, 10, 12"
            />
            <div style={styles.hint}>
              유효 챕터: {chapters.join(', ') || '없음'}<br />
              예시 입력: <code>4-8</code>, <code>1, 3, 5</code>, <code>2-4, 7, 9-10</code>
            </div>
          </div>
        </div>

        <div style={styles.btns}>
          {isOfficial ? (
            <button style={{ ...styles.btn, ...styles.strongPink }} onClick={goOfficial}>시험보기(공식)</button>
          ) : (
            <>
              <button style={{ ...styles.btn, ...styles.pink }} onClick={goMCQ}>연습하기 → 객관식</button>
              <button style={{ ...styles.btn, ...styles.outline }} onClick={goMock}>연습하기 → 모의시험(6초)</button>
              {/* 공식 버튼은 practice 모드에서 노출 안 함 */}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
