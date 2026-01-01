import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchChapters, parseChapterInput } from "../utils/vocab";
import { supabase } from "../utils/supabaseClient";
import StudentShell from "./StudentShell";

export default function BookRangePage({ mode = "practice" }) {
  const nav = useNavigate();
  const isOfficial = mode === "official";

  /* =========================
     상태
  ========================= */
  const [bookMeta, setBookMeta] = useState([]); // { book, category_id, category_path }
  const [catNodes, setCatNodes] = useState([]);

  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [catSearch, setCatSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  // ⭐ 여러 책 선택 + 책별 챕터
  const [selectedBooks, setSelectedBooks] = useState(() => new Set());
  const [chaptersByBook, setChaptersByBook] = useState({}); // book -> chapterInput
  const [chapterOptions, setChapterOptions] = useState({}); // book -> [chapters]

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const reloadingRef = useRef(false);

  /* =========================
     분류 트리 유틸
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
      (childrenBy.get(pid || "__root__") || []).sort((a, b) =>
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
     데이터 로드
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
     분류 선택
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
     분류별 책 목록
  ========================= */
  const booksInCategory = useMemo(() => {
    if (!selectedCategoryId) return [];
    return bookMeta.filter((b) => b.category_id === selectedCategoryId);
  }, [bookMeta, selectedCategoryId]);

  /* =========================
     ✅ 선택한 책 목록용(추가 기능)
     - selectedBooks(Set) → 배열로 보기 좋게
     - 목록에서 선택해제/범위수정 가능
  ========================= */
  const selectedBookList = useMemo(() => {
    const arr = Array.from(selectedBooks);
    // 보기 좋게 정렬(원하면 제거 가능)
    arr.sort((a, b) => (a || "").localeCompare(b || ""));
    return arr;
  }, [selectedBooks]);

  function unselectBook(book) {
    // ✅ 기존 toggleBook 로직을 그대로 재사용(선택/해제/챕터 로드 일관성 유지)
    if (selectedBooks.has(book)) toggleBook(book);
  }

  /* =========================
     책 선택 / 해제 (기존 유지)
  ========================= */
  async function toggleBook(book) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(book)) {
        next.delete(book);
      } else {
        next.add(book);
      }
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
     이동 (A안) (기존 유지)
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
     트리 렌더 (기존 유지)
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
          {err && <div style={{ color: "#d00" }}>{err}</div>}

          <h3>분류 선택</h3>
          <div style={{ maxHeight: 260, overflow: "auto" }}>
            {loading ? "불러오는 중…" : renderTree(null)}
          </div>

          {selectedCategoryId && (
            <>
              <h3 style={{ marginTop: 16 }}>책 선택 + 챕터 범위</h3>

              {/* ✅ 기존: 분류 내 책 목록(체크박스) 그대로 */}
              {booksInCategory.map((b) => {
                const checked = selectedBooks.has(b.book);
                return (
                  <div key={b.book} style={{ marginTop: 10 }}>
                    <label style={{ fontWeight: 900 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleBook(b.book)}
                      />{" "}
                      {b.book}
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
                  <span style={{ fontSize: 12, color: "#777" }}>
                    ({selectedBookList.length}권)
                  </span>
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
                          <div style={{ fontWeight: 900, color: "#1f2a44" }}>
                            {book}
                          </div>

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
