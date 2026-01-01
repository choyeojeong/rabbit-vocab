// src/pages/BookRangePage.jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBooks, parseChapterInput } from '../utils/vocab';
import StudentShell from './StudentShell';

const styles = {
  page: { minHeight: '100vh', background: '#fff5f8', padding: 16 },
  wrap: { maxWidth: 860, margin: '0 auto' },
  card: { background: '#fff', border: '1px solid #ffd3e3', borderRadius: 14, padding: 16, boxShadow: '0 8px 30px rgba(255,111,163,0.08)' },
  title: { fontSize: 20, fontWeight: 900, color: '#333', marginBottom: 8 },
  sub: { fontSize: 13, color: '#666', marginBottom: 12, lineHeight: 1.4 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 },
  label: { fontSize: 12, color: '#666', marginBottom: 6 },
  input: { width: '100%', padding: '12px 12px', border: '1px solid #ffd3e3', borderRadius: 10, outline: 'none', fontSize: 14 },
  select: { width: '100%', padding: '12px 12px', border: '1px solid #ffd3e3', borderRadius: 10, outline: 'none', fontSize: 14, background: '#fff' },
  btn: { padding: '12px 14px', borderRadius: 10, border: 'none', color: '#fff', fontWeight: 800, cursor: 'pointer', background: '#ff6fa3' },
  btn2: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ffd3e3', color: '#333', fontWeight: 800, cursor: 'pointer', background: '#fff' },
  btnDanger: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ffb8c9', color: '#b00020', fontWeight: 800, cursor: 'pointer', background: '#fff' },
  pill: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 999, background: '#fff0f5', border: '1px dashed #ff9fc0', fontSize: 12, color: '#b00020' },
  listHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  listTitle: { fontSize: 15, fontWeight: 900, color: '#333' },
  item: { border: '1px solid #ffd3e3', borderRadius: 12, padding: 12, background: '#fff', marginTop: 10 },
  itemTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  bookName: { fontSize: 14, fontWeight: 900, color: '#333' },
  meta: { fontSize: 12, color: '#777', marginTop: 6 },
  actionRow: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  hr: { border: 'none', borderTop: '1px dashed #ffd3e3', margin: '14px 0' },
  bottomBar: { marginTop: 14, display: 'grid', gap: 10 },
  note: { fontSize: 12, color: '#777', lineHeight: 1.4 },
};

function normalizeChapterText(t) {
  return (t ?? '').toString().replace(/\s+/g, '').trim();
}

function buildRangeLabel(chapterInput) {
  const raw = normalizeChapterText(chapterInput);
  const parsed = parseChapterInput(raw);
  if (!raw) return { text: '범위 미지정', ok: false, parsed: [] };
  if (!parsed.length) return { text: '형식 오류', ok: false, parsed: [] };
  const min = Math.min(...parsed);
  const max = Math.max(...parsed);
  const count = parsed.length;
  const compact = raw.length > 26 ? `${raw.slice(0, 26)}…` : raw;
  return { text: `챕터: ${compact}  (총 ${count}개 · ${min}~${max}강)`, ok: true, parsed };
}

