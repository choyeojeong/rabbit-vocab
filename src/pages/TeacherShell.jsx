// src/pages/TeacherShell.jsx
import { useEffect, useState } from "react";
import { Navigate, Outlet, Link, useLocation, useNavigate } from "react-router-dom";

const PASS = import.meta.env.VITE_TEACHER_PASS || "RABBIT";

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

  if (loc.pathname === "/teacher") {
    return <Navigate to="/teacher/home" replace />;
  }

  // ✅ 기본 1열(풀폭). 페이지에서 필요할 때만 grid-2 / grid-3를 직접 추가해서 사용.
  return (
    <div className="page teacher-page">
      <div className="teacher-shell">
        <div className="teacher-row teacher-text">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
