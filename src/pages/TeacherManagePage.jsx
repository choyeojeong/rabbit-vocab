import { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import DeleteStudentButton from "../components/DeleteStudentButton";

export default function TeacherManagePage() {
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setLoading(true);
      setErr("");

      // profiles 테이블 기준 (Rabbit 단어앱)
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, school, grade, phone, teacher_name")
        .order("name", { ascending: true });

      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      console.error(e);
      setErr(e.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  // 최초 로드
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => {
      return (
        (r.name || "").toLowerCase().includes(t) ||
        (r.school || "").toLowerCase().includes(t) ||
        (r.grade || "").toLowerCase().includes(t) ||
        (r.teacher_name || "").toLowerCase().includes(t) ||
        (r.phone || "").toLowerCase().includes(t)
      );
    });
  }, [q, rows]);

  return (
    <div style={styles.page}>
      <div style={styles.box}>
        {/* 상단 타이틀만 유지 */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <h1 style={styles.title}>학생관리</h1>
        </div>

        <div style={styles.toolbar}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름/학교/학년/담당T/전화번호 검색"
            style={styles.input}
          />
          <button onClick={load} disabled={loading} style={styles.reload}>
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>

        {err && <div style={styles.err}>오류: {err}</div>}

        <div style={{ overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>이름</th>
                <th>학교</th>
                <th>학년</th>
                <th>담당T</th>
                <th>전화</th>
                <th style={{ width: 160 }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((st) => (
                <tr key={st.id}>
                  <td>{st.name}</td>
                  <td>{st.school}</td>
                  <td>{st.grade}</td>
                  <td>{st.teacher_name}</td>
                  <td>{st.phone}</td>
                  <td>
                    <DeleteStudentButton
                      studentId={st.id}
                      studentName={st.name}
                      onDone={load}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      color: "#777",
                      padding: "18px",
                    }}
                  >
                    검색 결과가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 24 },
  box: {
    maxWidth: 1100,
    margin: "0 auto",
    background: "#fff",
    borderRadius: 12,
    padding: 24,
    boxShadow: "0 8px 24px rgba(255,192,217,0.35)",
  },
  title: { fontSize: 22, fontWeight: 800, color: "#ff6fa3", margin: 0 },
  toolbar: { display: "flex", gap: 10, margin: "14px 0" },
  input: {
    flex: 1,
    padding: "10px 12px",
    border: "1px solid #e8a9bf",
    borderRadius: 8,
    fontSize: 14,
  },
  reload: {
    background: "#ff6fa3",
    color: "#fff",
    border: "none",
    padding: "10px 12px",
    borderRadius: 8,
    cursor: "pointer",
  },
  err: { color: "#c00", marginBottom: 10 },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
};
