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

        // ✅ iPhone safe-area(노치) 만큼 아래로 자동 보정
        // - 지원 시: top = safe-area + 10px
        // - 미지원 시: top = 10px
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",

        left: 12,
        zIndex: 99998,
        height: 34,
        padding: "0 12px",
        borderRadius: 999,
        border: "1px solid #e9e9e9",
        background: "#fff",

        // ✅ 핵심: 전역 color(흰색) 상속 방지
        color: "#222",

        fontWeight: 900,
        fontSize: 14,
        lineHeight: "34px",
        cursor: "pointer",
        boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        WebkitTextFillColor: "#222", // ✅ iOS/일부 브라우저에서 color 무시 방지
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
