import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../utils/supabaseClient";
import DeleteStudentButton from "../components/DeleteStudentButton";

const PASS = import.meta.env.VITE_TEACHER_PASS || "RABBIT";

export default function TeacherManagePage() {
  const navigate = useNavigate();
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const has = localStorage.getItem("teacher_ok") === "1";
    if (!has) {
      const p = window.prompt("교사 비밀번호를 입력하세요");
      if (p && p === PASS) {
        localStorage.setItem("teacher_ok", "1");
        setOk(true);
      } else {
        alert("비밀번호가 올바르지 않습니다.");
        navigate("/");
      }
    } else {
      setOk(true);
    }
  }, [navigate]);

  useEffect(() => {
    if (!ok) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok]);

  async function load() {
    try {
      setLoading(true);
      setErr("");

      // profiles 테이블 기준 (Rabbit 단어앱)
      // 필요한 컬럼만 가져옵니다.
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

  if (!ok) return null;

  return (
    <div style={styles.page}>
      <div style={styles.box}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h1 style={styles.title}>학생관리</h1>
          <button onClick={()=>navigate("/teacher")} style={styles.back}>
            ← 교사용 홈
          </button>
        </div>

        <div style={styles.toolbar}>
          <input
            value={q}
            onChange={(e)=>setQ(e.target.value)}
            placeholder="이름/학교/학년/담당T/전화번호 검색"
            style={styles.input}
          />
          <button onClick={load} disabled={loading} style={styles.reload}>
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>

        {err && <div style={styles.err}>오류: {err}</div>}

        <div style={{overflowX:"auto"}}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>이름</th>
                <th>학교</th>
                <th>학년</th>
                <th>담당T</th>
                <th>전화</th>
                <th style={{width:160}}>작업</th>
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
                  <td colSpan={6} style={{textAlign:"center", color:"#777", padding:"18px"}}>
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
    maxWidth: 1100, margin: "0 auto", background: "#fff", borderRadius: 12,
    padding: 24, boxShadow: "0 8px 24px rgba(255,192,217,0.35)"
  },
  title: { fontSize: 22, fontWeight: 800, color: "#ff6fa3", margin: 0 },
  back: {
    background:"#ddd", border:"none", padding:"8px 12px", borderRadius:8, cursor:"pointer"
  },
  toolbar: { display:"flex", gap:10, margin:"14px 0" },
  input: {
    flex:1, padding:"10px 12px", border:"1px solid #e8a9bf", borderRadius:8, fontSize:14
  },
  reload: {
    background:"#ff6fa3", color:"#fff", border:"none", padding:"10px 12px",
    borderRadius:8, cursor:"pointer"
  },
  err: { color:"#c00", marginBottom:10 },
  table: {
    width:"100%", borderCollapse:"separate", borderSpacing:0
  }
};
