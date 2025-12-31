// src/pages/admin/BookCategoryManagePage.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabaseClient";
import { useNavigate } from "react-router-dom";

/**
 * ✅ 수정사항
 * - depth 표시 제거
 * - "하위 분류 추가" 입력칸이 항상 보이지 않도록 변경:
 *   → 각 노드에 [+ 하위] 버튼만 두고, 눌렀을 때만 해당 노드 아래에 입력칸이 펼쳐짐
 * - 트리 가시성 유지: 들여쓰기 + 가이드라인 + 접기/펼치기 유지
 */

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 16 },
  wrap: { maxWidth: 1100, margin: "0 auto" },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
    flexWrap: "wrap",
  },
  title: { fontSize: 22, fontWeight: 900, color: "#1f2a44" },

  card: {
    background: "#fff",
    border: "1px solid #ffd6e5",
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
  },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },

  input: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ffd6e5",
    outline: "none",
    minWidth: 220,
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
    background: "#ffffff",
    color: "#1f2a44",
    cursor: "pointer",
    fontWeight: 900,
    lineHeight: 1,
    minWidth: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
  },

  smallPink: {
    padding: "7px 10px",
    borderRadius: 10,
    border: "1px solid #ffb3c8",
    background: "#fff0f6",
    color: "#8a1f4b",
    cursor: "pointer",
    fontWeight: 900,
    lineHeight: 1,
    minWidth: 64,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
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
    minWidth: 52,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },

  tag: {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    background: "#ffe3ee",
    color: "#8a1f4b",
    fontWeight: 900,
    fontSize: 12,
    border: "1px solid #ffd6e5",
  },

  treeWrap: { marginTop: 14 },

  nodeRow: (depth) => ({
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ffe3ee",
    background: depth === 0 ? "#fff" : depth === 1 ? "#fff8fb" : "#fffbfd",
    marginTop: 8,
    marginLeft: depth * 18,
    gap: 10,
  }),

  guide: (depth) => ({
    position: "absolute",
    left: -10,
    top: 0,
    bottom: 0,
    width: 10,
    borderLeft: depth > 0 ? "2px solid #ffe3ee" : "none",
  }),

  elbow: {
    width: 10,
    height: 10,
    borderLeft: "2px solid #ffe3ee",
    borderBottom: "2px solid #ffe3ee",
    marginRight: 6,
  },

  inlineEditor: (depth) => ({
    marginLeft: depth * 18 + 18,
    marginTop: 6,
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  }),

  hint: { color: "#5d6b82", fontSize: 13, marginTop: 4 },
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
    // 해당 노드 접혀있으면 펼치기
    setCollapsed((p) => ({ ...p, [id]: false }));
  }

  async function submitAddChild(parentId) {
    const nm = (newChildText || "").trim();
    if (!nm) return;
    await createNode({ parentId, name: nm });
    setNewChildText("");
    // 계속 같은 parent에 연속 추가할 수 있게 유지하려면 아래 유지
    // setAddingFor(parentId);
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
                style={styles.small}
                onClick={() => toggleCollapse(node.id)}
                title={isCollapsed ? "펼치기" : "접기"}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
            ) : (
              <span style={{ width: 44 }} />
            )}

            <strong
              style={{
                color: "#1f2a44",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 560,
              }}
              title={node.name}
            >
              {node.name}
            </strong>

            <button
              style={styles.small}
              onClick={() => {
                const nm = prompt("이름 수정", node.name);
                if (nm !== null) renameNode(node.id, nm).catch((e) => setErr(e?.message || String(e)));
              }}
            >
              이름
            </button>
          </div>

          <div style={styles.row}>
            <button
              style={styles.smallPink}
              onClick={() => openAddChild(node.id)}
              title="하위 분류 추가"
            >
              + 하위
            </button>

            <button
              style={styles.small}
              onClick={() => moveUpDown(node, "up").catch((e) => setErr(e?.message || String(e)))}
              title="위로"
            >
              ↑
            </button>
            <button
              style={styles.small}
              onClick={() => moveUpDown(node, "down").catch((e) => setErr(e?.message || String(e)))}
              title="아래로"
            >
              ↓
            </button>

            <button
              style={styles.smallDanger}
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
              style={styles.input}
              value={newChildText}
              onChange={(e) => setNewChildText(e.target.value)}
              placeholder="하위 분류 이름 입력"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitAddChild(node.id).catch((err) => setErr(err?.message || String(err)));
                } else if (e.key === "Escape") {
                  setAddingFor(null);
                  setNewChildText("");
                }
              }}
              autoFocus
            />
            <button
              style={styles.btn2}
              onClick={() => submitAddChild(node.id).catch((err) => setErr(err?.message || String(err)))}
            >
              추가
            </button>
            <button
              style={styles.btn2}
              onClick={() => {
                setAddingFor(null);
                setNewChildText("");
              }}
            >
              닫기
            </button>
            <div style={styles.hint}>Enter: 추가 / Esc: 닫기</div>
          </div>
        )}

        {/* 자식 렌더 */}
        {!isCollapsed && children.map((c) => renderNode(c.id, depth + 1))}
      </div>
    );
  };

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.head}>
          <div>
            <div style={styles.title}>단어책 분류 관리 (무한 트리)</div>
            <div style={{ color: "#5d6b82", fontSize: 13, marginTop: 4 }}>
              ✅ “+ 하위”를 눌렀을 때만 입력칸이 펼쳐져서 트리가 더 잘 보입니다.
            </div>
          </div>
          <div style={styles.row}>
            <button style={styles.btn2} onClick={() => nav("/dashboard")}>
              ← 대시보드
            </button>
            <button style={styles.btn} onClick={() => nav("/teacher/book-categorize")}>
              책 분류 지정 →
            </button>
          </div>
        </div>

        {err && (
          <div style={{ ...styles.card, borderColor: "#ffb3c8", marginBottom: 12 }}>
            <div style={{ color: "#b42318", fontWeight: 900 }}>에러</div>
            <div style={{ color: "#b42318", marginTop: 6, whiteSpace: "pre-wrap" }}>{err}</div>
          </div>
        )}

        <div style={styles.card}>
          <div style={{ ...styles.row, justifyContent: "space-between" }}>
            <div style={{ fontWeight: 900, color: "#1f2a44" }}>
              루트(최상위) 추가 <span style={{ marginLeft: 8, ...styles.tag }}>root</span>
            </div>
            <div style={styles.row}>
              <button style={styles.btn2} onClick={() => setCollapsed({})} title="전부 펼치기">
                전부 펼치기
              </button>
              <button
                style={styles.btn2}
                onClick={() => {
                  const next = {};
                  for (const r of helpers.roots) next[r.id] = true;
                  setCollapsed(next);
                }}
                title="루트만 펼치고 하위 접기"
              >
                하위 접기
              </button>
              <button style={styles.btn2} onClick={load} disabled={loading}>
                {loading ? "불러오는 중..." : "새로고침"}
              </button>
            </div>
          </div>

          <div style={{ ...styles.row, marginTop: 10 }}>
            <input
              style={styles.input}
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
              style={styles.btn}
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
              <div style={{ color: "#5d6b82" }}>아직 루트 분류가 없습니다. 위에서 추가해 주세요.</div>
            )}

            {helpers.roots.map((r) => renderNode(r.id, 0))}
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
