// src/pages/admin/BookCategorizePage.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabaseClient";
import { useNavigate } from "react-router-dom";

/**
 * ✅ 요청 반영
 * - 가운데 흰색 네모(고정 폭 카드) 제거 → 화면 전체 사용 레이아웃
 * - iPhone 기준 모바일 최적화
 *   - safe-area(노치/홈바) 대응
 *   - sticky header
 *   - 2컬럼 → 모바일 1컬럼 자동 전환
 *   - 터치 타겟 44px / 입력 높이 44px
 * - 기능은 그대로 유지 (트리 선택/검색/접기/펼치기/지정/해제)
 */

const THEME = {
  bg: "#f7f9fc", // AdminGate bg와 맞춰도 무난
  card: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  border2: "#f1f4f8",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  borderPink: "#ffd6e5",
  danger: "#b42318",
};

const UI = {
  btn: (kind = "pink") => {
    const base = {
      height: 44,
      padding: "0 14px",
      borderRadius: 999,
      fontWeight: 900,
      cursor: "pointer",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
      whiteSpace: "nowrap",
      boxShadow: "0 10px 22px rgba(31,42,68,.06)",
    };
    if (kind === "pink") {
      return {
        ...base,
        border: "none",
        background: THEME.pink,
        color: "#fff",
        boxShadow: "0 10px 22px rgba(255,111,163,.18)",
      };
    }
    return {
      ...base,
      border: `1px solid ${THEME.border}`,
      background: "#fff",
      color: THEME.text,
    };
  },

  input: {
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
  },

  card: {
    background: THEME.card,
    border: `1px solid ${THEME.border}`,
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },

  label: {
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 900,
    marginBottom: 6,
  },
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

  const visibleSet = useMemo(() => {
    if (!catFilterText) return null;
    const vis = new Set();

    for (const n of nodes) {
      if (!nodeMatches(n.id)) continue;
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
    const clickable = leaf;

    return (
      <div key={n.id}>
        <div
          style={styles.treeRow(depth, selected, clickable)}
          onClick={() => {
            if (!leaf) return;
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
              aria-label={collapsed[n.id] ? "펼치기" : "접기"}
            >
              {collapsed[n.id] ? "▶" : "▼"}
            </button>
          ) : (
            <span style={styles.caretGhost} />
          )}

          <div style={styles.nodeName(leaf)}>{n.name}</div>

          {leaf && <span style={styles.leafPill}>leaf</span>}
        </div>

        {hasKids && !collapsed[n.id] && kids.map((c) => renderTreeNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div style={styles.page}>
      {/* ✅ sticky header */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.headTop}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.title}>단어책 분류 지정</div>
              <div style={styles.sub}>업로드된 책(book) 목록을 소분류(leaf)에 매핑합니다.</div>
            </div>

            <div style={styles.headBtns}>
              <button style={UI.btn("ghost")} onClick={() => nav("/teacher/book-categories")}>
                ← 분류 트리
              </button>
              <button style={UI.btn("ghost")} onClick={() => nav("/dashboard")}>
                대시보드
              </button>
              <button style={UI.btn("pink")} onClick={load} disabled={loading}>
                {loading ? "불러오는 중..." : "새로고침"}
              </button>
            </div>
          </div>

          {err && (
            <div style={styles.errBox}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>에러</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{err}</div>
            </div>
          )}
        </div>
      </div>

      {/* ✅ content full width */}
      <div style={styles.content}>
        <div className="_bc_grid" style={styles.grid}>
          {/* 왼쪽: 책 목록 */}
          <div style={UI.card}>
            <div style={{ fontWeight: 900, color: THEME.text }}>책 목록</div>

            <div style={{ marginTop: 10 }}>
              <input
                style={UI.input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="책 검색 (예: 워드마스터, 수능, 능률...)"
              />
            </div>

            <div style={{ marginTop: 10, color: THEME.sub, fontSize: 13, fontWeight: 800 }}>
              총 {books.length}권 / 표시 {filteredBooks.length}권
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {filteredBooks.map((b) => (
                <div key={b.book} style={styles.bookRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.bookName} title={b.book}>
                      {b.book}
                    </div>
                    <div style={styles.bookMeta}>
                      {b.category_path ? `현재: ${b.category_path}` : "현재: (미분류)"}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button style={styles.smallBtn} onClick={() => assign(b.book)}>
                      지정
                    </button>
                    <button style={styles.smallDangerBtn} onClick={() => clearAssign(b.book)}>
                      해제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 오른쪽: 트리로 소분류 선택 */}
          <div style={UI.card}>
            <div style={{ fontWeight: 900, color: THEME.text }}>분류 선택(트리)</div>
            <div style={{ marginTop: 6, fontSize: 12, color: THEME.sub, fontWeight: 800 }}>
              ✅ leaf(자식 없는 항목)만 선택할 수 있어요. 선택 후 왼쪽 책에서 “지정”을 누르세요.
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                style={{ ...UI.input, flex: "1 1 220px" }}
                value={catQ}
                onChange={(e) => setCatQ(e.target.value)}
                placeholder="분류 검색 (예: 수능 / 품사 / 명사 / 관계대명사 ...)"
              />
              <button style={UI.btn("ghost")} onClick={() => setCollapsed({})} title="전부 펼치기">
                전부 펼치기
              </button>
              <button
                style={UI.btn("ghost")}
                onClick={() => {
                  const next = {};
                  for (const r of tree.roots) next[r.id] = true;
                  setCollapsed(next);
                }}
                title="하위 접기"
              >
                하위 접기
              </button>
            </div>

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
                <div style={{ color: THEME.sub, fontWeight: 900, fontSize: 13 }}>
                  분류 트리가 없습니다. 먼저 “분류 트리”에서 만들어 주세요.
                </div>
              ) : (
                tree.roots.map((r) => renderTreeNode(r, 0))
              )}
            </div>
          </div>
        </div>

        <div style={{ height: 16 }} />
      </div>

      <style>{`
        @media (max-width: 980px) {
          ._bc_grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    height: "100dvh",
    background: THEME.bg,
    color: THEME.text,
  },

  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: THEME.bg,
    paddingTop: "env(safe-area-inset-top, 0px)",
    borderBottom: `1px solid ${THEME.border}`,
  },
  headerInner: {
    maxWidth: 1600,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
  },
  headTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  title: {
    fontSize: 18,
    fontWeight: 900,
    color: THEME.text,
    letterSpacing: "-0.2px",
  },
  sub: { fontSize: 12, color: THEME.sub, marginTop: 4, fontWeight: 800 },
  headBtns: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },

  errBox: {
    marginTop: 12,
    borderRadius: 16,
    border: `1px solid #ffb3c8`,
    background: "#fff6f8",
    color: THEME.danger,
    padding: 12,
    fontWeight: 900,
    boxShadow: "0 10px 22px rgba(180,35,24,.08)",
  },

  content: {
    maxWidth: 1600,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "1.1fr 0.9fr",
    gap: 12,
    alignItems: "start",
  },

  bookRow: {
    padding: "12px 12px",
    borderRadius: 14,
    border: `1px solid ${THEME.border2}`,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    background: "#fff",
  },
  bookName: {
    fontWeight: 900,
    color: THEME.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  bookMeta: { marginTop: 4, fontSize: 12, color: THEME.sub, fontWeight: 800 },

  smallBtn: {
    height: 40,
    padding: "0 12px",
    borderRadius: 12,
    border: `1px solid ${THEME.borderPink}`,
    background: "#fff",
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 900,
    boxShadow: "0 10px 22px rgba(31,42,68,.06)",
    WebkitTapHighlightColor: "transparent",
  },
  smallDangerBtn: {
    height: 40,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid #ffb3c8",
    background: "#fff6f8",
    color: "#b42318",
    cursor: "pointer",
    fontWeight: 900,
    WebkitTapHighlightColor: "transparent",
  },

  // ✅ 트리 UI
  treeBox: {
    marginTop: 12,
    border: `1px solid ${THEME.border2}`,
    borderRadius: 14,
    padding: 10,
    background: "#fbfcff",
    maxHeight: "62vh",
    overflow: "auto",
  },
  treeRow: (depth, selected, clickable) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 10px",
    borderRadius: 12,
    marginLeft: depth * 14,
    border: selected ? `1px solid ${THEME.pink}` : "1px solid transparent",
    background: selected ? THEME.pinkSoft : "transparent",
    cursor: clickable ? "pointer" : "default",
    userSelect: "none",
    minHeight: 44,
  }),
  caretBtn: {
    width: 32,
    height: 32,
    borderRadius: 12,
    border: `1px solid ${THEME.borderPink}`,
    background: "#fff",
    color: THEME.text,
    fontWeight: 900,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "0 0 auto",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  },
  caretGhost: { width: 32, height: 32, flex: "0 0 auto" },
  nodeName: () => ({
    fontWeight: 900,
    color: THEME.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: "1 1 auto",
    minWidth: 0,
  }),
  leafPill: {
    padding: "3px 9px",
    borderRadius: 999,
    border: `1px solid ${THEME.borderPink}`,
    background: "#fff",
    color: "#8a1f4b",
    fontSize: 11,
    fontWeight: 900,
    flex: "0 0 auto",
    whiteSpace: "nowrap",
  },

  selectedBar: {
    marginTop: 12,
    padding: "12px 12px",
    borderRadius: 14,
    border: `1px solid ${THEME.border2}`,
    background: "#fff",
  },
  selectedPath: { fontWeight: 900, color: THEME.text },
  pathSmall: {
    fontSize: 12,
    color: THEME.sub,
    marginTop: 6,
    whiteSpace: "pre-wrap",
    fontWeight: 800,
  },
};
