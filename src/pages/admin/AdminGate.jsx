import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";

export default function AdminGate() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1) 이미 인증된 상태면 통과
    const authed = sessionStorage.getItem("admin_authed");
    if (authed === "1") {
      setReady(true);
      return;
    }

    // 2) 최초 1회만 비번 확인
    const pw = prompt("관리자 비밀번호를 입력하세요");
    if (pw && pw === import.meta.env.VITE_TEACHER_PASS) {
      sessionStorage.setItem("admin_authed", "1");
      setReady(true);
    } else {
      alert("비밀번호가 틀렸습니다.");
      navigate("/", { replace: true });
    }
  }, [navigate]);

  if (!ready) return null;
  return <Outlet />;
}
