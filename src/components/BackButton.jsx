import { useNavigate } from "react-router-dom";

export default function BackButton({ fallback = "/dashboard" }) {
  const navigate = useNavigate();

  function goBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 1000,
        borderRadius: 999,
        border: "1px solid #eee",
        background: "#fff",
        padding: "6px 10px",
        fontSize: 14,
        cursor: "pointer",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
      }}
      aria-label="뒤로가기"
    >
      ← 뒤로
    </button>
  );
}
