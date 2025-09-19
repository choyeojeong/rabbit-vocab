// src/pages/OfficialResultList.jsx
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { getSession } from "../utils/session";

dayjs.locale("ko");

export default function OfficialResultList() {
  const me = getSession(); // { id, name, ... } 형태 가정
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const fetchRows = useCallback(async () => {
    if (!me?.id) return;
    try {
      setLoading(true);
      setErr("");
      const { data, error } = await supabase
        .from("test_sessions")
        .select(
          "id, book, chapters_text, chapter_start, chapter_end, num_questions, final_score, final_pass, teacher_confirmed_at, created_at"
        )
        .eq("student_id", me.id)
        .eq("mode", "official")
        .eq("status", "finalized")
        .order("teacher_confirmed_at", { ascending: false });
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "결과를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [me?.id]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  if (!me?.id) {
    return (
      <div style={{ minHeight: "100vh", background: "#fff5f8", padding: 24 }}>
        <div style={{ maxWidth: 800, margin: "0 auto", background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 8px 24px rgba(255,192,217,.35)" }}>
          <h2 style={{ marginTop: 0, color: "#ff6fa3" }}>공식시험 결과</h2>
          <div style={{ color: "#666" }}>로그인이 필요합니다.</div>
          <div style={{ marginTop: 12 }}>
            <Link to="/login" style={{ color: "#4361ee" }}>→ 로그인 하러 가기</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fff5f8", padding: 24 }}>
      <div style={{ maxWidth: 800, margin: "0 auto", background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 8px 24px rgba(255,192,217,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, color: "#ff6fa3" }}>공식시험 결과</h2>
          <button
            onClick={fetchRows}
            style={{
              marginLeft: "auto",
              background: "#fff",
              color: "#ff6fa3",
              border: "1px solid #ffd3e3",
              padding: "6px 10px",
              borderRadius: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
            title="새로고침"
          >
            ⟳ 새로고침
          </button>
        </div>

        {err && <div style={{ marginTop: 8, color: "#d00" }}>{err}</div>}

        {loading ? (
          <div style={{ marginTop: 10 }}>불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div style={{ marginTop: 10, color: "#777" }}>확정된 결과가 없습니다.</div>
        ) : (
          <ul style={{ paddingLeft: 18, marginTop: 10 }}>
            {rows.map((r) => {
              const range = r.chapters_text || `${r.chapter_start ?? "?"}-${r.chapter_end ?? "?"}`;
              const wrong = Math.max(0, (r.num_questions ?? 0) - (r.final_score ?? 0));
              const dateStr = dayjs(r.teacher_confirmed_at || r.created_at).format("YYYY.MM.DD");
              return (
                <li key={r.id} style={{ margin: "8px 0" }}>
                  <Link to={`/exam/official/result/${r.id}`} style={{ color: "#1f365e", textDecoration: "none" }}>
                    {dateStr} · {r.book} / {range} · {r.num_questions}문제 / -{wrong}
                    {r.final_pass ? " · 통과" : " · 불통과"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div style={{ marginTop: 12 }}>
          <Link to="/dashboard" style={{ color: "#4361ee" }}>← 대시보드</Link>
        </div>
      </div>
    </div>
  );
}
