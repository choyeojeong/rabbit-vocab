// src/pages/OfficialResultList.jsx
import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { getSession } from "../utils/session";
import StudentShell from "./StudentShell";

dayjs.locale("ko");

export default function OfficialResultList() {
  const nav = useNavigate();
  const me = getSession(); // { id, name, ... }
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

  // 비로그인 상태: 로그인 유도 카드
  if (!me?.id) {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: "100%" }}>
          <div className="student-container">
            <div className="student-card stack">
              <div className="student-text" style={{ color: "#666" }}>
                로그인 후 공식시험 결과를 확인할 수 있어요.
              </div>
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <button className="student-button" onClick={() => nav("/login")}>
                  로그인 하러 가기
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <Link to="/" style={{ color: "#4361ee" }}>← 홈으로</Link>
              </div>
            </div>
          </div>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: "100%" }}>
        <div className="student-container">
          <div className="student-card stack">
            {/* 상단: 인사 + 새로고침 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 8 }}>
              <div className="student-text">
                {me?.name ? <>안녕하세요, <b>{me.name}</b> 학생! 🐰</> : "세션 정보를 불러오는 중…"}
              </div>
              <button
                onClick={fetchRows}
                className="student-button"
                style={{ padding: "8px 12px", whiteSpace: "nowrap" }}
                title="새로고침"
              >
                ⟳ 새로고침
              </button>
            </div>

            {err && <div style={{ marginTop: 8, color: "#d00" }}>{err}</div>}

            {/* 결과 목록 */}
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
                      <Link
                        to={`/exam/official/result/${r.id}`}
                        style={{ color: "#1f365e", textDecoration: "none" }}
                      >
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
      </div>
    </StudentShell>
  );
}
