// /api/csv-prepare.ts
export const config = { runtime: "edge" };

/**
 * Rabbit Vocab CSV Preparer (Edge, TypeScript)
 * - Accepts a CSV file (multipart/form-data, field name: 'file')
 * - Normalizes to: book,chapter,term_en,meaning_ko,pos,accepted_ko
 * - Fills missing 'pos' and 'accepted_ko' via OpenAI (when fillMissing=true)
 * - Does NOT deduplicate rows
 * - Returns JSON (default) or text/csv when ?format=csv
 */

import Papa from "papaparse";

// ---------- types ----------
type RowIn = Record<string, unknown>;
type RowOut = {
  book: string;
  chapter: string;
  term_en: string;
  meaning_ko: string;
  pos: string;
  accepted_ko: string;
  _row?: number;
};
type Suggestion = { idx: number; pos?: string; accepted_ko?: string };

// ---------- small utils ----------
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = (): HeadersInit => ({
  "content-type": "application/json; charset=utf-8",
  ...CORS,
});

const csvHeaders = (filename = "normalized.csv"): HeadersInit => ({
  "content-type": "text/csv; charset=utf-8",
  "content-disposition": `attachment; filename="${filename}"`,
  ...CORS,
});

const norm = (s: unknown): string => (s ?? "").toString().trim();
const toDigits = (v: unknown): string => {
  const m = String(v ?? "").match(/\d+/);
  return m ? m[0] : "";
};

function splitMeaning(s: unknown): [string, string] {
  const raw = norm(s);
  if (!raw) return ["", ""];
  const normalized = raw
    .replace(/[;/·•\t]+/g, ",")
    .replace(/\s*,\s*/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "")
    .trim();
  if (!normalized) return ["", ""];
  const [first, rest] = normalized.split(",", 2);
  return [first ?? "", rest ?? ""];
}

function pickColumn(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => norm(h).toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0) return headers[idx];
  }
  return null;
}

function stripCodeFence(s: string): string {
  return s
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

// ---------- OpenAI helpers (fetch + backoff) ----------
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_TOKENS = 300;

/** sleep(ms) */
const zzz = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with timeout via AbortController */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 30000, ...rest } = init;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort("timeout"), timeoutMs);
  try {
    // @ts-ignore
    return await fetch(input, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 429/5xx 백오프 + Retry-After 준수 */
async function callOpenAIWithBackoff(body: any, maxRetries = 5) {
  const model = (process.env.OPENAI_MODEL || DEFAULT_MODEL).trim();
  const max_tokens = Number(process.env.OPENAI_MAX_TOKENS || DEFAULT_MAX_TOKENS);

  const payload = {
    model,
    temperature: 0.2,
    max_tokens,
    ...body,
  };

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    const res = await fetchWithTimeout(OPENAI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      timeoutMs: 45000, // 개별 호출 45초 제한
    });

    // 정상 응답
    if (res.ok) {
      // OpenAI는 JSON을 줘야 하지만 방어적으로 처리
      try {
        const data = await res.json();
        return data;
      } catch {
        const text = await res.text();
        throw new Error(`OpenAI JSON parse failed: ${text.slice(0, 300)}`);
      }
    }

    // 재시도 가능한 코드
    if ((res.status === 429 || res.status >= 500) && attempt <= maxRetries) {
      // Retry-After 또는 x-ratelimit-reset 기반 대기
      const ra = res.headers.get("retry-after");
      const reset = res.headers.get("x-ratelimit-reset-tokens");
      const waitSec = ra
        ? Number(ra)
        : reset
        ? Number(reset)
        : Math.min(60, 2 ** attempt);
      await zzz(Math.max(1, waitSec) * 1000);
      continue;
    }

    // 그 외 에러는 본문을 읽어서 throw
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`OpenAI error ${res.status}: ${bodyText.slice(0, 500)}`);
  }
}

