// src/utils/speech.js
// 브라우저 SpeechSynthesis 기반 TTS 유틸

let cachedVoice = null;

export function pickEnglishVoice() {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const primary = voices.find(v => /en[-_]US/i.test(v.lang));
  const anyEn = primary || voices.find(v => /^en[-_]/i.test(v.lang));
  cachedVoice = anyEn || null;
  return cachedVoice;
}

// 일부 브라우저는 getVoices()가 지연됨
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = null;
    pickEnglishVoice();
  };
}

export function speakCancel() {
  try {
    window.speechSynthesis?.cancel?.();
  } catch {}
}

export function speakWord(text, { rate = 0.95, pitch = 1.0 } = {}) {
  if (!text || !window.speechSynthesis) return;

  // 겹침 방지
  speakCancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-US";
  utter.rate = rate;
  utter.pitch = pitch;

  const v = pickEnglishVoice();
  if (v) utter.voice = v;

  window.speechSynthesis.speak(utter);
}
