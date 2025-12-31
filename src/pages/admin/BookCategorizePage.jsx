// src/pages/admin/BookCategorizePage.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabaseClient";
import { useNavigate } from "react-router-dom";

/**
 * ✅ 변경점
 * - 오른쪽 "소분류(leaf) 선택"을 뱃지 나열 → ✅ 트리(접기/펼치기) UI로 변경
 * - 트리에서 leaf(자식 없는 노드)만 선택 가능
 * - 상단에 "분류 검색" 입력 추가(경로 포함 검색)
 * - 선택된 leaf는 하이라이트 + 상단에 현재 선택 경로 표시
 */

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 16 },
  wrap: { maxWidth: 1200, margin: "0 auto" },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
    flexWrap: "wrap",
  },
  title: { fontSize: 22, fontWeight: 900, color: "#1f2a44" },
  sub: { fontSize: 13, color: "#5d6b82", marginTop: 4 },

  grid: { display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 12 },

  card: {
    background: "#fff",
    border: "1px solid #ffd6e5",
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
  },

  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ffd6e5",
    outline: "none",
    background: "#fff",
    color: "#1f2a44",
  },

  btn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ff6fa3",
    background: "#ff6fa3",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    letterSpacing: 0.2,
  },
  btn2: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ffd6e5",
    background: "#fff",
    color: "#1f2a44",
    fontWeight: 900,
    cursor: "pointer",
  },

  small: {
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid #ffd6e5",
    background: "#fff",
    color: "#1f2a44",
    cursor: "pointer",
    fontWeight: 900,
    lineHeight: 1,
    minWidth: 54,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
  },

  smallDanger: {
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid #ffb3c8",
    background: "#fff6f8",
    color: "#b42318",
    cursor: "pointer",
    fontWeight: 900,
    lineHeight: 1,
    minWidth: 54,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },

  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },

  bookRow: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ffe3ee",
    marginTop: 8,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    background: "#fff",
  },

  muted: { color: "#5d6b82", fontSize: 13 },

  // ✅ 트리 UI
  treeBox: {
    marginTop: 10,
    border: "1px solid #ffe3ee",
    borderRadius: 12,
    padding: 10,
    background: "#fffbfd",
    maxHeight: "65vh",
    overflow: "auto",
  },
  treeRow: (depth, selected, clickable) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 10,
    marginLeft: depth * 16,
    border: selected ? "1px solid #ff6fa3" : "1px solid transparent",
    background: selected ? "#fff0f6" : "transparent",
    cursor: clickable ? "pointer" : "default",
    userSelect: "none",
  }),
  caretBtn: {
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
    flex: "0 0 auto",
  },
  caretGhost: { width: 28, height: 28, flex: "0 0 auto" },
  nodeName: (isLeaf) => ({
    fontWeight: 900,
    color: "#1f2a44",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: "1 1 auto",
  }),
  leafPill: {
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid #ffd6e5",
    background: "#fff",
    color: "#8a1f4b",
    fontSize: 11,
    fontWeight: 900,
    flex: "0 0 auto",
  },
  selectedBar: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ffd6e5",
    background: "#fff",
  },
  selectedPath: { fontWeight: 900, color: "#1f2a44" },
  pathSmall: { fontSize: 12, color: "#5d6b82", marginTop: 4, whiteSpace: "pre-wrap" },
};

function buildTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenBy = new Map();
  for (const n of nodes) {
    const k = n.parent_id || "__root__";
    if (!childrenBy.has(k)) childrenBy.set(k, []);
    childrenBy.get(k).push(n);
  }
  for (const [, arr] of childrenBy.entries()) {
    arr.sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.name || "").localeCompare(b.name || "")
    );
  }

  const hasChild = new Set(nodes.filter((n) => n.parent_id).map((n) => n.parent_id));
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

  return { byId, childrenBy, roots: childrenBy.get("__root__") || [], isLeaf, buildPath };
}

