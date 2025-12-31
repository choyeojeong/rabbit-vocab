// src/pages/BookRangePage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchBooks, fetchChapters, parseChapterInput } from "../utils/vocab";
import { supabase } from "../utils/supabaseClient";
import StudentShell from "./StudentShell";

export default function BookRangePage({ mode = "practice" }) {
  const nav = useNavigate();

  // ✅ 책 목록(표시용)
  const [books, setBooks] = useState([]); // string[]
  const [bookMeta, setBookMeta] = useState([]); // [{ book, category_id, category_path }]
  const [book, setBook] = useState("");

  // ✅ 분류 트리
  const [catNodes, setCatNodes] = useState([]); // [{id,parent_id,name,sort_order,created_at}]
  const [useCategory, setUseCategory] = useState(true); // 분류 UI 사용 여부(기본 ON)
  const [catRoot, setCatRoot] = useState(""); // uuid
  const [catMid, setCatMid] = useState(""); // uuid
  const [catLeaf, setCatLeaf] = useState(""); // uuid
  const [onlyCategorized, setOnlyCategorized] = useState(false); // 미분류 숨기기
  const [bookSearch, setBookSearch] = useState(""); // 책 검색

  const [chapters, setChapters] = useState([]); // [number]
  const [chapterInput, setChapterInput] = useState(""); // raw text
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [err, setErr] = useState("");

  const isOfficial = mode === "official";

  // 중복 호출 방지(포커스 이벤트 연타)
  const reloadingRef = useRef(false);

  // =========================
  // 분류 트리 유틸
  // =========================
  const tree = useMemo(() => {
    const byParent = new Map();
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

    const roots = sortArr(byParent.get("__root__"));
    const mids = (pid) => sortArr(byParent.get(pid));
    const leafs = (pid) => sortArr(byParent.get(pid));

    // leaf 판정(자식 없는 노드)
    const hasChild = new Set(catNodes.filter((x) => x.parent_id).map((x) => x.parent_id));
    const leafSet = new Set(catNodes.filter((x) => !hasChild.has(x.id)).map((x) => x.id));

    return { roots, mids, leafs, leafSet };
  }, [catNodes]);

  // =========================
  // 책 목록: 분류 필터 적용
  // =========================
  const filteredBookMeta = useMemo(() => {
    let list = Array.isArray(bookMeta) ? [...bookMeta] : [];

    if (onlyCategorized) {
      list = list.filter((x) => !!x.category_id);
    }

    // leaf 선택 시 그 leaf에 매핑된 책만
    if (useCategory && catLeaf) {
      list = list.filter((x) => (x.category_id || "") === catLeaf);
    } else if (useCategory && catMid) {
      // mid 선택만 된 경우: mid의 모든 leaf들을 모아서 필터
      const leafs = tree.leafs(catMid).map((n) => n.id);
      const leafSet = new Set(leafs);
      list = list.filter((x) => x.category_id && leafSet.has(x.category_id));
    } else if (useCategory && catRoot) {
      // root 선택만 된 경우: root 아래 모든 mid/leaf를 모아서 필터
      const mids = tree.mids(catRoot).map((n) => n.id);
      const leafIds = [];
      for (const midId of mids) {
        for (const lf of tree.leafs(midId)) leafIds.push(lf.id);
      }
      const leafSet = new Set(leafIds);
      list = list.filter((x) => x.category_id && leafSet.has(x.category_id));
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
  }, [
    bookMeta,
    onlyCategorized,
    useCategory,
    catRoot,
    catMid,
    catLeaf,
    bookSearch,
    tree,
  ]);

  const filteredBooks = useMemo(() => {
    return filteredBookMeta.map((x) => x.book);
  }, [filteredBookMeta]);

  // 선택된 book이 필터 결과에 있는지 체크
  function normalizeSelection(nextBooks, { keepSelection }) {
    if (keepSelection) {
      if (book && nextBooks?.includes(book)) {
        // 유지
        return;
      }
      if (nextBooks && nextBooks.length) setBook(nextBooks[0]);
      else setBook("");
    } else {
      if (nextBooks && nextBooks.length) setBook(nextBooks[0]);
      else setBook("");
    }
  }

  // =========================
  // ✅ 책 목록 + 분류 데이터 로드
  // - 분류 테이블/뷰가 아직 없거나 에러면 기존 fetchBooks()로 폴백
  // =========================
  async function reloadBooks({ keepSelection = true } = {}) {
    if (reloadingRef.current) return;
    reloadingRef.current = true;

    try {
      setErr("");
      setLoadingBooks(true);

      // 1) 분류 노드 로드(있으면)
      let nodes = [];
      const { data: ns, error: ne } = await supabase
        .from("book_category_nodes")
        .select("id, parent_id, name, sort_order, created_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (!ne && Array.isArray(ns)) nodes = ns;

      // 2) 책+분류(뷰) 로드(있으면)
      const { data: vw, error: ve } = await supabase
        .from("v_books_with_category")
        .select("book, category_id, category_path");

      if (!ve && Array.isArray(vw) && vw.length) {
        setCatNodes(nodes);
        setBookMeta(vw);

        const bs = vw.map((x) => x.book).filter(Boolean);
        // ⚠️ 여기서는 아직 UI 필터(leaf/root/mid)가 반영되기 전이므로,
        // 실제 표시 목록은 filteredBooks(useMemo)에서 계산된다.
        // 다만 기본 선택값은 전체 bs 기준으로 잡아두고,
        // 아래 useEffect에서 필터 결과에 맞춰 다시 보정한다.
        setBooks(bs);
        normalizeSelection(bs, { keepSelection });
      } else {
        // 폴백: 기존 방식
        const bs = await fetchBooks();
        setCatNodes(nodes);
        setBookMeta((bs || []).map((b) => ({ book: b, category_id: null, category_path: null })));
        setBooks(bs || []);
        normalizeSelection(bs || [], { keepSelection });
      }
    } catch (e) {
      console.error(e);
      setErr(e?.message || "단어책 목록을 불러오지 못했습니다.");
      setCatNodes([]);
      setBookMeta([]);
      setBooks([]);
      setBook("");
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
      reloadBooks({ keepSelection: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

  // ✅ 분류/검색 필터가 바뀌면 선택 book을 필터 목록에 맞게 보정
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

  // book 바뀌면 chapters 로드
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

        console.log("[fetchChapters]", {
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

  // 입력된 텍스트를 파싱한 "요청 챕터 배열"
  const requestedChapters = useMemo(
    () => parseChapterInput(chapterInput),
    [chapterInput]
  );

  // 실제 책의 유효 챕터와 교집합만 허용 (잘못된 번호 제거)
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
    // 유효 교집합이 있으면 그걸 사용, 없으면 파싱값 사용
    return validRequested.length ? validRequested : requestedChapters;
  }

  function goMCQ() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(
      chapterInput
    )}`;
    nav(`/practice/mcq?${query}`, {
      state: { mode: "practice", book, chapters: list },
    });
  }

  function goMock() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(
      chapterInput
    )}`;
    nav(`/practice/mock?${query}`, {
      state: { mode: "practice", book, chapters: list },
    });
  }

  function goOfficial() {
    const list = guardAndGetChapters();
    if (!list) return;
    const query = `book=${encodeURIComponent(book)}&chapters=${encodeURIComponent(
      chapterInput
    )}`;
    nav(`/exam/official?${query}`, {
      state: { mode: "official", book, chapters: list },
    });
  }

  const btnDisabled =
    loadingBooks || loadingChapters || !book || !chapterInput.trim();

  // 분류 선택 변경 핸들러(상위 변경 시 하위 리셋)
  function onChangeRoot(v) {
    setCatRoot(v);
    setCatMid("");
    setCatLeaf("");
  }
  function onChangeMid(v) {
    setCatMid(v);
    setCatLeaf("");
  }

  // select 옵션 표시(책이 너무 많을 때 분류경로 표시하면 찾기 쉬움)
  const bookOptionLabel = (b) => {
    const row = filteredBookMeta.find((x) => x.book === b);
    const p = row?.category_path ? row.category_path : "미분류";
    return useCategory ? `${p} · ${b}` : b;
  };

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: "100%" }}>
        <div className="student-container">
          <div className="student-card stack">
            {/* 상단: 새로고침 버튼 */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="student-button"
                onClick={() => reloadBooks({ keepSelection: true })}
                disabled={loadingBooks}
                style={{ padding: "8px 12px", whiteSpace: "nowrap" }}
                title="단어책 목록 새로고침"
              >
                ⟳ 책 목록 새로고침
              </button>
            </div>

            {err && (
              <div style={{ marginTop: 8, color: "#d00", fontSize: 13 }}>
                {err}
              </div>
            )}

            {/* ✅ 분류/검색 UI */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#444" }}>
                  <input
                    type="checkbox"
                    checked={useCategory}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setUseCategory(on);
                      // 끄면 선택 초기화(혼란 방지)
                      if (!on) {
                        setCatRoot("");
                        setCatMid("");
                        setCatLeaf("");
                        setOnlyCategorized(false);
                      }
                    }}
                  />
                  분류로 찾기
                </label>

                {useCategory && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#444" }}>
                    <input
                      type="checkbox"
                      checked={onlyCategorized}
                      onChange={(e) => setOnlyCategorized(e.target.checked)}
                    />
                    미분류 숨기기
                  </label>
                )}
              </div>

              {useCategory && (
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <div className="student-row">
                    <div>
                      <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>대분류</div>
                      <select
                        className="student-field"
                        style={fieldStyle}
                        value={catRoot}
                        onChange={(e) => onChangeRoot(e.target.value)}
                        disabled={loadingBooks}
                      >
                        <option value="">전체</option>
                        {tree.roots.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>중분류</div>
                      <select
                        className="student-field"
                        style={fieldStyle}
                        value={catMid}
                        onChange={(e) => onChangeMid(e.target.value)}
                        disabled={loadingBooks || !catRoot}
                      >
                        <option value="">전체</option>
                        {(catRoot ? tree.mids(catRoot) : []).map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>소분류</div>
                      <select
                        className="student-field"
                        style={fieldStyle}
                        value={catLeaf}
                        onChange={(e) => setCatLeaf(e.target.value)}
                        disabled={loadingBooks || !catMid}
                      >
                        <option value="">전체</option>
                        {(catMid ? tree.leafs(catMid) : []).map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

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
                      표시 책 수: {filteredBooks.length} / 전체: {books.length}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 책/챕터 입력 */}
            <div className="student-row" style={{ marginTop: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>
                  단어책
                </div>
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

              <div>
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
              </div>
            </div>

            <div
              style={{
                fontSize: 12,
                color: "#888",
                marginTop: 8,
                wordBreak: "keep-all",
              }}
            >
              유효 챕터:{" "}
              {chapters.join(", ") || (loadingChapters ? "불러오는 중…" : "없음")}
              <br />
              예시 입력: <code>4-8</code>, <code>1, 3, 5</code>,{" "}
              <code>2-4, 7, 9-10</code>
              <br />
              선택됨:{" "}
              {requestedChapters.length ? requestedChapters.join(", ") : "없음"}
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
};
