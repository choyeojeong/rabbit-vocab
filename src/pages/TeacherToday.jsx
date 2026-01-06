// src/pages/TeacherToday.jsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../utils/supabaseClient";

/**
 * TeacherToday
 * ✅ 가운데 흰색 네모(box) 제거 → 화면 전체 사용
 * ✅ iPhone 모바일 최적화
 *  - safe-area(노치/홈바) 대응
 *  - 100dvh 사용(모바일 Safari 주소창 변화 대응)
 *  - 상단 헤더 sticky
 *  - 목록을 모바일에서 보기 좋게 카드/리스트 스타일 개선
 * ✅ 기능은 그대로 유지 (오늘 finalized 결과 조회 + pass/fail 분리)
 */

const THEME = {
  bg: "#f7f9fc",
  card: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  link: "#4361ee",
  okSoft: "#e9fff2",
  okText: "#0f7a3a",
  badSoft: "#fff1f2",
  badText: "#b00020",
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
          .eq("status", "finalized")
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
      {/* ✅ 상단 sticky 헤더 */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.headerRow}>
            <div>
              <h2 style={styles.title}>오늘의 통과/불통과</h2>
              <div style={styles.subTitle}>확정(finalized)된 결과만 표시</div>
            </div>

            <Link to="/teacher/review" style={styles.linkBtn}>
              ← 미검수 목록
            </Link>
          </div>

          {/* ✅ 요약 배지 */}
          {!loading && (
            <div style={styles.summaryRow}>
              <span style={{ ...styles.pill, borderColor: THEME.border, background: "#fff" }}>
                통과 {passed.length}명
              </span>
              <span style={{ ...styles.pill, borderColor: THEME.border, background: "#fff" }}>
                불통과 {failed.length}명
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={styles.content}>
        {loading ? (
          <div style={styles.stateText}>불러오는 중…</div>
        ) : (
          <div style={styles.grid}>
            {/* ✅ 통과 */}
            <section style={styles.section}>
              <div style={styles.sectionHeader}>
                <div style={styles.sectionTitle}>통과한 학생</div>
                <span style={{ ...styles.sectionBadge, background: THEME.okSoft, color: THEME.okText }}>
                  {passed.length}
                </span>
              </div>

              {passed.length === 0 ? (
                <div style={styles.empty}>없음</div>
              ) : (
                <div style={styles.list}>
                  {passed.map((s) => (
                    <div key={s.id} style={styles.itemCard}>
                      <div style={styles.itemText}>{lineFor(s)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ✅ 불통과 */}
            <section style={styles.section}>
              <div style={styles.sectionHeader}>
                <div style={styles.sectionTitle}>응시했지만 최종 불통과</div>
                <span style={{ ...styles.sectionBadge, background: THEME.badSoft, color: THEME.badText }}>
                  {failed.length}
                </span>
              </div>

              {failed.length === 0 ? (
                <div style={styles.empty}>없음</div>
              ) : (
                <div style={styles.list}>
                  {failed.map((s) => (
                    <div key={s.id} style={styles.itemCard}>
                      <div style={styles.itemText}>{lineFor(s)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    height: "100dvh",
    background: THEME.bg,
    color: THEME.text,
  },

  // ✅ sticky header + safe-area
  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: THEME.bg,
    paddingTop: "env(safe-area-inset-top, 0px)",
    borderBottom: `1px solid ${THEME.border}`,
  },
  headerInner: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 12,
    flexWrap: "wrap",
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 900,
    color: THEME.text,
    letterSpacing: "-0.2px",
    lineHeight: "24px",
  },
  subTitle: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: 700,
    color: THEME.sub,
  },

  linkBtn: {
    height: 44, // ✅ iPhone 터치 타겟
    display: "inline-flex",
    alignItems: "center",
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.link,
    fontWeight: 900,
    textDecoration: "none",
    boxShadow: "0 10px 22px rgba(31,42,68,.06)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  summaryRow: {
    marginTop: 12,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  pill: {
    height: 36,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.text,
    fontWeight: 900,
    fontSize: 13,
  },

  content: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  stateText: {
    marginTop: 10,
    color: THEME.sub,
    fontWeight: 800,
  },

  // ✅ PC: 2열 / 모바일: 1열
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
  },

  section: {
    background: THEME.card,
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
    minWidth: 0,
  },

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  sectionTitle: {
    fontWeight: 900,
    color: THEME.text,
    fontSize: 14,
  },

  sectionBadge: {
    fontSize: 12,
    fontWeight: 900,
    padding: "4px 10px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
  },

  empty: {
    marginTop: 10,
    color: THEME.sub,
    fontWeight: 800,
    fontStyle: "italic",
  },

  list: {
    marginTop: 12,
    display: "grid",
    gap: 10,
  },

  itemCard: {
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: "#fbfcff",
    padding: 12,
  },

  itemText: {
    fontSize: 13,
    lineHeight: "18px",
    color: THEME.text,
    wordBreak: "break-word",
    fontWeight: 800,
  },
};

// ✅ 반응형(모바일에서 1열로)
(function injectTeacherTodayCss() {
  if (typeof document === "undefined") return;
  const id = "teacher-today-responsive-css-v1";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.innerHTML = `
    @media (max-width: 700px) {
      /* 2열 → 1열 */
      div[style*="grid-template-columns: repeat(2"] {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  document.head.appendChild(style);
})();
