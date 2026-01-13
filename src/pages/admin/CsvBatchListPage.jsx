// src/pages/admin/CsvBatchListPage.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabaseClient";

/**
 * ✅ 요청 반영(중요)
 * - "삭제"를 배치 삭제가 아니라 "단어책(book) 전체 삭제"로 변경
 *   → 학생들이 책 고를 때 삭제한 책이 절대 안 나오게(vocab_words까지 삭제)
 *   → Supabase에 관련 흔적도 안 남게(word_batches, storage CSV, book_category_map까지 삭제)
 *
 * 삭제 대상(해당 book 기준):
 * 1) vocab_words: book=...
 * 2) word_batches: book=...
 * 3) Storage: csv_uploads/{batchId}.csv (해당 book의 모든 batch id)
 * 4) book_category_map: book=...
 */

export default function CsvBatchListPage() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    const { data, error } = await supabase
      .from("word_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      setErr(error.message);
      setBatches([]);
    } else {
      setBatches(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function handleDelete(batch) {
    const book = (batch?.book || "").toString().trim();
    if (!book) {
      alert("삭제할 book 정보가 없습니다.");
      return;
    }

    if (
      !window.confirm(
        "정말 이 단어책(book)을 완전 삭제할까요?\n\n" +
          `책: ${book}\n\n` +
          "- vocab_words: 해당 book 단어 전부 삭제(학생 책 목록에서 완전히 사라짐)\n" +
          "- word_batches: 해당 book 업로드 기록 전부 삭제\n" +
          "- Storage: 해당 book의 모든 배치 CSV 파일(csv_uploads/{batchId}.csv) 삭제\n" +
          "- book_category_map: 해당 book 분류 매핑 삭제\n\n" +
          "※ 되돌릴 수 없습니다."
      )
    ) {
      return;
    }

    setLoading(true);
    setErr("");

    try {
      // 0) 이 book에 속한 모든 배치 id 가져오기 (Storage 파일 삭제용)
      // 최근 200개만 보이지만, book 전체 삭제는 전체 배치를 찾아서 지워야 함.
      const { data: allBatches, error: listErr } = await supabase
        .from("word_batches")
        .select("id")
        .eq("book", book);

      if (listErr) throw new Error("배치 목록 조회 실패: " + listErr.message);

      const ids = (allBatches || []).map((x) => x.id).filter(Boolean);

      // 1) Storage(csv_uploads/{id}.csv) 전부 삭제 (있으면 삭제, 없어도 진행)
      if (ids.length > 0) {
        const paths = ids.map((id) => `${id}.csv`);
        const chunks = chunkArray(paths, 100); // remove에 너무 많이 넣지 않도록 분할
        for (const ch of chunks) {
          const { error: storageErr } = await supabase.storage.from("csv_uploads").remove(ch);
          if (storageErr) {
            // storage는 "없음" 때문에 에러가 날 수도 있어서 경고만
            console.warn("storage remove error:", storageErr.message);
          }
        }
      }

      // 2) book_category_map 삭제(분류 매핑 흔적 제거)
      {
        const { error: mapErr } = await supabase.from("book_category_map").delete().eq("book", book);
        if (mapErr) throw new Error("삭제 실패(book_category_map): " + mapErr.message);
      }

      // 3) word_batches 삭제(업로드 기록 흔적 제거)
      {
        const { error: wbErr } = await supabase.from("word_batches").delete().eq("book", book);
        if (wbErr) throw new Error("삭제 실패(word_batches): " + wbErr.message);
      }

      // 4) vocab_words 삭제(학생 책 목록에서 사라지게 하는 핵심)
      {
        const { error: vwErr } = await supabase.from("vocab_words").delete().eq("book", book);
        if (vwErr) throw new Error("삭제 실패(vocab_words): " + vwErr.message);
      }

      // 5) UI 반영: 현재 화면에 보이는 같은 book 배치들도 제거
      setBatches((prev) => prev.filter((b) => (b.book || "").toString().trim() !== book));

      alert(`완전 삭제 완료!\n\n책: ${book}\n- 단어(vocab_words) + 업로드기록(word_batches) + CSV 파일(Storage) + 분류매핑(book_category_map) 모두 삭제됨`);
    } catch (e) {
      alert("삭제 실패: " + (e?.message || String(e)));
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadCsv(batch) {
    const path = `${batch.id}.csv`;

    try {
      const { data, error } = await supabase.storage.from("csv_uploads").download(path);

      if (error || !data) {
        alert(
          "이 배치에는 저장된 CSV가 없거나, 다운로드에 실패했습니다.\n" +
            "방금 올린 배치라면 CsvManagePage에서 Supabase 등록을 다시 실행해 주세요.\n" +
            `(경로: csv_uploads/${path})`
        );
        if (error) console.warn("storage download error:", error.message);
        return;
      }

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      const fname = batch.filename ? batch.filename : `${batch.id}.csv`;
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("다운로드 중 오류가 발생했습니다: " + (e?.message || String(e)));
      console.error(e);
    }
  }

  const countText = useMemo(() => {
    if (loading) return "불러오는 중…";
    return `총 ${batches.length}개 (최근 200개)`;
  }, [batches.length, loading]);

  return (
    <div style={styles.page}>
      {/* ✅ sticky header (풀-폭) */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.headerTop}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.title}>CSV 업로드 기록</div>
              <div style={styles.sub}>
                Supabase에 실제로 등록이 완료된 CSV(batch)만 표시됩니다. · {countText}
              </div>
            </div>

            <div style={styles.headerBtns}>
              <button onClick={load} style={styles.btnPink} disabled={loading}>
                {loading ? "불러오는 중…" : "새로고침"}
              </button>
            </div>
          </div>

          <div style={styles.desc}>
            여기서 “삭제”는 <b style={{ color: styles._theme.text }}>선택한 행의 book(단어책)</b>을 기준으로{" "}
            <b style={{ color: styles._theme.text }}>완전 삭제</b>합니다.
            <br />
            - <code style={styles.code}>vocab_words</code> 단어 데이터까지 삭제되어 학생들이 책 고를 때{" "}
            <b style={{ color: styles._theme.text }}>해당 책이 더 이상 나오지 않습니다.</b>
            <br />
            - <code style={styles.code}>word_batches</code> 기록, Storage의 CSV 파일,{" "}
            <code style={styles.code}>book_category_map</code> 매핑도 함께 삭제되어{" "}
            <b style={{ color: styles._theme.text }}>Supabase에 관련 흔적이 남지 않습니다.</b>
          </div>

          {err && <div style={styles.error}>오류: {err}</div>}
        </div>
      </div>

      {/* ✅ content (풀-폭) */}
      <div style={styles.content}>
        <div style={styles.tableCard}>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: 160 }}>등록일</th>
                  <th style={{ ...styles.th, minWidth: 220 }}>파일명</th>
                  <th style={{ ...styles.th, minWidth: 180 }}>book</th>
                  <th style={{ ...styles.th, width: 100 }}>chapter</th>
                  <th style={{ ...styles.th, width: 110, textAlign: "right" }}>행 수</th>
                  <th style={{ ...styles.th, width: 190 }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={styles.tdCenter}>
                      불러오는 중...
                    </td>
                  </tr>
                ) : batches.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={styles.tdCenter}>
                      아직 등록된 CSV가 없습니다.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr key={b.id}>
                      <td style={styles.td}>{formatKst(b.created_at)}</td>
                      <td style={{ ...styles.td, ...styles.ellipsis }} title={b.filename || ""}>
                        {b.filename || "(이름 없음)"}
                      </td>
                      <td style={{ ...styles.td, ...styles.ellipsis }} title={b.book || ""}>
                        {b.book || "-"}
                      </td>
                      <td style={styles.td}>{b.chapter ?? "-"}</td>
                      <td style={{ ...styles.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {b.total_rows ?? "-"}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actions}>
                          <button onClick={() => handleDownloadCsv(b)} style={styles.btnBlue} disabled={loading}>
                            CSV 받기
                          </button>
                          <button onClick={() => handleDelete(b)} style={styles.btnRed} disabled={loading}>
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ✅ 모바일 안내 (표 가로스크롤 유도) */}
          <div style={styles.mobileHint}>모바일에서는 표가 좌우로 스크롤됩니다. (←→)</div>
        </div>
      </div>
    </div>
  );
}

