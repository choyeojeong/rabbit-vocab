// src/hooks/useExamFocusGuard.js
import { useEffect, useRef } from "react";
import { supabase } from "../utils/supabaseClient";

/**
 * 시험 화면에서 포커스 이탈/복귀를 감지해 Supabase에 기록합니다.
 * @param {object} params
 * @param {string} params.sessionId - test_sessions.id (공식시험 세션)
 * @param {string} params.studentId - profiles.id (학생)
 * @param {boolean} params.enableAlert - 경고창 띄울지 여부(기본 true)
 */
export default function useExamFocusGuard({ sessionId, studentId, enableAlert = true }) {
  const lastLogAtRef = useRef(0);

  useEffect(() => {
    if (!sessionId || !studentId) return;

    const logLoss = async (visibleState) => {
      // 과도한 중복 기록 방지(1.5초 쿨다운)
      const now = Date.now();
      if (now - lastLogAtRef.current < 1500) return;
      lastLogAtRef.current = now;

      try {
        await supabase.from("exam_focus_logs").insert({
          session_id: sessionId,
          student_id: studentId,
          event: "focus_lost",
          visible_state: visibleState,
          user_agent: navigator.userAgent || "",
          meta: {}
        });
      } catch (e) {
        // 콘솔만
        console.warn("[focus guard] insert failed", e);
      }

      if (enableAlert) {
        alert("⚠️ 시험 도중 화면을 벗어났습니다. 다시 시험 화면으로 돌아와 주세요.");
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        logLoss("hidden");
      }
    };
    const onBlur = () => {
      // 일부 브라우저/OS에서 blur만 발생하는 경우도 카バー
      if (document.hasFocus && !document.hasFocus()) {
        logLoss("blur");
      } else {
        logLoss("blur");
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [sessionId, studentId, enableAlert]);
}
