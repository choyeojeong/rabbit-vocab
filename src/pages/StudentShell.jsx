import BackButton from "../components/BackButton";

export default function StudentShell({ children }) {
  return (
    <div className="page student-page" style={{ position: "relative" }}>
      {/* ✅ 왼쪽 상단 뒤로가기 */}
      <BackButton fallback="/dashboard" />

      <div className="student-container">
        {children}
      </div>
    </div>
  );
}
