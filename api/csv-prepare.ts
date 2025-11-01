// /api/csv-prepare.ts
export const config = { runtime: "nodejs" };

/**
 * Rabbit Vocab CSV Preparer (Serverless / Node.js)
 * - Accepts:
 *   A) multipart/form-data with 'file'   (※ 요청당 최대 16행만 처리)
 *   B) application/json { rows: RowLike[], book?: string, aiFill?: boolean }
 * - Normalizes to: book,chapter,term_en,meaning_ko,pos,accepted_ko
 * - Fills missing 'pos' and 'accepted_ko' via OpenAI (when fillMissing/aiFill true)
 * - Does NOT deduplicate rows
 * - Returns JSON (default) and includes both `rows` and `csv` for compatibility.
 */

import Papa from "papaparse";

// ---------- limits (타임아웃 방지 핵심) ----------
const MAX_INPUT_ROWS = Number(process.env.CSV_PREPARE_MAX_INPUT || 8);  // 요청당 최대 16행
const OPENAI_SUB_CHUNK = Number(process.env.CSV_PREPARE_CHUNK_SIZE || 4); // OpenAI 보정 소배치
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

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

/** sleep(ms) */
const zzz = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with timeout via AbortController */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 7000, ...rest } = init; // Vercel 10s 가드 내
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
async function callOpenAIWithBackoff(body: any, maxRetries = 2) {
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" }, // JSON 강제
    ...body,
  };

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    const res = await fetchWithTimeout(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      timeoutMs: 7000, // 호출당 8.5s
    });

    if (res.ok) {
      try {
        const data = await res.json();
        return data;
      } catch {
        const text = await res.text();
        throw new Error(`OpenAI JSON parse failed: ${text.slice(0, 300)}`);
      }
    }

    if ((res.status === 429 || res.status >= 500) && attempt <= maxRetries) {
      const ra = res.headers.get("retry-after");
      const reset = res.headers.get("x-ratelimit-reset-tokens");
      const waitSec = ra ? Number(ra) : reset ? Number(reset) : Math.min(8, 2 ** attempt);
      await zzz(Math.max(0.4, waitSec) * 1000);
      continue;
    }

    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch { /* ignore */ }
    throw new Error(`OpenAI error ${res.status}: ${bodyText.slice(0, 500)}`);
  }
}

// ---------- normalization from flexible objects ----------
function normalizeFromObjects(src: RowIn[], fallbackBook: string): RowOut[] {
  if (!Array.isArray(src) || src.length === 0) return [];
  const first = src[0] || {};
  const headers = Object.keys(first);

  const col_chapter =
    pickColumn(headers, ["chapter","챕터","unit","lesson","day","index","idx","번호","단원","레슨","유닛","강"]) ?? undefined;

  const col_word =
    pickColumn(headers, ["word","term","영단어","단어","english","en","term_en"]) ?? undefined;

  const col_mean =
    pickColumn(headers, ["mean","meaning","뜻","국문뜻","ko","korean","의미","meaning_ko"]) ?? undefined;

  const col_pos = pickColumn(headers, ["pos","품사","part of speech"]) ?? undefined;

  const col_acc =
    pickColumn(headers, ["accepted","accepted_ko","synonyms","동의어","유의어","수용표기","대체표기","etc"]) ?? undefined;

  const out = src.map((r, i) => {
    const term_en = norm(col_word ? r[col_word] : (r as any)["word"]);
    const [meaning_ko, accRest] = splitMeaning(col_mean ? r[col_mean] : (r as any)["mean"]);
    const accepted_raw = norm(col_acc ? r[col_acc] : "");
    const accepted_ko = accepted_raw || accRest || "";
    const pos = norm(col_pos ? r[col_pos] : "");
    const chapterRaw = norm(col_chapter ? r[col_chapter] : "");
    const chapter = toDigits(chapterRaw);

    const bookInRow =
      norm((r as any)["book"]) ||
      norm((r as any)["Book"]) ||
      norm((r as any)["책"]) || "";

    return {
      book: bookInRow || fallbackBook,
      chapter,
      term_en,
      meaning_ko,
      pos,
      accepted_ko,
      _row: i + 1,
    };
  });

  return out;
}

