// src/pages/admin/WrongBooksAdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../../utils/supabaseClient";

dayjs.locale("ko");

/**
 * ✅ 변경사항
 * 1) 가운데 흰색 네모(고정 maxWidth 박스) 제거 → 화면 전체 사용
 * 2) iPhone 모바일 최적화
 *    - safe-area(노치/홈바) 대응
 *    - 100dvh / sticky header
 *    - 터치 타겟 44px
 *    - 3열 필터 → 모바일 1열 자동
 * 3) "허용단어(accepted_ko)" 표시 제거
 *    - 그 자리에 "학생 오답(student_answer)" 표시
 *
 * ⚠️ 전제
 * - wrong_book_items 테이블에 student_answer 컬럼이 존재한다고 가정합니다.
 */

const THEME = {
  pageBg: "transparent", // ✅ AdminGate 배경 사용
  bg: "#f7f9fc",
  cardBg: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  border2: "#f1f4f8",
  borderPink: "#ffd3e3",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  link: "#2b59ff",
  danger: "#b00020",
};

const btnBase = {
  height: 44,
  padding: "0 14px",
  borderRadius: 999,
  border: `1px solid ${THEME.border}`,
  background: "#fff",
  color: THEME.text,
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 10px 22px rgba(31,42,68,.06)",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  whiteSpace: "nowrap",
};

const pinkBtn = {
  height: 44,
  padding: "0 16px",
  borderRadius: 999,
  border: "none",
  background: THEME.pink,
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 10px 22px rgba(255,111,163,.18)",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  whiteSpace: "nowrap",
};

const inputStyle = {
  width: "100%",
  height: 44,
  padding: "0 12px",
  borderRadius: 12,
  border: `1px solid ${THEME.border}`,
  outline: "none",
  background: "#fff",
  color: THEME.text,
  fontWeight: 800,
  boxShadow: "0 10px 22px rgba(31,42,68,.06)",
};

const labelStyle = {
  fontSize: 12,
  color: THEME.sub,
  fontWeight: 900,
  marginBottom: 6,
};

