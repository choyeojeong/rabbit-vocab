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
    // 세션(role) 우선, 없으면 sessionStorage(role)로 보조 판정
    const roleFromSession = me?.role;
    const roleFromStorage = sessionStorage.getItem("role");
    return roleFromSession === "admin" || roleFromStorage === "admin";
  }, [me]);

  function logout() {
    // 앱 세션 정리 + role 플래그 정리 (AdminGate 통과 흔적 제거)
    clearSession();
    sessionStorage.removeItem("role");

    // 혹시 남아있던 이전 방식 키들도 정리(있어도 무해)
    sessionStorage.removeItem("admin_authed");
    sessionStorage.removeItem("admin_authed_v1");
    localStorage.removeItem("teacher_ok");
    localStorage.removeItem("teacher_pass_ok");

    navigate("/");
  }

  return (
    <StudentShell>
      {/* 중앙 정렬 */}
      <div className="vh-100 centered with-safe" style={{ width: "100%" }}>
        <div className="student-container">
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
                <div
                  className="student-text"
                  style={{ fontWeight: 700, marginTop: 12 }}
                >
                  관리자 전용
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  <button
                    className="student-button"
                    onClick={() => navigate("/admin/users")}
                  >
                    학생관리
                  </button>

                  <button
                    className="student-button"
                    onClick={() => navigate("/teacher/review")}
                  >
                    검수 목록
                  </button>

                  <button
                    className="student-button"
                    onClick={() => navigate("/teacher/today")}
                  >
                    오늘의 통과/불통과
                  </button>

                  <button
                    className="student-button"
                    onClick={() => navigate("/teacher/focus")}
                  >
                    집중 모니터(이탈 감지)
                  </button>

                  <button
                    className="student-button"
                    onClick={() => navigate("/admin/csv")}
                  >
                    CSV 관리
                  </button>

                  {/* ✅ 추가: 오답노트(학생별) */}
                  <button
                    className="student-button"
                    onClick={() => navigate("/admin/wrongs")}
                  >
                    오답노트(학생별)
                  </button>

                  {/* ✅ 단어책 분류(신규) */}
                  <button
                    className="student-button"
                    onClick={() => navigate("/admin/book-categories")}
                  >
                    단어책 분류 관리(대/중/소)
                  </button>
                  <button
                    className="student-button"
                    onClick={() => navigate("/admin/book-categorize")}
                  >
                    단어책 분류 지정(책 ↔ 소분류)
                  </button>
                </div>

                <div className="student-text" style={{ color: "#777", marginTop: 12 }}>
                  관리자 모드에서는 학생관리/검수/모니터/CSV/오답노트/단어책 분류 페이지로 바로 이동할 수 있어요.
                </div>
              </>
            ) : (
              /* ✅ 학생용 대시보드 */
              <>
                <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
                  <button
                    className="student-button"
                    onClick={() => navigate("/study")}
                  >
                    단어 공부 시작하기
                  </button>
                  <button
                    className="student-button"
                    onClick={() => navigate("/official")}
                  >
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
