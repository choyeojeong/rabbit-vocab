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
      // ✅ 풀스크린 + 중앙정렬 (흰 네모 래퍼 제거)
      pageWrap: {
        minHeight: "100dvh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        paddingLeft: 16,
        paddingRight: 16,
        background: COLORS.bg,
        color: COLORS.text,
      },
      container: {
        width: "100%",
        maxWidth: 860,
      },

      // 상단 헤더 패널(반투명)
      headBar: {
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: 14,
        background: "rgba(255,255,255,0.35)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 10px 24px rgba(255,111,163,.08)",
        width: "100%",
      },

      headRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
      title: { fontSize: 18, fontWeight: 900, margin: 0, color: COLORS.text },
      sub: { fontSize: 12, color: COLORS.sub, marginTop: 2, fontWeight: 800 },

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

      // 요약 메타 패널(반투명)
      metaGrid: {
        marginTop: 12,
        border: `1px solid ${COLORS.gray}`,
        borderRadius: 16,
        padding: 12,
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 10px 24px rgba(31,42,68,0.06)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
      },
      metaItem: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
      metaLabel: { fontSize: 12, color: COLORS.sub, fontWeight: 900 },
      metaValue: {
        fontSize: 13,
        color: COLORS.text,
        fontWeight: 900,
        lineHeight: 1.25,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },

      section: {
        marginTop: 12,
        borderTop: `1px dashed ${COLORS.border}`,
        paddingTop: 12,
      },
      sectionTitle: { fontSize: 14, fontWeight: 900, color: COLORS.text, marginBottom: 8 },

      empty: {
        padding: "12px 12px",
        borderRadius: 14,
        border: `1px solid ${COLORS.gray}`,
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(6px)",
        color: COLORS.sub,
        fontWeight: 900,
        boxShadow: "0 10px 24px rgba(31,42,68,0.05)",
      },

      wrongCard: {
        marginTop: 8,
        padding: "10px 12px",
        borderRadius: 14,
        border: `1px solid ${COLORS.gray}`,
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 10px 24px rgba(31,42,68,0.05)",
      },
      wrongTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
      wrongIdx: { fontSize: 12, color: COLORS.sub, fontWeight: 900, whiteSpace: "nowrap" },
      wrongTerm: {
        fontSize: 14,
        fontWeight: 900,
        color: COLORS.text,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
        flex: 1,
        textAlign: "right",
      },
      wrongLine: { marginTop: 6, fontSize: 13, fontWeight: 900, color: COLORS.text },
      wrongSub: { marginTop: 2, fontSize: 12, fontWeight: 900, color: COLORS.sub },

      bottomLink: {
        marginTop: 12,
        color: COLORS.blue,
        fontWeight: 900,
        display: "inline-block",
        textDecoration: "none",
      },

      loadingText: { color: COLORS.sub, fontWeight: 900 },
    }),
    []
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

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
        <div style={styles.pageWrap}>
          <div style={styles.container}>
            <div style={styles.headBar}>
              <div style={styles.loadingText}>불러오는 중…</div>
            </div>
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

  const wrongItems = (items || []).filter((it) => it?.final_ok === false || it?.final_ok === null);

  const confirmedAt = sess.teacher_confirmed_at || sess.created_at;

  return (
    <StudentShell>
      <div style={styles.pageWrap}>
        <div style={styles.container}>
          <div style={styles.headBar}>
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
                <div style={styles.metaValue} title={sess.book || ""}>
                  {sess.book || "-"}
                </div>
              </div>

              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>범위</div>
                <div style={styles.metaValue} title={range || ""}>
                  {range}
                </div>
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
        </div>
      </div>
    </StudentShell>
  );
}
