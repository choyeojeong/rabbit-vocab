import { useEffect, useRef, useState } from "react";
import { Outlet, Navigate, useNavigate } from "react-router-dom";
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

export default function AdminGate() {
  const navigate = useNavigate();
  const role = sessionStorage.getItem("role"); // 'admin' | 'student' | null

  // admin 아니면 즉시 차단
  if (role !== "admin") {
    return <Navigate to="/" replace />;
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

  // 중복/스팸 방지: 같은 session_id에서 짧은 시간 연속 이벤트 무시
  const lastBySessionRef = useRef(new Map()); // session_id -> lastTime(ms)

  // ✅ 폴링용 마지막 확인 시각
  // 기존: new Date().toISOString() → 진입 직후 이벤트 놓칠 수 있음
  // 변경: 최근 30초부터 시작 → "페이지 들어오고 바로 발생한" 이벤트도 잡음
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

    // 6초 후 자동 닫힘
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 6000);
  }

  // ✅ 공통: 스팸 방지 체크 후 토스트
  function maybeToast(row) {
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

          // 디버그 로그(원하면 나중에 제거)
          console.log("[AdminGate] realtime focus_events INSERT:", row);

          // 폴링 lastSeen도 같이 갱신 (중복 방지)
          if (row.created_at) {
            const cur = lastSeenIsoRef.current;
            if (!cur || row.created_at > cur) lastSeenIsoRef.current = row.created_at;
          }

          maybeToast(row);
        }
      )
      .subscribe((status) => {
        // 디버그: 구독 상태 확인
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

  // ✅ 2) Fallback Polling (Realtime이 안 와도 토스트 뜨게)
  useEffect(() => {
    async function pollNew() {
      try {
        // 마지막 본 시각 이후 새 이벤트만
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

        // lastSeen 갱신 (가장 마지막 created_at)
        const last = rows[rows.length - 1];
        if (last?.created_at) lastSeenIsoRef.current = last.created_at;

        // 새 이벤트들 토스트(스팸방지 통과한 것만)
        for (const r of rows) {
          console.log("[AdminGate] polling new row:", r);
          maybeToast(r);
        }
      } catch (e) {
        console.warn("[AdminGate] polling exception:", e);
      }
    }

    // 3초마다 확인
    pollTimerRef.current = setInterval(pollNew, 3000);

    // 최초 1회 즉시 실행
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

  // ✅ 오디오 unlock 버튼 (한번 클릭 필요)
  async function unlockAudioOnce() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        alert("이 브라우저는 오디오 알림을 지원하지 않아요.");
        return;
      }
      const ctx = new AudioCtx();
      // iOS/Chrome 정책: resume 필요
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      // 짧게 무음 재생(언락 목적)
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
      // 테스트 딩
      playDing();
      alert("소리 켜짐(한번) 완료! 이제 알림 소리가 납니다.");
    } catch (e) {
      console.warn("[AdminGate] unlock audio failed:", e);
      alert("소리 켜기 실패. 다시 한 번 눌러주세요.");
    }
  }

  return (
    <>
      {/* ✅ 전역 상단 작은 컨트롤(어느 관리자 페이지든) */}
      <div
        style={{
          position: "fixed",
          top: 10,
          right: 12,
          zIndex: 99998,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={unlockAudioOnce}
          style={{
            height: 34,
            padding: "0 12px",
            borderRadius: 999,
            border: "1px solid #ffd3e3",
            background: "#fff",
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
          }}
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
            height: 34,
            padding: "0 12px",
            borderRadius: 999,
            border: "none",
            background: soundEnabled ? "#ff6fa3" : "#f0f0f0",
            color: soundEnabled ? "#fff" : "#444",
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
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

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                if (sessionId) {
                  navigate(`/teacher/review/${sessionId}`, { replace: false });
                  return;
                }
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

          {/* detail 미리보기 */}
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
