// src/pages/admin/WrongBooksAdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../../utils/supabaseClient";

dayjs.locale("ko");

const THEME = {
  pageBg: "transparent", // ✅ AdminGate 배경 사용
  cardBg: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  borderPink: "#ffd3e3",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  link: "#2b59ff",
  danger: "#b00020",
};

const boxBase = {
  border: `1px solid ${THEME.border}`,
  borderRadius: 14,
  padding: 12,
  background: THEME.cardBg,
  color: THEME.text,
};

const btnBase = {
  padding: "8px 10px",
  borderRadius: 10,
  border: `1px solid ${THEME.borderPink}`,
  background: "#fff",
  color: THEME.text,
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 10px 22px rgba(31,42,68,.06)",
};

const pinkBtn = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  background: THEME.pink,
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 10px 22px rgba(255,111,163,.18)",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${THEME.borderPink}`,
  outline: "none",
  background: "#fff",
  color: THEME.text,
  fontWeight: 800,
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

  // 펼침 상태
  // openMap: wrong_book_id -> boolean
  const [openMap, setOpenMap] = useState(() => new Map());

  // 아이템 캐시
  // itemsByBook: wrong_book_id -> { loading, err, items[] }
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

      // 서버 필터(가볍게)
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

  // 초기/필터 변경 시 로드
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

  // 전체 데이터 기준 월 옵션(필터)
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
    const byStudent = new Map(); // sid -> { name, months: Map(month -> rows[]) }
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
      const { data, error } = await supabase
        .from("wrong_book_items")
        .select("id, wrong_book_id, word_id, term_en, meaning_ko, pos, accepted_ko, created_at")
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
    <div
      style={{
        background: THEME.pageBg,
        minHeight: "100vh",
        padding: "24px 12px",
        color: THEME.text, // ✅ 페이지 기본 글자색 확정
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          background: THEME.cardBg,
          borderRadius: 16,
          padding: 18,
          border: `1px solid ${THEME.border}`,
          boxShadow: "0 10px 30px rgba(31,42,68,.08)",
          color: THEME.text,
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: THEME.text }}>
              오답노트(관리자)
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: THEME.pinkSoft,
                  border: `1px solid ${THEME.borderPink}`,
                  color: "#c94a7a",
                  fontWeight: 900,
                }}
              >
                Wrong Books
              </span>
            </div>
            <div style={{ fontSize: 12, color: THEME.sub, marginTop: 4 }}>
              학생별 → 월별 → 오답파일(세션) 구조로 확인합니다.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={btnBase} onClick={() => nav("/dashboard")}>
              ← 대시보드
            </button>
            <button style={pinkBtn} onClick={loadAll} disabled={loading}>
              {loading ? "불러오는 중…" : "새로고침"}
            </button>
          </div>
        </div>

        {err && (
          <div
            style={{
              marginTop: 12,
              background: "#fff1f2",
              border: "1px solid #fecdd3",
              color: "#9f1239",
              padding: 12,
              borderRadius: 12,
              fontWeight: 900,
              whiteSpace: "pre-line",
            }}
          >
            {err}
          </div>
        )}

        {/* 필터 */}
        <div style={{ ...boxBase, marginTop: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
            }}
          >
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
              <div style={{ marginTop: 6, fontSize: 11, color: THEME.sub }}>
                예) “고3”, “2026-01”, “수능”, “4-8”
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
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

            <div style={{ fontSize: 12, color: THEME.sub, alignSelf: "center", fontWeight: 900 }}>
              현재 {filteredRows.length}개 파일
            </div>
          </div>
        </div>

        {/* 본문 */}
        <div style={{ marginTop: 14 }}>
          {loading ? (
            <div style={{ padding: 14, color: THEME.sub, fontWeight: 900 }}>불러오는 중…</div>
          ) : grouped.length === 0 ? (
            <div style={{ ...boxBase, color: THEME.sub, fontWeight: 900 }}>
              표시할 오답 파일이 없습니다.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {grouped.map((stu) => (
                <div key={stu.sid} style={{ ...boxBase }}>
                  <div style={{ fontWeight: 900, color: THEME.text }}>
                    🧑‍🎓 {stu.name}{" "}
                    <span style={{ fontSize: 12, color: THEME.sub, fontWeight: 800 }}>
                      ({stu.sid?.slice?.(0, 8) || stu.sid})
                    </span>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                    {Array.from(stu.months.entries()).map(([month, list]) => (
                      <div
                        key={month}
                        style={{
                          border: `1px dashed ${THEME.borderPink}`,
                          borderRadius: 12,
                          padding: 10,
                          background: "#fff",
                          color: THEME.text,
                        }}
                      >
                        <div style={{ fontWeight: 900, marginBottom: 8, color: THEME.text }}>
                          📁 {month}{" "}
                          <span style={{ fontSize: 12, color: THEME.sub, fontWeight: 800 }}>
                            ({list.length}개)
                          </span>
                        </div>

                        <div style={{ display: "grid", gap: 8 }}>
                          {list.map((r) => {
                            const opened = !!openMap.get(r.id);
                            const cache = itemsByBook.get(r.id);
                            const cnt = Array.isArray(cache?.items) ? cache.items.length : null;

                            return (
                              <div
                                key={r.id}
                                style={{
                                  border: `1px solid ${THEME.borderPink}`,
                                  borderRadius: 12,
                                  padding: 10,
                                  background: opened ? THEME.pinkSoft : "#fff",
                                  color: THEME.text,
                                }}
                              >
                                <div
                                  onClick={() => onClickBook(r)}
                                  style={{ cursor: "pointer", color: THEME.text }}
                                  title="클릭해서 단어 목록 펼치기"
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                    <div style={{ fontWeight: 900, color: THEME.text }}>
                                      {opened ? "▼" : "▶"} {r.title}
                                    </div>
                                    <div style={{ fontSize: 12, color: THEME.sub, whiteSpace: "nowrap", fontWeight: 800 }}>
                                      {r.exam_date
                                        ? dayjs(r.exam_date).format("YYYY.MM.DD")
                                        : dayjs(r.created_at).format("YYYY.MM.DD")}
                                      {cnt !== null ? ` · ${cnt}단어` : ""}
                                    </div>
                                  </div>

                                  <div style={{ marginTop: 6, fontSize: 12, color: THEME.sub, fontWeight: 800 }}>
                                    원본: {r.source_book || "—"}{" "}
                                    {r.source_chapters_text ? `(${r.source_chapters_text})` : ""}
                                  </div>
                                </div>

                                {opened && (
                                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${THEME.borderPink}` }}>
                                    {cache?.loading ? (
                                      <div style={{ fontSize: 13, color: THEME.sub, fontWeight: 900 }}>
                                        단어 불러오는 중…
                                      </div>
                                    ) : cache?.err ? (
                                      <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 900 }}>
                                        {cache.err}
                                      </div>
                                    ) : (
                                      <div style={{ display: "grid", gap: 6 }}>
                                        {(cache?.items || []).length === 0 ? (
                                          <div style={{ fontSize: 13, color: THEME.sub, fontWeight: 900 }}>
                                            이 파일에 저장된 오답 단어가 없습니다.
                                          </div>
                                        ) : (
                                          <>
                                            <div style={{ fontSize: 12, color: THEME.sub, fontWeight: 900 }}>
                                              오답 단어 {cache.items.length}개 (클릭으로 접기/펼치기)
                                            </div>

                                            <div
                                              style={{
                                                maxHeight: 260,
                                                overflow: "auto",
                                                display: "grid",
                                                gap: 6,
                                                paddingRight: 4,
                                              }}
                                            >
                                              {cache.items.map((it, idx) => (
                                                <div
                                                  key={it.id}
                                                  style={{
                                                    border: `1px solid ${THEME.border}`,
                                                    borderRadius: 10,
                                                    padding: "8px 10px",
                                                    background: "#fff",
                                                    color: THEME.text,
                                                  }}
                                                >
                                                  <div style={{ fontWeight: 900, color: THEME.text }}>
                                                    {idx + 1}. {it.term_en}
                                                    {it.pos ? (
                                                      <span style={{ marginLeft: 8, fontSize: 12, color: THEME.sub, fontWeight: 800 }}>
                                                        ({it.pos})
                                                      </span>
                                                    ) : null}
                                                  </div>

                                                  <div style={{ fontSize: 13, marginTop: 4, color: THEME.text, fontWeight: 800 }}>
                                                    뜻:{" "}
                                                    {it.meaning_ko ? (
                                                      it.meaning_ko
                                                    ) : (
                                                      <span style={{ color: THEME.sub }}>—</span>
                                                    )}
                                                  </div>

                                                  {it.accepted_ko ? (
                                                    <div style={{ fontSize: 12, color: THEME.sub, marginTop: 3, fontWeight: 800 }}>
                                                      허용: {it.accepted_ko}
                                                    </div>
                                                  ) : null}
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
        </div>

        {/* 하단 안내 */}
        <div style={{ marginTop: 14, fontSize: 12, color: THEME.sub, fontWeight: 800 }}>
          ※ 오답 파일은 <b style={{ color: THEME.text }}>공식시험 검수 “최종 확정”</b> 시점에 자동 생성되는 구조입니다.
        </div>
      </div>

      {/* 작은 반응형 보완 */}
      <style>{`
        @media (max-width: 860px) {
          ._wb_grid3 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
