// src/pages/admin/WrongBooksAdminPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../../utils/supabaseClient";

dayjs.locale("ko");

const box = {
  border: "1px solid #ffd3e3",
  borderRadius: 14,
  padding: 12,
  background: "#fff",
};

const btn = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #ffd3e3",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const pinkBtn = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  background: "#ff6fa3",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 6px 14px rgba(255,111,163,.18)",
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

  // ✅ 학생별 → 월별 그룹핑 (요구사항)
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

    // 정렬
    const students = Array.from(byStudent.values()).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "")
    );

    for (const s of students) {
      // 월 정렬(최근월 우선)
      const monthKeys = Array.from(s.months.keys()).sort((a, b) => (b || "").localeCompare(a || ""));
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
        n.set(wrongBookId, { loading: false, err: "오답 단어를 불러오지 못했습니다.", items: [] });
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
    <div style={{ background: "#fff5f8", minHeight: "100vh", padding: "24px 12px" }}>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          background: "white",
          borderRadius: 16,
          padding: 18,
          boxShadow: "0 10px 30px rgba(255,111,163,.14)",
        }}
      >
        {/* 헤더 */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#ff6fa3" }}>오답노트(관리자)</div>
            <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>
              학생별 → 월별 → 오답파일(세션) 구조로 확인합니다.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={btn} onClick={() => nav("/dashboard")}>← 대시보드</button>
            <button style={pinkBtn} onClick={loadAll} disabled={loading}>
              {loading ? "불러오는 중…" : "새로고침"}
            </button>
          </div>
        </div>

        {err && <div style={{ marginTop: 10, color: "#d00" }}>{err}</div>}

        {/* 필터 */}
        <div style={{ ...box, marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: "#666", fontWeight: 900, marginBottom: 6 }}>학생 필터</div>
              <select
                value={studentFilter}
                onChange={(e) => setStudentFilter(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ffd3e3" }}
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
              <div style={{ fontSize: 12, color: "#666", fontWeight: 900, marginBottom: 6 }}>월 필터</div>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ffd3e3" }}
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
              <div style={{ fontSize: 12, color: "#666", fontWeight: 900, marginBottom: 6 }}>검색</div>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="학생/파일제목/원본책/범위/월 검색"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #ffd3e3" }}
              />
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              style={btn}
              onClick={() => {
                setStudentFilter("");
                setMonthFilter("");
                setQ("");
              }}
            >
              필터 초기화
            </button>
            <div style={{ fontSize: 12, color: "#777", alignSelf: "center" }}>
              현재 {filteredRows.length}개 파일
            </div>
          </div>
        </div>

        {/* 본문 */}
        <div style={{ marginTop: 14 }}>
          {loading ? (
            <div style={{ padding: 14, color: "#777" }}>불러오는 중…</div>
          ) : grouped.length === 0 ? (
            <div style={{ ...box, color: "#777" }}>표시할 오답 파일이 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {grouped.map((stu) => (
                <div key={stu.sid} style={{ ...box }}>
                  <div style={{ fontWeight: 900, color: "#1f2a44" }}>
                    🧑‍🎓 {stu.name}{" "}
                    <span style={{ fontSize: 12, color: "#777", fontWeight: 700 }}>
                      ({stu.sid?.slice?.(0, 8) || stu.sid})
                    </span>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
                    {Array.from(stu.months.entries()).map(([month, list]) => (
                      <div key={month} style={{ border: "1px dashed #ffd3e3", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 900, marginBottom: 8, color: "#1f2a44" }}>
                          📁 {month}{" "}
                          <span style={{ fontSize: 12, color: "#777", fontWeight: 700 }}>
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
                                  border: "1px solid #ffe1ec",
                                  borderRadius: 12,
                                  padding: 10,
                                  background: opened ? "#fff0f5" : "#fff",
                                }}
                              >
                                <div
                                  onClick={() => onClickBook(r)}
                                  style={{ cursor: "pointer" }}
                                  title="클릭해서 단어 목록 펼치기"
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                    <div style={{ fontWeight: 900 }}>
                                      {opened ? "▼" : "▶"} {r.title}
                                    </div>
                                    <div style={{ fontSize: 12, color: "#777", whiteSpace: "nowrap" }}>
                                      {r.exam_date
                                        ? dayjs(r.exam_date).format("YYYY.MM.DD")
                                        : dayjs(r.created_at).format("YYYY.MM.DD")}
                                      {cnt !== null ? ` · ${cnt}단어` : ""}
                                    </div>
                                  </div>

                                  <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>
                                    원본: {r.source_book || "—"}{" "}
                                    {r.source_chapters_text ? `(${r.source_chapters_text})` : ""}
                                  </div>
                                </div>

                                {opened && (
                                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #ffd3e3" }}>
                                    {cache?.loading ? (
                                      <div style={{ fontSize: 13, color: "#777" }}>단어 불러오는 중…</div>
                                    ) : cache?.err ? (
                                      <div style={{ fontSize: 13, color: "#d00" }}>{cache.err}</div>
                                    ) : (
                                      <div style={{ display: "grid", gap: 6 }}>
                                        {(cache?.items || []).length === 0 ? (
                                          <div style={{ fontSize: 13, color: "#777" }}>
                                            이 파일에 저장된 오답 단어가 없습니다.
                                          </div>
                                        ) : (
                                          <>
                                            <div style={{ fontSize: 12, color: "#777" }}>
                                              오답 단어 {cache.items.length}개 (클릭으로 접기/펼치기)
                                            </div>
                                            <div style={{ maxHeight: 260, overflow: "auto", display: "grid", gap: 6 }}>
                                              {cache.items.map((it, idx) => (
                                                <div
                                                  key={it.id}
                                                  style={{
                                                    border: "1px solid #ffd3e3",
                                                    borderRadius: 10,
                                                    padding: "8px 10px",
                                                    background: "#fff",
                                                  }}
                                                >
                                                  <div style={{ fontWeight: 900 }}>
                                                    {idx + 1}. {it.term_en}
                                                    {it.pos ? (
                                                      <span style={{ marginLeft: 8, fontSize: 12, color: "#777" }}>
                                                        ({it.pos})
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                  <div style={{ fontSize: 13, marginTop: 4 }}>
                                                    뜻: {it.meaning_ko || <span style={{ color: "#999" }}>—</span>}
                                                  </div>
                                                  {it.accepted_ko ? (
                                                    <div style={{ fontSize: 12, color: "#777", marginTop: 3 }}>
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
        <div style={{ marginTop: 14, fontSize: 12, color: "#777" }}>
          ※ 오답 파일은 <b>공식시험 검수 “최종 확정”</b> 시점에 자동 생성되는 구조입니다.
        </div>
      </div>
    </div>
  );
}
