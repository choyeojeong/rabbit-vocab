// src/pages/OfficialResultPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { getSession } from "../utils/session";
import StudentShell from "./StudentShell";

dayjs.locale("ko");

const COLORS = {
  bg: "#fff5f8",
  card: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#ffd3e3",
  pink: "#ff6fa3",
  pink2: "#ff8fb7",
  gray: "#eef1f6",
  blue: "#4361ee",
  okBg: "#e9fbf1",
  okText: "#167a3a",
  noBg: "#ffecec",
  noText: "#b42318",
};

export default function OfficialResultPage() {
  const { id } = useParams();
  const me = getSession();
  const nav = useNavigate();

  const [sess, setSess] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const styles = useMemo(
    () => ({
      topCard: {
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 10px 30px rgba(31,42,68,0.06)",
        width: "100%",
        maxWidth: "100%",
        color: COLORS.text,
      },

      headRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
      title: { fontSize: 18, fontWeight: 900, margin: 0, color: COLORS.text },
      sub: { fontSize: 12, color: COLORS.sub, marginTop: 2, fontWeight: 700 },

      pill: (ok) => ({
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 900,
        background: ok ? COLORS.okBg : COLORS.noBg,
        color: ok ? COLORS.okText : COLORS.noText,
        border: `1px solid ${ok ? "#c7f0d8" : "#ffd0d0"}`,
        whiteSpace: "nowrap",
      }),

      metaGrid: {
        marginTop: 12,
        border: `1px solid ${COLORS.gray}`,
        borderRadius: 14,
        padding: 12,
        background: "#fff",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
      },
      metaItem: { display: "flex", flexDirection: "column", gap: 3 },
      metaLabel: { fontSize: 12, color: COLORS.sub, fontWeight: 900 },
      metaValue: { fontSize: 13, color: COLORS.text, fontWeight: 900, lineHeight: 1.25 },

      section: {
        marginTop: 12,
        borderTop: `1px dashed ${COLORS.border}`,
        paddingTop: 12,
      },
      sectionTitle: { fontSize: 14, fontWeight: 900, color: COLORS.text, marginBottom: 8 },

      empty: {
        padding: "12px 12px",
        borderRadius: 12,
        border: `1px solid ${COLORS.gray}`,
        background: "#fff",
        color: COLORS.sub,
        fontWeight: 800,
      },

      list: { margin: 0, paddingLeft: 18 },
      li: { margin: "8px 0", color: COLORS.text, fontWeight: 800, lineHeight: 1.35 },

      wrongCard: {
        marginTop: 8,
        padding: "10px 12px",
        borderRadius: 12,
        border: `1px solid ${COLORS.gray}`,
        background: "#fff",
      },
      wrongTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
      wrongIdx: { fontSize: 12, color: COLORS.sub, fontWeight: 900, whiteSpace: "nowrap" },
      wrongTerm: { fontSize: 14, fontWeight: 900, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis" },
      wrongLine: { marginTop: 6, fontSize: 13, fontWeight: 800, color: COLORS.text },
      wrongSub: { marginTop: 2, fontSize: 12, fontWeight: 800, color: COLORS.sub },

      bottomLink: { marginTop: 12, color: COLORS.blue, fontWeight: 900, display: "inline-block", textDecoration: "none" },

      loadingText: { color: COLORS.sub, fontWeight: 800 },
    }),
    []
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // 세션
        const { data: s, error: e1 } = await supabase
          .from("test_sessions")
          .select(
            "id, student_id, book, chapters_text, chapter_start, chapter_end, num_questions, cutoff_miss, final_score, final_pass, teacher_confirmed_at, status, created_at"
          )
          .eq("id", id)
          .maybeSingle();

        if (e1) throw e1;

        if (!s) {
          alert("세션을 찾을 수 없습니다.");
          nav("/exam/official/results", { replace: true });
          return;
        }

        // 본인 확인 + 확정 여부
        if (me?.id && s.student_id !== me.id) {
          alert("본인 결과만 볼 수 있습니다.");
          nav("/exam/official/results", { replace: true });
          return;
        }
        if (s.status !== "finalized") {
          alert("아직 검수 중입니다.");
          nav("/exam/official/results", { replace: true });
          return;
        }

        setSess(s);

        // 문항
        const { data: its, error: e2 } = await supabase
          .from("test_items")
          .select("order_index, term_en, meaning_ko, student_answer, final_ok, auto_ok")
          .eq("session_id", id)
          .order("order_index", { ascending: true });

        if (e2) throw e2;
        setItems(its || []);
      } catch (e) {
        console.error(e);
        alert(e?.message || "결과를 불러오는 중 오류가 발생했습니다.");
        nav("/exam/official/results", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [id, me?.id, nav]);

  if (loading) {
    return (
      <StudentShell>
        <div style={styles.topCard}>
          <div style={styles.loadingText}>불러오는 중…</div>
        </div>
      </StudentShell>
    );
  }
  if (!sess) return null;

  const range = sess.chapters_text || `${sess.chapter_start ?? "?"}-${sess.chapter_end ?? "?"}`;
  const total = sess.num_questions ?? items.length;
  const score = sess.final_score ?? 0;
  const wrong = Math.max(0, total - score);

  // final_ok가 null일 수도 있으니: false/0/undefined 포함해서 “오답”으로 묶기
  const wrongItems = (items || []).filter((it) => it?.final_ok === false || it?.final_ok === null);

  const confirmedAt = sess.teacher_confirmed_at || sess.created_at;

  return (
    <StudentShell>
      <div style={styles.topCard}>
        {/* 헤더 */}
        <div style={styles.headRow}>
          <div>
            <h2 style={styles.title}>공식시험 상세 결과</h2>
            <div style={styles.sub}>{dayjs(confirmedAt).format("YYYY.MM.DD HH:mm")} · 검수 확정</div>
          </div>

          <span style={styles.pill(!!sess.final_pass)}>{sess.final_pass ? "통과" : "불통과"}</span>
        </div>

        {/* 요약 메타 */}
        <div style={styles.metaGrid}>
          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>책</div>
            <div style={styles.metaValue}>{sess.book || "-"}</div>
          </div>

          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>범위</div>
            <div style={styles.metaValue}>{range}</div>
          </div>

          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>문제 수</div>
            <div style={styles.metaValue}>{total}문제</div>
          </div>

          <div style={styles.metaItem}>
            <div style={styles.metaLabel}>틀린 수 / 커트라인</div>
            <div style={styles.metaValue}>
              -{wrong} · -{sess.cutoff_miss ?? 0}컷
            </div>
          </div>
        </div>

        {/* 오답 섹션 */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>틀린 문제</div>

          {wrongItems.length === 0 ? (
            <div style={styles.empty}>틀린 문제가 없습니다. 🎉</div>
          ) : (
            <div>
              {wrongItems.map((it) => (
                <div key={it.order_index} style={styles.wrongCard}>
                  <div style={styles.wrongTop}>
                    <div style={styles.wrongIdx}>{it.order_index}번</div>
                    <div style={styles.wrongTerm} title={it.term_en || ""}>
                      {it.term_en || "-"}
                    </div>
                  </div>

                  <div style={styles.wrongLine}>정답: {it.meaning_ko || "-"}</div>
                  <div style={styles.wrongSub}>내 답: {it.student_answer ? it.student_answer : "(무응답)"}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Link to="/exam/official/results" style={styles.bottomLink}>
          ← 결과 목록
        </Link>
      </div>
    </StudentShell>
  );
}
