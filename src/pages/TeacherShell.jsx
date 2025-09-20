// src/pages/TeacherShell.jsx
import { useEffect, useState } from "react";
import { Navigate, Outlet, Link, useLocation, useNavigate } from "react-router-dom";

const PASS = import.meta.env.VITE_TEACHER_PASS || "RABBIT";

/**
 * 교사용 모든 하위 라우트를 감싸는 게이트 + 레이아웃 쉘
 * - 미인증: 비번 폼 표시
 * - 인증 직후: 어떤 경로로 들어왔든 /teacher/home 으로 1회 이동
 * - 인증 상태: 데스크톱 최적화 레이아웃(.teacher-page/.teacher-shell) 안에 <Outlet/> 렌더
 *   → responsive.css의 .teacher-* 스타일이 적용되어 PC 화면에 딱 맞게 표시됩니다.
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
    // 비번 통과 직후 한 번만 홈으로 강제 이동
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
      setJustUnlocked(true);
    } else {
      alert("비밀번호가 올바르지 않습니다.");
    }
  };

  if (!tried) return null;

  // 미인증: 비번 폼
  if (!ok) {
    return (
      <div className="page teacher-page" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="teacher-shell" style={{ width: "100%", maxWidth: 560 }}>
          <div className="teacher-card" style={{ padding: 24 }}>
            <h1 className="page-title" style={{ marginTop: 0 }}>교사용 페이지</h1>
            <p className="teacher-text" style={{ color: "#555", marginBottom: 12 }}>
              교사용 비밀번호를 입력하세요.
            </p>
            <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={p}
                onChange={(e) => setP(e.target.value)}
                placeholder="Teacher Password"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  border: "1px solid #e8a9bf",
                  borderRadius: 8,
                  fontSize: 14,
                }}
              />
              <button
                type="submit"
                style={{
                  background: "#ff6fa3",
                  color: "#fff",
                  border: "none",
                  padding: "10px 14px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                입장
              </button>
            </form>
            <div style={{ marginTop: 12 }}>
              <Link to="/" style={{ fontSize: 13, color: "#777" }}>← 로그인으로</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 이미 인증된 상태로 /teacher 루트면 홈으로
  if (loc.pathname === "/teacher") {
    return <Navigate to="/teacher/home" replace />;
  }

  // 인증 상태: 데스크톱 최적화 레이아웃으로 자식 라우트 감싸기
  return (
    <div className="page teacher-page">
      <div className="teacher-shell">
        {/* 필요 시 상단 공용 헤더를 넣고 싶다면 이 영역 사용
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 12}}>
          <h1 className="page-title" style={{margin:0}}>교사용</h1>
          <nav className="teacher-text">
            <Link to="/teacher/manage" style={{marginRight:12}}>학생관리</Link>
            <Link to="/teacher/review" style={{marginRight:12}}>검수목록</Link>
            <Link to="/teacher/today">오늘의 시험결과</Link>
          </nav>
        </div>
        */}
        <div className="teacher-row grid-2 teacher-text">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