export default function BookCategorizePage() {
  const nav = useNavigate();
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [books, setBooks] = useState([]); // {book, category_id, category_path}
  const [nodes, setNodes] = useState([]); // tree nodes
  const [selectedLeafId, setSelectedLeafId] = useState(null);

  // ✅ 분류 검색
  const [catQ, setCatQ] = useState("");

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // ✅ 선택된 leaf 경로
  const selectedLeafPath = useMemo(() => {
    if (!selectedLeafId) return "";
    return tree.buildPath(selectedLeafId);
  }, [selectedLeafId, tree]);

  const filteredBooks = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return books;
    return books.filter((b) => (b.book || "").toLowerCase().includes(t));
  }, [books, q]);

  async function load() {
    try {
      setLoading(true);
      setErr("");

      const [{ data: bs, error: e1 }, { data: ns, error: e2 }] = await Promise.all([
        supabase.from("v_books_with_category").select("book, category_id, category_path"),
        supabase
          .from("book_category_nodes")
          .select("id, parent_id, name, sort_order, created_at")
          .order("sort_order", { ascending: true }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      setBooks(bs || []);
      setNodes(ns || []);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function assign(book) {
    if (!selectedLeafId) {
      alert("오른쪽에서 소분류(leaf)를 먼저 선택해 주세요.");
      return;
    }
    try {
      setErr("");
      const { error } = await supabase
        .from("book_category_map")
        .upsert({ book, category_id: selectedLeafId }, { onConflict: "book" });
      if (error) throw error;
      await load();
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  async function clearAssign(book) {
    try {
      setErr("");
      const { error } = await supabase.from("book_category_map").delete().eq("book", book);
      if (error) throw error;
      await load();
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  // ✅ 트리 접기/펼치기 상태
  const [collapsed, setCollapsed] = useState({}); // { [nodeId]: true }

  // 검색 시: 매칭 경로는 자동 펼치기
  useEffect(() => {
    const t = catQ.trim().toLowerCase();
    if (!t) return;

    const toOpen = new Set();
    for (const n of nodes) {
      const path = tree.buildPath(n.id).toLowerCase();
      if (path.includes(t)) {
        // 조상들을 전부 open 대상으로
        let cur = tree.byId.get(n.id);
        while (cur?.parent_id) {
          toOpen.add(cur.parent_id);
          cur = tree.byId.get(cur.parent_id);
        }
      }
    }
    if (toOpen.size) {
      setCollapsed((prev) => {
        const next = { ...prev };
        for (const id of toOpen) next[id] = false;
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catQ]);

  function toggle(id) {
    setCollapsed((p) => ({ ...p, [id]: !p[id] }));
  }

  const catFilterText = catQ.trim().toLowerCase();
  const nodeMatches = (id) => {
    if (!catFilterText) return true;
    const p = tree.buildPath(id).toLowerCase();
    return p.includes(catFilterText);
  };

  // ✅ 필터가 있을 때는: 매칭 노드 + 매칭 노드의 조상만 표시
  const visibleSet = useMemo(() => {
    if (!catFilterText) return null; // null = 모두 표시
    const vis = new Set();

    for (const n of nodes) {
      if (!nodeMatches(n.id)) continue;
      // 해당 노드 + 조상들
      let cur = tree.byId.get(n.id);
      while (cur) {
        vis.add(cur.id);
        cur = cur.parent_id ? tree.byId.get(cur.parent_id) : null;
      }
    }
    return vis;
  }, [catFilterText, nodes, tree]);

  const renderTreeNode = (n, depth) => {
    if (visibleSet && !visibleSet.has(n.id)) return null;

    const kids = tree.childrenBy.get(n.id) || [];
    const hasKids = kids.length > 0;
    const leaf = tree.isLeaf(n.id);

    const selected = selectedLeafId === n.id;
    const clickable = leaf; // ✅ leaf만 선택 가능

    return (
      <div key={n.id}>
        <div
          style={styles.treeRow(depth, selected, clickable)}
          onClick={() => {
            if (!leaf) return; // leaf가 아니면 선택 X
            setSelectedLeafId((p) => (p === n.id ? null : n.id));
          }}
          title={tree.buildPath(n.id)}
        >
          {hasKids ? (
            <button
              type="button"
              style={styles.caretBtn}
              onClick={(e) => {
                e.stopPropagation();
                toggle(n.id);
              }}
              title={collapsed[n.id] ? "펼치기" : "접기"}
            >
              {collapsed[n.id] ? "▶" : "▼"}
            </button>
          ) : (
            <span style={styles.caretGhost} />
          )}

          <div style={styles.nodeName(leaf)}>
            {n.name}
          </div>

          {leaf && <span style={styles.leafPill}>leaf</span>}
        </div>

        {hasKids && !collapsed[n.id] && kids.map((c) => renderTreeNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.head}>
          <div>
            <div style={styles.title}>단어책 분류 지정</div>
            <div style={styles.sub}>업로드된 책(book) 목록을 소분류(leaf)에 매핑합니다.</div>
          </div>
          <div style={styles.row}>
            <button style={styles.btn2} onClick={() => nav("/teacher/book-categories")}>
              ← 분류 트리
            </button>
            <button style={styles.btn2} onClick={() => nav("/dashboard")}>
              대시보드
            </button>
            <button style={styles.btn} onClick={load} disabled={loading}>
              {loading ? "불러오는 중..." : "새로고침"}
            </button>
          </div>
        </div>

        {err && (
          <div style={{ ...styles.card, borderColor: "#ffb3c8", marginBottom: 12 }}>
            <div style={{ color: "#b42318", fontWeight: 900 }}>에러</div>
            <div style={{ color: "#b42318", marginTop: 6, whiteSpace: "pre-wrap" }}>{err}</div>
          </div>
        )}

        <div style={styles.grid}>
          {/* 왼쪽: 책 목록 */}
          <div style={styles.card}>
            <div style={{ fontWeight: 900, color: "#1f2a44" }}>책 목록</div>
            <div style={{ ...styles.row, marginTop: 10 }}>
              <input
                style={styles.input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="책 검색 (예: 워드마스터, 수능, 능률...)"
              />
            </div>

            <div style={{ marginTop: 10, ...styles.muted }}>
              총 {books.length}권 / 표시 {filteredBooks.length}권
            </div>

            {filteredBooks.map((b) => (
              <div key={b.book} style={styles.bookRow}>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 900,
                      color: "#1f2a44",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={b.book}
                  >
                    {b.book}
                  </div>
                  <div style={styles.muted}>
                    {b.category_path ? `현재: ${b.category_path}` : "현재: (미분류)"}
                  </div>
                </div>

                <div style={styles.row}>
                  <button style={styles.small} onClick={() => assign(b.book)}>
                    지정
                  </button>
                  <button style={styles.smallDanger} onClick={() => clearAssign(b.book)}>
                    해제
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 오른쪽: 트리로 소분류 선택 */}
          <div style={styles.card}>
            <div style={{ fontWeight: 900, color: "#1f2a44" }}>분류 선택(트리)</div>
            <div style={{ ...styles.muted, marginTop: 6 }}>
              ✅ leaf(자식 없는 항목)만 선택할 수 있어요. 선택 후 왼쪽 책에서 “지정”을 누르세요.
            </div>

            {/* 분류 검색 */}
            <div style={{ ...styles.row, marginTop: 10 }}>
              <input
                style={styles.input}
                value={catQ}
                onChange={(e) => setCatQ(e.target.value)}
                placeholder="분류 검색 (예: 수능 / 품사 / 명사 / 관계대명사 ...)"
              />
              <button
                style={styles.btn2}
                onClick={() => setCollapsed({})}
                title="전부 펼치기"
              >
                전부 펼치기
              </button>
              <button
                style={styles.btn2}
                onClick={() => {
                  const next = {};
                  for (const r of tree.roots) next[r.id] = true; // 루트의 하위만 접기
                  setCollapsed(next);
                }}
                title="하위 접기"
              >
                하위 접기
              </button>
            </div>

            {/* 현재 선택 표시 */}
            <div style={styles.selectedBar}>
              <div style={styles.selectedPath}>
                현재 선택: {selectedLeafId ? "✅ 선택됨" : "—"}
              </div>
              <div style={styles.pathSmall}>
                {selectedLeafId ? selectedLeafPath : "오른쪽 트리에서 leaf를 클릭해 선택하세요."}
              </div>
            </div>

            <div style={styles.treeBox}>
              {nodes.length === 0 ? (
                <div style={styles.muted}>분류 트리가 없습니다. 먼저 “분류 트리”에서 만들어 주세요.</div>
              ) : (
                tree.roots.map((r) => renderTreeNode(r, 0))
              )}
            </div>
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
