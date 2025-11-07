// src/utils/batchAiPrepare.js
export async function aiPrepareInBatches(allRows, { onProgress } = {}) {
  const BATCH_SIZE = 3; // 서버도 3줄만 받으니까 여기서도 3
  const total = allRows.length;
  const result = [];

  let done = 0;

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const slice = allRows.slice(i, i + BATCH_SIZE);

    // fetch 타임아웃 12초
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    let rowsFromServer = slice;
    try {
      const resp = await fetch('/api/csv-prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: slice }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json.rows) && json.rows.length) {
          rowsFromServer = json.rows;
        }
      }
    } catch (e) {
      // abort나 네트워크 에러면 그냥 slice 사용
      clearTimeout(timer);
      rowsFromServer = slice;
    }

    result.push(...rowsFromServer);
    done += slice.length;

    if (onProgress) {
      onProgress(done, total); // 여기서 바로바로 올림
    }
  }

  return result;
}
