// src/pages/TeacherHome.jsx
import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";

export default function TeacherHome() {
  const navigate = useNavigate();

  useEffect(() => {
    const passOk = localStorage.getItem("teacher_pass_ok") === "true";
    if (passOk) return;

    const envPass = (import.meta.env.VITE_TEACHER_PASS || "RABBIT"); // ← 기본값
    const input = window.prompt("교사용 비밀번호를 입력하세요");
    const normalized = (input || "").trim(); // 공백 제거

    if (normalized !== envPass) {
      alert("비밀번호가 올바르지 않습니다.");
      navigate("/");
    } else {
      localStorage.setItem("teacher_pass_ok", "true");
    }
  }, [navigate]);

  const box = {
    maxWidth: 920, margin: "24px auto", background: "#fff", borderRadius: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.08)", padding: 20
  };
  const grid = { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", padding: 24 }}>
      <div style={box}>
        <h2 style={{ margin: 0, fontSize: 22 }}>교사용 홈</h2>
        <p style={{ color: "#666" }}>검수 / 오늘결과 / 학생관리 / 이탈감지</p>

        <div style={grid}>
          <Link className="btn" to="/teacher/manage" style={btn}>학생관리</Link>
          <Link className="btn" to="/teacher/review" style={btn}>검수 목록</Link>
          <Link className="btn" to="/teacher/today" style={btn}>오늘의 시험결과</Link>
          <Link className="btn" to="/teacher/focus" style={btn}>이탈 감지</Link>
        </div>
      </div>
    </div>
  );
}

const btn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: 48, background: "#ff6fa3", color: "#fff", borderRadius: 10,
  textDecoration: "none", fontWeight: 700
};
