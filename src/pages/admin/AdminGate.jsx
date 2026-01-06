import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, Navigate, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../utils/supabaseClient";

/**
 * AdminGate
 * - 로그인에서 role=admin 인 경우만 통과
 * - prompt / 비밀번호 입력 없음
 * - 관리자 어느 페이지에 있든 "이탈 감지" 발생 시 토스트 + (옵션) 알림 소리
 * - Realtime(INSERT) + fallback polling(새 이벤트 조회) 둘 다 사용
 *
 * ✅ 개선
 * 1) polling lastSeen 초기값을 "지금"이 아니라 "최근 30초"로 → 진입 직후 이벤트 놓침 방지
 * 2) 전역 '소리 켜기(한번)' 버튼 추가 (브라우저 오디오 정책 unlock)
 * 3) 토스트 뜰 때 soundEnabled면 딩 소리 재생
 *
 * ✅ 추가
 * - 왼쪽 상단 "← 뒤로" 버튼 (history 없으면 /dashboard로)
 * - /dashboard에서는 버튼 숨김(원하면 아래 hideBack 로직 제거 가능)
 *
 * ✅ 모바일(iPhone) 최적화
 * - 100vh 대신 100dvh 사용 (Safari 주소창 높이 변화 대응)
 * - 상단/하단 fixed UI에 safe-area inset 적용 (노치/홈바)
 * - fixed 상단 UI 때문에 Outlet이 가려지지 않게 top padding 확보
 * - 모바일에서 버튼 터치 타겟(44px+)로 확대
 */

// --- WebAudio 딩 사운드 (짧게) ---
function playDing() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.6);

    osc.onended = () => {
      try {
        ctx.close();
      } catch {}
    };
  } catch {
    // ignore
  }
}

// ✅ 관리자 기본 톤
const THEME = {
  bg: "#f7f9fc",
  card: "#ffffff",
  text: "#1f2a44",
  subText: "#5d6b82",
  border: "#e9eef5",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  danger: "#b00020",
};

