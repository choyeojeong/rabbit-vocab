// src/pages/BookRangePage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBooks, fetchChapters, parseChapterInput } from '../utils/vocab';
import StudentShell from './StudentShell';

export default function BookRangePage({ mode = 'practice' }) {
  const nav = useNavigate();
  const [books, setBooks] = useState([]);
  const [book, setBook] = useState('');
  const [chapters, setChapters] = useState([]);         // [number]
  const [chapterInput, setChapterInput] = useState(''); // raw text
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [err, setErr] = useState('');

  const isOfficial = mode === 'official';

  // 중복 호출 방지(포커스 이벤트 연타)
  const reloadingRef = useRef(false);

  async function reloadBooks({ keepSelection = true } = {}) {
    if (reloadingRef.current) return;
    reloadingRef.current = true;

    try {
      setErr('');
      setLoadingBooks(true);

      const bs = await fetchBooks();
      setBooks(bs || []);

      // ✅ 선택된 book 유지/보정
      if (keepSelection) {
        // 현재 선택 book이 새 목록에 없으면 첫 번째로 교체
        if (book && bs?.includes(book)) {
          // 유지
        } else if (bs && bs.length) {
          setBook(bs[0]);
        } else {
          setBook('');
        }
      } else {
        if (bs && bs.length) setBook(bs[0]);
        else setBook('');
      }
    } catch (e) {
      console.error(e);
      setErr(e?.message || '단어책 목록을 불러오지 못했습니다.');
      setBooks([]);
      setBook('');
    } finally {
      setLoadingBooks(false);
      reloadingRef.current = false;
    }
  }

  // 최초 로드
  useEffect(() => {
    reloadBooks({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ 업로드 후 “다른 탭 갔다가 돌아오거나” 앱 재활성화 시 자동 반영
  useEffect(() => {
    const onFocus = () => {
      // 너무 자주 호출되는 걸 막기 위해 가드만 둠
      reloadBooks({ keepSelection: true });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // book 바뀌면 chapters 로드
  useEffect(() => {
    if (!book) {
      setChapters([]);
      return;
    }

    let alive = true;
    (async () => {
      try {
        setErr('');
        setLoadingChapters(true);

        const cs = await fetchChapters(book);
        if (!alive) return;

        console.log('[fetchChapters]', {
          book,
          len: cs.length,
          first: cs[0],
          last: cs[cs.length - 1],
          sample: cs.slice(0, 30),
        });

        setChapters(cs);

        // 초기 진입 시 기본 범위를 자동 채움 (예: 1-끝)
        if (!chapterInput && cs.length) {
          const first = cs[0];
          const last = cs[cs.length - 1];
          setChapterInput(`${first}-${last}`);
        }
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setErr(e?.message || '챕터 목록을 불러오지 못했습니다.');
        setChapters([]);
      } finally {
        if (alive) setLoadingChapters(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // 입력된 텍스트를 파싱한 "요청 챕터 배열"
  const requestedChapters = useMemo(() => parseChapterInput(chapterInput), [chapterInput]);

  // 실제 책의 유효 챕터와 교집합만 허용 (잘못된 번호 제거)
  const validRequested = useMemo(() => {
    if (!chapters?.length) return requestedChapters;
    const set = new Set(chapters);
    return requestedChapters.filter((n) => set.has(n));
  }, [requestedChapters, chapters]);

  function guardAndGetChapters() {
    if (!book) {
      alert('단어책을 선택해 주세요.');
      return null;
    }
    if (!chapterInput.trim()) {
      alert('챕터 입력을 확인해 주세요.');
      return null;
    }
    if (!requestedChapters.length) {
      alert('올바른 챕터 형식이 아닙니다. 예) 4-8, 10, 12');
      return null;
    }
    if (chapters.length && validRequested.length === 0) {
      alert('선택한 책에 존재하는 챕터가 아닙니다. 유효한 챕터로 다시 입력해 주세요.');
      return null;
    }
    // 유효 교집합이 있으면 그걸 사용, 없으면 파싱값 사용
    return (validRequested.length ? validRequested : requestedChapters);
  }

  function goMCQ() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`;
    nav(`/practice/mcq?${query}`, { state: { mode: 'practice', book, chapters: list } });
  }

  function goMock() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`;
    nav(`/practice/mock?${query}`, { state: { mode: 'practice', book, chapters: list } });
  }

  function goOfficial() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`;
    nav(`/exam/official?${query}`, { state: { mode: 'official', book, chapters: list } });
  }

  const btnDisabled = loadingBooks || loadingChapters || !book || !chapterInput.trim();

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
        <div className="student-container">
          <div className="student-card stack">
            {/* 상단: 새로고침 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="student-button"
                onClick={() => reloadBooks({ keepSelection: true })}
                disabled={loadingBooks}
                style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
                title="단어책 목록 새로고침"
              >
                ⟳ 책 목록 새로고침
              </button>
            </div>

            {err && <div style={{ marginTop: 8, color: '#d00', fontSize: 13 }}>{err}</div>}

            {/* 책/챕터 입력 */}
            <div className="student-row" style={{ marginTop: 8 }}>
              <div>
                <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>단어책</div>
                <select
                  className="student-field"
                  value={book}
                  onChange={(e) => setBook(e.target.value)}
                  style={fieldStyle}
                  disabled={loadingBooks}
                >
                  {loadingBooks ? (
                    <option value="" disabled>불러오는 중…</option>
                  ) : books.length === 0 ? (
                    <option value="" disabled>단어책이 없습니다</option>
                  ) : (
                    books.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>
                  챕터 (콤마/범위 입력 가능)
                </div>
                <input
                  className="student-field"
                  style={fieldStyle}
                  value={chapterInput}
                  onChange={(e) => setChapterInput(e.target.value)}
                  placeholder="예: 4-8, 10, 12"
                  inputMode="text"
                  autoCapitalize="none"
                />
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#888', marginTop: 8, wordBreak: 'keep-all' }}>
              유효 챕터: {chapters.join(', ') || (loadingChapters ? '불러오는 중…' : '없음')}<br />
              예시 입력: <code>4-8</code>, <code>1, 3, 5</code>, <code>2-4, 7, 9-10</code><br />
              선택됨: {requestedChapters.length ? requestedChapters.join(', ') : '없음'}
              {chapters.length > 0 && requestedChapters.length > 0 && requestedChapters.length !== validRequested.length
                ? ` → 유효: ${validRequested.join(', ') || '없음'}`
                : ''}
            </div>

            {/* 버튼 */}
            <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
              {isOfficial ? (
                <button className="button-lg" onClick={goOfficial} disabled={btnDisabled}>
                  시험보기(공식)
                </button>
              ) : (
                <>
                  <button className="button-lg" onClick={goMCQ} disabled={btnDisabled}>
                    연습하기 → 객관식
                  </button>
                  <button
                    className="button-lg"
                    onClick={goMock}
                    disabled={btnDisabled}
                    style={{ background: '#fff', color: '#ff6fa3', border: '2px solid #ff8fb7' }}
                  >
                    연습하기 → 모의시험(6초)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </StudentShell>
  );
}

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
