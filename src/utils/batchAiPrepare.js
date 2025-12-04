// src/utils/batchAiPrepare.js

/**
 * AI로 CSV 행들을 여러 번에 나눠서 보정하는 헬퍼.
 * - BATCH_SIZE 단위로 /api/csv-prepare 호출
 * - 각 청크는 자동 재시도(기본 3회)
 * - 응답이 없거나 비정상이면 원본 slice 사용
 * - meaning_ko / pos / accepted_ko 가 빈 문자열이면 원본 값 유지 + accepted_ko 최소 채우기
 */

const BATCH_SIZE = 3; // 서버도 3줄만 받으니까 여기서도 3

// 한 청크에 대해 /api/csv-prepare 호출 + 자동 재시도
async function callCsvPrepareWithRetry(slice, maxTry = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxTry; attempt++) {
    // fetch 타임아웃 12초
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const resp = await fetch("/api/csv-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: slice }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        lastError = new Error(`HTTP ${resp.status}`);
      } else {
        const json = await resp.json();
        if (Array.isArray(json.rows)) {
          return json.rows;
        } else {
          lastError = new Error("Invalid response shape");
        }
      }
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
    }

    // 실패 시 간단한 backoff 후 재시도
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }

  console.error("csv-prepare failed after retry:", lastError);
  // 완전 실패하면 null 리턴 → 호출 측에서 원본 slice 사용
  return null;
}

// AI 응답과 원본 slice를 머지하면서 "빈 값 덮어쓰기" 방지
function mergeChunk(originalChunk, preparedChunk) {
  const merged = [];

  for (let idx = 0; idx < originalChunk.length; idx++) {
    const orig = originalChunk[idx] || {};
    const ai = preparedChunk && preparedChunk[idx] ? preparedChunk[idx] : {};

    const out = { ...orig };

    // 공통 헬퍼: 문자열 트림
    const trim = (v) =>
      v == null ? "" : String(v).replace(/\s+/g, " ").trim();

    // book / chapter / term_en 은 AI가 주면 우선, 없으면 원본
    out.book = ai.book != null ? ai.book : orig.book;
    out.chapter =
      ai.chapter != null && ai.chapter !== ""
        ? ai.chapter
        : orig.chapter;
    out.term_en = ai.term_en != null ? ai.term_en : orig.term_en;

    const origMeaning = trim(orig.meaning_ko);
    const origPos = trim(orig.pos);
    const origAccepted = trim(orig.accepted_ko);

    const aiMeaning = trim(ai.meaning_ko);
    const aiPos = trim(ai.pos);
    const aiAccepted = trim(ai.accepted_ko);

    // meaning_ko: AI 값이 비어있지 않으면 사용, 아니면 원본
    out.meaning_ko = aiMeaning || origMeaning || "";

    // pos: AI 값이 비어있지 않으면 사용, 아니면 원본
    out.pos = aiPos || origPos || "";

    // accepted_ko:
    // 1) AI 값이 있으면 그거 사용
    // 2) 없으면 원본 accepted_ko
    // 3) 그것도 없고 meaning_ko가 있으면 meaning_ko 복사
    let finalAccepted = aiAccepted || origAccepted;
    if (!finalAccepted) {
      finalAccepted = out.meaning_ko || "";
    }
    out.accepted_ko = finalAccepted;

    merged.push(out);
  }

  return merged;
}

export async function aiPrepareInBatches(allRows, { onProgress } = {}) {
  const total = allRows.length;
  const result = [];

  let done = 0;

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const slice = allRows.slice(i, i + BATCH_SIZE);

    // 한 청크에 대해 서버 호출 + 재시도
    const rowsFromServer = await callCsvPrepareWithRetry(slice, 3);

    let mergedChunk;
    if (!rowsFromServer || !Array.isArray(rowsFromServer) || !rowsFromServer.length) {
      // 완전 실패/비정상 → 원본 slice 그대로
      mergedChunk = slice;
    } else {
      // 정상 응답 → 원본과 머지하면서 빈값 덮어쓰기 방지
      mergedChunk = mergeChunk(slice, rowsFromServer);
    }

    result.push(...mergedChunk);
    done += slice.length;

    if (onProgress) {
      onProgress(done, total); // 여기서 바로바로 올림
    }
  }

  return result;
}
