// src/pages/BookRangePage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchBooks, fetchChapters, parseChapterInput } from "../utils/vocab";
import { supabase } from "../utils/supabaseClient";
import StudentShell from "./StudentShell";

export default function BookRangePage({ mode = "practice" }) {
  const nav = useNavigate();

  // ✅ 책 메타(뷰)
  const [bookMeta, setBookMeta] = useState([]); // [{ book, category_id, category_path }]
  const [book, setBook] = useState("");

  // ✅ 분류 트리
  const [catNodes, setCatNodes] = useState([]); // [{id,parent_id,name,sort_order,created_at}]
  const [selectedNodeId, setSelectedNodeId] = useState(""); // 선택한 분류(아무 depth 가능)
  const [expanded, setExpanded] = useState(() => new Set()); // 펼침 상태(노드 id)
  const [catSearch, setCatSearch] = useState(""); // 분류 검색(트리 필터)
  const [bookSearch, setBookSearch] = useState(""); // 책 검색(책 목록 필터)

  const [chapters, setChapters] = useState([]); // [number]
  const [chapterInput, setChapterInput] = useState(""); // raw text
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [err, setErr] = useState("");

  const isOfficial = mode === "official";

  // 중복 호출 방지(포커스 이벤트 연타)
  const reloadingRef = useRef(false);

  // =========================
  // 트리 인덱스/유틸
  // =========================
  const tree = useMemo(() => {
    const byId = new Map(catNodes.map((n) => [n.id, n]));
    const byParent = new Map(); // parent -> children[]
    for (const n of catNodes) {
      const k = n.parent_id || "__root__";
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(n);
    }

    const sortArr = (arr) =>
      [...(arr || [])].sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          (a.name || "").localeCompare(b.name || "")
      );

    // 정렬 적용
    for (const [k, arr] of byParent.entries()) {
      byParent.set(k, sortArr(arr));
    }

    const roots = byParent.get("__root__") || [];

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

    // ✅ 선택 노드 아래의 "leaf id들"을 전부 수집
    const collectLeafIds = (startId) => {
      if (!startId) return [];
      const out = [];
      const stack = [startId];
      const seen = new Set();

      while (stack.length) {
        const id = stack.pop();
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const children = byParent.get(id) || [];
        if (!children.length) {
          // 자식이 없으면 leaf
          out.push(id);
        } else {
          for (const c of children) stack.push(c.id);
        }
      }
      return out;
    };

    // ✅ 루트 기준으로 자동 펼치기(초기 UX)
    const defaultExpanded = () => {
      // 루트는 펼친 상태로
      const s = new Set();
      for (const r of roots) s.add(r.id);
      return s;
    };

    return {
      byId,
      byParent,
      roots,
      isLeaf,
      buildPath,
      collectLeafIds,
      defaultExpanded,
    };
  }, [catNodes]);

  // =========================
  // ✅ 로드: 책+분류 데이터
  // =========================
  async function reloadBooks({ keepSelection = true } = {}) {
    if (reloadingRef.current) return;
    reloadingRef.current = true;

    try {
      setErr("");
      setLoadingBooks(true);

      // 1) 분류 노드 로드
      const { data: ns, error: ne } = await supabase
        .from("book_category_nodes")
        .select("id, parent_id, name, sort_order, created_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (ne) throw ne;
      setCatNodes(Array.isArray(ns) ? ns : []);

      // 2) 책+분류(뷰) 로드
      const { data: vw, error: ve } = await supabase
        .from("v_books_with_category")
        .select("book, category_id, category_path");

      if (ve) throw ve;

      // ✅ 분류 기반 UI이므로 "미분류는 기본 제외"
      const list = (vw || []).filter((x) => !!x.book);

      setBookMeta(list);

      // 선택된 book 유지/보정(일단 전체에서)
      if (keepSelection) {
        if (book && list.some((x) => x.book === book)) {
          // 유지
        } else {
          const first = list.find((x) => x.book && x.category_id)?.book || list[0]?.book || "";
          setBook(first || "");
        }
      } else {
        const first = list.find((x) => x.book && x.category_id)?.book || list[0]?.book || "";
        setBook(first || "");
      }

      // ✅ 처음 진입 시: 루트 자동 펼침
      setExpanded((prev) => {
        if (prev && prev.size) return prev;
        return tree.defaultExpanded();
      });
    } catch (e) {
      console.error(e);
      // 폴백: 기존 방식(단, 이 경우 분류 UI가 의미가 없으니 안내)
      try {
        const bs = await fetchBooks();
        setBookMeta((bs || []).map((b) => ({ book: b, category_id: null, category_path: null })));
        if (!keepSelection) setBook(bs?.[0] || "");
        setErr(
          (e?.message || "단어책/분류 데이터를 불러오지 못했습니다.") +
            "\n(분류 테이블/뷰가 아직 없거나 권한 문제가 있을 수 있어요.)"
        );
      } catch {
        setBookMeta([]);
        setBook("");
        setErr(e?.message || "단어책/분류 데이터를 불러오지 못했습니다.");
      }
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

  // 포커스 시 갱신
  useEffect(() => {
    const onFocus = () => reloadBooks({ keepSelection: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // =========================
  // ✅ 분류 트리 검색: 노드/조상/자손 가시화
  // - 검색어가 있으면, 매칭 노드 + 그 조상 + 자손만 보여주기
  // =========================
  const visibleNodeIds = useMemo(() => {
    const q = (catSearch || "").trim().toLowerCase();
    if (!q) return null; // null이면 전체 표시

    const byId = tree.byId;
    const byParent = tree.byParent;

    const matchIds = new Set();
    for (const n of catNodes) {
      if ((n.name || "").toLowerCase().includes(q)) matchIds.add(n.id);
    }

    const addAncestors = (id, set) => {
      let cur = byId.get(id);
      while (cur && cur.parent_id) {
        set.add(cur.parent_id);
        cur = byId.get(cur.parent_id);
      }
    };

    const addDescendants = (id, set) => {
      const stack = [id];
      const seen = new Set();
      while (stack.length) {
        const x = stack.pop();
        if (!x || seen.has(x)) continue;
        seen.add(x);
        set.add(x);
        const kids = byParent.get(x) || [];
        for (const k of kids) stack.push(k.id);
      }
    };

    const vis = new Set();
    for (const id of matchIds) {
      vis.add(id);
      addAncestors(id, vis);
      addDescendants(id, vis);
    }
    return vis;
  }, [catSearch, catNodes, tree]);

  // =========================
  // ✅ 책 목록 필터
  // - "분류로 찾기" 강제이므로 미분류는 항상 숨김
  // - 선택한 노드(어떤 depth든) 아래 leaf들에 매핑된 책만
  // - 책 검색 적용
  // =========================
  const filteredBookMeta = useMemo(() => {
    let list = Array.isArray(bookMeta) ? [...bookMeta] : [];

    // ✅ 미분류는 학생에게 안 보이게(항상 숨김)
    list = list.filter((x) => !!x.category_id);

    // 선택된 분류가 있으면 그 하위 leaf로 필터
    if (selectedNodeId) {
      const leafIds = tree.collectLeafIds(selectedNodeId);
      const leafSet = new Set(leafIds);
      list = list.filter((x) => x.category_id && leafSet.has(x.category_id));
    }

    // 책 검색
    const q = (bookSearch || "").trim().toLowerCase();
    if (q) list = list.filter((x) => (x.book || "").toLowerCase().includes(q));

    // 정렬: 경로 -> 책이름
    list.sort((a, b) => {
      const pa = (a.category_path || "").toLowerCase();
      const pb = (b.category_path || "").toLowerCase();
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      return (a.book || "").localeCompare(b.book || "");
    });

    return list;
  }, [bookMeta, selectedNodeId, bookSearch, tree]);

  const filteredBooks = useMemo(() => filteredBookMeta.map((x) => x.book), [filteredBookMeta]);

  // 필터 결과에 맞춰 book 보정
  useEffect(() => {
    if (loadingBooks) return;
    if (!filteredBooks.length) {
      if (book) setBook("");
      return;
    }
    if (!book || !filteredBooks.includes(book)) setBook(filteredBooks[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingBooks, filteredBooks.join("|")]);

  // =========================
  // 챕터 로드
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
  // 시험/연습 이동
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
  // =========================
  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickNode(id) {
    setSelectedNodeId((prev) => (prev === id ? "" : id));
    // 선택 시, 해당 노드 자동 펼침(찾기 편하게)
    setExpanded((prev) => {
      const next = new Set(prev || []);
      next.add(id);
      return next;
    });
  }

  function renderNode(id, depth = 0) {
    const node = tree.byId.get(id);
    if (!node) return null;

    // 검색 시 가시성 필터
    if (visibleNodeIds && !visibleNodeIds.has(id)) return null;

    const children = tree.byParent.get(id) || [];
    const hasKids = children.length > 0;
    const isOpen = expanded.has(id);

    const active = selectedNodeId === id;

    return (
      <div key={id} style={{ marginTop: 6 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 12,
            border: active ? "1px solid #ff6fa3" : "1px solid #ffe3ee",
            background: active ? "rgba(255,111,163,0.10)" : "#fff",
            marginLeft: depth * 14,
          }}
        >
          <button
            type="button"
            onClick={() => (hasKids ? toggleExpand(id) : pickNode(id))}
            title={hasKids ? (isOpen ? "접기" : "펼치기") : "선택"}
            style={{
              width: 28,
              height: 28,
              borderRadius: 10,
              border: "1px solid #ffd6e5",
              background: "#fff",
              color: "#1f2a44",
              fontWeight: 900,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {hasKids ? (isOpen ? "▾" : "▸") : "•"}
          </button>

          <button
            type="button"
            onClick={() => pickNode(id)}
            style={{
              flex: 1,
              textAlign: "left",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "#1f2a44",
              fontWeight: 900,
              padding: 0,
              minWidth: 0,
            }}
            title={tree.buildPath(id)}
          >
            <span style={{ display: "inline-block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
              {node.name}
            </span>
            <span style={{ marginLeft: 8, fontSize: 12, color: "#5d6b82", fontWeight: 800 }}>
              {tree.isLeaf(id) ? "leaf" : ""}
            </span>
          </button>
        </div>

        {hasKids && isOpen && (
          <div style={{ marginTop: 6 }}>
            {children.map((c) => renderNode(c.id, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  const bookOptionLabel = (b) => {
    const row = filteredBookMeta.find((x) => x.book === b);
    const p = row?.category_path ? row.category_path : "";
    return p ? `${p} · ${b}` : b;
  };

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
                onClick={() => reloadBooks({ keepSelection: true })}
                disabled={loadingBooks}
                style={{ padding: "8px 12px", whiteSpace: "nowrap" }}
                title="단어책/분류 새로고침"
              >
                ⟳ 새로고침
              </button>
            </div>

            {err && <div style={{ marginTop: 8, color: "#d00", fontSize: 13, whiteSpace: "pre-wrap" }}>{err}</div>}

            {/* ✅ 분류 트리 + 책 검색 */}
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 10 }}>
                {/* 왼쪽: 분류 트리 */}
                <div
                  style={{
                    border: "1px solid #ffd3e3",
                    borderRadius: 12,
                    padding: 10,
                    background: "#fff",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#444", marginBottom: 6, fontWeight: 800 }}>
                    분류로 찾기 (항상)
                  </div>

                  <input
                    className="student-field"
                    style={{ ...fieldStyle, marginBottom: 8 }}
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    placeholder="분류 검색 (예: 품사, 명사, 관계사...)"
                    inputMode="text"
                    autoCapitalize="none"
                  />

                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
                    선택됨:{" "}
                    <b style={{ color: "#1f2a44" }}>
                      {selectedNodeId ? tree.buildPath(selectedNodeId) : "전체(분류됨 책)"}
                    </b>
                  </div>

                  <div style={{ maxHeight: 320, overflow: "auto", paddingRight: 4 }}>
                    {tree.roots.length === 0 ? (
                      <div style={{ fontSize: 13, color: "#5d6b82" }}>
                        분류 트리가 아직 없습니다. (관리자에서 분류를 먼저 만들어 주세요)
                      </div>
                    ) : (
                      tree.roots.map((r) => renderNode(r.id, 0))
                    )}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="student-button"
                      onClick={() => {
                        setSelectedNodeId("");
                        setCatSearch("");
                      }}
                      style={{ padding: "8px 12px" }}
                    >
                      전체 보기
                    </button>
                    <button
                      type="button"
                      className="student-button"
                      onClick={() => {
                        // 전부 펼치기(현재 로드된 노드 기준)
                        setExpanded(new Set(catNodes.map((n) => n.id)));
                      }}
                      style={{ padding: "8px 12px" }}
                      disabled={!catNodes.length}
                    >
                      모두 펼치기
                    </button>
                    <button
                      type="button"
                      className="student-button"
                      onClick={() => setExpanded(tree.defaultExpanded())}
                      style={{ padding: "8px 12px" }}
                      disabled={!tree.roots.length}
                    >
                      접기(루트만)
                    </button>
                  </div>
                </div>

                {/* 오른쪽: 책 검색 */}
                <div>
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
                  <div style={{ marginTop: 6, fontSize: 12, color: "#888", wordBreak: "keep-all" }}>
                    표시 책 수: {filteredBooks.length}
                  </div>

                  {/* 책 선택 */}
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>단어책</div>
                    <select
                      className="student-field"
                      value={book}
                      onChange={(e) => setBook(e.target.value)}
                      style={fieldStyle}
                      disabled={loadingBooks}
                    >
                      {loadingBooks ? (
                        <option value="" disabled>
                          불러오는 중…
                        </option>
                      ) : filteredBooks.length === 0 ? (
                        <option value="" disabled>
                          (조건에 맞는 단어책이 없습니다)
                        </option>
                      ) : (
                        filteredBooks.map((b) => (
                          <option key={b} value={b}>
                            {bookOptionLabel(b)}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* 챕터 입력 */}
            <div className="student-row" style={{ marginTop: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>챕터 (콤마/범위 입력 가능)</div>
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
                    style={{ background: "#fff", color: "#ff6fa3", border: "2px solid #ff8fb7" }}
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
