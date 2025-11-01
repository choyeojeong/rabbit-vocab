// src/utils/batchAiPrepare.js
import Papa from "papaparse";

/**
 * 큰 CSV를 안전하게 AI 보정하기 위한 배치 유틸
 *
 * @param {Array<object>} rows           원본 행 배열(헤더 유무 상관없음)
 * @param {object} opts
 *   - batchSize: number = 250           한 번에 보낼 행 수 (100~300 권장)
 *   - aiFill: boolean = true            pos/accepted_ko 채우기 여부
 *   - book: string = ""                 기본 book 이름(없으면 서버가 추론)
 *   - onProgress?: (p: number) => void  진행률 콜백 (0~1)
 *   - retries: number = 3               청크별 재시도 횟수
 *   - backoffMs: number = 1200          재시도 지수 백오프 기본(ms)
 *
 * 서버: /api/csv-prepare (JSON 모드)
 *  - body: { rows: [...], book?: string, aiFill?: boolean }
 *  - response: { csv: "...", columns: [...] }
 *    → csv를 다시 파싱해서 표준 열로 반환
 */
export async function aiPrepareInBatches(rows, opts = {}) {
  const {
    batchSize = 250,
    aiFill = true,
    book = "",
    onProgress,
    retries = 3,
    backoffMs = 1200,
  } = opts;

  if (!Array.isArray(rows) || rows.length === 0) return [];

  const total = rows.length;
  let done = 0;
  const out = [];

  const update = () => {
    if (typeof onProgress === "function") onProgress(done / total);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < total; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);

    let attempt = 0;
    // 재시도 루프
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const res = await fetch("/api/csv-prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk, book, aiFill }),
        });

        // 서버가 에러를 JSON으로 주므로 항상 json 파싱
        const data = await res.json();

        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `csv-prepare failed (HTTP ${res.status})`);
        }

        // 응답의 csv → 객체 배열
        const parsed = Papa.parse(data.csv || "", { header: true, skipEmptyLines: true });
        const normRows = Array.isArray(parsed.data) ? parsed.data : [];
        out.push(...normRows);

        done += chunk.length;
        update();
        break; // 청크 성공 → 다음 청크
      } catch (e) {
        attempt++;
        if (attempt > retries) {
          // 실패한 청크의 첫 행 몇 개만 같이 보여주면 디버그 쉬움
          const sample = JSON.stringify(chunk.slice(0, 2));
          throw new Error(
            `[aiPrepareInBatches] chunk ${i}-${i + chunk.length - 1} failed after ${retries} retries: ${e.message}\nSample: ${sample}`
          );
        }
        // 지수 백오프
        const wait = backoffMs * Math.pow(2, attempt - 1);
        await sleep(wait);
      }
    }
  }

  // 최종 100%
  if (typeof onProgress === "function") onProgress(1);
  return out;
}
