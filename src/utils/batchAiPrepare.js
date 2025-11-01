// /src/utils/batchAiPrepare.js
// 클라이언트에서 CSV 파싱 결과를 16줄 단위로 순차 POST.
// 504/429/500 발생 시 지수백오프 + 부분 재시도.

const API_PATH = '/api/csv-prepare';
const MAX_PER_REQ = 16;

async function postSmallBatch(items, bookOverride, fillMissing, attempt = 0) {
  const resp = await fetch(API_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, bookOverride, fillMissing }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    // 429/504/500 등은 재시도
    if (resp.status === 429 || resp.status === 504 || resp.status === 500) {
      if (attempt < 3) {
        const wait = 400 * Math.pow(2, attempt); // 0.4s → 0.8s → 1.6s
        await new Promise((r) => setTimeout(r, wait));
        return postSmallBatch(items, bookOverride, fillMissing, attempt + 1);
      }
    }
    throw new Error(`csv-prepare failed: ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  return data?.rows || [];
}

export async function aiPrepareInBatches(allRows, { bookOverride = '', fillMissing = true, onProgress } = {}) {
  const out = [];
  const total = allRows.length || 0;
  for (let i = 0; i < total; i += MAX_PER_REQ) {
    const chunk = allRows.slice(i, i + MAX_PER_REQ);

    // 만약 이 소배치가 실패를 반복하면 더 잘게 쪼개서 복구
    try {
      const rows = await postSmallBatch(chunk, bookOverride, fillMissing);
      out.push(...rows);
    } catch (e) {
      // 반으로 쪼개어 구제(재귀)
      const half = Math.max(1, Math.floor(chunk.length / 2));
      for (let j = 0; j < chunk.length; j += half) {
        const sub = chunk.slice(j, j + half);
        const rows = await postSmallBatch(sub, bookOverride, fillMissing);
        out.push(...rows);
      }
    }

    if (onProgress) onProgress(Math.min(1, (i + chunk.length) / total));
  }
  if (onProgress) onProgress(1);
  return out;
}
