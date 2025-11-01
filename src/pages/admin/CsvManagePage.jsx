// src/pages/admin/CsvManagePage.jsx
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "../../utils/supabaseClient";
import { aiPrepareInBatches } from "../../utils/batchAiPrepare";

/**
 * CSV Manage Page
 * - 파일 업로드 → (클라이언트에서 CSV 파싱) → /api/csv-prepare를 배치 호출(AI 보정)
 * - 결과 미리보기 + CSV 다운로드
 * - Supabase 등록(word_batches 로그 + vocab_words 행 INSERT)
 *
 * 주의:
 * - 중복 제거하지 않습니다(요청사항 반영). INSERT만 사용.
 * - 테이블: word_batches(로그), vocab_words(실제 단어 데이터)
 */
export default function CsvManagePage() {
  const fileRef = useRef(null);

  // 옵션
  const [bookOverride, setBookOverride] = useState("");
  const [fillMissing, setFillMissing] = useState(true);

  // 상태
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0); // 배치 진행률(0~1)
  const [resultCsv, setResultCsv] = useState(""); // 변환 결과 CSV 원문(다운로드용)
  const [stats, setStats] = useState(null); // 통계
  const [rows, setRows] = useState([]); // 미리보기/등록용 행 배열
  const [errorMsg, setErrorMsg] = useState("");

  const previewRows = useMemo(() => rows.slice(0, 50), [rows]);

  /** CSV 파일을 표준 행 구조로 파싱 */
  async function parseCsvFileToRows(file, bookFallback) {
    const text = await file.text();
    // header 유무 상관없이 최대한 흡수
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    const headerMode = Array.isArray(parsed.data) && parsed.meta?.fields?.length > 0;
    let out = [];

    if (headerMode) {
      // 헤더가 있는 경우: 필드명 추정
      out = parsed.data
        .filter((r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== ""))
        .map((r) => ({
          book: (r.book ?? bookFallback ?? "").toString().trim(),
          chapter: (r.chapter ?? r.chap ?? r.unit ?? r.section ?? "").toString().trim(),
          term_en: (r.term_en ?? r.en ?? r.english ?? r.word ?? "").toString().trim(),
          meaning_ko: (r.meaning_ko ?? r.ko ?? r.korean ?? r.meaning ?? "").toString().trim(),
          pos: (r.pos ?? r.part_of_speech ?? "").toString().trim(),
          accepted_ko: (r.accepted_ko ?? r.synonyms_ko ?? r.syn_ko ?? "").toString().trim(),
        }));
    } else {
      // 헤더가 없는 경우: 단순 쉼표 분해(최대 6칸)
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      out = lines.map((line) => {
        const p = line.split(","); // 아주 단순 분해
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
        r.term_en !== "" || r.meaning_ko !== "" || r.pos !== "" || r.accepted_ko !== ""
    );
    return out;
  }

  /** CSV → 표준행 → (선택)AI 보정(배치) → rows/state 갱신 */
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

      const fallbackBook = bookOverride.trim() || file.name.replace(/\.[^.]+$/, "");
      const parsedRows = await parseCsvFileToRows(file, fallbackBook);

      let filledRows = parsedRows;
      if (fillMissing) {
        // 큰 파일도 안정적으로 변환: 배치 처리 + 진행률 + 재시도
        filledRows = await aiPrepareInBatches(parsedRows, {
          batchSize: 250, // 200~300 권장
          aiFill: true,
          book: fallbackBook,
          onProgress: (p) => setProgress(p),
        });
      }

      // 결과 CSV 생성(화면 미리보기/다운로드 공용)
      const csv = Papa.unparse(filledRows, {
        columns: ["book", "chapter", "term_en", "meaning_ko", "pos", "accepted_ko"],
      });

      setRows(filledRows);
      setResultCsv(csv);

      // 통계 계산(간단 버전)
      const total = filledRows.length;
      const withPos = filledRows.filter((r) => String(r.pos ?? "").trim() !== "").length;
      const withAcc = filledRows.filter((r) => String(r.accepted_ko ?? "").trim() !== "").length;

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

  async function registerToSupabase() {
    setErrorMsg("");
    if (!resultCsv || rows.length === 0) {
      setErrorMsg("먼저 CSV를 업로드하여 변환/보정을 완료해 주세요.");
      return;
    }

    setBusy(true);
    try {
      // 1) word_batches 로그 생성
      const batchName = `${stats?.book || "batch"} - ${new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", " ")}`;

      const { data: batch, error: e1 } = await supabase
        .from("word_batches")
        .insert({
          name: batchName,
          book: stats?.book || null,
          source_filename:
            fileRef.current?.files?.[0]?.name || "(unknown filename)",
          rows_count: rows.length,
        })
        .select()
        .single();

      if (e1) {
        throw new Error(`[word_batches.insert] ${e1.message}`);
      }

      // 2) vocab_words INSERT (중복 제거 X, INSERT만)
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK).map((r) => ({
          book: (r.book ?? "").toString().trim(),
          chapter: (r.chapter ?? "").toString().trim(), // DB가 int면 서버에서 형변환
          term_en: (r.term_en ?? "").toString().trim(),
          meaning_ko: (r.meaning_ko ?? "").toString().trim(),
          pos: (r.pos ?? "").toString().trim(),
          accepted_ko: (r.accepted_ko ?? "").toString().trim(),
          // batch_id 컬럼이 있다면:
          // batch_id: batch?.id ?? null,
        }));

        const { error: e2 } = await supabase.from("vocab_words").insert(chunk);
        if (e2) throw new Error(`[vocab_words.insert] ${e2.message}`);
      }

      alert(
        `등록 완료!\n배치: ${batch?.name}\n총 ${rows.length.toLocaleString()}건 등록`
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
        <h1 style={styles.title}>CSV 관리 (AI 자동 변환/보정)</h1>

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

          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
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

            {/* 진행률 바 */}
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
                accepted_ko 채워진 행:{" "}
                {stats.filled_acc_count?.toLocaleString?.()}
              </div>
            </div>
          )}
        </div>

        {/* 미리보기 */}
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
