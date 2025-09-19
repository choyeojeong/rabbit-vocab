// src/utils/textEval.js
import { parseAccepted } from './vocab';

/** 간단 정규화: 소문자, 공백/구두점 제거, 전각→반각 */
export function normalize(s) {
  if (!s) return '';
  let t = s.normalize('NFKC').trim().toLowerCase();
  // 끝의 경어체/종결어미 일부 제거 (요/습니다/합니다/했어요 등)
  t = t.replace(/(입니다|합니다|했습니다|했어요|해요|요)$/g, '');
  // 공백/구두점 제거
  t = t.replace(/[\s.,!?~'"`()\[\]{}:;/-]/g, '');
  return t;
}

/** 레벤슈타인 거리 */
export function levenshtein(a, b) {
  const s = normalize(a);
  const t = normalize(b);
  const m = s.length, n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/** 오탈자 허용 기준: <= max(1, ceil(len*0.12)) */
function withinTypoTolerance(answer, target) {
  const dist = levenshtein(answer, target);
  const L = normalize(target).length || 1;
  const maxErr = Math.max(1, Math.ceil(L * 0.12));
  return dist <= maxErr;
}

/** 형태 판별 */
function looksLikeModifierForm(korean) {
  const raw = (korean || '').trim();
  // 관형형 대략치: …는/…은/…ㄴ/…운
  return /(는|은|ㄴ|운)$/.test(raw);
}
function endsWithDa(korean) {
  return /다$/.test((korean || '').trim());
}

/** 품사 규칙(개선):
 * - v/adj에서 "정답 후보가 기본형(…다)인데 학생 답이 관형형"이면 오답.
 * - 그 외에는 비교 로직에 맡김(정답 후보가 관형형이면 관형형도 허용).
 */
function posAllowedForPair(pos, input, candidate) {
  if (!pos) return true;
  if (pos === 'v' || pos === 'adj') {
    const candIsBase = endsWithDa(candidate);
    const inputIsModifier = looksLikeModifierForm(input);
    if (candIsBase && inputIsModifier) return false; // 예: 달리다(정답) vs 달리는(학생) → 오답
    return true;
  }
  return true;
}

/** 정답 후보 집합: meaning_ko + accepted_ko */
function candidateAnswers(word) {
  const base = [word.meaning_ko].filter(Boolean);
  const extra = parseAccepted(word.accepted_ko);
  return [...base, ...extra];
}

/** 최종 채점 */
export function isAnswerCorrect(input, word) {
  const cands = candidateAnswers(word);
  for (const cand of cands) {
    // 품사/형태 규칙 체크 (후보별로)
    if (!posAllowedForPair(word.pos, input, cand)) continue;

    // 정규 일치
    if (normalize(input) === normalize(cand)) return true;

    // 오탈자 허용
    if (withinTypoTolerance(input, cand)) return true;
  }
  return false;
}
