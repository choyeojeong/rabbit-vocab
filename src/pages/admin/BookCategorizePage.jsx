import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabaseClient";
import { useNavigate } from "react-router-dom";

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 16 },
  wrap: { maxWidth: 1200, margin: "0 auto" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 22, fontWeight: 900, color: "#1f2a44" },
  sub: { fontSize: 13, color: "#5d6b82", marginTop: 4 },
  grid: { display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 12 },
  card: { background: "#fff", border: "1px solid #ffd6e5", borderRadius: 14, padding: 14, boxShadow: "0 6px 18px rgba(0,0,0,0.06)" },
  input: { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #ffd6e5", outline: "none" },
  btn: { padding: "10px 12px", borderRadius: 12, border: "1px solid #ff6fa3", background: "#ff6fa3", color: "#fff", fontWeight: 800, cursor: "pointer" },
  btn2: { padding: "10px 12px", borderRadius: 12, border: "1px solid #ffd6e5", background: "#fff", color: "#1f2a44", fontWeight: 800, cursor: "pointer" },
  small: { padding: "6px 10px", borderRadius: 10, border: "1px solid #ffd6e5", background: "#fff", cursor: "pointer", fontWeight: 800 },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  badge: (on) => ({
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #ffd6e5",
    background: on ? "#ff6fa3" : "#fff",
    color: on ? "#fff" : "#1f2a44",
    fontWeight: 900,
    cursor: "pointer",
    margin: "4px 6px 0 0",
    fontSize: 12,
  }),
  bookRow: { padding: "10px 12px", borderRadius: 12, border: "1px solid #ffe3ee", marginTop: 8, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
  muted: { color: "#5d6b82", fontSize: 13 },
};

export default function BookCategorizePage() {
  const nav = useNavigate();
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [books, setBooks] = useState([]); // {book, category_id, category_path}
  const [nodes, setNodes] = useState([]); // tree nodes
  const [selectedLeafId, setSelectedLeafId] = useState(null);

  const leafNodes = useMemo(() => {
    // leaf = 자식이 없는 노드
    const hasChild = new Set(nodes.filter(n => n.parent_id).map(n => n.parent_id));
    const leaf = nodes.filter(n => !hasChild.has(n.id));
    // 경로 라벨 만들기 위해 parent map
    const byId = new Map(nodes.map(n => [n.id, n]));
    const buildPath = (id) => {
      const parts = [];
      let cur = byId.get(id);
      while (cur) {
        parts.push(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
      return parts.reverse().join(" > ");
    };
    return leaf
      .map(n => ({ ...n, path: buildPath(n.id) }))
      .sort((a,b)=>a.path.localeCompare(b.path));
  }, [nodes]);

  const filteredBooks = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return books;
    return books.filter(b => (b.book || "").toLowerCase().includes(t));
  }, [books, q]);

  async function load() {
    try {
      setLoading(true);
      setErr("");

      const [{ data: bs, error: e1 }, { data: ns, error: e2 }] = await Promise.all([
        supabase.from("v_books_with_category").select("book, category_id, category_path"),
        supabase.from("book_category_nodes").select("id, parent_id, name, sort_order, created_at").order("sort_order", { ascending: true }),
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

  useEffect(() => { load(); }, []);

  async function assign(book) {
    if (!selectedLeafId) {
      alert("오른쪽에서 소분류(leaf)를 먼저 선택해 주세요.");
      return;
    }
    try {
      setErr("");
      // book 1개당 1개 분류: upsert
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

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.head}>
          <div>
            <div style={styles.title}>단어책 분류 지정</div>
            <div style={styles.sub}>업로드된 책(book) 목록을 소분류(leaf)에 매핑합니다.</div>
          </div>
          <div style={styles.row}>
            <button style={styles.btn2} onClick={() => nav("/teacher/book-categories")}>← 분류 트리</button>
            <button style={styles.btn2} onClick={() => nav("/dashboard")}>대시보드</button>
            <button style={styles.btn} onClick={load} disabled={loading}>{loading ? "불러오는 중..." : "새로고침"}</button>
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
                  <div style={{ fontWeight: 900, color: "#1f2a44", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.book}
                  </div>
                  <div style={styles.muted}>
                    {b.category_path ? `현재: ${b.category_path}` : "현재: (미분류)"}
                  </div>
                </div>

                <div style={styles.row}>
                  <button style={styles.small} onClick={() => assign(b.book)}>지정</button>
                  <button style={styles.small} onClick={() => clearAssign(b.book)}>해제</button>
                </div>
              </div>
            ))}
          </div>

          {/* 오른쪽: 소분류 선택 */}
          <div style={styles.card}>
            <div style={{ fontWeight: 900, color: "#1f2a44" }}>소분류 선택(leaf)</div>
            <div style={{ ...styles.muted, marginTop: 6 }}>
              아래에서 소분류를 하나 선택한 뒤, 왼쪽 책에서 “지정”을 누르세요.
            </div>

            <div style={{ marginTop: 10 }}>
              {leafNodes.length === 0 && (
                <div style={styles.muted}>아직 leaf가 없습니다. 먼저 분류 트리를 만들어 주세요.</div>
              )}

              {leafNodes.map((n) => (
                <span
                  key={n.id}
                  style={styles.badge(selectedLeafId === n.id)}
                  onClick={() => setSelectedLeafId((p) => (p === n.id ? null : n.id))}
                  title={n.path}
                >
                  {n.path}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
