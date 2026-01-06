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
 *
 * ✅ 요청 반영(UI)
 * - 가운데 흰색 카드(고정 폭 박스) 느낌 최소화: "풀-폭" 레이아웃(최대폭만 넓게) + sticky header
 * - iPhone 모바일 최적화:
 *   - safe-area(노치/홈바) 대응
 *   - 버튼 44px 터치 타겟
 *   - 3열 그리드 → 모바일에서 1열로 자동 변경
 *   - 표는 가로 스크롤 유지
 * - 기능/로직은 그대로 유지
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
  // { attemptedUnique, inserted, skippedFileDup, skippedDbDup, batchId, book }

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
    const headerMode = Array.isArray(parsed.data) && parsed.meta?.fields?.length > 0;
    let out = [];

    if (headerMode) {
      out = parsed.data
        .filter((r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== ""))
        .map((r) => {
          const chapterRaw = r.chapter ?? r.index ?? r.chap ?? r.unit ?? r.section ?? "";

          return {
            book: (r.book ?? bookFallback ?? "").toString().trim(),
            chapter: chapterRaw.toString().trim(),
            term_en: (r.term_en ?? r.en ?? r.english ?? r.word ?? "").toString().trim(),
            meaning_ko: (r.meaning_ko ?? r.ko ?? r.korean ?? r.meaning ?? "").toString().trim(),
            pos: (r.pos ?? r.part_of_speech ?? "").toString().trim(),
            accepted_ko: (r.accepted_ko ?? r.synonyms_ko ?? r.syn_ko ?? "").toString().trim(),
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
      (r) => r.term_en !== "" || r.meaning_ko !== "" || r.pos !== "" || r.accepted_ko !== ""
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

      const fallbackBook = (bookOverride || file.name.replace(/\.[^.]+$/, "")).trim();
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
      const withPos = postProcessed.filter((r) => String(r.pos ?? "").trim() !== "").length;
      const withAcc = postProcessed.filter((r) => String(r.accepted_ko ?? "").trim() !== "").length;

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

        const { data, error: e2 } = await supabase
          .from("vocab_words")
          .upsert(safeChunk, {
            onConflict: "book,chapter,term_en",
            ignoreDuplicates: true,
          })
          .select("id"); // inserted row 수 추정용

        if (e2) {
          throw new Error(`[vocab_words.upsert] ${e2.message}`);
        }

        inserted += Array.isArray(data) ? data.length : 0;

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
        const csvBlob = new Blob([resultCsv], { type: "text/csv;charset=utf-8" });
        const storagePath = `${batch.id}.csv`;

        const { error: uploadErr } = await supabase.storage.from("csv_uploads").upload(storagePath, csvBlob, {
          upsert: true,
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

  const canRunAi = !busy;
  const canDownload = !!resultCsv && !busy;
  const canRegister = !!resultCsv && rows.length > 0 && !busy;

  return (
    <div style={styles.page}>
      {/* ✅ sticky header (풀-폭) */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.headerTop}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.titleRow}>
                <div style={styles.title}>CSV 관리 (AI 자동 변환/보정)</div>
                <a href="/admin/csv/batches" style={styles.link}>
                  업로드 기록 보기 →
                </a>
              </div>
              <div style={styles.sub}>
                파일 업로드 → (선택)AI 보정 → 미리보기 → Supabase 등록(word_batches + storage 업로드)
              </div>
            </div>

            <div style={styles.headerBtns}>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!canRunAi}
                style={styles.btnPink}
                title="선택한 CSV를 파싱하고(선택 시) AI 보정을 수행합니다."
              >
                {busy ? "처리 중…" : "AI 변환 실행"}
              </button>
            </div>
          </div>

          {linkedBatchInfo && (
            <div style={styles.info}>
              업로드 기록에서 넘어온 배치입니다.
              {linkedBatchInfo.batchId ? <> (batchId: {linkedBatchInfo.batchId})</> : null}
              <br />
              이 페이지에서 파일을 다시 업로드한 뒤 “Supabase 등록”을 눌러주세요.
            </div>
          )}

          {busy && (
            <div style={styles.progressWrap}>
              <div style={styles.progressBarBg}>
                <div
                  style={{
                    ...styles.progressBarFill,
                    width: `${Math.round(progress * 100)}%`,
                  }}
                />
              </div>
              <div style={styles.progressText}>{Math.round(progress * 100)}%</div>
            </div>
          )}

          {errorMsg && (
            <div style={styles.error}>
              <strong>오류:</strong> {errorMsg}
            </div>
          )}
        </div>
      </div>

      {/* ✅ content (풀-폭) */}
      <div style={styles.content}>
        {/* 설정 카드 */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>업로드 / 옵션</div>

          <div className="_csv_grid" style={styles.grid3}>
            <div style={styles.col}>
              <label style={styles.label}>CSV 파일</label>
              <input ref={fileRef} type="file" accept=".csv" style={styles.fileInput} />
              <div style={styles.hint}>어떤 형식이든 올리면 됩니다. (중복 제거/병합은 등록 단계에서 수행)</div>
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
                <div style={styles.hint}>※ 이 배치는 chapter {linkedChapter} 로 넘어왔습니다.</div>
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

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={downloadCsv} disabled={!canDownload} style={styles.btnGhost}>
                  결과 CSV 다운로드
                </button>
                <button type="button" onClick={registerToSupabase} disabled={!canRegister} style={styles.btnPinkSolid}>
                  Supabase 등록
                </button>
              </div>
            </div>
          </div>

          {stats && (
            <div style={styles.stats}>
              <div style={styles.statsTitle}>처리 요약</div>
              <div className="_csv_stats" style={styles.statsGrid}>
                <div style={styles.statsLabel}>book</div>
                <div style={styles.statsValue}>{stats.book}</div>

                <div style={styles.statsLabel}>원본 행 수</div>
                <div style={styles.statsValue}>{stats.original_rows?.toLocaleString?.()}</div>

                <div style={styles.statsLabel}>처리 행 수</div>
                <div style={styles.statsValue}>{stats.processed_rows?.toLocaleString?.()}</div>

                <div style={styles.statsLabel}>pos 채워진 행</div>
                <div style={styles.statsValue}>{stats.filled_pos_count?.toLocaleString?.()}</div>

                <div style={styles.statsLabel}>accepted_ko 채워진 행</div>
                <div style={styles.statsValue}>{stats.filled_acc_count?.toLocaleString?.()}</div>
              </div>
            </div>
          )}

          {registerReport && (
            <div style={styles.report}>
              <div style={styles.reportTitle}>✅ 등록 결과 (중복 스킵 포함)</div>
              <div className="_csv_report" style={styles.reportGrid}>
                <div style={styles.reportLabel}>book</div>
                <div style={styles.reportValue}>{registerReport.book}</div>

                <div style={styles.reportLabel}>유니크 기준 시도</div>
                <div style={styles.reportValue}>{registerReport.attemptedUnique.toLocaleString()}건</div>

                <div style={styles.reportLabel}>신규 등록</div>
                <div style={styles.reportValue}>{registerReport.inserted.toLocaleString()}건</div>

                <div style={styles.reportLabel}>중복 스킵(파일 내부)</div>
                <div style={styles.reportValue}>{registerReport.skippedFileDup.toLocaleString()}건</div>

                <div style={styles.reportLabel}>중복 스킵(DB 기존)</div>
                <div style={styles.reportValue}>{registerReport.skippedDbDup.toLocaleString()}건</div>

                <div style={styles.reportLabel}>배치 ID</div>
                <div style={styles.reportValue}>{registerReport.batchId || "-"}</div>
              </div>
              <div style={styles.reportHint}>
                ※ “파일 내부 중복”은 업로드 파일 안에서 (book+chapter+term_en)이 반복된 경우, <br />
                “DB 기존 중복”은 이미 DB에 있던 동일 키가 upsert(ignoreDuplicates)로 자동 스킵된 경우입니다.
              </div>
            </div>
          )}
        </div>

        {/* 미리보기 테이블 */}
        {rows.length > 0 && (
          <div style={styles.card}>
            <div style={styles.subhead}>
              <div style={{ fontWeight: 900 }}>미리보기 (상위 50행)</div>
              <div style={styles.muted}>총 {rows.length.toLocaleString()}건</div>
            </div>

            <div style={styles.tableCard}>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>book</th>
                      <th style={styles.th}>chapter</th>
                      <th style={styles.th}>term_en</th>
                      <th style={styles.th}>meaning_ko</th>
                      <th style={styles.th}>pos</th>
                      <th style={styles.th}>accepted_ko</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...styles.td, ...styles.ellipsis }} title={r.book || ""}>
                          {r.book}
                        </td>
                        <td style={styles.td}>{r.chapter}</td>
                        <td style={{ ...styles.td, ...styles.ellipsis }} title={r.term_en || ""}>
                          {r.term_en}
                        </td>
                        <td style={{ ...styles.td, ...styles.ellipsis }} title={r.meaning_ko || ""}>
                          {r.meaning_ko}
                        </td>
                        <td style={styles.td}>{r.pos}</td>
                        <td style={{ ...styles.td, ...styles.ellipsis }} title={r.accepted_ko || ""}>
                          {r.accepted_ko}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={styles.mobileHint}>모바일에서는 표가 좌우로 스크롤됩니다. (←→)</div>
            </div>
          </div>
        )}

        <div style={{ height: 16 }} />
      </div>

      {/* ✅ 반응형 + iPhone safe-area 보완 */}
      <style>{`
        @media (max-width: 860px) {
          ._csv_grid { grid-template-columns: 1fr !important; }
          ._csv_stats { grid-template-columns: 140px 1fr !important; }
          ._csv_report { grid-template-columns: 140px 1fr !important; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  _theme: {
    bg: "#fff5f8",
    card: "#ffffff",
    text: "#1f2a44",
    sub: "#5d6b82",
    border: "#e9eef5",
    borderPink: "#ffd3e3",
    pink: "#ff6fa3",
    pinkSoft: "#fff0f6",
    dangerBg: "#fff1f2",
    dangerBorder: "#fecdd3",
    dangerText: "#9f1239",
  },

  page: {
    minHeight: "100vh",
    height: "100dvh",
    background: "#fff5f8",
    color: "#1f2a44",
  },

  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: "#fff5f8",
    paddingTop: "env(safe-area-inset-top, 0px)",
    borderBottom: "1px solid #ffd3e3",
  },
  headerInner: {
    maxWidth: 1600,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  titleRow: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  title: { fontSize: 18, fontWeight: 900, letterSpacing: "-0.2px" },
  link: { fontSize: 13, color: "#ff6fa3", fontWeight: 900, textDecoration: "none" },
  sub: { marginTop: 4, fontSize: 12, color: "#5d6b82", fontWeight: 800 },

  headerBtns: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },

  info: {
    marginTop: 10,
    background: "#ecfeff",
    border: "1px solid #bae6fd",
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    color: "#075985",
    fontWeight: 800,
    lineHeight: 1.45,
  },

  progressWrap: { marginTop: 10, display: "flex", alignItems: "center", gap: 10 },
  progressBarBg: { flex: 1, height: 10, background: "#fff", border: "1px solid #ffd3e3", borderRadius: 999 },
  progressBarFill: { height: 10, borderRadius: 999, background: "#ff6fa3", transition: "width .2s" },
  progressText: { fontSize: 12, color: "#5d6b82", fontWeight: 900, minWidth: 38, textAlign: "right" },

  error: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    color: "#9f1239",
    fontWeight: 900,
    boxShadow: "0 10px 22px rgba(159,18,57,.08)",
  },

  content: {
    maxWidth: 1600,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  card: {
    background: "#ffffff",
    border: "1px solid #e9eef5",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 10px 30px rgba(255,192,217,.22)",
  },

  cardTitle: { fontSize: 14, fontWeight: 900, color: "#1f2a44", marginBottom: 10 },

  grid3: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 12,
  },

  col: { minWidth: 0 },
  label: { display: "block", fontSize: 12, color: "#5d6b82", fontWeight: 900, marginBottom: 6 },
  hint: { fontSize: 12, color: "#6b7280", marginTop: 6, lineHeight: 1.45 },

  fileInput: { width: "100%", height: 44 },

  input: {
    width: "100%",
    height: 44,
    padding: "0 12px",
    border: "1px solid #ffd3e3",
    borderRadius: 12,
    outline: "none",
    fontSize: 14,
    fontWeight: 800,
    color: "#1f2a44",
    background: "#fff",
  },

  check: { display: "flex", alignItems: "center", height: 44, fontWeight: 800, color: "#1f2a44" },

  btnPink: {
    height: 44,
    padding: "0 14px",
    borderRadius: 999,
    border: "none",
    background: "#ff6fa3",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(255,111,163,.18)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  btnPinkSolid: {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid #ff6fa3",
    background: "#ff6fa3",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(255,111,163,.18)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  btnGhost: {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#1f2a44",
    fontWeight: 900,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  stats: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    border: "1px solid #ffd3e3",
    background: "#fffbfd",
  },
  statsTitle: { fontWeight: 900, marginBottom: 8, color: "#1f2a44" },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: 8,
    fontSize: 13,
  },
  statsLabel: { color: "#5d6b82", fontWeight: 900 },
  statsValue: { color: "#1f2a44", fontWeight: 900 },

  report: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#065f46",
  },
  reportTitle: { fontWeight: 900, marginBottom: 8 },
  reportGrid: { display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, fontSize: 13 },
  reportLabel: { fontWeight: 900, opacity: 0.9 },
  reportValue: { fontWeight: 900 },
  reportHint: { marginTop: 10, fontSize: 12, color: "#047857", fontWeight: 800, lineHeight: 1.45 },

  subhead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  muted: { color: "#5d6b82", fontWeight: 800, fontSize: 12 },

  tableCard: {
    borderRadius: 16,
    border: "1px solid #e9eef5",
    background: "#fff",
    overflow: "hidden",
  },
  tableWrap: { width: "100%", overflow: "auto" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 980 },

  th: {
    position: "sticky",
    top: 0,
    background: "#fff",
    zIndex: 1,
    textAlign: "left",
    fontSize: 12,
    color: "#5d6b82",
    fontWeight: 900,
    padding: "12px 12px",
    borderBottom: "1px solid #e9eef5",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 12px",
    borderBottom: "1px solid #f1f4f8",
    fontSize: 13,
    color: "#1f2a44",
    fontWeight: 700,
    verticalAlign: "middle",
    background: "#fff",
    whiteSpace: "nowrap",
  },

  ellipsis: { maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" },

  mobileHint: { padding: "10px 12px", fontSize: 12, color: "#5d6b82", fontWeight: 800, background: "#fff" },
};
