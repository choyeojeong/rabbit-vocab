// src/pages/BookRangePage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchChapters, parseChapterInput } from "../utils/vocab";
import { supabase } from "../utils/supabaseClient";
import StudentShell from "./StudentShell";
import { getSession } from "../utils/session";

export default function BookRangePage({ mode = "practice" }) {
  const nav = useNavigate();
  const isOfficial = mode === "official";

  /* =========================
     탭: 정규(기존) / 오답(신규)
  ========================= */
  const [tab, setTab] = useState("regular"); // 'regular' | 'wrong'

  /* =========================
     상태(기존)
  ========================= */
  const [bookMeta, setBookMeta] = useState([]); // { book, category_id, category_path }
  const [catNodes, setCatNodes] = useState([]);

  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [catSearch, setCatSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  // ✅ 맨 상단: 단어책 검색(추가)
  const [bookSearch, setBookSearch] = useState("");

  // ⭐ 여러 책 선택 + 책별 챕터
  const [selectedBooks, setSelectedBooks] = useState(() => new Set());
  const [chaptersByBook, setChaptersByBook] = useState({}); // book -> chapterInput
  const [chapterOptions, setChapterOptions] = useState({}); // book -> [chapters]

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const reloadingRef = useRef(false);

  /* =========================
     ✅ 오답(신규)
  ========================= */
  const me = useMemo(() => {
    const s = getSession?.();
    return { id: s?.id || null, name: (s?.name || "").trim() };
  }, []);

  const [wrongLoading, setWrongLoading] = useState(false);
  const [wrongErr, setWrongErr] = useState("");
  const [wrongRows, setWrongRows] = useState([]); // wrong_books rows
  const [selectedWrongBookIds, setSelectedWrongBookIds] = useState(() => new Set());

  async function loadWrongBooks() {
    if (!me?.id) {
      setWrongErr("로그인 정보가 없습니다. 다시 로그인해 주세요.");
      setWrongRows([]);
      return;
    }
    try {
      setWrongErr("");
      setWrongLoading(true);

      const { data, error } = await supabase
        .from("wrong_books")
        .select("id, title, yyyy_mm, exam_date, created_at, source_book, source_chapters_text")
        .eq("owner_student_id", me.id)
        .order("exam_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      setWrongRows(data || []);
    } catch (e) {
      console.error(e);
      setWrongErr("오답 파일을 불러오지 못했습니다.");
      setWrongRows([]);
    } finally {
      setWrongLoading(false);
    }
  }

  // 탭이 '오답'으로 바뀌면 목록 로드
  useEffect(() => {
    if (tab !== "wrong") return;
    loadWrongBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // yyyy_mm로 그룹핑
  const wrongByMonth = useMemo(() => {
    const map = new Map(); // yyyy_mm -> rows[]
    for (const r of wrongRows) {
      const key = r.yyyy_mm || "기타";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    // 월 내 정렬(최근 우선)
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => {
        const ad = a.exam_date ? new Date(a.exam_date).getTime() : 0;
        const bd = b.exam_date ? new Date(b.exam_date).getTime() : 0;
        if (bd !== ad) return bd - ad;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      map.set(k, arr);
    }
    // 키 정렬(최근 월 우선: "YYYY-MM")
    const keys = Array.from(map.keys()).sort((a, b) => (b || "").localeCompare(a || ""));
    return keys.map((k) => ({ month: k, rows: map.get(k) }));
  }, [wrongRows]);

  function toggleWrong(id) {
    setSelectedWrongBookIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // ✅ 월 전체 선택/해제
  function isMonthAllSelected(rows) {
    if (!rows?.length) return false;
    for (const r of rows) {
      if (!selectedWrongBookIds.has(r.id)) return false;
    }
    return true;
  }

  function toggleMonthAll(rows) {
    if (!rows?.length) return;
    setSelectedWrongBookIds((prev) => {
      const next = new Set(prev);
      const allOn = rows.every((r) => next.has(r.id));
      if (allOn) {
        rows.forEach((r) => next.delete(r.id));
      } else {
        rows.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }

  function clearWrongSelection() {
    setSelectedWrongBookIds(new Set());
  }

  // ✅ 오답 시험보기: PracticeMCQ/MockExamPage가 wrong_book_ids를 로드
  function goWrong(path) {
    const ids = Array.from(selectedWrongBookIds);
    if (!ids.length) {
      alert("최소 1개 이상의 오답 파일을 선택해 주세요.");
      return;
    }
    nav(path, { state: { mode, wrong_book_ids: ids } });
  }

  /* =========================
     분류 트리 유틸(기존)
  ========================= */
  const tree = useMemo(() => {
    const byId = new Map(catNodes.map((n) => [n.id, n]));
    const childrenBy = new Map();

    for (const n of catNodes) {
      const k = n.parent_id || "__root__";
      if (!childrenBy.has(k)) childrenBy.set(k, []);
      childrenBy.get(k).push(n);
    }

    const getChildren = (pid) =>
      (childrenBy.get(pid || "__root__") || []).sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          (a.name || "").localeCompare(b.name || "")
      );

    const hasChild = new Set(catNodes.filter((x) => x.parent_id).map((x) => x.parent_id));
    const isLeaf = (id) => !hasChild.has(id);

    const buildPath = (id) => {
      const parts = [];
      let cur = byId.get(id);
      while (cur) {
        parts.push(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
      return parts.reverse().join(" > ");
    };

    return { byId, getChildren, isLeaf, buildPath };
  }, [catNodes]);

  /* =========================
     데이터 로드(기존)
  ========================= */
  async function reloadAll() {
    if (reloadingRef.current) return;
    reloadingRef.current = true;

    try {
      setErr("");
      setLoading(true);

      const { data: cats } = await supabase
        .from("book_category_nodes")
        .select("id, parent_id, name, sort_order, created_at");

      setCatNodes(cats || []);

      const { data: books } = await supabase
        .from("v_books_with_category")
        .select("book, category_id, category_path");

      setBookMeta(books || []);
    } catch (e) {
      console.error(e);
      setErr("단어책/분류 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      reloadingRef.current = false;
    }
  }

  useEffect(() => {
    reloadAll();
  }, []);

  /* =========================
     분류 선택(기존)
  ========================= */
  function toggleExpand(id) {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function onPickCategory(id) {
    if (!tree.isLeaf(id)) {
      toggleExpand(id);
      return;
    }
    setSelectedCategoryId((p) => (p === id ? "" : id));
  }

  /* =========================
     분류별 책 목록(기존)
  ========================= */
  const booksInCategory = useMemo(() => {
    if (!selectedCategoryId) return [];
    return bookMeta.filter((b) => b.category_id === selectedCategoryId);
  }, [bookMeta, selectedCategoryId]);

  /* =========================
     ✅ 맨 상단 검색 결과(기존)
  ========================= */
  const searchedBooks = useMemo(() => {
    const q = (bookSearch || "").trim().toLowerCase();
    if (!q) return [];
    const uniq = new Set();
    const out = [];
    for (const b of bookMeta) {
      const name = (b?.book || "").toString();
      if (!name) continue;
      if (name.toLowerCase().includes(q)) {
        if (!uniq.has(name)) {
          uniq.add(name);
          out.push(name);
        }
      }
    }
    out.sort((a, b) => (a || "").localeCompare(b || ""));
    return out.slice(0, 30);
  }, [bookSearch, bookMeta]);

  /* =========================
     ✅ 선택한 책 목록용(기존)
  ========================= */
  const selectedBookList = useMemo(() => {
    const arr = Array.from(selectedBooks);
    arr.sort((a, b) => (a || "").localeCompare(b || ""));
    return arr;
  }, [selectedBooks]);

  function unselectBook(book) {
    if (selectedBooks.has(book)) toggleBook(book);
  }

  /* =========================
     책 선택 / 해제(기존)
  ========================= */
  async function toggleBook(book) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(book)) next.delete(book);
      else next.add(book);
      return next;
    });

    // 처음 선택 시 챕터 로드
    if (!chapterOptions[book]) {
      const cs = await fetchChapters(book);
      setChapterOptions((m) => ({ ...m, [book]: cs }));
      if (cs?.length) {
        setChaptersByBook((m) => ({
          ...m,
          [book]: `${cs[0]}-${cs[cs.length - 1]}`,
        }));
      }
    }
  }

  /* =========================
     이동 (A안) (기존)
  ========================= */
  function buildSelections() {
    const selections = [];

    for (const book of selectedBooks) {
      const text = chaptersByBook[book];
      if (!text) {
        alert(`${book}의 챕터 범위를 입력해 주세요.`);
        return null;
      }
      const parsed = parseChapterInput(text);
      if (!parsed.length) {
        alert(`${book}의 챕터 형식이 올바르지 않습니다.`);
        return null;
      }
      selections.push({ book, chaptersText: text });
    }

    if (!selections.length) {
      alert("최소 한 권 이상의 책을 선택해 주세요.");
      return null;
    }

    return selections;
  }

  function go(path) {
    const selections = buildSelections();
    if (!selections) return;
    nav(path, { state: { mode, selections } });
  }

  /* =========================
     트리 렌더 (기존)
  ========================= */
  function renderTree(parentId = null) {
    const nodes = tree.getChildren(parentId);
    if (!nodes.length) return null;

    return (
      <div style={{ marginLeft: parentId ? 16 : 0 }}>
        {nodes.map((n) => {
          const open = expanded.has(n.id);
          const leaf = tree.isLeaf(n.id);
          const on = selectedCategoryId === n.id;

          return (
            <div key={n.id} style={{ marginTop: 6 }}>
              <div
                onClick={() => onPickCategory(n.id)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #ffd3e3",
                  background: on ? "#ff6fa3" : "#fff",
                  color: on ? "#fff" : "#1f2a44",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
                title={tree.buildPath(n.id)}
              >
                {leaf ? "📘 " : "📂 "} {n.name}
              </div>
              {!leaf && open && renderTree(n.id)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <StudentShell>
      <div className="student-container">
        <div className="student-card stack">
          {/* 탭 버튼 */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => setTab("regular")}
              style={{
                ...tabBtn,
                background: tab === "regular" ? "#ff6fa3" : "#fff",
                color: tab === "regular" ? "#fff" : "#ff6fa3",
                border: tab === "regular" ? "1px solid #ff6fa3" : "1px solid #ffd3e3",
              }}
            >
              정규
            </button>
            <button
              type="button"
              onClick={() => setTab("wrong")}
              style={{
                ...tabBtn,
                background: tab === "wrong" ? "#ff6fa3" : "#fff",
                color: tab === "wrong" ? "#fff" : "#ff6fa3",
                border: tab === "wrong" ? "1px solid #ff6fa3" : "1px solid #ffd3e3",
              }}
            >
              오답
            </button>
          </div>

          {/* =========================
              오답 탭 UI (신규)
          ========================= */}
          {tab === "wrong" ? (
            <>
              <div style={{ marginTop: 12, fontWeight: 900 }}>
                {me?.name ? `${me.name}님의 오답 파일` : "내 오답 파일"}
              </div>

              {wrongErr && <div style={{ color: "#d00", marginTop: 8 }}>{wrongErr}</div>}

              <div
                style={{
                  marginTop: 10,
                  border: "1px solid #ffd3e3",
                  borderRadius: 14,
                  padding: 12,
                  background: "#fff",
                }}
              >
                {wrongLoading ? (
                  <div style={{ fontSize: 13, color: "#777" }}>불러오는 중…</div>
                ) : wrongByMonth.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#777" }}>
                    아직 오답 파일이 없어요. (공식시험 확정 후 자동 생성됩니다.)
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 14 }}>
                    {wrongByMonth.map(({ month, rows }) => {
                      const monthAll = isMonthAllSelected(rows);
                      const monthCount = rows?.length || 0;

                      return (
                        <div key={month}>
                          {/* ✅ 월 헤더 + 월 전체선택 */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 10,
                              marginBottom: 8,
                            }}
                          >
                            <div style={{ fontWeight: 900, color: "#1f2a44" }}>
                              📁 {month}{" "}
                              <span style={{ fontSize: 12, color: "#777" }}>({monthCount}개)</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => toggleMonthAll(rows)}
                              style={{
                                ...miniBtn,
                                border: monthAll ? "1px solid #ff6fa3" : "1px solid #ffd3e3",
                                color: monthAll ? "#ff6fa3" : "#1f2a44",
                              }}
                              disabled={!monthCount}
                              title="이 달의 파일을 한 번에 선택/해제"
                            >
                              {monthAll ? "월 전체 해제" : "월 전체 선택"}
                            </button>
                          </div>

                          <div style={{ display: "grid", gap: 8 }}>
                            {rows.map((r) => {
                              const checked = selectedWrongBookIds.has(r.id);
                              return (
                                <label
                                  key={r.id}
                                  style={{
                                    border: "1px solid #ffe1ec",
                                    borderRadius: 12,
                                    padding: 10,
                                    background: checked ? "#fff0f5" : "#fff",
                                    cursor: "pointer",
                                    display: "flex",
                                    gap: 10,
                                    alignItems: "flex-start",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleWrong(r.id)}
                                    style={{ marginTop: 3 }}
                                  />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 900 }}>{r.title}</div>
                                    <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                                      원본: {r.source_book || "—"}{" "}
                                      {r.source_chapters_text ? `(${r.source_chapters_text})` : ""}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" onClick={loadWrongBooks} style={miniBtn} disabled={wrongLoading}>
                    새로고침
                  </button>
                  <button
                    type="button"
                    onClick={clearWrongSelection}
                    style={miniBtn}
                    disabled={selectedWrongBookIds.size === 0}
                  >
                    선택 해제
                  </button>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: "#777" }}>
                  * 월 전체선택도 되고, 파일별로도 선택할 수 있어요.
                </div>
              </div>

              {/* 오답 시험 보기 버튼들 */}
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                <button className="button-lg" onClick={() => goWrong("/practice/mcq")}>
                  오답 시험보기 → 객관식
                </button>
                <button
                  className="button-lg"
                  style={{
                    background: "#fff",
                    color: "#ff6fa3",
                    border: "2px solid #ff8fb7",
                  }}
                  onClick={() => goWrong("/practice/mock")}
                >
                  오답 시험보기 → 모의시험
                </button>
              </div>
            </>
          ) : (
            /* =========================
                정규 탭 UI (기존 그대로)
            ========================= */
            <>
              {err && <div style={{ color: "#d00" }}>{err}</div>}

              {/* ✅ 맨 상단: 단어책 검색칸(추가) */}
              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>단어책 검색</div>
                <input
                  style={fieldStyle}
                  value={bookSearch}
                  onChange={(e) => setBookSearch(e.target.value)}
                  placeholder="책 이름을 입력하세요 (예: 워드마스터)"
                />

                {bookSearch.trim() && (
                  <div
                    style={{
                      marginTop: 8,
                      border: "1px solid #ffd3e3",
                      borderRadius: 12,
                      background: "#fff",
                      padding: 10,
                    }}
                  >
                    {loading ? (
                      <div style={{ fontSize: 13, color: "#777" }}>불러오는 중…</div>
                    ) : searchedBooks.length === 0 ? (
                      <div style={{ fontSize: 13, color: "#777" }}>검색 결과가 없어요.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {searchedBooks.map((book) => {
                          const checked = selectedBooks.has(book);
                          return (
                            <div
                              key={book}
                              style={{
                                border: "1px solid #ffe1ec",
                                borderRadius: 10,
                                padding: 10,
                                background: checked ? "#fff0f5" : "#fff",
                              }}
                            >
                              <label style={{ fontWeight: 900, cursor: "pointer" }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleBook(book)} /> {book}
                              </label>

                              {checked && (
                                <input
                                  style={{ ...fieldStyle, marginTop: 8 }}
                                  value={chaptersByBook[book] || ""}
                                  onChange={(e) =>
                                    setChaptersByBook((m) => ({
                                      ...m,
                                      [book]: e.target.value,
                                    }))
                                  }
                                  placeholder="예: 4-8, 10"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ marginTop: 8, fontSize: 12, color: "#777" }}>
                      * 여기서 체크한 책도 아래 “선택한 책 목록”에 자동 반영돼요.
                    </div>
                  </div>
                )}
              </div>

              {/* ======= 아래는 기존 그대로 ======= */}

              <h3 style={{ marginTop: 16 }}>분류 선택</h3>
              <div style={{ maxHeight: 260, overflow: "auto" }}>{loading ? "불러오는 중…" : renderTree(null)}</div>

              {selectedCategoryId && (
                <>
                  <h3 style={{ marginTop: 16 }}>책 선택 + 챕터 범위</h3>

                  {/* ✅ 기존: 분류 내 책 목록(체크박스) 그대로 */}
                  {booksInCategory.map((b) => {
                    const checked = selectedBooks.has(b.book);
                    return (
                      <div key={b.book} style={{ marginTop: 10 }}>
                        <label style={{ fontWeight: 900 }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleBook(b.book)} /> {b.book}
                        </label>

                        {checked && (
                          <input
                            style={{ ...fieldStyle, marginTop: 6 }}
                            value={chaptersByBook[b.book] || ""}
                            onChange={(e) =>
                              setChaptersByBook((m) => ({
                                ...m,
                                [b.book]: e.target.value,
                              }))
                            }
                            placeholder="예: 4-8, 10"
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* =========================
                     ✅ 추가: 선택한 책 목록(기존 기능 건드리지 않고 "추가"만)
                  ========================= */}
                  <div
                    style={{
                      marginTop: 16,
                      padding: 12,
                      borderRadius: 12,
                      border: "1px dashed #ff9fc0",
                      background: "#fff0f5",
                    }}
                  >
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>
                      선택한 책 목록{" "}
                      <span style={{ fontSize: 12, color: "#777" }}>({selectedBookList.length}권)</span>
                    </div>

                    {selectedBookList.length === 0 ? (
                      <div style={{ fontSize: 13, color: "#777" }}>
                        아직 선택된 책이 없어요. 위에서 책을 체크해 주세요.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {selectedBookList.map((book) => (
                          <div
                            key={book}
                            style={{
                              border: "1px solid #ffd3e3",
                              borderRadius: 12,
                              padding: 10,
                              background: "#fff",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <div style={{ fontWeight: 900, color: "#1f2a44" }}>{book}</div>

                              {/* 선택 해제 버튼 */}
                              <button
                                type="button"
                                onClick={() => unselectBook(book)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 10,
                                  border: "1px solid #ffb8c9",
                                  background: "#fff",
                                  color: "#b00020",
                                  fontWeight: 900,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                                title="선택 해제"
                              >
                                선택 해제
                              </button>
                            </div>

                            {/* 범위 수정(= chaptersByBook 수정) */}
                            <div style={{ marginTop: 8 }}>
                              <input
                                style={fieldStyle}
                                value={chaptersByBook[book] || ""}
                                onChange={(e) =>
                                  setChaptersByBook((m) => ({
                                    ...m,
                                    [book]: e.target.value,
                                  }))
                                }
                                placeholder="예: 4-8, 10"
                              />
                              <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>
                                여기서 범위를 수정하면 바로 반영돼요.
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
                {isOfficial ? (
                  <button className="button-lg" onClick={() => go("/exam/official")}>
                    시험보기(공식)
                  </button>
                ) : (
                  <>
                    <button className="button-lg" onClick={() => go("/practice/mcq")}>
                      연습하기 → 객관식
                    </button>
                    <button
                      className="button-lg"
                      style={{
                        background: "#fff",
                        color: "#ff6fa3",
                        border: "2px solid #ff8fb7",
                      }}
                      onClick={() => go("/practice/mock")}
                    >
                      연습하기 → 모의시험
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </StudentShell>
  );
}

const fieldStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #ffd3e3",
  borderRadius: 10,
  fontSize: 14,
};

const tabBtn = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 12,
  fontWeight: 900,
  cursor: "pointer",
};

const miniBtn = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #ffd3e3",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};