export default function BookRangePage({ mode = 'practice' }) {
  const nav = useNavigate();
  const isOfficial = mode === 'official';

  const [loadingBooks, setLoadingBooks] = useState(true);
  const [books, setBooks] = useState([]);

  // 선택 UI(추가용)
  const [pickBook, setPickBook] = useState('');
  const [pickChapters, setPickChapters] = useState('');

  // ✅ 다중 선택 목록
  // item: { id, book, chaptersText }
  const [selections, setSelections] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingBooks(true);
        const bs = await fetchBooks();
        setBooks(bs || []);
        if ((bs || []).length) setPickBook(bs[0]);
      } finally {
        setLoadingBooks(false);
      }
    })();
  }, []);

  const selectedBooksSet = useMemo(() => {
    return new Set(selections.map((s) => s.book));
  }, [selections]);

  function addSelection() {
    const b = (pickBook || '').trim();
    const t = normalizeChapterText(pickChapters);

    if (!b) return alert('책을 선택해 주세요.');
    if (!t) return alert('챕터 범위를 입력해 주세요. 예) 4-8,10,12');

    const info = buildRangeLabel(t);
    if (!info.ok) return alert('챕터 입력 형식이 올바르지 않아요. 예) 4-8,10,12');

    // 같은 책이 이미 있으면 "범위 업데이트"로 처리
    if (selectedBooksSet.has(b)) {
      setSelections((prev) =>
        prev.map((s) => (s.book === b ? { ...s, chaptersText: t } : s))
      );
      setPickChapters('');
      return;
    }

    setSelections((prev) => [
      ...prev,
      { id: crypto?.randomUUID?.() || String(Date.now() + Math.random()), book: b, chaptersText: t },
    ]);
    setPickChapters('');
  }

  function removeSelection(id) {
    setSelections((prev) => prev.filter((s) => s.id !== id));
  }

  function updateChapters(id, text) {
    const t = normalizeChapterText(text);
    setSelections((prev) => prev.map((s) => (s.id === id ? { ...s, chaptersText: t } : s)));
  }

  function buildNavState() {
    // ✅ pages/PracticeMCQ, MockExamPage, OfficialExamPage는 selections를 읽도록 수정된 상태 기준
    // selections: [{ book, chapters }]
    const normalized = selections
      .map((s) => ({
        book: s.book,
        chapters: parseChapterInput(s.chaptersText), // number[]
        // raw string이 필요하면 여기에 같이 붙여도 됨: chaptersText: s.chaptersText
      }))
      .filter((x) => x.book && x.chapters && x.chapters.length);

    if (!normalized.length) return null;

    // 레거시 호환: 1개일 때 book/chapters도 같이 넣어줌(기존 페이지가 혹시 단일을 참조해도 안전)
    const legacy = normalized.length === 1 ? { book: normalized[0].book, chapters: normalized[0].chapters } : {};
    return { selections: normalized, ...legacy };
  }

  function goPracticeMCQ() {
    const st = buildNavState();
    if (!st) return alert('선택한 책 목록에 최소 1권 + 챕터 범위를 입력해 주세요.');
    nav('/practice/mcq', { state: st });
  }

  function goMock() {
    const st = buildNavState();
    if (!st) return alert('선택한 책 목록에 최소 1권 + 챕터 범위를 입력해 주세요.');
    nav('/practice/mock', { state: st });
  }

  function goOfficial() {
    const st = buildNavState();
    if (!st) return alert('선택한 책 목록에 최소 1권 + 챕터 범위를 입력해 주세요.');
    nav('/exam/official', { state: st });
  }

  return (
    <StudentShell>
      <div style={styles.page}>
        <div style={styles.wrap}>
          <div style={styles.card}>
            <div style={styles.title}>
              {isOfficial ? '공식시험 범위 선택' : '연습 범위 선택'}
            </div>
            <div style={styles.sub}>
              책을 선택하고 챕터 범위를 입력한 뒤 <b>추가</b>를 누르면 아래 <b>선택한 책 목록</b>에 쌓입니다. <br />
              목록에서 <b>범위 수정</b>하거나 <b>선택 해제</b>할 수 있어요. (예: <b>4-8,10,12</b>)
            </div>

            {/* 선택/추가 영역 */}
            <div style={styles.row2}>
              <div>
                <div style={styles.label}>책 선택</div>
                <select
                  style={styles.select}
                  value={pickBook}
                  onChange={(e) => setPickBook(e.target.value)}
                  disabled={loadingBooks || !books.length}
                >
                  {(books || []).map((b) => (
                    <option key={b} value={b}>
                      {b}{selectedBooksSet.has(b) ? ' (선택됨)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={styles.label}>챕터 입력</div>
                <input
                  style={styles.input}
                  value={pickChapters}
                  onChange={(e) => setPickChapters(e.target.value)}
                  placeholder="예) 4-8,10,12"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            </div>

            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={styles.pill}>
                💡 같은 책을 다시 추가하면 <b>그 책 범위가 업데이트</b>돼요.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={styles.btn2} onClick={() => { setPickChapters(''); }}>
                  입력 비우기
                </button>
                <button type="button" style={styles.btn} onClick={addSelection} disabled={loadingBooks || !books.length}>
                  + 목록에 추가
                </button>
              </div>
            </div>

            <hr style={styles.hr} />

            {/* ✅ 선택한 책 목록 */}
            <div style={styles.listHead}>
              <div style={styles.listTitle}>선택한 책 목록</div>
              <div style={{ fontSize: 12, color: '#777' }}>
                {selections.length ? `${selections.length}권 선택됨` : '아직 선택된 책이 없어요'}
              </div>
            </div>

            {selections.length === 0 ? (
              <div style={styles.note}>
                위에서 책/범위를 입력하고 <b>목록에 추가</b>를 눌러주세요.
              </div>
            ) : (
              <div>
                {selections.map((s, idx) => {
                  const info = buildRangeLabel(s.chaptersText);
                  return (
                    <div key={s.id} style={styles.item}>
                      <div style={styles.itemTop}>
                        <div>
                          <div style={styles.bookName}>
                            {idx + 1}. {s.book}
                          </div>
                          <div style={styles.meta}>
                            {info.ok ? info.text : '챕터 입력이 비어있거나 형식이 올바르지 않아요.'}
                          </div>
                        </div>

                        <div style={styles.actionRow}>
                          <button type="button" style={styles.btnDanger} onClick={() => removeSelection(s.id)}>
                            선택 해제
                          </button>
                        </div>
                      </div>

                      {/* ✅ 범위 수정 */}
                      <div style={{ marginTop: 10 }}>
                        <div style={styles.label}>범위 수정 (챕터 입력)</div>
                        <input
                          style={styles.input}
                          value={s.chaptersText}
                          onChange={(e) => updateChapters(s.id, e.target.value)}
                          placeholder="예) 4-8,10,12"
                          autoCapitalize="none"
                          autoCorrect="off"
                        />
                        {!info.ok && (
                          <div style={{ marginTop: 6, fontSize: 12, color: '#b00020' }}>
                            ⚠️ 형식 예시: <b>4-8,10,12</b>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <hr style={styles.hr} />

            {/* 하단 실행 버튼 */}
            <div style={styles.bottomBar}>
              {!isOfficial ? (
                <div style={styles.row2}>
                  <button type="button" style={styles.btn} onClick={goPracticeMCQ}>
                    객관식 연습 시작
                  </button>
                  <button type="button" style={styles.btn} onClick={goMock}>
                    모의시험 시작
                  </button>
                </div>
              ) : (
                <button type="button" style={styles.btn} onClick={goOfficial}>
                  공식시험 시작
                </button>
              )}

              <div style={styles.note}>
                • 다중 책 선택 시, 선택한 모든 책/범위에서 단어가 합쳐져 랜덤으로 출제됩니다. <br />
                • 목록에서 범위를 수정하면 바로 반영돼요.
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <button type="button" style={styles.btn2} onClick={() => nav('/dashboard')}>
                  대시보드
                </button>
                <button type="button" style={styles.btn2} onClick={() => setSelections([])}>
                  전체 선택 해제
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
