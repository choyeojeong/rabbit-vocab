// src/pages/admin/CsvManagePage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "../../utils/supabaseClient";

/**
 * CSV Manage Page
 * - 파일 업로드 → 파싱 → /api/csv-prepare 소배치 호출 → 미리보기
 * - "Supabase 등록" 누르면 vocab_words 다 넣은 뒤에 word_batches 한 줄만 기록
 * - 이번 버전:
 *   1) vocab_words는 upsert + ignoreDuplicates (중복 충돌로 전체 실패 방지)
 *   2) 파일 내부 중복은 사전에 dedupe(스킵 카운트 표시)
 *   3) DB 중복으로 인해 upsert에서 무시된 건수도 추정(= inserted rows 길이로 계산)해서 표시
 *   4) word_batches 기록 뒤에 변환된 CSV도 storage(csv_uploads/{batch.id}.csv)에 저장
 */
export default function CsvManagePage() {
  const fileRef = useRef(null);

  // 옵션
  const [bookOverride, setBookOverride] = useState("");
  const [fillMissing, setFillMissing] = useState(true);

  // 업로드 기록에서 넘어온 정보(?batchId=..&book=..&chapter=..)
  const [linkedBatchInfo, setLinkedBatchInfo] = useState(null);
  const [linkedChapter, setLinkedChapter] = useState("");

  // 상태
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultCsv, setResultCsv] = useState("");
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");

  // ✅ 등록 결과(중복 스킵 등) 표시
  const [registerReport, setRegisterReport] = useState(null);
  // { attemptedUnique, inserted, skippedFileDup, skippedDbDup, batchId }

  // 쿼리스트링 읽어서 기본값 세팅
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const batchId = sp.get("batchId");
    const book = sp.get("book");
    const chapter = sp.get("chapter");
    if (batchId || book || chapter) {
      setLinkedBatchInfo({
        batchId: batchId || null,
        book: book || "",
      });
      if (book) setBookOverride(book);
      if (chapter) setLinkedChapter(chapter);
    }
  }, []);

  const previewRows = useMemo(() => rows.slice(0, 50), [rows]);

  // 공통: chapter를 안전하게 숫자로 바꾸기
  function toSafeChapter(val) {
    if (val === undefined || val === null || val === "") return null;
    const n = Number(val);
    if (Number.isNaN(n)) return null;
    return n;
  }

  // ✅ 키 정규화 (중복 판별용)
  function normTerm(v) {
    return (v ?? "").toString().trim().toLowerCase();
  }
  function normBook(v) {
    return (v ?? "").toString().trim();
  }
  function makeKey(book, chapter, term) {
    const b = normBook(book);
    const ch = toSafeChapter(chapter);
    const t = normTerm(term);
    return `${b}__${ch ?? "null"}__${t}`;
  }

  // ✅ 파일 내부 중복 제거 + (가능하면) 정보 보강 병합
  // - 같은 key가 여러 번 나오면:
  //   1) meaning_ko/pos/accepted_ko가 비어있으면 뒤의 값으로 채우기
  //   2) accepted_ko는 콤마로 합치기(중복 제거)
  function dedupeRowsWithMerge(inputRows) {
    const map = new Map();
    let dupCount = 0;

    const splitAccepted = (s) =>
      (s ?? "")
        .toString()
        .split(/[,\|;]/g)
        .map((x) => x.trim())
        .filter(Boolean);

    for (const r of inputRows) {
      const key = makeKey(r.book, r.chapter, r.term_en);
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, { ...r });
      } else {
        dupCount += 1;
        const cur = map.get(key);

        // 빈 값이면 보강
        if (!String(cur.meaning_ko ?? "").trim() && String(r.meaning_ko ?? "").trim()) {
          cur.meaning_ko = r.meaning_ko;
        }
        if (!String(cur.pos ?? "").trim() && String(r.pos ?? "").trim()) {
          cur.pos = r.pos;
        }

        // accepted_ko는 합치기
        const a = new Set([...splitAccepted(cur.accepted_ko), ...splitAccepted(r.accepted_ko)]);
        cur.accepted_ko = Array.from(a).join(", ");

        map.set(key, cur);
      }
    }

    return { deduped: Array.from(map.values()), dupCount };
  }

  /** CSV 파일을 표준 행 구조로 파싱 */
  async function parseCsvFileToRows(file, bookFallback) {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const headerMode =
      Array.isArray(parsed.data) && parsed.meta?.fields?.length > 0;
    let out = [];

    if (headerMode) {
      out = parsed.data
        .filter(
          (r) =>
            r && Object.values(r).some((v) => String(v ?? "").trim() !== "")
        )
        .map((r) => {
          const chapterRaw =
            r.chapter ??
            r.index ??
            r.chap ??
            r.unit ??
            r.section ??
            "";

          return {
            book: (r.book ?? bookFallback ?? "").toString().trim(),
            chapter: chapterRaw.toString().trim(),
            term_en: (r.term_en ?? r.en ?? r.english ?? r.word ?? "")
              .toString()
              .trim(),
            meaning_ko: (r.meaning_ko ?? r.ko ?? r.korean ?? r.meaning ?? "")
              .toString()
              .trim(),
            pos: (r.pos ?? r.part_of_speech ?? "").toString().trim(),
            accepted_ko: (r.accepted_ko ?? r.synonyms_ko ?? r.syn_ko ?? "")
              .toString()
              .trim(),
          };
        });
    } else {
      // 헤더가 없는 CSV일 때
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      out = lines.map((line) => {
        const p = line.split(",");
        return {
          book: (p[0] ?? bookFallback ?? "").toString().trim(),
          chapter: (p[1] ?? "").toString().trim(),
          term_en: (p[2] ?? "").toString().trim(),
          meaning_ko: (p[3] ?? "").toString().trim(),
          pos: (p[4] ?? "").toString().trim(),
          accepted_ko: (p[5] ?? "").toString().trim(),
        };
      });
    }

    // 빈 행 제거
    out = out.filter(
      (r) =>
        r.term_en !== "" ||
        r.meaning_ko !== "" ||
        r.pos !== "" ||
        r.accepted_ko !== ""
    );

    // 미리보기에서는 비어 있으면 0으로만 보이게
    out = out.map((r) => ({
      ...r,
      chapter: r.chapter === "" ? "0" : r.chapter,
    }));

    return out;
  }

  /** 아주 작은 소배치(3줄)를 /api/csv-prepare로 보내서 AI 보정 */
  async function postSmallBatch(rowsChunk, { book, aiFill }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const resp = await fetch("/api/csv-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rowsChunk,
          book,
          aiFill,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        return rowsChunk;
      }

      const data = await resp.json().catch(() => ({}));
      if (Array.isArray(data?.rows) && data.rows.length) {
        return data.rows;
      }

      return rowsChunk;
    } catch (e) {
      clearTimeout(timer);
      return rowsChunk;
    }
  }

  /** 큰 배열을 3줄씩 순차 처리 */
  async function prepareInTinyBatches(allRows, { book, aiFill, onProgress }) {
    const MAX_PER_REQ = 3;
    const out = [];
    const total = allRows.length || 0;
    let done = 0;

    for (let i = 0; i < total; i += MAX_PER_REQ) {
      const chunk = allRows.slice(i, i + MAX_PER_REQ);
      const converted = await postSmallBatch(chunk, { book, aiFill });
      out.push(...converted);
      done += chunk.length;
      if (onProgress) onProgress(done, total);
    }

    if (onProgress) onProgress(total, total);
    return out;
  }

  /** 업로드 핸들러 */
  async function handleUpload() {
    setErrorMsg("");
    setStats(null);
    setResultCsv("");
    setRows([]);
    setProgress(0);
    setRegisterReport(null);
    setBusy(true);

    try {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setErrorMsg("CSV 파일을 선택해주세요.");
        setBusy(false);
        return;
      }

      const fallbackBook =
        (bookOverride || file.name.replace(/\.[^.]+$/, "")).trim();
      const parsedRows = await parseCsvFileToRows(file, fallbackBook);

      let filledRows = parsedRows;

      if (fillMissing) {
        filledRows = await prepareInTinyBatches(parsedRows, {
          book: fallbackBook,
          aiFill: true,
          onProgress: (done, total) => {
            const pct = total > 0 ? done / total : 1;
            setProgress(pct);
          },
        });
      }

      // pos 후처리
      const postProcessed = filledRows.map((r) => {
        let pos = (r.pos || "").trim();
        const ko = (r.meaning_ko || "").trim();

        if (!pos) {
          if (
            ko.endsWith("의") ||
            ko.endsWith("적인") ||
            ko.endsWith("스러운") ||
            ko.endsWith("스러워하는")
          ) {
            pos = "형용사";
          }
        }

        return {
          ...r,
          pos,
        };
      });

      const csv = Papa.unparse(
        postProcessed.map((r) => ({
          ...r,
          chapter: r.chapter === "" ? "0" : r.chapter,
        })),
        {
          columns: ["book", "chapter", "term_en", "meaning_ko", "pos", "accepted_ko"],
        }
      );

      setRows(postProcessed);
      setResultCsv(csv);

      const total = postProcessed.length;
      const withPos = postProcessed.filter(
        (r) => String(r.pos ?? "").trim() !== ""
      ).length;
      const withAcc = postProcessed.filter(
        (r) => String(r.accepted_ko ?? "").trim() !== ""
      ).length;

      setStats({
        book: fallbackBook,
        original_rows: parsedRows.length,
        processed_rows: total,
        filled_pos_count: withPos,
        filled_acc_count: withAcc,
      });
    } catch (e) {
      setErrorMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!resultCsv) return;
    const fname = `${stats?.book || "normalized"}.csv`;
    const blob = new Blob([resultCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = fname;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 1) vocab_words upsert(ignoreDuplicates)로 등록
   *    - 파일 내부 중복은 사전에 dedupe하여 스킵(카운트 표시)
   *    - DB에 이미 있는 동일 키는 upsert(ignoreDuplicates)로 자동 스킵(카운트 표시)
   * 2) 성공하면 word_batches 한 줄 기록
   * 3) 그리고 변환된 CSV를 storage(csv_uploads/{batch.id}.csv)에 업로드
   */
  async function registerToSupabase() {
    setErrorMsg("");
    setRegisterReport(null);

    if (!resultCsv || rows.length === 0) {
      setErrorMsg("먼저 CSV를 업로드하여 변환/보정을 완료해 주세요.");
      return;
    }

    setBusy(true);
    setProgress(0);

    try {
      const CHUNK = 500;

      // ✅ 최종 저장될 book명(선택값 우선)
      const finalBook = (bookOverride || stats?.book || "unknown").toString().trim();

      // ✅ 등록용 정규화 rows 만들기
      const normalized = rows.map((r) => {
        const rawChapter = r.chapter ?? r.index ?? "";
        const pos = (r.pos ?? "").toString().trim() || "기타";
        const accepted_ko = (r.accepted_ko ?? "").toString().trim() || null;

        return {
          book: finalBook, // ✅ bookOverride/선택 book으로 강제 통일
          chapter: toSafeChapter(rawChapter),
          term_en: (r.term_en ?? "").toString().trim(),
          meaning_ko: (r.meaning_ko ?? "").toString().trim(),
          pos,
          accepted_ko,
        };
      });

      // ✅ 파일 내부 중복 제거(병합) + 카운트
      const { deduped, dupCount: skippedFileDup } = dedupeRowsWithMerge(normalized);

      // ✅ DB upsert(ignoreDuplicates)로 등록
      // - chunk마다 inserted 개수를 받아서 "DB 중복으로 스킵된 수" 계산
      let attemptedUnique = 0;
      let inserted = 0;

      for (let i = 0; i < deduped.length; i += CHUNK) {
        const chunk = deduped.slice(i, i + CHUNK);

        // key가 완전히 비어있는 행은 제외(안전)
        const safeChunk = chunk.filter(
          (r) =>
            String(r.book ?? "").trim() &&
            String(r.term_en ?? "").trim() &&
            r.chapter !== null &&
            r.chapter !== undefined
        );

        attemptedUnique += safeChunk.length;

        // ✅ 핵심: upsert + ignoreDuplicates
        const { data, error: e2 } = await supabase
          .from("vocab_words")
          .upsert(safeChunk, {
            onConflict: "book,chapter,term_en",
            ignoreDuplicates: true,
          })
          .select("id"); // ✅ inserted row 수 추정용

        if (e2) {
          throw new Error(`[vocab_words.upsert] ${e2.message}`);
        }

        inserted += Array.isArray(data) ? data.length : 0;

        // 진행률(등록 단계는 0~1로)
        const done = Math.min(i + CHUNK, deduped.length);
        setProgress(deduped.length > 0 ? done / deduped.length : 1);
      }

      const skippedDbDup = Math.max(0, attemptedUnique - inserted);

      // 2) word_batches 기록
      const { data: batch, error: e1 } = await supabase
        .from("word_batches")
        .insert({
          filename: fileRef.current?.files?.[0]?.name || "(unknown filename)",
          book: finalBook,
          chapter: linkedChapter ? toSafeChapter(linkedChapter) : 0,
          total_rows: rows.length,
        })
        .select()
        .single();

      if (e1) {
        throw new Error(
          `[word_batches.insert] 단어는 저장됐지만 기록은 못 남겼습니다: ${e1.message}`
        );
      }

      // 3) Storage 업로드
      if (resultCsv && batch?.id) {
        const csvBlob = new Blob([resultCsv], {
          type: "text/csv;charset=utf-8",
        });
        const storagePath = `${batch.id}.csv`;

        const { error: uploadErr } = await supabase.storage
          .from("csv_uploads")
          .upload(storagePath, csvBlob, {
            upsert: true, // 같은 id로 다시 등록할 때 덮어쓰기
            contentType: "text/csv",
          });

        if (uploadErr) {
          alert(
            "CSV는 테이블에 저장됐지만 Storage 업로드는 실패했습니다.\n" +
              uploadErr.message +
              "\n\nStorage 버킷(csv_uploads)에 insert 권한이 있는지 확인해 주세요."
          );
        }
      }

      // ✅ UI 표시용 리포트 저장
      setRegisterReport({
        attemptedUnique,
        inserted,
        skippedFileDup,
        skippedDbDup,
        batchId: batch?.id || null,
        book: finalBook,
      });

      alert(
        `등록 완료!\n배치ID: ${batch?.id}\n` +
          `유니크 기준 시도: ${attemptedUnique.toLocaleString()}건\n` +
          `신규 등록: ${inserted.toLocaleString()}건\n` +
          `중복 스킵(파일): ${skippedFileDup.toLocaleString()}건\n` +
          `중복 스킵(DB): ${skippedDbDup.toLocaleString()}건`
      );
    } catch (e) {
      setErrorMsg(e.message || String(e));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <h1 style={styles.title}>
          CSV 관리 (AI 자동 변환/보정)
          <a
            href="/admin/csv/batches"
            style={{ marginLeft: 12, fontSize: 13, color: "#ff6fa3" }}
          >
            업로드 기록 보기 →
          </a>
        </h1>

        {linkedBatchInfo && (
          <div
            style={{
              background: "#ecfeff",
              border: "1px solid #bae6fd",
              borderRadius: 8,
              padding: 8,
              marginTop: 8,
              marginBottom: 8,
              fontSize: 13,
            }}
          >
            업로드 기록에서 넘어온 배치입니다.
            {linkedBatchInfo.batchId && (
              <> (batchId: {linkedBatchInfo.batchId})</>
            )}
            <br />
            이 페이지에서 파일을 다시 업로드한 뒤 “Supabase 등록”을 눌러주세요.
          </div>
        )}

        <div style={styles.card}>
          <div style={styles.row}>
            <div style={styles.col}>
              <label style={styles.label}>CSV 파일</label>
              <input ref={fileRef} type="file" accept=".csv" />
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                어떤 형식이든 그대로 올리면 됩니다. (중복 제거 안 함)
              </div>
            </div>

            <div style={styles.col}>
              <label style={styles.label}>book 이름(선택)</label>
              <input
                value={bookOverride}
                onChange={(e) => setBookOverride(e.target.value)}
                placeholder="(지정하지 않으면 파일명으로 사용)"
                style={styles.input}
              />
              {linkedChapter ? (
                <div style={{ fontSize: 12, marginTop: 4, color: "#6b7280" }}>
                  ※ 이 배치는 chapter {linkedChapter} 로 넘어왔습니다.
                </div>
              ) : null}
            </div>

            <div style={styles.col}>
              <label style={styles.label}>AI 보정</label>
              <label style={styles.check}>
                <input
                  type="checkbox"
                  checked={fillMissing}
                  onChange={(e) => setFillMissing(e.target.checked)}
                />
                <span style={{ marginLeft: 8 }}>
                  비어 있는 pos/accepted_ko 채우기
                </span>
              </label>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 12,
              alignItems: "center",
            }}
          >
            <button onClick={handleUpload} disabled={busy} style={styles.btn}>
              {busy ? "처리 중..." : "AI 변환 실행"}
            </button>

            <button
              onClick={downloadCsv}
              disabled={!resultCsv || busy}
              style={styles.btnSecondary}
            >
              결과 CSV 다운로드
            </button>

            <button
              onClick={registerToSupabase}
              disabled={!resultCsv || rows.length === 0 || busy}
              style={styles.btnPrimary}
            >
              Supabase 등록
            </button>

            {busy && (
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ height: 8, background: "#eee", borderRadius: 6 }}>
                  <div
                    style={{
                      width: `${Math.round(progress * 100)}%`,
                      height: 8,
                      borderRadius: 6,
                      background: "#ff6fa3",
                      transition: "width .2s",
                    }}
                  />
                </div>
                <small style={{ color: "#6b7280" }}>
                  {Math.round(progress * 100)}%
                </small>
              </div>
            )}
          </div>

          {errorMsg && (
            <div style={styles.error}>
              <strong>오류:</strong> {errorMsg}
            </div>
          )}

          {stats && (
            <div style={styles.stats}>
              <div>📘 book: {stats.book}</div>
              <div>원본 행 수: {stats.original_rows?.toLocaleString?.()}</div>
              <div>처리 행 수: {stats.processed_rows?.toLocaleString?.()}</div>
              <div>pos 채워진 행: {stats.filled_pos_count?.toLocaleString?.()}</div>
              <div>
                accepted_ko 채워진 행: {stats.filled_acc_count?.toLocaleString?.()}
              </div>
            </div>
          )}

          {/* ✅ 등록 결과 리포트 (중복 스킵 N개) */}
          {registerReport && (
            <div style={styles.report}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>
                ✅ 등록 결과 (중복 스킵 포함)
              </div>
              <div style={styles.reportGrid}>
                <div>📘 book</div>
                <div>{registerReport.book}</div>

                <div>유니크 기준 시도</div>
                <div>{registerReport.attemptedUnique.toLocaleString()}건</div>

                <div>신규 등록</div>
                <div>{registerReport.inserted.toLocaleString()}건</div>

                <div>중복 스킵(파일 내부)</div>
                <div>{registerReport.skippedFileDup.toLocaleString()}건</div>

                <div>중복 스킵(DB 기존)</div>
                <div>{registerReport.skippedDbDup.toLocaleString()}건</div>

                <div>배치 ID</div>
                <div>{registerReport.batchId || "-"}</div>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                ※ “파일 내부 중복”은 업로드 파일 안에서 (book+chapter+term_en)이 반복된 경우이고, <br />
                “DB 기존 중복”은 이미 DB에 있던 동일 키가 upsert(ignoreDuplicates)로 자동 스킵된 경우입니다.
              </div>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div style={styles.card}>
            <div style={styles.subhead}>
              <div style={{ fontWeight: 800 }}>미리보기 (상위 50행)</div>
              <div style={{ color: "#6b7280" }}>
                총 {rows.length.toLocaleString()}건 중
              </div>
            </div>

            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th>book</th>
                    <th>chapter</th>
                    <th>term_en</th>
                    <th>meaning_ko</th>
                    <th>pos</th>
                    <th>accepted_ko</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.book}</td>
                      <td>{r.chapter}</td>
                      <td>{r.term_en}</td>
                      <td>{r.meaning_ko}</td>
                      <td>{r.pos}</td>
                      <td>{r.accepted_ko}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 16 },
  wrap: { maxWidth: 1100, margin: "0 auto" },
  title: { fontSize: 22, fontWeight: 900, color: "#1f2a44" },
  card: {
    background: "#fff",
    border: "1px solid #e9eef5",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 12,
  },
  col: {},
  label: { display: "block", fontSize: 13, color: "#374151", marginBottom: 6 },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #ffd3e3",
    borderRadius: 8,
    outline: "none",
    fontSize: 14,
  },
  check: { display: "flex", alignItems: "center" },
  btn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #ffd3e3",
    background: "#ffe6ef",
    fontWeight: 800,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  btnPrimary: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #ff6fa3",
    background: "#ff6fa3",
    color: "#fff",
    fontWeight: 800,
    cursor: "pointer",
  },
  error: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    color: "#9f1239",
  },
  stats: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: 8,
    fontSize: 14,
    color: "#374151",
  },
  report: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#065f46",
  },
  reportGrid: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: 6,
    fontSize: 14,
  },
  subhead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  tableWrap: {
    width: "100%",
    overflow: "auto",
    border: "1px solid #e9eef5",
    borderRadius: 8,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
};
