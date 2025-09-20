// src/pages/TeacherHome.jsx
import { Link } from "react-router-dom";

/**
 * 교사용 홈
 * - 인증/레이아웃은 TeacherShell이 담당합니다. (이 컴포넌트는 <Outlet/> 안에서 카드만 렌더)
 * - 데스크톱 최적화 스타일은 responsive.css의 .teacher-* 클래스가 적용됩니다.
 */
export default function TeacherHome() {
  return (
    <>
      {/* 상단 카드: 빠른 메뉴 */}
      <div className="teacher-card">
        <h2 className="page-title" style={{ marginTop: 0 }}>교사용 홈</h2>
        <p className="teacher-text" style={{ color: "#666", marginTop: 4 }}>
          검수 / 오늘결과 / 학생관리
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0,1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          <Link to="/teacher/manage" style={btnStyle}>학생관리</Link>
          <Link to="/teacher/review" style={btnStyle}>검수 목록</Link>
          <Link to="/teacher/today"  style={btnStyle}>오늘의 시험결과</Link>
          <Link to="/teacher/focus"  style={btnStyle}>이탈 감지</Link>
        </div>
      </div>

      {/* 추가 카드: 안내/위젯 등 필요 시 확장 */}
      <div className="teacher-card">
        <div className="teacher-text" style={{ color: "#555" }}>
          좌측/우측으로 카드를 더 추가해 교사용 위젯(통계, 최근 제출 등)을 배치할 수 있어요.
          넓은 화면에서는 2~3열 그리드로 자동 정렬됩니다.
        </div>
      </div>
    </>
  );
}

const btnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: 52,
  background: "#ff6fa3",
  color: "#fff",
  borderRadius: 10,
  textDecoration: "none",
  fontWeight: 700,
  fontSize: 16,
};
