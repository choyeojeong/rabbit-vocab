import { useNavigate } from "react-router-dom";

export default function BackButton({ fallback = "/dashboard", hide = false }) {
  const navigate = useNavigate();
  if (hide) return null;

  function goBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate(fallback, { replace: true });
  }

  return (
    <button
      type="button"
      onClick={goBack}
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        left: 12,
        zIndex: 99998,

        height: 34,
        padding: "0 12px",
        borderRadius: 999,

        // ✅ 전역 button 스타일(특히 !important)과 충돌 대비: 값들을 최대한 고정
        backgroundColor: "#fff",
        border: "1px solid #e9e9e9",

        // ✅ 전역 color 상속/강제 흰색 방지 (iOS 포함)
        color: "#222",
        WebkitTextFillColor: "#222",

        fontWeight: 900,
        fontSize: 14,
        lineHeight: "34px",

        cursor: "pointer",
        boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,

        // ✅ 모바일 UX 안정화
        WebkitAppearance: "none",
        appearance: "none",
        outline: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
      aria-label="뒤로가기"
      title="뒤로가기"
    >
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "16px" }}>
        ←
      </span>
      <span>뒤로</span>
    </button>
  );
}
