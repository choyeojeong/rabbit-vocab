// src/pages/admin/CsvBatchListPage.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabaseClient";

/**
 * ✅ 요청 반영
 * - 가운데 흰색 네모(고정폭 카드) 제거 → 화면 전체 사용(풀-폭)
 * - iPhone 모바일 최적화
 *   - safe-area(노치/홈바) 대응
 *   - sticky header
 *   - 버튼/입력 터치 타겟 44px
 *   - 표는 가로 스크롤 유지(데스크탑/모바일 공통)
 * - 기능 동일 유지
 *   - 최근 200개 로드, 새로고침
 *   - storage(csv_uploads/{batch.id}.csv) 다운로드
 *   - word_batches 행 삭제(확인 포함)
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

  async function handleDelete(id) {
    if (
      !window.confirm(
        "정말 이 배치를 삭제할까요?\n(이건 word_batches만 지웁니다. vocab_words는 그대로 남습니다.)"
      )
    ) {
      return;
    }
    const { error } = await supabase.from("word_batches").delete().eq("id", id);
    if (error) {
      alert("삭제 실패: " + error.message);
      return;
    }
    setBatches((prev) => prev.filter((b) => b.id !== id));
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
            여기서 삭제하면 <b style={{ color: styles._theme.text }}>word_batches 행만 삭제</b>되고, 이미{" "}
            <code style={styles.code}>vocab_words</code>에 등록된 단어 데이터는 그대로 남습니다.
            <br />
            CsvManagePage에서 변환한 CSV를 <code style={styles.code}>csv_uploads/배치ID.csv</code>로 저장해둔 경우 이
            화면에서 다시 내려받을 수 있습니다.
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
                          <button onClick={() => handleDownloadCsv(b)} style={styles.btnBlue}>
                            CSV 받기
                          </button>
                          <button onClick={() => handleDelete(b.id)} style={styles.btnRed}>
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
          <div style={styles.mobileHint}>
            모바일에서는 표가 좌우로 스크롤됩니다. (←→)
          </div>
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
    minWidth: 920, // ✅ 모바일 가로 스크롤 자연스럽게
  },

  th: {
    position: "sticky",
    top: 0, // tableWrap 안에서 sticky
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
