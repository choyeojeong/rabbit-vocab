// src/utils/ding.js
// 브라우저 오디오 정책을 "확실히" 풀고, 합성 '딩' 소리를 내는 훅
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

let shared = {
  ctx: null,        // AudioContext (싱글톤)
  unlocked: false,  // 전역 unlock 상태(탭 생명주기 동안 유지)
};

function ensureContext() {
  if (shared.ctx) return shared.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("AudioContext not supported");
  shared.ctx = new AC({ latencyHint: "interactive" });
  return shared.ctx;
}

// iOS/크롬 정책 회피용: 0.02s 무음 버퍼를 터치 제스처로 재생
async function playSilentOnce(ctx) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.02)), ctx.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  return new Promise((res) => {
    src.onended = res;
    src.start(0);
  });
}

// 합성 사운드: 간단한 2톤 '딩' (길이: short/long)
async function synthDing(ctx, kind = "long") {
  const now = ctx.currentTime;
  const dur = kind === "short" ? 0.35 : 0.9;

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  // 두 톤(하모닉)으로 더 또렷한 딩
  osc1.type = "sine";  osc1.frequency.setValueAtTime(880, now);   // A5
  osc2.type = "sine";  osc2.frequency.setValueAtTime(1320, now);  // E6 (완전5도 위)

  // ADSR 느낌의 짧은 엔벨로프
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.4, now + 0.02);       // attack
  gain.gain.exponentialRampToValueAtTime(0.25, now + dur * 0.4); // decay
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);     // release

  osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
  osc1.start(now); osc2.start(now);
  osc1.stop(now + dur); osc2.stop(now + dur);

  return new Promise((res) => {
    osc2.onended = res;
  });
}

export function useDing(storageKey = "ding", opts = {}) {
  const defaultLength = opts.defaultLength || "long";
  const [soundOn, setSoundOn] = useState(() => {
    const saved = localStorage.getItem(`${storageKey}:on`);
    return saved ? saved === "1" : true;
  });
  const [, force] = useState(0);

  const unlocked = useMemo(() => shared.unlocked, [/* force tick */]);
  const forceRerender = () => force((x) => x + 1);

  // 탭 복귀 시 자동 resume 시도 (모바일에서 가끔 suspend됨)
  useEffect(() => {
    const onVis = async () => {
      try {
        if (!shared.ctx) return;
        if (shared.ctx.state === "suspended") {
          await shared.ctx.resume();
        }
      } catch {}
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const unlock = useCallback(async () => {
    try {
      const ctx = ensureContext();

      // 이미 해제면 OK
      if (shared.unlocked && ctx.state === "running") return true;

      // 반드시 '사용자 제스처 체인' 안에서 실행되어야 함
      // 1) resume()
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      // 2) 무음 버퍼 1회 재생 (iOS 필수)
      await playSilentOnce(ctx);

      shared.unlocked = (ctx.state === "running");
      forceRerender();
      return shared.unlocked;
    } catch (e) {
      console.warn("[ding] unlock failed:", e);
      return false;
    }
  }, []);

  const play = useCallback(
    async (kind = defaultLength) => {
      try {
        const ctx = ensureContext();
        if (!shared.unlocked || ctx.state !== "running") {
          // 안전장치: 혹시 잠겨있다면 한 번 더 시도
          const ok = await unlock();
          if (!ok) throw new Error("Audio locked");
        }
        await synthDing(ctx, kind);
      } catch (e) {
        console.warn("[ding] play failed:", e);
      }
    },
    [defaultLength, unlock]
  );

  const setSoundOnWrapped = useCallback((v) => {
    const next = typeof v === "function" ? v(soundOn) : v;
    localStorage.setItem(`${storageKey}:on`, next ? "1" : "0");
    setSoundOn(next);
  }, [soundOn, storageKey]);

  return {
    soundOn,
    setSoundOn: setSoundOnWrapped,
    unlocked: shared.unlocked,
    unlock,
    play,
  };
}