function formatKst(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

const styles = {
  _theme: {
    bg: "#fff5f8",
    text: "#1f2a44",
    sub: "#5d6b82",
    border: "#e9eef5",
    borderPink: "#ffd3e3",
    pink: "#ff6fa3",
    pinkSoft: "#fff0f6",
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

  title: { fontSize: 18, fontWeight: 900, color: "#1f2a44", letterSpacing: "-0.2px" },
  sub: { marginTop: 4, fontSize: 12, color: "#5d6b82", fontWeight: 800 },

  headerBtns: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },

  desc: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 1.55,
    color: "#5d6b82",
    fontWeight: 700,
  },

  code: {
    background: "#fff",
    border: "1px solid #ffd3e3",
    padding: "1px 6px",
    borderRadius: 8,
    color: "#8a1f4b",
    fontWeight: 900,
  },

  error: {
    marginTop: 10,
    background: "#fee2e2",
    border: "1px solid #fecaca",
    borderRadius: 12,
    padding: 10,
    color: "#b91c1c",
    fontWeight: 900,
    whiteSpace: "pre-wrap",
    boxShadow: "0 10px 22px rgba(185,28,28,.08)",
  },

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

  content: {
    maxWidth: 1600,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  tableCard: {
    borderRadius: 16,
    border: "1px solid #ffd3e3",
    background: "#ffffff",
    boxShadow: "0 10px 30px rgba(255,192,217,.25)",
    overflow: "hidden",
  },

  tableWrap: {
    width: "100%",
    overflow: "auto",
  },

  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    minWidth: 920,
  },

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
  },

  tdCenter: {
    textAlign: "center",
    padding: 16,
    color: "#6b7280",
    fontWeight: 800,
    background: "#fff",
  },

  ellipsis: {
    maxWidth: 420,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },

  btnBlue: {
    height: 36,
    padding: "0 10px",
    borderRadius: 10,
    background: "#e0f2fe",
    border: "1px solid #bae6fd",
    color: "#075985",
    fontWeight: 900,
    fontSize: 12,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  btnRed: {
    height: 36,
    padding: "0 10px",
    borderRadius: 10,
    background: "#fee2e2",
    border: "1px solid #fca5a5",
    color: "#991b1b",
    fontWeight: 900,
    fontSize: 12,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  mobileHint: {
    padding: "10px 12px",
    fontSize: 12,
    color: "#5d6b82",
    fontWeight: 800,
    background: "#fff",
  },
};
