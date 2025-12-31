import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabaseClient";
import { useNavigate } from "react-router-dom";

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 16 },
  wrap: { maxWidth: 1100, margin: "0 auto" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 22, fontWeight: 900, color: "#1f2a44" },
  card: { background: "#fff", border: "1px solid #ffd6e5", borderRadius: 14, padding: 14, boxShadow: "0 6px 18px rgba(0,0,0,0.06)" },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  input: { padding: "10px 12px", borderRadius: 12, border: "1px solid #ffd6e5", outline: "none", minWidth: 220 },
  btn: { padding: "10px 12px", borderRadius: 12, border: "1px solid #ff6fa3", background: "#ff6fa3", color: "#fff", fontWeight: 800, cursor: "pointer" },
  btn2: { padding: "10px 12px", borderRadius: 12, border: "1px solid #ffd6e5", background: "#fff", color: "#1f2a44", fontWeight: 800, cursor: "pointer" },
  small: { padding: "6px 10px", borderRadius: 10, border: "1px solid #ffd6e5", background: "#fff", cursor: "pointer", fontWeight: 800 },
  tag: { display: "inline-block", padding: "6px 10px", borderRadius: 999, background: "#ffe3ee", color: "#8a1f4b", fontWeight: 900, fontSize: 12 },
  node: (lvl) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #ffe3ee",
    background: lvl === 0 ? "#fff" : lvl === 1 ? "#fff8fb" : "#fffbfd",
    marginTop: 8,
    marginLeft: lvl * 18,
  }),
};

function normalizeSort(rows) {
  // 같은 parent_id끼리 sort_order 정렬
  const groups = new Map();
  for (const r of rows) {
    const k = r.parent_id || "__root__";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, arr] of groups.entries()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    arr.forEach((r, i) => (r._idx = i));
  }
  return rows;
}

