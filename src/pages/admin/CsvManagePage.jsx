// src/pages/admin/CsvManagePage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "../../utils/supabaseClient";

/**
 * CSV Manage Page
 * - 파일 업로드 → 파싱 → /api/csv-prepare 소배치 호출 → 미리보기
 * - "Supabase 등록" 누르면 vocab_words 다 넣은 뒤에 word_batches 한 줄만 기록
 *   → 이렇게 하면 등록 실패한 건 업로드 기록에 안 남음
 */
export default function CsvManagePage() {
  const fileRef = useRef(null);

  // 옵션
  const [bookOverride, setBookOverride] = useState("");
  const [fillMissing, setFillMissing] = useState(true);

  // 쿼리 파라미터에서 넘어온 배치 정보
  const [linkedBatchInfo, setLinkedBatchInfo] = useState(null);
  const [linkedChapter, setLinkedChapter] = useState("");

  // 상태
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultCsv, setResultCsv] = useState("");
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");

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
        .map((r) => ({
          book: (r.book ?? bookFallback ?? "").toString().trim(),
          chapter: (r.chapter ?? r.chap ?? r.unit ?? r.section ?? "")
            .toString()
            .trim(),
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
        }));
    } else {
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

    return out;
  }

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

  async function handleUpload() {
    setErrorMsg("");
    setStats(null);
    setResultCsv("");
    setRows([]);
    setProgress(0);
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

      const csv = Papa.unparse(filledRows, {
        columns: ["book", "chapter", "term_en", "meaning_ko", "pos", "accepted_ko"],
      });

      setRows(filledRows);
      setResultCsv(csv);

      const total = filledRows.length;
      const withPos = filledRows.filter(
        (r) => String(r.pos ?? "").trim() !== ""
      ).length;
      const withAcc = filledRows.filter(
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
   * ✅ 여기서 순서 변경
   * 1) vocab_words 쪼개서 전부 insert
   * 2) 전부 성공하면 word_batches 에 1줄 insert
   * → 이렇게 해야 “진짜 등록된 것만” 업로드 기록 페이지에 보임
   */
  async function registerToSupabase() {
    setErrorMsg("");
    if (!resultCsv || rows.length === 0) {
      setErrorMsg("먼저 CSV를 업로드하여 변환/보정을 완료해 주세요.");
      return;
    }

    setBusy(true);
    try {
      // 1) vocab_words 먼저 넣기
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK).map((r) => ({
          book: (r.book ?? "").toString().trim(),
          chapter: Number(r.chapter) || null,
          term_en: (r.term_en ?? "").toString().trim(),
          meaning_ko: (r.meaning_ko ?? "").toString().trim(),
          pos: (r.pos ?? "").toString().trim(),
          accepted_ko: (r.accepted_ko ?? "").toString().trim(),
          // batch_id: 나중에 word_batches.insert 결과 사용해서 다시 업데이트할 거면 여기서 안 넣고 넘어감
        }));

        const { error: e2 } = await supabase.from("vocab_words").insert(chunk);
        if (e2) throw new Error(`[vocab_words.insert] ${e2.message}`);
      }

      // 2) 전부 성공했으니까 이제 word_batches 기록 남기기
      const { data: batch, error: e1 } = await supabase
        .from("word_batches")
        .insert({
          filename: fileRef.current?.files?.[0]?.name || "(unknown filename)",
          book: stats?.book || bookOverride || null,
          chapter: linkedChapter ? Number(linkedChapter) || null : null,
          total_rows: rows.length,
        })
        .select()
        .single();

      if (e1) {
        // 여기서 실패해도 단어는 이미 들어갔으니 그냥 메시지만 보여줌
        throw new Error(
          `[word_batches.insert] 단어는 저장됐지만 기록은 못 남겼습니다: ${e1.message}`
        );
      }

      alert(
        `등록 완료!\n배치ID: ${batch?.id}\n총 ${rows.length.toLocaleString()}건 등록`
      );
    } catch (e) {
      setErrorMsg(e.message || String(e));
    } finally {
      setBusy(false);
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
                <span style={{ marginLeft: 8 }}>비어 있는 pos/accepted_ko 채우기</span>
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
