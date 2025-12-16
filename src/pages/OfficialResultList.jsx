// src/pages/OfficialResultList.jsx
import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { ensureLiveStudent, getSession } from "../utils/session";
import StudentShell from "./StudentShell";

dayjs.locale("ko");

export default function OfficialResultList() {
  const nav = useNavigate();

  // ✅ 세션은 state로 들고와서 렌더/의존성 안전하게
  const [who, setWho] = useState(() => {
    const me = getSession();
    return { id: me?.id || null, name: (me?.name || "").trim() };
  });

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ✅ 마운트 시 한 번 더 “실존 학생” 검증 (PWA 캐시로 오래된 세션 방지)
  useEffect(() => {
    (async () => {
      const s = await ensureLiveStudent();
      if (!s) {
        nav("/", { replace: true });
        return;
      }
      setWho({ id: s.id, name: (s.name || "").trim() });
    })();
  }, [nav]);

  const fetchRows = useCallback(async () => {
    if (!who.id && !who.name) return;
    try {
      setLoading(true);
      setErr("");

      // ✅ 공식시험 + 확정본만
      let q = supabase
        .from("test_sessions")
        .select(
          "id, status, mode, book, chapters_text, chapter_start, chapter_end, num_questions, final_score, final_pass, teacher_confirmed_at, created_at, student_id, student_name"
        )
        .eq("mode", "official")
        .eq("status", "finalized")
        // ✅ id OR name 둘 다 허용 (id가 가장 신뢰도 높음)
        .or(
          [
            who.id ? `student_id.eq.${who.id}` : null,
            who.name ? `student_name.eq.${who.name}` : null,
          ]
            .filter(Boolean)
            .join(",")
        )
        .order("teacher_confirmed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      const { data, error } = await q;
      if (error) throw error;

      setRows(data || []);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "결과를 불러오는 중 오류가 발생했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [who.id, who.name]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // 비로그인 상태: 로그인 유도
  if (!who.id && !who.name) {
    return (
      <StudentShell>
        <div
          className="vh-100 centered with-safe"
          style={{ width: "100%", color: "#000" }}
        >
          <div className="student-container">
            <div className="student-card stack">
              <div className="student-text" style={{ color: "#333" }}>
                로그인 후 공식시험 결과를 확인할 수 있어요.
              </div>
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <button className="student-button" onClick={() => nav("/login")}>
                  로그인 하러 가기
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <Link to="/" style={{ color: "#4361ee" }}>
                  ← 홈으로
                </Link>
              </div>
            </div>
          </div>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: "100%", color: "#000" }}>
        <div className="student-container">
          <div className="student-card stack">
            {/* 상단: 새로고침만 */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
                        // ✅ 여기만 수정: results(복수) 라우트로 이동해야 함
                        to={`/exam/official/results/${r.id}`}
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
              <Link to="/dashboard" style={{ color: "#4361ee" }}>
                ← 대시보드
              </Link>
            </div>
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
