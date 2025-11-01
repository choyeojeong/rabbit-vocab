// src/pages/TeacherToday.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../utils/supabaseClient";

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 24 },
  box: {
    maxWidth: 700,
    margin: "0 auto",
    background: "#fff",
    borderRadius: 14,
    padding: 22,
    boxShadow: "0 10px 30px rgba(255,111,163,0.18)",
  },
  title: { fontSize: 22, fontWeight: 900, color: "#ff6fa3", margin: 0 },
  sectionTitle: { marginTop: 18, fontWeight: 800, color: "#1f365e" },
  bulletWrap: { marginTop: 8 },
  bullet: { margin: "6px 0" },
  empty: { color: "#888", fontStyle: "italic", marginTop: 6 },
};

function formatRange(s) {
  if (!s) return "?-?";
  return s.chapters_text || `${s.chapter_start ?? "?"}-${s.chapter_end ?? "?"}`;
}

function lineFor(s) {
  const range = formatRange(s);
  const total = s.num_questions ?? 0;
  const score = s.final_score ?? 0; // 오늘 페이지는 확정된 것만 사용
  const wrong = Math.max(0, total - score);
  // 원하는 포맷: 이름 / 책 / 범위 / N문제 / -틀린수
  return `${s.student_name} / ${s.book} / ${range} / ${total}문제 / -${wrong}`;
}

export default function TeacherToday() {
  const [loading, setLoading] = useState(true);
  const [passed, setPassed] = useState([]);
  const [failed, setFailed] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        // 오늘 00:00 ~ 내일 00:00
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start);
        end.setDate(end.getDate() + 1);

        const { data, error } = await supabase
          .from("test_sessions")
          .select(
            "id, student_name, book, chapters_text, chapter_start, chapter_end, num_questions, final_score, final_pass, status, created_at"
          )
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .eq("status", "finalized") // 확정된 결과만
          .order("created_at", { ascending: false });

        if (error) throw error;

        const p = (data || []).filter((s) => s.final_pass === true);
        const f = (data || []).filter((s) => s.final_pass === false);
        setPassed(p);
        setFailed(f);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={styles.title}>오늘의 통과/불통과</h2>
          <Link to="/teacher/review" style={{ color: "#4361ee", textDecoration: "none" }}>
            ← 미검수 목록
          </Link>
        </div>

        {loading ? (
          <div style={{ marginTop: 12 }}>불러오는 중…</div>
        ) : (
          <>
            <div style={styles.sectionTitle}>통과한 학생</div>
            <div style={styles.bulletWrap}>
              {passed.length === 0 ? (
                <div style={styles.empty}>없음</div>
              ) : (
                <ul>
                  {passed.map((s) => (
                    <li key={s.id} style={styles.bullet}>
                      {lineFor(s)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={styles.sectionTitle}>응시했지만 최종 불통과</div>
            <div style={styles.bulletWrap}>
              {failed.length === 0 ? (
                <div style={styles.empty}>없음</div>
              ) : (
                <ul>
                  {failed.map((s) => (
                    <li key={s.id} style={styles.bullet}>
                      {lineFor(s)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
