// src/utils/batchAiPrepare.js

/** 내부 호출: /api/csv-prepare 를 한 번 실행 */
export async function runAiPrepare(payload) {
  const res = await fetch("/api/csv-prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();

  let data;
  try { data = JSON.parse(text); }
  catch {
    throw new Error(`서버가 JSON이 아닌 응답을 보냈어요. status=${res.status}\n${text.slice(0,300)}`);
  }

  if (!res.ok || data?.error) {
    const msg = data?.error || res.statusText || "요청 실패";
    const details = data?.details ? `\n${data.details}` : "";
    throw new Error(`${msg}${details}`);
  }
  return data; // { ok: true, rows: [...] }
}

/**
 * 큰 rows 배열을 batchSize 로 쪼개 순차 처리합니다.
 * - onProgress(0~1) 진행률 콜백
 * - 429/5xx/timeout 메시지면 지수 백오프로 재시도
 */
export async function aiPrepareInBatches(allRows, {
  batchSize = 250,
  aiFill = true,
  book = null,
  onProgress = () => {},
  maxRetries = 4,
} = {}) {
  const total = allRows.length;
  const out = [];

  for (let i = 0; i < total; i += batchSize) {
    const slice = allRows.slice(i, i + batchSize);

    let attempt = 0;
    while (true) {
      try {
        const { rows } = await runAiPrepare({ rows: slice, book, aiFill });
        out.push(...rows);
        break; // 성공
      } catch (e) {
        attempt++;
        const msg = String(e.message || e);
        const retriable = /429|5\d\d|시간 초과|timeout/i.test(msg);
        if (!retriable || attempt > maxRetries) throw e;
        const delay = Math.min(15000, 1000 * 2 ** (attempt - 1)); // 1s,2s,4s,8s,15s cap
        await new Promise(r => setTimeout(r, delay));
      }
    }

    onProgress(Math.min(1, (i + slice.length) / total));
  }
  return out;
}
