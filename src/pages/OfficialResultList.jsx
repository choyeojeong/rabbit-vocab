// src/pages/OfficialResultList.jsx
import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { getSession } from "../utils/session";
import StudentShell from "./StudentShell";

dayjs.locale("ko");

function norm(v) {
  return (v ?? "").toString().trim().toLowerCase();
}

export default function OfficialResultList() {
  const nav = useNavigate();
  const me = getSession(); // { id, name, ... } 형태 가정
  const studentId = me?.id || null;
  const studentName = (me?.name || "").trim();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // 시간 제한(기본 90시간) / 해제 토글
  const [hours, setHours] = useState(90);
  const [noTimeLimit, setNoTimeLimit] = useState(false);

  const sinceISO = useMemo(() => {
    if (noTimeLimit) return null;
    const t = new Date(Date.now() - 1000 * 60 * 60 * (Number(hours) || 90));
    return t.toISOString();
  }, [hours, noTimeLimit]);

  const fetchRows = useCallback(async () => {
    if (!studentId && !studentName) return;
    try {
      setLoading(true);
      setErr("");

      // 기본 쿼리: mode만 제한하고 넓게 가져옴
      let q = supabase
        .from("test_sessions")
        .select(
          "id, status, mode, book, chapters_text, chapter_start, chapter_end, num_questions, final_score, final_pass, teacher_confirmed_at, created_at, student_id, student_name"
        )
        .eq("mode", "official")
        // 정렬: 확정 시각 우선, 없으면 생성 시각
        .order("teacher_confirmed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      // 학생 매칭: id 우선, 없으면 name 보조
      const ors = [];
      if (studentId) ors.push(`student_id.eq.${studentId}`);
      if (studentName) ors.push(`student_name.eq.${encodeURIComponent(studentName)}`);
      if (ors.length) q = q.or(ors.join(","));

      // 시간 제한(확정시각 또는 생성시각 중 하나라도 범위 내면 포함)
      if (sinceISO) {
        q = q.or(`teacher_confirmed_at.gte.${sinceISO},created_at.gte.${sinceISO}`);
      }

      const { data, error } = await q;
      if (error) throw error;

      // 화면에서 status 정규화하여 'finalized'만 남김 (공백/대소문자 오염 방지)
      const filtered = (data || []).filter((r) => norm(r.status) === "finalized");

      setRows(filtered);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "결과를 불러오는 중 오류가 발생했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [studentId, studentName, sinceISO]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // 비로그인 상태: 로그인 유도 카드
  if (!studentId && !studentName) {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: "100%", color: "#000" }}>
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
      <div className="vh-100 centered with-safe" style={{ width: "100%", color: "#000" }}>
        <div className="student-container">
          <div className="student-card stack">
            {/* 상단: 인사 + 새로고침 + 시간필터 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 8 }}>
              <div className="student-text" style={{ color: "#000" }}>
                {studentName ? <>안녕하세요, <b>{studentName}</b> 학생! 🐰</> : "세션 정보를 불러오는 중…"}
              </div>

              {/* 시간 제한 해제 토글 */}
              <label style={{ fontSize: 13, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={noTimeLimit}
                  onChange={(e) => setNoTimeLimit(e.target.checked)}
                />
                시간 제한 해제
              </label>

              {/* 시간 범위 입력 */}
              {!noTimeLimit && (
                <label style={{ fontSize: 13, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                  최근
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    style={{ width: 64, padding: "4px 6px", borderRadius: 8, border: "1px solid #ffd3e3" }}
                  />
                  시간
                </label>
              )}
            </div>

            <div style={{ marginTop: 8 }}>
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
