// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, clearSession } from "../utils/session";
import StudentShell from "./StudentShell";

export default function Dashboard() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);

  useEffect(() => {
    setMe(getSession());
  }, []);

  const isAdmin = useMemo(() => {
    const roleFromSession = me?.role;
    const roleFromStorage = sessionStorage.getItem("role");
    return roleFromSession === "admin" || roleFromStorage === "admin";
  }, [me]);

  function logout() {
    clearSession();
    sessionStorage.removeItem("role");

    sessionStorage.removeItem("admin_authed");
    sessionStorage.removeItem("admin_authed_v1");
    localStorage.removeItem("teacher_ok");
    localStorage.removeItem("teacher_pass_ok");

    navigate("/");
  }

  return (
    <StudentShell>
      {/* ✅ StudentShell이 어떤 레이아웃을 쓰든 "진짜 중앙"으로 고정 */}
      <div
        style={{
          minHeight: "100dvh",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
          paddingLeft: 16,
          paddingRight: 16,
        }}
      >
        {/* ✅ 카드가 너무 넓어지지 않게 */}
        <div style={{ width: "100%", maxWidth: 520 }}>
          <div className="student-card stack">
            {/* 상단: 인사 + 로그아웃 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div className="student-text">
                {me ? (
                  <>
                    안녕하세요, <b>{me.name}</b> {isAdmin ? "관리자" : "학생"}! 🐰
                  </>
                ) : (
                  <>세션 정보를 불러오는 중…</>
                )}
              </div>
              <button
                onClick={logout}
                className="student-button"
                style={{ padding: "10px 14px", whiteSpace: "nowrap" }}
              >
                로그아웃
              </button>
            </div>

            {/* ✅ 관리자 전용 대시보드 */}
            {isAdmin ? (
              <>
                <div className="student-text" style={{ fontWeight: 800, marginTop: 12 }}>
                  관리자 전용
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <button className="student-button" onClick={() => navigate("/admin/users")}>
                    학생관리
                  </button>

                  <button className="student-button" onClick={() => navigate("/teacher/review")}>
                    검수 목록
                  </button>

                  <button className="student-button" onClick={() => navigate("/teacher/today")}>
                    오늘의 통과/불통과
                  </button>

                  <button className="student-button" onClick={() => navigate("/teacher/focus")}>
                    집중 모니터(이탈 감지)
                  </button>

                  <button className="student-button" onClick={() => navigate("/admin/csv")}>
                    CSV 관리
                  </button>

                  <button className="student-button" onClick={() => navigate("/admin/wrongs")}>
                    오답노트(학생별)
                  </button>

                  {/* ✅ BookCategorizePage / BookCategoryManagePage 삭제했으므로 대시보드에서도 제거 */}
                </div>

                <div className="student-text" style={{ color: "#777", marginTop: 12 }}>
                  관리자 모드에서는 학생관리/검수/모니터/CSV/오답노트 페이지로 바로 이동할 수 있어요.
                </div>
              </>
            ) : (
              /* ✅ 학생용 대시보드 */
              <>
                <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
                  <button className="student-button" onClick={() => navigate("/study")}>
                    단어 공부 시작하기
                  </button>

                  <button className="student-button" onClick={() => navigate("/official")}>
                    시험보기(공식)
                  </button>

                  <button
                    className="student-button"
                    onClick={() => navigate("/exam/official/results")}
                  >
                    공식시험 결과 보기
                  </button>
                </div>

                <div className="student-text" style={{ color: "#777", marginTop: 12 }}>
                  ‘단어 공부 시작하기’에서는 객관식 연습과 모의시험 연습을 할 수 있어요.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