// ---------- main handler ----------
export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Use POST (multipart 'file' or JSON {rows, book, aiFill})." }),
      { headers: jsonHeaders(), status: 405 }
    );
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      // 키가 없어도 normalize만 하게 허용할지 선택. 여기선 허용(보정 스킵).
      // return new Response(JSON.stringify({ ok:false, error:"OPENAI_API_KEY missing" }), { headers: jsonHeaders(), status: 500 });
    }

    const url = new URL(req.url);
    const wantCsv = url.searchParams.get("format") === "csv";
    const bookOverride = url.searchParams.get("book") || "";
    const fillMissingQuery = url.searchParams.get("fillMissing");
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : null;

    const contentType = req.headers.get("content-type") || "";

    let bookFromInput = "";
    let aiFillFromInput: boolean | undefined = undefined;
    let normalized: RowOut[] = [];
    let originalCount = 0;
    let filename = "uploaded.csv";
    let partial = false;

    if (contentType.includes("multipart/form-data")) {
      // --------- A) multipart: CSV 파일 업로드 ----------
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) {
        return new Response(
          JSON.stringify({ ok: false, error: "No file. Use 'file' field." }),
          { headers: jsonHeaders(), status: 400 }
        );
      }
      filename = file.name || "uploaded.csv";
      const book = norm(bookOverride) || filename.replace(/\.[^.]+$/, "").trim();
      bookFromInput = book;

      const text = await file.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true }) as any;

      const rows: RowIn[] = Array.isArray(parsed.data) ? parsed.data : [];
      originalCount = rows.length;
      if (!originalCount) {
        return new Response(
          JSON.stringify({ ok: false, error: "CSV has no rows." }),
          { headers: jsonHeaders(), status: 400 }
        );
      }

      let usable = rows;
      // 요청당 최대 처리 행수 제한
      if (usable.length > MAX_INPUT_ROWS) {
        usable = usable.slice(0, MAX_INPUT_ROWS);
        partial = true;
      }
      const limited = limit && Number.isFinite(limit) && limit > 0 ? usable.slice(0, limit) : usable;
      normalized = normalizeFromObjects(limited, bookFromInput);
    } else {
      // --------- B) JSON: { rows, book?, aiFill? } ----------
      let body: any = null;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid JSON. Send { rows: Row[], book?: string, aiFill?: boolean }" }),
          { headers: jsonHeaders(), status: 400 }
        );
      }

      const rowsIn: RowIn[] = Array.isArray(body?.rows) ? body.rows : [];
      if (!rowsIn.length) {
        return new Response(
          JSON.stringify({ ok: false, error: "rows[] is required." }),
          { headers: jsonHeaders(), status: 400 }
        );
      }

      originalCount = rowsIn.length;
      aiFillFromInput = typeof body?.aiFill === "boolean" ? body.aiFill : undefined;
      bookFromInput = norm(body?.book) || norm(bookOverride) || "book";

      let usable = rowsIn;
      if (usable.length > MAX_INPUT_ROWS) {
        usable = usable.slice(0, MAX_INPUT_ROWS);
        partial = true;
      }
      const limited =
        limit && Number.isFinite(limit) && limit > 0 ? usable.slice(0, limit) : usable;
      normalized = normalizeFromObjects(limited, bookFromInput);
    }

    // ====== OpenAI 보정 (pos/accepted_ko) ======
    const fillMissing =
      typeof aiFillFromInput === "boolean"
        ? aiFillFromInput
        : fillMissingQuery === "false"
        ? false
        : true;

    let filled: RowOut[] = normalized.slice();

    if (fillMissing && (process.env.OPENAI_API_KEY || "").trim()) {
      const needFill = normalized
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => !row.pos || !row.accepted_ko);

      if (needFill.length > 0) {
        for (let i = 0; i < needFill.length; i += OPENAI_SUB_CHUNK) {
          const chunk = needFill.slice(i, i + OPENAI_SUB_CHUNK).map(({ row, idx }) => ({
            idx,
            term_en: row.term_en,
            meaning_ko: row.meaning_ko,
            pos: row.pos,
            accepted_ko: row.accepted_ko,
          }));

          const sys =
            'You transform vocabulary rows to fill missing "pos" (e.g., n., v., adj., adv., prep., pron., conj., interj.) and "accepted_ko" (comma-separated Korean synonyms). Keep existing values. Output STRICT JSON with array "rows": [{idx, pos?, accepted_ko?}].';
          const data = await callOpenAIWithBackoff({
            messages: [
              { role: "system", content: sys },
              { role: "user", content: JSON.stringify({ rows: chunk }) },
            ],
          });

          const content: string = data?.choices?.[0]?.message?.content?.trim() || "{}";
          const jsonText = stripCodeFence(content);
          let suggestions: { rows?: Suggestion[] } = {};
          try {
            suggestions = JSON.parse(jsonText);
          } catch {
            suggestions = {};
          }
          const arr = Array.isArray(suggestions?.rows) ? suggestions.rows! : [];

          for (const s of arr) {
            const idx = Number(s.idx);
            if (Number.isInteger(idx) && filled[idx]) {
              if (!filled[idx].pos && s.pos) filled[idx].pos = norm(s.pos);
              if (!filled[idx].accepted_ko && s.accepted_ko)
                filled[idx].accepted_ko = norm(s.accepted_ko);
            }
          }

          // 소배치 사이 잠깐 대기 (레이트 리밋/타임아웃 방지)
          await zzz(150);
        }
      }
    }

    const outHeaders = ["book","chapter","term_en","meaning_ko","pos","accepted_ko"] as const;

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
      book: bookFromInput,
      partial, // true면: 더 쪼개서 다시 호출 필요
      max_per_request: MAX_INPUT_ROWS,
      sub_chunk: OPENAI_SUB_CHUNK,
    };

    if (wantCsv) {
      const downloadName = `${bookFromInput || "normalized"}.csv`.replace(
        /[^\w.\-가-힣\(\)\s]/g, "_"
      );
      return new Response(csv, { headers: csvHeaders(downloadName) });
    }

    // JSON 응답: rows + csv + stats 동시 제공 (클라이언트 호환)
    return new Response(
      JSON.stringify({ ...stats, rows: filled, csv, columns: outHeaders }, null, 2),
      { headers: jsonHeaders() }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error)?.message || String(err) }),
      { headers: jsonHeaders(), status: 500 }
    );
  }
}
