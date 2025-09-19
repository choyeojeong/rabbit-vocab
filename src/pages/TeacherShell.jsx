// src/pages/TeacherShell.jsx
import { useEffect, useState } from "react";
import { Navigate, Outlet, Link, useLocation, useNavigate } from "react-router-dom";

const PASS = import.meta.env.VITE_TEACHER_PASS || "RABBIT";

/**
 * 교사용 모든 하위 라우트를 감싸는 게이트 레이아웃
 * - 비번 미인증: 비번 폼
 * - 비번 통과 "직후": 어떤 경로로 들어왔든 /teacher/home 으로 보냄
 * - 이미 인증 상태에서 내비게이션: 자식 라우트 그대로 사용
 */
export default function TeacherShell() {
  const [ok, setOk] = useState(false);
  const [tried, setTried] = useState(false);
  const [p, setP] = useState("");
  const [justUnlocked, setJustUnlocked] = useState(false);

  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const has = localStorage.getItem("teacher_ok") === "1";
    if (has) setOk(true);
    setTried(true);
  }, []);

  useEffect(() => {
    // 비번 통과 "직후" 한 번만 홈으로 강제 이동
    if (ok && justUnlocked) {
      setJustUnlocked(false);
      navigate("/teacher/home", { replace: true });
    }
  }, [ok, justUnlocked, navigate]);

  const submit = (e) => {
    e.preventDefault();
    if (p === PASS) {
      localStorage.setItem("teacher_ok", "1");
      setOk(true);
      setJustUnlocked(true); // ← 통과 직후 홈으로 보내기 트리거
    } else {
      alert("비밀번호가 올바르지 않습니다.");
    }
  };

  if (!tried) return null;

  // 미인증: 비번 폼
  if (!ok) {
    return (
      <div style={styles.page}>
        <div style={styles.box}>
          <h1 style={styles.title}>교사용 페이지</h1>
          <p style={{color:"#555",marginBottom:12}}>교사용 비밀번호를 입력하세요.</p>
          <form onSubmit={submit} style={{display:"flex",gap:8}}>
            <input
              type="password"
              value={p}
              onChange={(e)=>setP(e.target.value)}
              placeholder="Teacher Password"
              style={styles.input}
            />
            <button type="submit" style={styles.btn}>입장</button>
          </form>
          <div style={{marginTop:12}}>
            <Link to="/" style={{fontSize:13,color:"#777"}}>← 로그인으로</Link>
          </div>
        </div>
      </div>
    );
  }

  // 이미 인증된 상태로 /teacher 루트면 홈으로
  if (loc.pathname === "/teacher") {
    return <Navigate to="/teacher/home" replace />;
  }

  // 평소엔 자식 라우트 그대로
  return <Outlet />;
}

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", display:"flex", alignItems:"center", justifyContent:"center", padding:24 },
  box: { width: 420, background:"#fff", borderRadius:12, padding:24, boxShadow:"0 8px 24px rgba(255,192,217,0.35)" },
  title: { fontSize:22, fontWeight:800, color:"#ff6fa3", margin:"0 0 8px" },
  input: { flex:1, padding:"10px 12px", border:"1px solid #e8a9bf", borderRadius:8, fontSize:14 },
  btn: { background:"#ff6fa3", color:"#fff", border:"none", padding:"10px 14px", borderRadius:8, cursor:"pointer" },
};