export default function BookCategoryManagePage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  const [newRoot, setNewRoot] = useState("");
  const [newMidBy, setNewMidBy] = useState({});  // {parentId: text}
  const [newLeafBy, setNewLeafBy] = useState({}); // {parentId: text}

  const tree = useMemo(() => {
    const byParent = new Map();
    for (const r of rows) {
      const k = r.parent_id || "__root__";
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(r);
    }
    const sortArr = (a) =>
      [...a].sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0) || x.name.localeCompare(y.name));

    const roots = sortArr(byParent.get("__root__") || []);
    const mids = (pid) => sortArr(byParent.get(pid) || []);
    const leafs = (pid) => sortArr(byParent.get(pid) || []);

    return { roots, mids, leafs };
  }, [rows]);

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

    // 같은 parent 아래 max(sort_order)+1로 넣기
    const siblings = rows.filter((r) => (r.parent_id || null) === (parentId || null));
    const next = siblings.length ? Math.max(...siblings.map((s) => s.sort_order ?? 0)) + 1 : 0;

    const { error } = await supabase.from("book_category_nodes").insert({
      parent_id: parentId || null,
      name: nm,
      sort_order: next,
    });
    if (error) throw error;
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
    // on delete cascade로 자식도 같이 삭제
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

    const { error: e1 } = await supabase.from("book_category_nodes").update({ sort_order: b.sort_order ?? 0 }).eq("id", a.id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("book_category_nodes").update({ sort_order: a.sort_order ?? 0 }).eq("id", b.id);
    if (e2) throw e2;

    await load();
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.head}>
          <div>
            <div style={styles.title}>단어책 분류 관리 (대/중/소)</div>
            <div style={{ color: "#5d6b82", fontSize: 13, marginTop: 4 }}>
              대분류 → 중분류 → 소분류(leaf) 구조로 책을 정리합니다.
            </div>
          </div>
          <div style={styles.row}>
            <button style={styles.btn2} onClick={() => nav("/dashboard")}>← 대시보드</button>
            <button style={styles.btn} onClick={() => nav("/teacher/book-categorize")}>책 분류 지정 →</button>
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
              대분류 추가 <span style={{ marginLeft: 8, ...styles.tag }}>depth 0</span>
            </div>
            <button style={styles.btn2} onClick={load} disabled={loading}>
              {loading ? "불러오는 중..." : "새로고침"}
            </button>
          </div>

          <div style={{ ...styles.row, marginTop: 10 }}>
            <input
              style={styles.input}
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              placeholder="예) 품사 / 문장 형식 / 구(Phrase) / 절(Clause) ..."
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
              + 대분류 추가
            </button>
          </div>

          <div style={{ marginTop: 14 }}>
            {tree.roots.length === 0 && (
              <div style={{ color: "#5d6b82" }}>아직 대분류가 없습니다. 위에서 추가해 주세요.</div>
            )}

            {tree.roots.map((r) => (
              <div key={r.id}>
                <div style={styles.node(0)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={styles.tag}>대</span>
                    <strong style={{ color: "#1f2a44" }}>{r.name}</strong>
                    <button style={styles.small} onClick={() => {
                      const nm = prompt("대분류 이름 수정", r.name);
                      if (nm !== null) renameNode(r.id, nm).catch((e)=>setErr(e?.message||String(e)));
                    }}>이름</button>
                  </div>
                  <div style={styles.row}>
                    <button style={styles.small} onClick={() => moveUpDown(r, "up").catch((e)=>setErr(e?.message||String(e)))}>↑</button>
                    <button style={styles.small} onClick={() => moveUpDown(r, "down").catch((e)=>setErr(e?.message||String(e)))}>↓</button>
                    <button style={styles.small} onClick={() => {
                      if (confirm("이 대분류를 삭제할까요? (중/소분류도 함께 삭제)")) {
                        deleteNode(r.id).catch((e)=>setErr(e?.message||String(e)));
                      }
                    }}>삭제</button>
                  </div>
                </div>

                {/* 중분류 추가 */}
                <div style={{ ...styles.row, marginLeft: 18, marginTop: 6 }}>
                  <input
                    style={styles.input}
                    value={newMidBy[r.id] || ""}
                    onChange={(e) => setNewMidBy((p) => ({ ...p, [r.id]: e.target.value }))}
                    placeholder="중분류 추가 (예: 명사 / 동사 / to부정사구 ...)"
                  />
                  <button
                    style={styles.btn2}
                    onClick={async () => {
                      try {
                        setErr("");
                        await createNode({ parentId: r.id, name: newMidBy[r.id] || "" });
                        setNewMidBy((p) => ({ ...p, [r.id]: "" }));
                      } catch (e) {
                        setErr(e?.message || String(e));
                      }
                    }}
                  >
                    + 중분류
                  </button>
                </div>

                {/* 중분류 목록 */}
                {tree.mids(r.id).map((m) => (
                  <div key={m.id}>
                    <div style={styles.node(1)}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={styles.tag}>중</span>
                        <strong style={{ color: "#1f2a44" }}>{m.name}</strong>
                        <button style={styles.small} onClick={() => {
                          const nm = prompt("중분류 이름 수정", m.name);
                          if (nm !== null) renameNode(m.id, nm).catch((e)=>setErr(e?.message||String(e)));
                        }}>이름</button>
                      </div>
                      <div style={styles.row}>
                        <button style={styles.small} onClick={() => moveUpDown(m, "up").catch((e)=>setErr(e?.message||String(e)))}>↑</button>
                        <button style={styles.small} onClick={() => moveUpDown(m, "down").catch((e)=>setErr(e?.message||String(e)))}>↓</button>
                        <button style={styles.small} onClick={() => {
                          if (confirm("이 중분류를 삭제할까요? (소분류도 함께 삭제)")) {
                            deleteNode(m.id).catch((e)=>setErr(e?.message||String(e)));
                          }
                        }}>삭제</button>
                      </div>
                    </div>

                    {/* 소분류 추가 */}
                    <div style={{ ...styles.row, marginLeft: 36, marginTop: 6 }}>
                      <input
                        style={styles.input}
                        value={newLeafBy[m.id] || ""}
                        onChange={(e) => setNewLeafBy((p) => ({ ...p, [m.id]: e.target.value }))}
                        placeholder="소분류 추가 (예: 보통명사 / 재귀대명사 / 시간부사절 ...)"
                      />
                      <button
                        style={styles.btn2}
                        onClick={async () => {
                          try {
                            setErr("");
                            await createNode({ parentId: m.id, name: newLeafBy[m.id] || "" });
                            setNewLeafBy((p) => ({ ...p, [m.id]: "" }));
                          } catch (e) {
                            setErr(e?.message || String(e));
                          }
                        }}
                      >
                        + 소분류
                      </button>
                    </div>

                    {/* 소분류 목록 */}
                    {tree.leafs(m.id).map((s) => (
                      <div key={s.id} style={styles.node(2)}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={styles.tag}>소</span>
                          <strong style={{ color: "#1f2a44" }}>{s.name}</strong>
                          <button style={styles.small} onClick={() => {
                            const nm = prompt("소분류 이름 수정", s.name);
                            if (nm !== null) renameNode(s.id, nm).catch((e)=>setErr(e?.message||String(e)));
                          }}>이름</button>
                        </div>
                        <div style={styles.row}>
                          <button style={styles.small} onClick={() => moveUpDown(s, "up").catch((e)=>setErr(e?.message||String(e)))}>↑</button>
                          <button style={styles.small} onClick={() => moveUpDown(s, "down").catch((e)=>setErr(e?.message||String(e)))}>↓</button>
                          <button style={styles.small} onClick={() => {
                            if (confirm("이 소분류를 삭제할까요?")) {
                              deleteNode(s.id).catch((e)=>setErr(e?.message||String(e)));
                            }
                          }}>삭제</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
