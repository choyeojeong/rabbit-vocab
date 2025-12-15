// src/pages/AdminGate.jsx
import { useEffect, useRef, useState } from "react";
import { Outlet, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../utils/supabaseClient";

/**
 * AdminGate
 * - 로그인 페이지에서 role=admin 인 경우만 통과
 * - prompt / 비밀번호 입력 없음
 * - 관리자 로그인 이후에는 절대 다시 묻지 않음
 *
 * ✅ 추가: "집중 모니터(이탈 감지)" 실시간 알림
 * - 학생이 시험 중 다른 앱/탭으로 이동(blur/hidden/pagehide)하면
 *   focus_events 테이블에 INSERT가 생기고
 * - 관리자는 어느 페이지에 있든 AdminGate에서 Realtime 구독으로 토스트 알림을 띄움
 *
 * ✅ 추가: 토스트 클릭(버튼) → 해당 세션의 검수페이지로 이동
 * - /teacher/review/:id (id = test_sessions.id = focus_events.session_id)
 *
 * ✅ 수정: Router 밖에서 useNavigate 오류 방지
 * - role 체크로 막힐 때는 useNavigate로 리다이렉트하지 않고
 *   <Navigate />를 반환하도록 변경
 */
export default function AdminGate() {
  const navigate = useNavigate();
  const role = sessionStorage.getItem("role"); // 'admin' | 'student' | null

  // ✅ admin이 아니면 Router 훅 쓰기 전에 바로 차단 (Navigate로 리다이렉트)
  if (role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const [ready, setReady] = useState(false);

  // 토스트 UI
  const [toast, setToast] = useState(null); // { id, title, msg, row }
  const toastTimerRef = useRef(null);

  // 중복/스팸 방지 (같은 세션에서 짧은 시간 연속 이벤트)
  const lastBySessionRef = useRef(new Map()); // session_id -> lastTime(ms)

  function showToast(row) {
    // 기존 타이머 정리
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

    const student = row?.student_name || "학생";
    const type = row?.event_type || "이탈";
    const when = row?.created_at
      ? new Date(row.created_at).toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "";

    const typeLabel =
      type === "hidden"
        ? "탭/앱 전환"
        : type === "blur"
        ? "화면 이탈"
        : type === "pagehide"
        ? "페이지 종료/전환"
        : type;

    setToast({
      id: row?.id ?? Date.now(),
      title: `🚨 이탈 감지: ${student}`,
      msg: `${typeLabel}${when ? ` · ${when}` : ""}`,
      row,
    });

    // 6초 후 자동 닫힘
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 6000);
  }

  useEffect(() => {
    // role이 admin이면 준비 OK
    setReady(true);
  }, []);

  // ✅ 관리자 실시간 이탈 알림: focus_events INSERT 구독
  useEffect(() => {
    if (!ready) return;

    const channel = supabase
      .channel("focus-events-live-admin")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "focus_events" },
        (payload) => {
          const row = payload?.new;
          if (!row) return;

          // 스팸 방지: 같은 session_id에서 2초 이내 연속 이벤트는 무시
          const sid = row.session_id || "";
          const now = Date.now();
          if (sid) {
            const last = lastBySessionRef.current.get(sid) || 0;
            if (now - last < 2000) return;
            lastBySessionRef.current.set(sid, now);
          }

          showToast(row);
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, [ready]);

  // cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  if (!ready) return null;

  const sessionId = toast?.row?.session_id || null;

  return (
    <>
      <Outlet />

      {/* ✅ 전역 토스트 (어느 관리자 페이지에 있든 뜸) */}
      {toast && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 99999,
            width: "min(360px, calc(100vw - 32px))",
            background: "#fff",
            border: "1px solid #ffd3e3",
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            padding: 12,
          }}
          role="status"
          aria-live="polite"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 14, color: "#333" }}>
              {toast.title}
            </div>
            <button
              onClick={() => setToast(null)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: "16px",
                padding: 2,
                color: "#999",
              }}
              aria-label="닫기"
              title="닫기"
            >
              ×
            </button>
          </div>

          <div style={{ marginTop: 6, fontSize: 13, color: "#555" }}>
            {toast.msg}
          </div>

          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => {
                // ✅ 토스트 → 해당 세션 검수페이지로 이동
                if (sessionId) {
                  navigate(`/teacher/review/${sessionId}`, { replace: false });
                  return;
                }
                // 세션ID가 없다면 fallback: 집중 모니터로
                navigate("/teacher/focus", { replace: false });
              }}
              style={{
                border: "none",
                background: "#ff6fa3",
                color: "#fff",
                fontWeight: 800,
                padding: "8px 10px",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 13,
              }}
              title={sessionId ? `검수 페이지로 이동: ${sessionId}` : "세션 정보 없음"}
            >
              검수 페이지로 이동
            </button>

            <button
              onClick={() => navigate("/teacher/focus", { replace: false })}
              style={{
                border: "1px solid #ffd3e3",
                background: "#fff0f5",
                color: "#b00020",
                fontWeight: 800,
                padding: "8px 10px",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              집중 모니터
            </button>

            <button
              onClick={() => setToast(null)}
              style={{
                border: "1px solid #eee",
                background: "#f7f7f7",
                color: "#444",
                fontWeight: 800,
                padding: "8px 10px",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              닫기
            </button>
          </div>

          {/* (선택) 아주 간단한 디테일 미리보기 */}
          {toast?.row?.detail && (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "#777",
                background: "#fafafa",
                border: "1px solid #eee",
                borderRadius: 10,
                padding: 10,
                maxHeight: 120,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {(() => {
                try {
                  return JSON.stringify(toast.row.detail, null, 2);
                } catch {
                  return String(toast.row.detail);
                }
              })()}
            </div>
          )}
        </div>
      )}
    </>
  );
}
