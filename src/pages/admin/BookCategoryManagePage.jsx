// src/pages/admin/BookCategoryManagePage.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabaseClient";
import { useNavigate } from "react-router-dom";

/**
 * ✅ 요청 반영
 * - 가운데 흰색 네모(고정 폭 카드) 제거 → 화면 전체 사용
 * - iPhone 모바일 최적화
 *   - safe-area(노치/홈바) 대응
 *   - sticky header
 *   - 터치 타겟 44px / 입력 높이 44px
 *   - 긴 트리 스크롤 UX 개선
 * - 기능은 그대로 유지
 *   - depth 표시 제거(기존대로)
 *   - [+ 하위] 눌렀을 때만 입력칸 펼침
 *   - 들여쓰기/가이드라인/접기/펼치기 유지
 */

const THEME = {
  bg: "#f7f9fc",
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
  btn: (kind = "ghost") => {
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

  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#ffe3ee",
    color: "#8a1f4b",
    fontWeight: 900,
    fontSize: 12,
    border: `1px solid ${THEME.borderPink}`,
  },
};

function normalizeSort(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = r.parent_id || "__root__";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [, arr] of groups.entries()) {
    arr.sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.name || "").localeCompare(b.name || "")
    );
    arr.forEach((r, i) => (r._idx = i));
  }
  return rows;
}

function buildTreeHelpers(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenBy = new Map();
  for (const r of rows) {
    const k = r.parent_id || "__root__";
    if (!childrenBy.has(k)) childrenBy.set(k, []);
    childrenBy.get(k).push(r);
  }
  for (const [, arr] of childrenBy.entries()) {
    arr.sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
        (a.name || "").localeCompare(b.name || "")
    );
  }
  const roots = childrenBy.get("__root__") || [];
  return { byId, childrenBy, roots };
}