export default function WrongBooksAdminPage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // wrong_books 전체(또는 필터) 로드
  const [rows, setRows] = useState([]);

  // 학생/월 필터 + 검색
  const [studentFilter, setStudentFilter] = useState(""); // owner_student_id
  const [monthFilter, setMonthFilter] = useState(""); // yyyy_mm
  const [q, setQ] = useState("");

  // 펼침 상태 (wrong_book_id -> boolean)
  const [openMap, setOpenMap] = useState(() => new Map());

  // 아이템 캐시 (wrong_book_id -> { loading, err, items[] })
  const [itemsByBook, setItemsByBook] = useState(() => new Map());

  async function loadAll() {
    try {
      setErr("");
      setLoading(true);

      let query = supabase
        .from("wrong_books")
        .select(
          "id, owner_student_id, owner_name, title, yyyy_mm, exam_date, created_at, source_book, source_chapters_text, source_session_id, source_mode"
        )
        .order("created_at", { ascending: false });

      if (studentFilter) query = query.eq("owner_student_id", studentFilter);
      if (monthFilter) query = query.eq("yyyy_mm", monthFilter);

      const { data, error } = await query;
      if (error) throw error;

      setRows(data || []);
    } catch (e) {
      console.error(e);
      setRows([]);
      setErr("오답 노트 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentFilter, monthFilter]);

  // 학생 옵션 (현재 wrong_books에 존재하는 학생들)
  const studentOptions = useMemo(() => {
    const map = new Map(); // id -> name
    for (const r of rows) {
      const sid = r.owner_student_id;
      const name = (r.owner_name || "").trim();
      if (sid && !map.has(sid)) map.set(sid, name || sid);
    }
    const arr = Array.from(map.entries()).map(([id, name]) => ({ id, name }));
    arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return arr;
  }, [rows]);

  // 월 옵션(필터)
  const monthOptions = useMemo(() => {
    const set = new Set();
    for (const r of rows) set.add(r.yyyy_mm || "기타");
    const arr = Array.from(set).filter(Boolean);
    arr.sort((a, b) => (b || "").localeCompare(a || "")); // 최근월 우선
    return arr;
  }, [rows]);

  // 검색 적용(프론트)
  const filteredRows = useMemo(() => {
    const text = (q || "").trim().toLowerCase();
    if (!text) return rows;

    return (rows || []).filter((r) => {
      const a = (r.owner_name || "").toLowerCase();
      const b = (r.title || "").toLowerCase();
      const c = (r.source_book || "").toLowerCase();
      const d = (r.source_chapters_text || "").toLowerCase();
      return (
        a.includes(text) ||
        b.includes(text) ||
        c.includes(text) ||
        d.includes(text) ||
        (r.yyyy_mm || "").toLowerCase().includes(text)
      );
    });
  }, [rows, q]);

  // ✅ 학생별 → 월별 그룹핑
  const grouped = useMemo(() => {
    const byStudent = new Map(); // sid -> { sid, name, months: Map(month -> rows[]) }
    for (const r of filteredRows) {
      const sid = r.owner_student_id || "unknown";
      const name = (r.owner_name || "이름없음").trim();

      if (!byStudent.has(sid)) byStudent.set(sid, { sid, name, months: new Map() });
      const obj = byStudent.get(sid);

      const month = r.yyyy_mm || "기타";
      if (!obj.months.has(month)) obj.months.set(month, []);
      obj.months.get(month).push(r);
    }

    const students = Array.from(byStudent.values()).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );

    for (const s of students) {
      const monthKeys = Array.from(s.months.keys()).sort((a, b) =>
        (b || "").localeCompare(a || "")
      );
      const newMonths = new Map();
      for (const mk of monthKeys) {
        const arr = s.months.get(mk) || [];
        arr.sort((x, y) => {
          const xd = x.exam_date ? new Date(x.exam_date).getTime() : 0;
          const yd = y.exam_date ? new Date(y.exam_date).getTime() : 0;
          if (yd !== xd) return yd - xd;
          return new Date(y.created_at).getTime() - new Date(x.created_at).getTime();
        });
        newMonths.set(mk, arr);
      }
      s.months = newMonths;
    }

    return students;
  }, [filteredRows]);

  function toggleOpen(wrongBookId) {
    setOpenMap((prev) => {
      const n = new Map(prev);
      n.set(wrongBookId, !n.get(wrongBookId));
      return n;
    });
  }

  async function loadItemsIfNeeded(wrongBookId) {
    const cached = itemsByBook.get(wrongBookId);
    if (cached?.items && Array.isArray(cached.items)) return;

    setItemsByBook((prev) => {
      const n = new Map(prev);
      n.set(wrongBookId, { loading: true, err: "", items: null });
      return n;
    });

    try {
      // ✅ accepted_ko 제거 + student_answer 추가
      const { data, error } = await supabase
        .from("wrong_book_items")
        .select("id, wrong_book_id, word_id, term_en, meaning_ko, pos, student_answer, created_at")
        .eq("wrong_book_id", wrongBookId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setItemsByBook((prev) => {
        const n = new Map(prev);
        n.set(wrongBookId, { loading: false, err: "", items: data || [] });
        return n;
      });
    } catch (e) {
      console.error(e);
      setItemsByBook((prev) => {
        const n = new Map(prev);
        n.set(wrongBookId, {
          loading: false,
          err: "오답 단어를 불러오지 못했습니다.",
          items: [],
        });
        return n;
      });
    }
  }

  function onClickBook(r) {
    const id = r.id;
    const willOpen = !openMap.get(id);
    toggleOpen(id);
    if (willOpen) loadItemsIfNeeded(id);
  }

  return (
    <div style={styles.page}>
      {/* ✅ sticky header */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.headerTop}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.hTitle}>
                오답노트(관리자)
                <span style={styles.hBadge}>Wrong Books</span>
              </div>
              <div style={styles.hSub}>학생별 → 월별 → 오답파일(세션) 구조로 확인합니다.</div>
            </div>

            <div style={styles.headerBtns}>
              <button style={btnBase} onClick={() => nav("/dashboard")}>
                ← 대시보드
              </button>
              <button style={pinkBtn} onClick={loadAll} disabled={loading}>
                {loading ? "불러오는 중…" : "새로고침"}
              </button>
            </div>
          </div>

          {/* 에러 */}
          {err && <div style={styles.errBox}>{err}</div>}

          {/* 필터 */}
          <div style={styles.filterCard}>
            <div className="_wb_filterGrid" style={styles.filterGrid}>
              <div>
                <div style={labelStyle}>학생 필터</div>
                <select
                  value={studentFilter}
                  onChange={(e) => setStudentFilter(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">(전체 학생)</option>
                  {studentOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={labelStyle}>월 필터</div>
                <select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">(전체 월)</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={labelStyle}>검색</div>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="학생/파일제목/원본책/범위/월 검색"
                  style={inputStyle}
                />
                <div style={{ marginTop: 6, fontSize: 11, color: THEME.sub, fontWeight: 800 }}>
                  예) “고3”, “2026-01”, “수능”, “4-8”
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <button
                style={btnBase}
                onClick={() => {
                  setStudentFilter("");
                  setMonthFilter("");
                  setQ("");
                }}
              >
                필터 초기화
              </button>

              <div style={{ fontSize: 12, color: THEME.sub, fontWeight: 900 }}>
                현재 {filteredRows.length}개 파일
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ 본문(전체 폭) */}
      <div style={styles.content}>
        {loading ? (
          <div style={styles.stateText}>불러오는 중…</div>
        ) : grouped.length === 0 ? (
          <div style={styles.emptyCard}>표시할 오답 파일이 없습니다.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {grouped.map((stu) => (
              <div key={stu.sid} style={styles.studentCard}>
                <div style={styles.studentHeader}>
                  <div style={styles.studentName}>
                    {stu.name}
                    <span style={styles.studentId}>({stu.sid?.slice?.(0, 8) || stu.sid})</span>
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  {Array.from(stu.months.entries()).map(([month, list]) => (
                    <div key={month} style={styles.monthCard}>
                      <div style={styles.monthTitle}>
                        {month}
                        <span style={styles.monthCount}>({list.length}개)</span>
                      </div>

                      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                        {list.map((r) => {
                          const opened = !!openMap.get(r.id);
                          const cache = itemsByBook.get(r.id);
                          const cnt = Array.isArray(cache?.items) ? cache.items.length : null;

                          return (
                            <div
                              key={r.id}
                              style={{
                                ...styles.bookCard,
                                background: opened ? THEME.pinkSoft : "#fff",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => onClickBook(r)}
                                style={styles.bookHeaderBtn}
                                title="클릭해서 단어 목록 펼치기"
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={styles.bookTitleRow}>
                                    <div style={styles.bookTitleText}>
                                      {opened ? "▼" : "▶"} {r.title}
                                    </div>
                                    <div style={styles.bookRightMeta}>
                                      {r.exam_date
                                        ? dayjs(r.exam_date).format("YYYY.MM.DD")
                                        : dayjs(r.created_at).format("YYYY.MM.DD")}
                                      {cnt !== null ? ` · ${cnt}단어` : ""}
                                    </div>
                                  </div>

                                  <div style={styles.bookSub}>
                                    원본: {r.source_book || "—"}{" "}
                                    {r.source_chapters_text ? `(${r.source_chapters_text})` : ""}
                                  </div>
                                </div>
                              </button>

                              {opened && (
                                <div style={styles.bookOpenArea}>
                                  {cache?.loading ? (
                                    <div style={styles.stateText}>단어 불러오는 중…</div>
                                  ) : cache?.err ? (
                                    <div style={{ ...styles.stateText, color: THEME.danger }}>
                                      {cache.err}
                                    </div>
                                  ) : (
                                    <div style={{ display: "grid", gap: 8 }}>
                                      {(cache?.items || []).length === 0 ? (
                                        <div style={styles.stateText}>
                                          이 파일에 저장된 오답 단어가 없습니다.
                                        </div>
                                      ) : (
                                        <>
                                          <div style={styles.smallHint}>
                                            오답 단어 {cache.items.length}개
                                          </div>

                                          <div style={styles.itemsScroll}>
                                            {cache.items.map((it, idx) => (
                                              <div key={it.id} style={styles.itemRow}>
                                                <div style={styles.itemTop}>
                                                  <div style={styles.itemTerm}>
                                                    {idx + 1}. {it.term_en}
                                                    {it.pos ? (
                                                      <span style={styles.itemPos}>({it.pos})</span>
                                                    ) : null}
                                                  </div>
                                                </div>

                                                <div style={styles.itemBody}>
                                                  <div style={styles.itemLine}>
                                                    <b>정답(ko):</b>{" "}
                                                    {it.meaning_ko ? (
                                                      it.meaning_ko
                                                    ) : (
                                                      <span style={{ color: THEME.sub }}>—</span>
                                                    )}
                                                  </div>

                                                  {/* ✅ 허용단어 제거 → 학생 오답 표시 */}
                                                  <div style={{ ...styles.itemLine, marginTop: 4 }}>
                                                    <b>학생 오답:</b>{" "}
                                                    {it.student_answer ? (
                                                      <span style={{ color: THEME.text }}>
                                                        {String(it.student_answer)}
                                                      </span>
                                                    ) : (
                                                      <span style={{ color: THEME.sub }}>—</span>
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={styles.footerNote}>
          ※ 오답 파일은 <b style={{ color: THEME.text }}>공식시험 검수 “최종 확정”</b> 시점에 자동
          생성되는 구조입니다.
        </div>
      </div>

      {/* ✅ 반응형: 3열 → 1열 */}
      <style>{`
        @media (max-width: 860px) {
          ._wb_filterGrid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    background: THEME.pageBg,
    minHeight: "100vh",
    height: "100dvh",
    color: THEME.text,
  },

  // ✅ sticky header + safe-area
  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: THEME.bg,
    paddingTop: "env(safe-area-inset-top, 0px)",
    borderBottom: `1px solid ${THEME.border}`,
  },
  headerInner: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
  },
  headerTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  hTitle: {
    fontSize: 18,
    fontWeight: 900,
    color: THEME.text,
    letterSpacing: "-0.2px",
    lineHeight: "24px",
  },
  hBadge: {
    marginLeft: 10,
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    background: THEME.pinkSoft,
    border: `1px solid ${THEME.borderPink}`,
    color: "#c94a7a",
    fontWeight: 900,
  },
  hSub: {
    fontSize: 12,
    color: THEME.sub,
    marginTop: 4,
    fontWeight: 800,
  },
  headerBtns: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  },

  errBox: {
    marginTop: 12,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    color: "#9f1239",
    padding: 12,
    borderRadius: 14,
    fontWeight: 900,
    whiteSpace: "pre-line",
  },

  filterCard: {
    marginTop: 12,
    background: "#fff",
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    padding: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },
  filterGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },

  content: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  stateText: {
    color: THEME.sub,
    fontWeight: 900,
    fontSize: 13,
  },

  emptyCard: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    padding: 14,
    background: "#fff",
    color: THEME.sub,
    fontWeight: 900,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },

  studentCard: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 16,
    padding: 14,
    background: "#fff",
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },
  studentHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  },
  studentName: {
    fontWeight: 900,
    fontSize: 16,
    color: THEME.text,
    wordBreak: "break-word",
  },
  studentId: {
    marginLeft: 8,
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
  },

  monthCard: {
    border: `1px dashed ${THEME.borderPink}`,
    borderRadius: 14,
    padding: 12,
    background: "#fff",
  },
  monthTitle: {
    fontWeight: 900,
    color: THEME.text,
    fontSize: 14,
  },
  monthCount: {
    marginLeft: 8,
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
  },

  bookCard: {
    border: `1px solid ${THEME.borderPink}`,
    borderRadius: 14,
    overflow: "hidden",
  },
  bookHeaderBtn: {
    width: "100%",
    textAlign: "left",
    border: "none",
    background: "transparent",
    padding: 12,
    cursor: "pointer",
    color: THEME.text,
    WebkitTapHighlightColor: "transparent",
  },
  bookTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "baseline",
    flexWrap: "wrap",
  },
  bookTitleText: {
    fontWeight: 900,
    color: THEME.text,
    minWidth: 0,
    wordBreak: "break-word",
  },
  bookRightMeta: {
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  bookSub: {
    marginTop: 6,
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
    wordBreak: "break-word",
  },

  bookOpenArea: {
    borderTop: `1px dashed ${THEME.borderPink}`,
    padding: 12,
    background: "#fff",
  },

  smallHint: {
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 900,
  },

  itemsScroll: {
    maxHeight: 280,
    overflow: "auto",
    display: "grid",
    gap: 8,
    paddingRight: 4,
  },

  itemRow: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    padding: 10,
    background: "#fff",
  },
  itemTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
  },
  itemTerm: {
    fontWeight: 900,
    color: THEME.text,
    wordBreak: "break-word",
  },
  itemPos: {
    marginLeft: 8,
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
  },
  itemBody: {
    marginTop: 6,
    fontSize: 13,
    color: THEME.text,
    fontWeight: 800,
    lineHeight: 1.55,
  },
  itemLine: {
    color: THEME.text,
    wordBreak: "break-word",
  },

  footerNote: {
    marginTop: 14,
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
  },
};
