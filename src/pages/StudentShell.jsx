// src/pages/StudentShell.jsx
import BackButton from "../components/BackButton";

const COLORS = {
  bg: "#fff5f8",
  text: "#1f2a44",
};

export default function StudentShell({ children }) {
  return (
    <div
      className="page student-page with-safe"
      style={{
        position: "relative",
        minHeight: "100dvh",
        width: "100%",
        background: COLORS.bg,
        color: COLORS.text,
        // ✅ "가운데 카드" 강제 레이아웃을 페이지 전체에서는 없앰
        // (기존 student-container가 maxWidth를 잡고 있었다면, 아래에서 풀어줌)
        display: "block",
      }}
    >
      {/* ✅ 왼쪽 상단 뒤로가기 */}
      <BackButton fallback="/dashboard" />

      {/* ✅ 전체 폭 사용: 컨테이너를 '풀폭 래퍼'로 변경 */}
      <div
        className="student-container"
        style={{
          width: "100%",
          maxWidth: "100%",
          margin: 0,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 12,
          paddingBottom: 16,
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </div>
  );
}