export default function BookCategoryManagePage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  const [newRoot, setNewRoot] = useState("");

  // ✅ 하위 추가: "입력칸 펼침" 상태
  const [addingFor, setAddingFor] = useState(null); // nodeId | null
  const [newChildText, setNewChildText] = useState(""); // 현재 펼쳐진 입력칸의 텍스트

  // ✅ 접기/펼치기
  const [collapsed, setCollapsed] = useState({}); // { [nodeId]: true }

  const helpers = useMemo(() => buildTreeHelpers(rows), [rows]);

  async function load() {
    try {
      setLoading(true);
      setErr("");
      const { data, error } = await supabase
        .from("book_category_nodes")
        .select("id, parent_id, name, sort_order, created_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;
      setRows(normalizeSort(data || []));
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createNode({ parentId, name }) {
    const nm = (name || "").trim();
    if (!nm) return;

    const siblings = rows.filter((r) => (r.parent_id || null) === (parentId || null));
    const next = siblings.length
      ? Math.max(...siblings.map((s) => s.sort_order ?? 0)) + 1
      : 0;

    const { error } = await supabase.from("book_category_nodes").insert({
      parent_id: parentId || null,
      name: nm,
      sort_order: next,
    });
    if (error) throw error;

    if (parentId) setCollapsed((p) => ({ ...p, [parentId]: false }));
    await load();
  }

  async function renameNode(id, name) {
    const nm = (name || "").trim();
    if (!nm) return;
    const { error } = await supabase.from("book_category_nodes").update({ name: nm }).eq("id", id);
    if (error) throw error;
    await load();
  }

  async function deleteNode(id) {
    const { error } = await supabase.from("book_category_nodes").delete().eq("id", id);
    if (error) throw error;
    await load();
  }

  async function moveUpDown(node, dir) {
    const siblings = rows
      .filter((r) => (r.parent_id || null) === (node.parent_id || null))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const idx = siblings.findIndex((s) => s.id === node.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;

    const a = siblings[idx];
    const b = siblings[swapIdx];

    const { error: e1 } = await supabase
      .from("book_category_nodes")
      .update({ sort_order: b.sort_order ?? 0 })
      .eq("id", a.id);
    if (e1) throw e1;

    const { error: e2 } = await supabase
      .from("book_category_nodes")
      .update({ sort_order: a.sort_order ?? 0 })
      .eq("id", b.id);
    if (e2) throw e2;

    await load();
  }

  function toggleCollapse(id) {
    setCollapsed((p) => ({ ...p, [id]: !p[id] }));
  }

  function openAddChild(id) {
    setAddingFor((cur) => (cur === id ? null : id));
    setNewChildText("");
    setCollapsed((p) => ({ ...p, [id]: false }));
  }

  async function submitAddChild(parentId) {
    const nm = (newChildText || "").trim();
    if (!nm) return;
    await createNode({ parentId, name: nm });
    setNewChildText("");
  }

  const renderNode = (nodeId, depth) => {
    const node = helpers.byId.get(nodeId);
    if (!node) return null;

    const children = helpers.childrenBy.get(node.id) || [];
    const hasKids = children.length > 0;
    const isCollapsed = !!collapsed[node.id];

    return (
      <div key={node.id}>
        <div style={styles.nodeRow(depth)}>
          <div style={styles.guide(depth)} />

          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {depth > 0 && <span style={styles.elbow} />}

            {/* 접기/펼치기 */}
            {hasKids ? (
              <button
                type="button"
                style={styles.smallBtn}
                onClick={() => toggleCollapse(node.id)}
                title={isCollapsed ? "펼치기" : "접기"}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
            ) : (
              <span style={{ width: 44, height: 44 }} />
            )}

            <strong style={styles.nodeName} title={node.name}>
              {node.name}
            </strong>

            <button
              type="button"
              style={styles.smallBtn}
              onClick={() => {
                const nm = prompt("이름 수정", node.name);
                if (nm !== null) renameNode(node.id, nm).catch((e) => setErr(e?.message || String(e)));
              }}
            >
              이름
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              style={styles.smallPinkBtn}
              onClick={() => openAddChild(node.id)}
              title="하위 분류 추가"
            >
              + 하위
            </button>

            <button
              type="button"
              style={styles.smallBtn}
              onClick={() => moveUpDown(node, "up").catch((e) => setErr(e?.message || String(e)))}
              title="위로"
            >
              ↑
            </button>
            <button
              type="button"
              style={styles.smallBtn}
              onClick={() => moveUpDown(node, "down").catch((e) => setErr(e?.message || String(e)))}
              title="아래로"
            >
              ↓
            </button>

            <button
              type="button"
              style={styles.smallDangerBtn}
              onClick={() => {
                if (confirm("이 분류를 삭제할까요? (하위도 함께 삭제)")) {
                  deleteNode(node.id).catch((e) => setErr(e?.message || String(e)));
                }
              }}
              title="삭제"
            >
              🗑 삭제
            </button>
          </div>
        </div>

        {/* ✅ 하위 추가 입력칸: 선택된 노드에서만 펼쳐짐 */}
        {addingFor === node.id && (
          <div style={styles.inlineEditor(depth)}>
            <input
              style={styles.inlineInput}
              value={newChildText}
              onChange={(e) => setNewChildText(e.target.value)}
              placeholder="하위 분류 이름 입력"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitAddChild(node.id).catch((er) => setErr(er?.message || String(er)));
                } else if (e.key === "Escape") {
                  setAddingFor(null);
                  setNewChildText("");
                }
              }}
              autoFocus
            />
            <button
              type="button"
              style={UI.btn("pink")}
              onClick={() => submitAddChild(node.id).catch((er) => setErr(er?.message || String(er)))}
            >
              추가
            </button>
            <button
              type="button"
              style={UI.btn("ghost")}
              onClick={() => {
                setAddingFor(null);
                setNewChildText("");
              }}
            >
              닫기
            </button>
            <div style={styles.inlineHint}>Enter: 추가 / Esc: 닫기</div>
          </div>
        )}

        {/* 자식 렌더 */}
        {!isCollapsed && children.map((c) => renderNode(c.id, depth + 1))}
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
              <div style={styles.title}>단어책 분류 관리 (무한 트리)</div>
              <div style={styles.sub}>
                ✅ “+ 하위”를 눌렀을 때만 입력칸이 펼쳐져서 트리가 더 잘 보입니다.
              </div>
            </div>

            <div style={styles.headBtns}>
              <button style={UI.btn("ghost")} onClick={() => nav("/dashboard")}>
                ← 대시보드
              </button>
              <button style={UI.btn("pink")} onClick={() => nav("/teacher/book-categorize")}>
                책 분류 지정 →
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
        <div style={UI.card}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 900, color: THEME.text }}>
              루트(최상위) 추가 <span style={{ marginLeft: 8, ...UI.chip }}>root</span>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button style={UI.btn("ghost")} onClick={() => setCollapsed({})} title="전부 펼치기">
                전부 펼치기
              </button>
              <button
                style={UI.btn("ghost")}
                onClick={() => {
                  const next = {};
                  for (const r of helpers.roots) next[r.id] = true;
                  setCollapsed(next);
                }}
                title="루트만 펼치고 하위 접기"
              >
                하위 접기
              </button>
              <button style={UI.btn("ghost")} onClick={load} disabled={loading}>
                {loading ? "불러오는 중..." : "새로고침"}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              style={{ ...UI.input, flex: "1 1 260px" }}
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              placeholder="예) 내신 / 수능 / 토익 / 초등 / 중등 ..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (async () => {
                    try {
                      setErr("");
                      await createNode({ parentId: null, name: newRoot });
                      setNewRoot("");
                    } catch (er) {
                      setErr(er?.message || String(er));
                    }
                  })();
                }
              }}
            />
            <button
              style={UI.btn("pink")}
              onClick={async () => {
                try {
                  setErr("");
                  await createNode({ parentId: null, name: newRoot });
                  setNewRoot("");
                } catch (e) {
                  setErr(e?.message || String(e));
                }
              }}
            >
              + 루트 추가
            </button>
          </div>

          <div style={styles.treeWrap}>
            {helpers.roots.length === 0 && (
              <div style={{ color: THEME.sub, fontWeight: 900, marginTop: 10 }}>
                아직 루트 분류가 없습니다. 위에서 추가해 주세요.
              </div>
            )}

            <div style={{ marginTop: 8 }}>
              {helpers.roots.map((r) => renderNode(r.id, 0))}
            </div>
          </div>
        </div>

        <div style={{ height: 16 }} />
      </div>
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

  treeWrap: { marginTop: 14 },

  nodeRow: (depth) => ({
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: 14,
    border: `1px solid ${THEME.border2}`,
    background: depth === 0 ? "#fff" : depth === 1 ? "#fbfcff" : "#fdfbff",
    marginTop: 10,
    marginLeft: depth * 16,
    gap: 10,
    minHeight: 56,
  }),

  guide: (depth) => ({
    position: "absolute",
    left: -10,
    top: 0,
    bottom: 0,
    width: 10,
    borderLeft: depth > 0 ? `2px solid ${THEME.border2}` : "none",
  }),

  elbow: {
    width: 10,
    height: 10,
    borderLeft: `2px solid ${THEME.border2}`,
    borderBottom: `2px solid ${THEME.border2}`,
    marginRight: 6,
    flex: "0 0 auto",
  },

  nodeName: {
    color: THEME.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 560,
    minWidth: 0,
  },

  smallBtn: {
    height: 44,
    minWidth: 44,
    padding: "0 12px",
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 900,
    boxShadow: "0 10px 22px rgba(31,42,68,.06)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  smallPinkBtn: {
    height: 44,
    minWidth: 64,
    padding: "0 12px",
    borderRadius: 12,
    border: `1px solid ${THEME.borderPink}`,
    background: THEME.pinkSoft,
    color: "#8a1f4b",
    cursor: "pointer",
    fontWeight: 900,
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  smallDangerBtn: {
    height: 44,
    minWidth: 72,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid #ffb3c8",
    background: "#fff6f8",
    color: "#b42318",
    cursor: "pointer",
    fontWeight: 900,
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  inlineEditor: (depth) => ({
    marginLeft: depth * 16 + 16,
    marginTop: 8,
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  }),

  inlineInput: {
    height: 44,
    padding: "0 12px",
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    outline: "none",
    minWidth: 220,
    background: "#fff",
    color: THEME.text,
    fontWeight: 800,
    boxShadow: "0 10px 22px rgba(31,42,68,.06)",
    flex: "1 1 220px",
  },

  inlineHint: { color: THEME.sub, fontSize: 12, fontWeight: 800 },
};
