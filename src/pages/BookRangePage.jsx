// src/pages/BookRangePage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchBooks, fetchChapters, parseChapterInput } from "../utils/vocab";
import { supabase } from "../utils/supabaseClient";
import StudentShell from "./StudentShell";

export default function BookRangePage({ mode = "practice" }) {
  const nav = useNavigate();

  // ✅ 책 메타(뷰 기반)
  const [bookMeta, setBookMeta] = useState([]); // [{ book, category_id, category_path }]
  const [book, setBook] = useState("");

  // ✅ 분류 트리
  const [catNodes, setCatNodes] = useState([]); // [{id,parent_id,name,sort_order,created_at}]
  const [selectedCategoryId, setSelectedCategoryId] = useState(""); // leaf 선택
  const [onlyCategorized, setOnlyCategorized] = useState(false); // 미분류 숨기기
  const [bookSearch, setBookSearch] = useState(""); // 책 검색
  const [catSearch, setCatSearch] = useState(""); // 분류 검색(트리 필터)

  // ✅ 트리 펼침 상태(가시성)
  const [expanded, setExpanded] = useState(() => new Set()); // node id Set

  // ✅ 챕터
  const [chapters, setChapters] = useState([]); // [number]
  const [chapterInput, setChapterInput] = useState(""); // raw text

  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [err, setErr] = useState("");

  const isOfficial = mode === "official";
  const reloadingRef = useRef(false);

  // =========================
  // 트리 유틸 (무한 depth)
  // =========================
  const tree = useMemo(() => {
    const byId = new Map(catNodes.map((n) => [n.id, n]));
    const childrenBy = new Map();
    for (const n of catNodes) {
      const k = n.parent_id || "__root__";
      if (!childrenBy.has(k)) childrenBy.set(k, []);
      childrenBy.get(k).push(n);
    }

    const sortArr = (arr) =>
      [...(arr || [])].sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          (a.name || "").localeCompare(b.name || "")
      );

    // 정렬된 childrenBy
    const getChildren = (pid) => sortArr(childrenBy.get(pid || "__root__") || []);

    // leaf 판정(자식 없음)
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

  // 선택된 leaf 기준으로 "해당 leaf + 모든 하위 leaf" 같은 개념은 필요 없음
  // (매핑은 leaf에만 붙는다고 가정. leaf가 아닌 노드 선택을 막습니다.)

  // =========================
  // 책 목록 필터
  // =========================
  const filteredBookMeta = useMemo(() => {
    let list = Array.isArray(bookMeta) ? [...bookMeta] : [];

    if (onlyCategorized) list = list.filter((x) => !!x.category_id);

    // ✅ leaf 선택 시 해당 leaf에 매핑된 책만
    if (selectedCategoryId) {
      list = list.filter((x) => (x.category_id || "") === selectedCategoryId);
    }

    // 책 검색
    const q = (bookSearch || "").trim().toLowerCase();
    if (q) list = list.filter((x) => (x.book || "").toLowerCase().includes(q));

    // 정렬: 분류경로 -> 책이름
    list.sort((a, b) => {
      const pa = (a.category_path || "~~~미분류").toLowerCase();
      const pb = (b.category_path || "~~~미분류").toLowerCase();
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      return (a.book || "").localeCompare(b.book || "");
    });

    return list;
  }, [bookMeta, onlyCategorized, selectedCategoryId, bookSearch]);

  const filteredBooks = useMemo(() => filteredBookMeta.map((x) => x.book), [filteredBookMeta]);

  // =========================
  // 데이터 로드
  // =========================
  async function reloadAll({ keepSelection = true } = {}) {
    if (reloadingRef.current) return;
    reloadingRef.current = true;

    try {
      setErr("");
      setLoadingBooks(true);

      // 1) 분류 노드
      const { data: ns, error: ne } = await supabase
        .from("book_category_nodes")
        .select("id, parent_id, name, sort_order, created_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (!ne && Array.isArray(ns)) setCatNodes(ns);
      else setCatNodes([]);

      // 2) 책 + 분류
      const { data: vw, error: ve } = await supabase
        .from("v_books_with_category")
        .select("book, category_id, category_path");

      if (!ve && Array.isArray(vw) && vw.length) {
        setBookMeta(vw);
        // 선택된 책 보정은 아래 useEffect에서 filteredBooks 기준으로 처리
        if (!keepSelection) {
          const first = vw.map((x) => x.book).find(Boolean) || "";
          setBook(first);
        }
      } else {
        // 폴백: 기존 방식
        const bs = await fetchBooks();
        setBookMeta((bs || []).map((b) => ({ book: b, category_id: null, category_path: null })));
        if (!keepSelection) setBook((bs && bs[0]) || "");
      }
    } catch (e) {
      console.error(e);
      setErr(e?.message || "단어책 목록을 불러오지 못했습니다.");
      setCatNodes([]);
      setBookMeta([]);
      setBook("");
    } finally {
      setLoadingBooks(false);
      reloadingRef.current = false;
    }
  }

  useEffect(() => {
    reloadAll({ keepSelection: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 앱 포커스 복귀 시 동기화
  useEffect(() => {
    const onFocus = () => reloadAll({ keepSelection: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 필터 결과에 맞춰 선택 book 보정
  useEffect(() => {
    if (loadingBooks) return;

    if (!filteredBooks.length) {
      if (book) setBook("");
      return;
    }

    if (!book || !filteredBooks.includes(book)) {
      setBook(filteredBooks[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingBooks, filteredBooks.join("|")]);

  // =========================
  // book 바뀌면 chapters 로드
  // =========================
  useEffect(() => {
    if (!book) {
      setChapters([]);
      return;
    }

    let alive = true;
    (async () => {
      try {
        setErr("");
        setLoadingChapters(true);

        const cs = await fetchChapters(book);
        if (!alive) return;

        setChapters(cs);

        // 기본 범위 자동 채움 (처음만)
        if (!chapterInput && cs.length) {
          const first = cs[0];
          const last = cs[cs.length - 1];
          setChapterInput(`${first}-${last}`);
        }
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setErr(e?.message || "챕터 목록을 불러오지 못했습니다.");
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

  // =========================
  // 챕터 검증/이동
  // =========================
  const requestedChapters = useMemo(() => parseChapterInput(chapterInput), [chapterInput]);

  const validRequested = useMemo(() => {
    if (!chapters?.length) return requestedChapters;
    const set = new Set(chapters);
    return requestedChapters.filter((n) => set.has(n));
  }, [requestedChapters, chapters]);

  function guardAndGetChapters() {
    if (!book) {
      alert("단어책을 선택해 주세요.");
      return null;
    }
    if (!chapterInput.trim()) {
      alert("챕터 입력을 확인해 주세요.");
      return null;
    }
    if (!requestedChapters.length) {
      alert("올바른 챕터 형식이 아닙니다. 예) 4-8, 10, 12");
      return null;
    }
    if (chapters.length && validRequested.length === 0) {
      alert("선택한 책에 존재하는 챕터가 아닙니다. 유효한 챕터로 다시 입력해 주세요.");
      return null;
    }
    return validRequested.length ? validRequested : requestedChapters;
  }

  function goMCQ() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`;
    nav(`/practice/mcq?${query}`, { state: { mode: "practice", book, chapters: list } });
  }

  function goMock() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`;
    nav(`/practice/mock?${query}`, { state: { mode: "practice", book, chapters: list } });
  }

  function goOfficial() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(chapterInput)}`;
    nav(`/exam/official?${query}`, { state: { mode: "official", book, chapters: list } });
  }

  const btnDisabled = loadingBooks || loadingChapters || !book || !chapterInput.trim();

  // =========================
  // 트리 UI (무한 depth)
  // - leaf만 선택 가능
  // - 검색(catSearch) 시, 매칭되는 노드/조상만 보이도록
  // =========================
  const catFilter = useMemo(() => {
    const q = (catSearch || "").trim().toLowerCase();
    if (!q) return null;

    // 검색어 매칭되는 노드 + 그 조상들을 visible로
    const visible = new Set();
    const matched = catNodes.filter((n) => (n.name || "").toLowerCase().includes(q));

    const byId = tree.byId;
    for (const m of matched) {
      let cur = m;
      while (cur) {
        visible.add(cur.id);
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
    }
    return { q, visible };
  }, [catSearch, catNodes, tree.byId]);

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function ensureExpandPathTo(id) {
    // 선택/검색 시 조상 자동 펼침
    const byId = tree.byId;
    const toOpen = [];
    let cur = byId.get(id);
    while (cur && cur.parent_id) {
      toOpen.push(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
    if (!toOpen.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      toOpen.forEach((x) => next.add(x));
      return next;
    });
  }

  function onPickLeaf(id) {
    if (!tree.isLeaf(id)) {
      // non-leaf는 펼침만
      toggleExpand(id);
      return;
    }
    setSelectedCategoryId((p) => (p === id ? "" : id));
    ensureExpandPathTo(id);
  }

  // 검색 시 matched 조상 자동 펼침
  useEffect(() => {
    if (!catFilter?.visible) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of catFilter.visible) next.add(id);
      return next;
    });
  }, [catFilter]);

  // 트리 렌더
  function renderTree(parentId = null, level = 0) {
    const children = tree.getChildren(parentId);
    if (!children.length) return null;

    return (
      <div style={{ marginLeft: level ? 12 : 0 }}>
        {children.map((n) => {
          const kids = tree.getChildren(n.id);
          const hasKids = kids.length > 0;
          const leaf = tree.isLeaf(n.id);

          // 검색 필터가 있으면 visible에 포함된 것만
          if (catFilter?.visible && !catFilter.visible.has(n.id)) return null;

          const isOn = selectedCategoryId === n.id;
          const isOpen = expanded.has(n.id) || !!catFilter?.visible; // 검색 시는 펼침 느낌

          return (
            <div key={n.id} style={{ marginTop: 6 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #ffe3ee",
                  background: isOn ? "#ff6fa3" : "#fff",
                  color: isOn ? "#fff" : "#1f2a44",
                  cursor: "pointer",
                  userSelect: "none",
                }}
                title={tree.buildPath(n.id)}
                onClick={() => onPickLeaf(n.id)}
              >
                {hasKids ? (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(n.id);
                    }}
                    style={{
                      width: 18,
                      height: 18,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 6,
                      border: isOn ? "1px solid rgba(255,255,255,0.6)" : "1px solid #ffd6e5",
                      background: isOn ? "rgba(255,255,255,0.18)" : "#fff",
                      fontWeight: 900,
                      lineHeight: 1,
                    }}
                    title={isOpen ? "접기" : "펼치기"}
                  >
                    {isOpen ? "▾" : "▸"}
                  </span>
                ) : (
                  <span style={{ width: 18, textAlign: "center", opacity: isOn ? 0.9 : 0.5 }}>
                    •
                  </span>
                )}

                <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {n.name}
                  </span>
                  {leaf && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 900,
                        padding: "3px 8px",
                        borderRadius: 999,
                        border: isOn ? "1px solid rgba(255,255,255,0.6)" : "1px solid #ffd6e5",
                        background: isOn ? "rgba(255,255,255,0.18)" : "#fff",
                        color: isOn ? "#fff" : "#8a1f4b",
                      }}
                    >
                      선택가능
                    </span>
                  )}
                </div>
              </div>

              {hasKids && isOpen && <div style={{ marginLeft: 18 }}>{renderTree(n.id, level + 1)}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  // 선택된 카테고리 경로 표시
  const selectedCategoryPath = useMemo(() => {
    if (!selectedCategoryId) return "";
    return tree.buildPath(selectedCategoryId);
  }, [selectedCategoryId, tree]);

  // 선택된 책의 현재 분류 경로
  const selectedBookRow = useMemo(() => {
    if (!book) return null;
    return bookMeta.find((x) => x.book === book) || null;
  }, [book, bookMeta]);

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: "100%" }}>
        <div className="student-container">
          <div className="student-card stack">

            {/* 상단: 새로고침 */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="student-button"
                onClick={() => reloadAll({ keepSelection: true })}
                disabled={loadingBooks}
                style={{ padding: "8px 12px", whiteSpace: "nowrap" }}
                title="단어책/분류 새로고침"
              >
                ⟳ 새로고침
              </button>
            </div>

            {err && <div style={{ marginTop: 8, color: "#d00", fontSize: 13 }}>{err}</div>}

            {/* ✅ 1) 책 검색란 (맨 위) */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>책 검색</div>
              <input
                className="student-field"
                style={fieldStyle}
                value={bookSearch}
                onChange={(e) => setBookSearch(e.target.value)}
                placeholder="예: 워드마스터, 수능, 능률..."
                inputMode="text"
                autoCapitalize="none"
              />
              <div style={{ marginTop: 6, fontSize: 12, color: "#888" }}>
                표시 책 수: {filteredBooks.length} / 전체: {bookMeta.length || 0}
              </div>
            </div>

            {/* ✅ 2) 분류로 찾기 (트리) */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #ffe3ee" }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 900, color: "#1f2a44" }}>분류로 찾기</div>
                  <div style={{ fontSize: 12, color: "#5d6b82", marginTop: 4 }}>
                    * 아래 트리에서 <b>선택가능(leaf)</b> 뱃지가 있는 항목만 선택됩니다.
                  </div>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#444" }}>
                  <input
                    type="checkbox"
                    checked={onlyCategorized}
                    onChange={(e) => setOnlyCategorized(e.target.checked)}
                  />
                  미분류 숨기기
                </label>
              </div>

              <div style={{ marginTop: 10 }}>
                <input
                  className="student-field"
                  style={fieldStyle}
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  placeholder="분류 검색 (예: 품사, 명사, 부사절...)"
                  inputMode="text"
                  autoCapitalize="none"
                />
              </div>

              {selectedCategoryId && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#444", wordBreak: "keep-all" }}>
                  선택된 분류: <b style={{ color: "#ff3b8d" }}>{selectedCategoryPath}</b>{" "}
                  <button
                    type="button"
                    className="student-button"
                    style={{ padding: "6px 10px", marginLeft: 8 }}
                    onClick={() => setSelectedCategoryId("")}
                  >
                    선택 해제
                  </button>
                </div>
              )}

              <div
                style={{
                  marginTop: 10,
                  maxHeight: 260,
                  overflow: "auto",
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid #ffe3ee",
                  background: "#fff",
                }}
              >
                {loadingBooks ? (
                  <div style={{ fontSize: 13, color: "#5d6b82" }}>불러오는 중…</div>
                ) : catNodes.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#5d6b82" }}>
                    분류 트리가 없습니다. (관리자에서 분류를 먼저 만들어 주세요)
                  </div>
                ) : (
                  renderTree(null, 0)
                )}
              </div>
            </div>

            {/* ✅ 책 목록 (드롭다운 대신 클릭 선택) */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 900, color: "#1f2a44" }}>책 선택</div>
              <div style={{ fontSize: 12, color: "#5d6b82", marginTop: 4 }}>
                아래 목록에서 책을 클릭하면 선택됩니다.
              </div>

              <div
                style={{
                  marginTop: 10,
                  maxHeight: 230,
                  overflow: "auto",
                  border: "1px solid #ffe3ee",
                  borderRadius: 12,
                  background: "#fff",
                }}
              >
                {loadingBooks ? (
                  <div style={{ padding: 12, fontSize: 13, color: "#5d6b82" }}>불러오는 중…</div>
                ) : filteredBookMeta.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 13, color: "#5d6b82" }}>
                    (조건에 맞는 단어책이 없습니다)
                  </div>
                ) : (
                  filteredBookMeta.map((row) => {
                    const on = row.book === book;
                    const path = row.category_path || "미분류";
                    return (
                      <div
                        key={row.book}
                        onClick={() => setBook(row.book)}
                        title={row.book}
                        style={{
                          padding: "10px 12px",
                          borderBottom: "1px solid #fff0f6",
                          cursor: "pointer",
                          background: on ? "#fff0f6" : "#fff",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 900,
                              color: "#1f2a44",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.book}
                          </div>
                          <div style={{ fontSize: 12, color: "#5d6b82", marginTop: 2 }}>
                            {path}
                          </div>
                        </div>
                        {on && (
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 900,
                              color: "#ff3b8d",
                              whiteSpace: "nowrap",
                            }}
                          >
                            선택됨
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {book && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#444", wordBreak: "keep-all" }}>
                  현재 선택 책: <b style={{ color: "#1f2a44" }}>{book}</b>
                  {selectedBookRow?.category_path ? (
                    <span style={{ marginLeft: 8, color: "#5d6b82" }}>
                      ({selectedBookRow.category_path})
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {/* ✅ 3) 챕터란 (맨 아래) */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #ffe3ee" }}>
              <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>
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

              <div style={{ fontSize: 12, color: "#888", marginTop: 8, wordBreak: "keep-all" }}>
유효 챕터: {chapters.join(", ") || (loadingChapters ? "불러오는 중…" : "없음")}
                <br />
                예시 입력: <code>4-8</code>, <code>1, 3, 5</code>, <code>2-4, 7, 9-10</code>
                <br />
                선택됨: {requestedChapters.length ? requestedChapters.join(", ") : "없음"}
                {chapters.length > 0 &&
                requestedChapters.length > 0 &&
                requestedChapters.length !== validRequested.length
                  ? ` → 유효: ${validRequested.join(", ") || "없음"}`
                  : ""}
              </div>
            </div>

            {/* 버튼 */}
            <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
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
                    style={{
                      background: "#fff",
                      color: "#ff6fa3",
                      border: "2px solid #ff8fb7",
                    }}
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
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  border: "1px solid #ffd3e3",
  borderRadius: 10,
  outline: "none",
  fontSize: 14,
  background: "#fff",
  color: "#1f2a44",
};
