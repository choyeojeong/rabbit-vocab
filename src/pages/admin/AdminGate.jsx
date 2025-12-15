import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

/**
 * AdminGate
 * - 로그인 페이지에서 role=admin 인 경우만 통과
 * - prompt / 비밀번호 입력 없음
 * - 관리자 로그인 이후에는 절대 다시 묻지 않음
 */
export default function AdminGate() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 로그인 시점에 심어둔 역할 값
    // admin | student | null
    const role = sessionStorage.getItem("role");

    if (role === "admin") {
      setReady(true);
      return;
    }

    // 관리자가 아니면 접근 차단
    navigate("/", { replace: true });
  }, [navigate]);

  if (!ready) return null;
  return <Outlet />;
}