// ---------- main handler ----------
export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Use POST with multipart/form-data (field: file).",
      }),
      { headers: jsonHeaders(), status: 405 }
    );
  }

  try {
    const url = new URL(req.url);
    const wantCsv = url.searchParams.get("format") === "csv";
    const bookOverride = url.searchParams.get("book") || "";
    const fillMissing = url.searchParams.get("fillMissing") !== "false";
    const limit = url.searchParams.get("limit")
      ? parseInt(url.searchParams.get("limit") as string, 10)
      : null;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return new Response(
        JSON.stringify({ ok: false, error: "No file. Use 'file' field." }),
        { headers: jsonHeaders(), status: 400 }
      );
    }

    const filename = file.name || "uploaded.csv";
    const book = norm(bookOverride) || filename.replace(/\.[^.]+$/, "").trim();
    const text = await file.text();

    // Papa.parse (제네릭 없이)
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    }) as any;

    let rows: RowIn[] = Array.isArray(parsed.data) ? parsed.data : [];
    const originalCount = rows.length;
    if (!originalCount) {
      return new Response(
        JSON.stringify({ ok: false, error: "CSV has no rows." }),
        { headers: jsonHeaders(), status: 400 }
      );
    }

    if (limit && Number.isFinite(limit) && limit > 0) {
      rows = rows.slice(0, limit);
    }

    const headers: string[] =
      (parsed.meta?.fields as string[]) || Object.keys(rows[0] || {});

    const col_chapter =
      pickColumn(headers, [
        "chapter",
        "챕터",
        "unit",
        "lesson",
        "day",
        "index",
        "idx",
        "번호",
        "단원",
        "레슨",
        "유닛",
        "강",
      ]) ?? undefined;

    const col_word =
      pickColumn(headers, [
        "word",
        "term",
        "영단어",
        "단어",
        "english",
        "en",
        "term_en",
      ]) ?? undefined;

    const col_mean =
      pickColumn(headers, [
        "mean",
        "meaning",
        "뜻",
        "국문뜻",
        "ko",
        "korean",
        "의미",
        "meaning_ko",
      ]) ?? undefined;

    const col_pos = pickColumn(headers, ["pos", "품사", "part of speech"]) ?? undefined;

    const col_acc =
      pickColumn(headers, [
        "accepted",
        "accepted_ko",
        "synonyms",
        "동의어",
        "유의어",
        "수용표기",
        "대체표기",
        "etc",
      ]) ?? undefined;

    const normalized: RowOut[] = rows.map((r, i) => {
      const term_en = norm(col_word ? r[col_word] : (r as any)["word"]);
      const [meaning_ko, accRest] = splitMeaning(
        col_mean ? r[col_mean] : (r as any)["mean"]
      );
      const accepted_raw = norm(col_acc ? r[col_acc] : "");
      const accepted_ko = accepted_raw || accRest || "";
      const pos = norm(col_pos ? r[col_pos] : "");
      const chapterRaw = norm(col_chapter ? r[col_chapter] : "");
      const chapter = toDigits(chapterRaw);

      return {
        book,
        chapter,
        term_en,
        meaning_ko,
        pos,
        accepted_ko,
        _row: i + 1,
      };
    });

    let filled: RowOut[] = normalized.slice();

    // ====== OpenAI 보정 (pos/accepted_ko) ======
    if (fillMissing && (process.env.OPENAI_API_KEY || "").trim()) {
      // 보정 필요한 행만 추출
      const needFill = normalized
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => !row.pos || !row.accepted_ko);

      if (needFill.length > 0) {
        // 청크 크기는 작게 유지(응답 타임아웃/과대 방지)
        const chunkSize = Number(process.env.CSV_PREPARE_CHUNK_SIZE || 30);

        for (let i = 0; i < needFill.length; i += chunkSize) {
          const chunk = needFill.slice(i, i + chunkSize).map(({ row, idx }) => ({
            idx,
            term_en: row.term_en,
            meaning_ko: row.meaning_ko,
            pos: row.pos,
            accepted_ko: row.accepted_ko,
          }));

          const prompt =
            [
              "당신은 영어 단어 데이터의 보정기입니다.",
              "각 항목에 대해 누락된 pos(품사)와 accepted_ko(동의어/대체표기, 한국어)를 채워주세요.",
              "규칙:",
              "- 이미 값이 있으면 그대로 유지 (덮어쓰지 말 것)",
              "- pos는 간결한 표기: n., v., adj., adv., prep., pron., conj., interj. 등",
              "- accepted_ko는 쉼표로 구분된 한국어 표현",
              "- meaning_ko(첫뜻)는 변경하지 말 것",
              "- 응답은 JSON 배열만, 각 항목: { idx, pos?, accepted_ko? }",
              "",
              "입력:",
              JSON.stringify(chunk, null, 2),
            ].join("\n");

          // OpenAI 호출 (백오프/타임아웃 포함)
          const data = await callOpenAIWithBackoff({
            messages: [{ role: "user", content: prompt }],
          });

          // 방어적 파싱
          const content: string =
            data?.choices?.[0]?.message?.content?.trim() || "[]";
          const jsonText = stripCodeFence(content);

          let suggestions: Suggestion[] = [];
          try {
            suggestions = JSON.parse(jsonText) as Suggestion[];
          } catch {
            // 흔한 경우: 모델이 앞/뒤에 문장을 덧붙인 경우 → JSON만 추출 시도
            const m = jsonText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
            if (m) {
              try {
                suggestions = JSON.parse(m[0]) as Suggestion[];
              } catch {
                suggestions = [];
              }
            } else {
              suggestions = [];
            }
          }

          for (const s of suggestions) {
            const idx = Number(s.idx);
            if (Number.isInteger(idx) && filled[idx]) {
              if (!filled[idx].pos && s.pos) filled[idx].pos = norm(s.pos);
              if (!filled[idx].accepted_ko && s.accepted_ko)
                filled[idx].accepted_ko = norm(s.accepted_ko);
            }
          }

          // 각 청크 사이 약간 쉬어주면 TPM/RPM 안정화
          await zzz(150);
        }
      }
    }

    const outHeaders = [
      "book",
      "chapter",
      "term_en",
      "meaning_ko",
      "pos",
      "accepted_ko",
    ] as const;

    // CSV 생성
    const csv = Papa.unparse(
      filled.map((r) => ({
        book: r.book,
        chapter: String(r.chapter ?? "").trim(),
        term_en: r.term_en,
        meaning_ko: r.meaning_ko,
        pos: r.pos,
        accepted_ko: r.accepted_ko,
      })),
      { columns: outHeaders as unknown as string[] }
    );

    const stats = {
      ok: true,
      original_rows: originalCount,
      processed_rows: filled.length,
      filled_pos_count: filled.filter((r) => !!r.pos).length,
      filled_acc_count: filled.filter((r) => !!r.accepted_ko).length,
      book,
    };

    if (wantCsv) {
      const downloadName = `${book || "normalized"}.csv`.replace(
        /[^\w.\-가-힣\(\)\s]/g,
        "_"
      );
      return new Response(csv, { headers: csvHeaders(downloadName) });
    }

    return new Response(
      JSON.stringify(
        {
          ...stats,
          csv,
          sample: filled.slice(0, 10),
          columns: outHeaders,
        },
        null,
        2
      ),
      { headers: jsonHeaders() }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: (err as Error)?.message || String(err),
      }),
      { headers: jsonHeaders(), status: 500 }
    );
  }
}
