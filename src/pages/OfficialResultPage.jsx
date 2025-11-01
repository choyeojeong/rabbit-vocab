// src/pages/OfficialResultPage.jsx
import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { getSession } from "../utils/session";
import StudentShell from "./StudentShell";

dayjs.locale("ko");

export default function OfficialResultPage() {
  const { id } = useParams();
  const me = getSession();
  const nav = useNavigate();

  const [sess, setSess] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // 세션
        const { data: s, error: e1 } = await supabase
          .from("test_sessions")
          .select(
            "id, student_id, book, chapters_text, chapter_start, chapter_end, num_questions, cutoff_miss, final_score, final_pass, teacher_confirmed_at, status"
          )
          .eq("id", id)
          .maybeSingle();
        if (e1) throw e1;
        if (!s) {
          alert("세션을 찾을 수 없습니다.");
          nav("/exam/official/results");
          return;
        }

        // 본인 확인 + 확정 여부
        if (me?.id && s.student_id !== me.id) {
          alert("본인 결과만 볼 수 있습니다.");
          nav("/exam/official/results");
          return;
        }
        if (s.status !== "finalized") {
          alert("아직 검수 중입니다.");
          nav("/exam/official/results");
          return;
        }
        setSess(s);

        // 문항
        const { data: its, error: e2 } = await supabase
          .from("test_items")
          .select("order_index, term_en, meaning_ko, student_answer, final_ok")
          .eq("session_id", id)
          .order("order_index", { ascending: true });
        if (e2) throw e2;
        setItems(its || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, me?.id, nav]);

  if (loading) {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={{ width: "100%" }}>
          <div className="student-container">
            <div className="student-card stack">불러오는 중…</div>
          </div>
        </div>
      </StudentShell>
    );
  }
  if (!sess) return null;

  const range = sess.chapters_text || `${sess.chapter_start ?? "?"}-${sess.chapter_end ?? "?"}`;
  const total = sess.num_questions ?? items.length;
  const score = sess.final_score ?? 0;
  const wrong = Math.max(0, total - score);
  const wrongItems = items.filter((it) => !it.final_ok);

  return (
    <StudentShell>
      <div className="vh-100 centered with-safe" style={{ width: "100%" }}>
        <div className="student-container">
          <div className="student-card stack">
            {/* 상단 요약 */}
            <div className="student-text" style={{ color: "#444", marginBottom: 4 }}>
              <div>책/범위: <b>{sess.book}</b> / <b>{range}</b></div>
              <div>
                문제 수: <b>{total}</b> · 틀린 수: <b>-{wrong}</b> · 최종: <b>{sess.final_pass ? "통과" : "불통과"}</b>
              </div>
              <div>검수 완료: {dayjs(sess.teacher_confirmed_at).format("YYYY.MM.DD HH:mm")}</div>
              <div>커트라인: -{sess.cutoff_miss}컷</div>
            </div>

            {/* 틀린 문제 */}
            <div style={{ borderTop: "1px solid #ffe1ec", paddingTop: 12 }}>
              <div className="student-text" style={{ fontWeight: 700, marginBottom: 6 }}>
                틀린 문제
              </div>
              {wrongItems.length === 0 ? (
                <div className="student-text" style={{ color: "#888" }}>틀린 문제가 없습니다. 🎉</div>
              ) : (
                <ul style={{ paddingLeft: 18 }}>
                  {wrongItems.map((it) => (
                    <li key={it.order_index} style={{ margin: "6px 0" }}>
                      <b>{it.order_index}. {it.term_en}</b> — 정답: {it.meaning_ko} / 내 답: {it.student_answer || "—"}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <Link to="/exam/official/results" style={{ color: "#4361ee", textDecoration: "none" }}>
                ← 결과 목록
              </Link>
            </div>
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
