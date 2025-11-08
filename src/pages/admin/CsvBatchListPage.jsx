// src/pages/admin/CsvBatchListPage.jsx
import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabaseClient";

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
      .limit(200); // 최근 200개까지만

    if (error) {
      setErr(error.message);
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
        "정말 이 배치를 삭제할까요? (이건 word_batches만 지웁니다. vocab_words는 안 지움)"
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

  function handleGoRegister(batch) {
    // 업로드 기록에서 곧바로 등록 페이지로 이동
    const qs = new URLSearchParams({
      batchId: String(batch.id),
      book: batch.book || "",
      chapter: batch.chapter != null ? String(batch.chapter) : "",
    });
    // 라우터에 맞춰서 경로는 프로젝트에 이미 있는 csv 관리 페이지로
    window.location.href = `/admin/csv-manage?${qs.toString()}`;
  }

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <h1 style={styles.title}>CSV 업로드 기록</h1>
        <p style={{ marginBottom: 12, color: "#6b7280" }}>
          admin에서 등록한 CSV(batch) 목록입니다. 여기서 삭제하면 word_batches 행만
          삭제되고, 이미 vocab_words에 넣은 단어들은 그대로 남습니다.
          <br />
          업로드만 해두고 등록을 안 했던 파일은 오른쪽의 <b>등록</b> 버튼으로
          다시 등록할 수 있습니다.
        </p>

        <div style={{ marginBottom: 12 }}>
          <button onClick={load} style={styles.btn}>
            새로고침
          </button>
        </div>

        {err && <div style={styles.error}>오류: {err}</div>}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 220 }}>등록일</th>
                <th>파일명</th>
                <th>book</th>
                <th>chapter</th>
                <th style={{ width: 110 }}>행 수</th>
                <th style={{ width: 90 }}>관리</th>
                <th style={{ width: 110 }}>등록</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 16 }}>
                    불러오는 중...
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 16 }}>
                    아직 등록된 CSV가 없습니다.
                  </td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.id}>
                    <td>{formatKst(b.created_at)}</td>
                    <td>{b.filename || "(이름 없음)"}</td>
                    <td>{b.book || "-"}</td>
                    <td>{b.chapter ?? "-"}</td>
                    <td>{b.total_rows ?? "-"}</td>
                    <td>
                      <button
                        onClick={() => handleDelete(b.id)}
                        style={styles.deleteBtn}
                      >
                        삭제
                      </button>
                    </td>
                    <td>
                      <button
                        onClick={() => handleGoRegister(b)}
                        style={styles.registerBtn}
                      >
                        등록
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatKst(iso) {
  if (!iso) return "-";
  // 그냥 보기 좋게만
  const d = new Date(iso);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 16 },
  wrap: { maxWidth: 1100, margin: "0 auto" },
  title: { fontSize: 22, fontWeight: 900, color: "#1f2a44", marginBottom: 8 },
  btn: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #ffd3e3",
    background: "#ffe6ef",
    fontWeight: 700,
    cursor: "pointer",
  },
  tableWrap: {
    width: "100%",
    overflow: "auto",
    border: "1px solid #e9eef5",
    borderRadius: 8,
    background: "#fff",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  error: {
    marginBottom: 12,
    background: "#fee2e2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    padding: 8,
    color: "#b91c1c",
  },
  deleteBtn: {
    padding: "4px 8px",
    background: "#fee2e2",
    border: "1px solid #fca5a5",
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
  },
  registerBtn: {
    padding: "4px 8px",
    background: "#e0f2fe",
    border: "1px solid #bae6fd",
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 600,
  },
};