export default function AdminGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const role = sessionStorage.getItem("role"); // 'admin' | 'student' | null

  // admin 아니면 즉시 차단
  if (role !== "admin") {
    return <Navigate to="/" replace />;
  }

  // ✅ iPhone 기준 모바일 최적화: 폭 기준으로 UI 스케일 조절
  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia && window.matchMedia("(max-width: 520px)").matches;
  }, []);

  // ✅ 왼쪽 상단 뒤로가기 버튼
  const hideBack = location?.pathname === "/dashboard";

  function goBack() {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/dashboard", { replace: true });
    }
  }

  // 토스트 UI
  const [toast, setToast] = useState(null); // { id, title, msg, row }
  const toastTimerRef = useRef(null);

  // ✅ 소리 on/off (세션 유지)
  const [soundEnabled, setSoundEnabled] = useState(
    sessionStorage.getItem("admin_sound_enabled") === "1"
  );

  // ✅ 오디오 unlock(클릭 1번 필요) 상태
  const [audioUnlocked, setAudioUnlocked] = useState(
    sessionStorage.getItem("admin_audio_unlocked") === "1"
  );

  // 중복/스팸 방지
  const lastBySessionRef = useRef(new Map()); // session_id -> lastTime(ms)

  // ✅ 폴링용 마지막 확인 시각
  const lastSeenIsoRef = useRef(new Date(Date.now() - 30_000).toISOString());
  const pollTimerRef = useRef(null);

  function showToast(row) {
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

    // ✅ 소리
    if (soundEnabled && audioUnlocked) {
      playDing();
    }

    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 6000);
  }

  function maybeToast(row) {
    if (!row) return;

    // 같은 session_id에서 2초 이내 연속 이벤트 무시
    const sid = row.session_id || "";
    const now = Date.now();
    if (sid) {
      const last = lastBySessionRef.current.get(sid) || 0;
      if (now - last < 2000) return;
      lastBySessionRef.current.set(sid, now);
    }

    showToast(row);
  }

  // ✅ 1) Realtime 구독
  useEffect(() => {
    const channel = supabase
      .channel("focus-events-live-admin")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "focus_events" },
        (payload) => {
          const row = payload?.new;
          if (!row) return;

          console.log("[AdminGate] realtime focus_events INSERT:", row);

          if (row.created_at) {
            const cur = lastSeenIsoRef.current;
            if (!cur || row.created_at > cur) lastSeenIsoRef.current = row.created_at;
          }

          maybeToast(row);
        }
      )
      .subscribe((status) => {
        console.log("[AdminGate] realtime subscribe status:", status);
      });

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    };
  }, []);

  // ✅ 2) Fallback Polling
  useEffect(() => {
    async function pollNew() {
      try {
        const afterIso =
          lastSeenIsoRef.current || new Date(Date.now() - 10_000).toISOString();

        const { data, error } = await supabase
          .from("focus_events")
          .select("id, created_at, session_id, student_name, event_type, detail")
          .gt("created_at", afterIso)
          .order("created_at", { ascending: true })
          .limit(20);

        if (error) {
          console.warn("[AdminGate] polling error:", error);
          return;
        }

        const rows = data || [];
        if (rows.length === 0) return;

        const last = rows[rows.length - 1];
        if (last?.created_at) lastSeenIsoRef.current = last.created_at;

        for (const r of rows) {
          console.log("[AdminGate] polling new row:", r);
          maybeToast(r);
        }
      } catch (e) {
        console.warn("[AdminGate] polling exception:", e);
      }
    }

    pollTimerRef.current = setInterval(pollNew, 3000);
    pollNew();

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, []);

  // cleanup toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const sessionId = toast?.row?.session_id || null;

  // ✅ 오디오 unlock 버튼
  async function unlockAudioOnce() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        alert("이 브라우저는 오디오 알림을 지원하지 않아요.");
        return;
      }
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
      osc.onended = () => {
        try {
          ctx.close();
        } catch {}
      };

      setAudioUnlocked(true);
      sessionStorage.setItem("admin_audio_unlocked", "1");
      playDing();
      alert("소리 켜짐(한번) 완료! 이제 알림 소리가 납니다.");
    } catch (e) {
      console.warn("[AdminGate] unlock audio failed:", e);
      alert("소리 켜기 실패. 다시 한 번 눌러주세요.");
    }
  }

  // ✅ 모바일에서 터치 타겟 키우기(44px+)
  const BTN_H = isMobile ? 44 : 34;
  const BTN_PAD = isMobile ? "0 14px" : "0 12px";

  const ui = {
    pillBtn: {
      height: BTN_H,
      padding: BTN_PAD,
      borderRadius: 999,
      fontWeight: 900,
      cursor: "pointer",
      boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
      color: THEME.text,
      background: THEME.card,
      border: `1px solid ${THEME.border}`,
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    dangerPill: {
      height: BTN_H,
      padding: BTN_PAD,
      borderRadius: 999,
      fontWeight: 900,
      cursor: "pointer",
      boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
      color: THEME.text,
      background: THEME.card,
      border: "1px solid #ffd3e3",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    toastBtnPrimary: {
      border: "none",
      background: THEME.pink,
      color: "#fff",
      fontWeight: 800,
      padding: isMobile ? "10px 12px" : "8px 10px",
      borderRadius: 10,
      cursor: "pointer",
      fontSize: 13,
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
      minHeight: 40,
    },
    toastBtnSecondary: {
      border: "1px solid #ffd3e3",
      background: THEME.pinkSoft,
      color: THEME.danger,
      fontWeight: 800,
      padding: isMobile ? "10px 12px" : "8px 10px",
      borderRadius: 10,
      cursor: "pointer",
      fontSize: 13,
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
      minHeight: 40,
    },
    toastBtnNeutral: {
      border: "1px solid #eee",
      background: "#f7f7f7",
      color: "#374151",
      fontWeight: 800,
      padding: isMobile ? "10px 12px" : "8px 10px",
      borderRadius: 10,
      cursor: "pointer",
      fontSize: 13,
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
      minHeight: 40,
    },
  };

  // ✅ iPhone safe-area 대응: top/bottom inset 포함한 위치 계산
  // - Safari에서 env()는 스타일 문자열로 그대로 넣어야 함
  const TOP = "calc(env(safe-area-inset-top, 0px) + 10px)";
  const RIGHT = "calc(env(safe-area-inset-right, 0px) + 12px)";
  const LEFT = "calc(env(safe-area-inset-left, 0px) + 12px)";
  const BOTTOM = "calc(env(safe-area-inset-bottom, 0px) + 16px)";

  // ✅ 상단 fixed 영역 때문에 Outlet이 가려지지 않게 padding-top 확보
  // 버튼 높이 + 여유 + safe-area-top
  const contentPadTop = isMobile
    ? `calc(env(safe-area-inset-top, 0px) + ${BTN_H}px + 22px)`
    : `calc(env(safe-area-inset-top, 0px) + 56px)`;

  return (
    <>
      {/* ✅ AdminGate가 감싸는 전역 UI 톤: 배경/기본 글자색 강제 */}
      <div
        style={{
          // ✅ iOS Safari 주소창 변화 대응: 100dvh 우선, 미지원 브라우저는 100vh
          minHeight: "100vh",
          height: "100dvh",
          background: THEME.bg,
          color: THEME.text,
          // ✅ fixed 상단 UI에 가려지지 않게
          paddingTop: contentPadTop,
          // ✅ iOS 탄성 스크롤 시 배경 하얗게 비는 느낌 최소화
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* ✅ 왼쪽 상단 뒤로가기 */}
        {!hideBack && (
          <button
            onClick={goBack}
            style={{
              ...ui.pillBtn,
              position: "fixed",
              top: TOP,
              left: LEFT,
              zIndex: 99998,
            }}
            title="뒤로가기"
            aria-label="뒤로가기"
          >
            ← 뒤로
          </button>
        )}

        {/* ✅ 전역 상단 작은 컨트롤 */}
        <div
          style={{
            position: "fixed",
            top: TOP,
            right: RIGHT,
            zIndex: 99998,
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            // ✅ 모바일에서 우측 컨트롤이 너무 길면 아래로 떨어질 수 있게
            maxWidth: "min(520px, calc(100vw - 24px))",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={unlockAudioOnce}
            style={ui.dangerPill}
            title="브라우저 정책 때문에 알림 소리는 한 번 클릭으로 활성화가 필요해요."
          >
            {audioUnlocked ? "🔊 소리 켜짐" : "🔊 소리 켜기(한번)"}
          </button>

          <button
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              sessionStorage.setItem("admin_sound_enabled", next ? "1" : "0");
              if (next && audioUnlocked) playDing();
            }}
            style={{
              height: BTN_H,
              padding: BTN_PAD,
              borderRadius: 999,
              border: "none",
              background: soundEnabled ? THEME.pink : "#f0f0f0",
              color: soundEnabled ? "#fff" : THEME.text,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
              WebkitTapHighlightColor: "transparent",
              touchAction: "manipulation",
            }}
            title="알림 소리 on/off"
          >
            {soundEnabled ? "🔔 켜짐" : "🔕 꺼짐"}
          </button>
        </div>

        <Outlet />

        {/* ✅ 전역 토스트 */}
        {toast && (
          <div
            style={{
              position: "fixed",
              right: RIGHT,
              bottom: BOTTOM,
              zIndex: 99999,
              width: isMobile ? "min(420px, calc(100vw - 24px))" : "min(360px, calc(100vw - 32px))",
              background: THEME.card,
              color: THEME.text,
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
              <div style={{ fontWeight: 900, fontSize: 14, color: THEME.text }}>
                {toast.title}
              </div>
              <button
                onClick={() => setToast(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: "18px",
                  padding: 6, // ✅ 모바일에서 누르기 쉬움
                  color: "#6b7280",
                  WebkitTapHighlightColor: "transparent",
                  touchAction: "manipulation",
                }}
                aria-label="닫기"
                title="닫기"
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 6, fontSize: 13, color: THEME.subText }}>
              {toast.msg}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  if (sessionId) {
                    navigate(`/teacher/review/${sessionId}`, { replace: false });
                    return;
                  }
                  navigate("/teacher/focus", { replace: false });
                }}
                style={ui.toastBtnPrimary}
                title={sessionId ? `검수 페이지로 이동: ${sessionId}` : "세션 정보 없음"}
              >
                검수 페이지로 이동
              </button>

              <button
                onClick={() => navigate("/teacher/focus", { replace: false })}
                style={ui.toastBtnSecondary}
              >
                집중 모니터
              </button>

              <button onClick={() => setToast(null)} style={ui.toastBtnNeutral}>
                닫기
              </button>
            </div>

            {/* detail 미리보기 */}
            {toast?.row?.detail && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: THEME.subText,
                  background: "#f3f6fb",
                  border: `1px solid ${THEME.border}`,
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
      </div>
    </>
  );
}
