import { useEffect, useMemo, useState } from "react";
import { supabase } from "../utils/supabaseClient";
import DeleteStudentButton from "../components/DeleteStudentButton";

/**
 * TeacherManagePage (학생관리)
 * ✅ 화면 전체 사용(가운데 흰 네모 박스 제거)
 * ✅ iPhone 모바일 최적화
 *  - safe-area(노치/홈바) 대응
 *  - 100dvh 사용(모바일 Safari 주소창 변화 대응)
 *  - 검색/새로고침 상단 고정(sticky)
 *  - 테이블은 모바일에서 카드 리스트로 자동 전환
 * ✅ 기능은 기존 그대로 (검색/새로고침/삭제)
 */

export default function TeacherManagePage() {
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setLoading(true);
      setErr("");

      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, school, grade, phone, teacher_name")
        .order("name", { ascending: true });

      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      console.error(e);
      setErr(e.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => {
      return (
        (r.name || "").toLowerCase().includes(t) ||
        (r.school || "").toLowerCase().includes(t) ||
        (r.grade || "").toLowerCase().includes(t) ||
        (r.teacher_name || "").toLowerCase().includes(t) ||
        (r.phone || "").toLowerCase().includes(t)
      );
    });
  }, [q, rows]);

  return (
    <div style={styles.page}>
      {/* ✅ 상단 영역(전체 폭, sticky) */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.titleRow}>
            <h1 style={styles.title}>학생관리</h1>
            <div style={styles.count}>
              {loading ? "불러오는 중..." : `${filtered.length}명`}
            </div>
          </div>

          <div style={styles.toolbar}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름/학교/학년/담당T/전화번호 검색"
              style={styles.input}
              inputMode="search"
            />
            <button onClick={load} disabled={loading} style={styles.reload}>
              {loading ? "로딩..." : "새로고침"}
            </button>
          </div>

          {err && <div style={styles.err}>오류: {err}</div>}
        </div>
      </div>

      {/* ✅ 콘텐츠 영역 */}
      <div style={styles.content}>
        {/* ✅ PC/태블릿: 테이블 */}
        <div style={styles.tableWrap} aria-label="학생 목록 테이블">
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>이름</th>
                <th style={styles.th}>학교</th>
                <th style={styles.th}>학년</th>
                <th style={styles.th}>담당T</th>
                <th style={styles.th}>전화</th>
                <th style={{ ...styles.th, width: 160, textAlign: "right" }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((st) => (
                <tr key={st.id}>
                  <td style={styles.td}>{st.name}</td>
                  <td style={styles.td}>{st.school}</td>
                  <td style={styles.td}>{st.grade}</td>
                  <td style={styles.td}>{st.teacher_name}</td>
                  <td style={styles.td}>{st.phone}</td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    <DeleteStudentButton
                      studentId={st.id}
                      studentName={st.name}
                      onDone={load}
                    />
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={styles.emptyRow}>
                    검색 결과가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ✅ iPhone/모바일: 카드 리스트 (테이블 숨김) */}
        <div style={styles.cardsWrap} aria-label="학생 목록 카드">
          {filtered.map((st) => (
            <div key={st.id} style={styles.card}>
              <div style={styles.cardTop}>
                <div style={{ minWidth: 0 }}>
                  <div style={styles.cardName}>{st.name || "-"}</div>
                  <div style={styles.cardMeta}>
                    {[st.school, st.grade, st.teacher_name].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>

                <div style={styles.cardAction}>
                  <DeleteStudentButton
                    studentId={st.id}
                    studentName={st.name}
                    onDone={load}
                  />
                </div>
              </div>

              <div style={styles.cardBottom}>
                <div style={styles.kv}>
                  <div style={styles.k}>전화</div>
                  <div style={styles.v}>{st.phone || "—"}</div>
                </div>
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div style={styles.emptyCard}>검색 결과가 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const THEME = {
  bg: "#f7f9fc", // 관리자 톤과 맞춤 (AdminGate THEME.bg)
  card: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  danger: "#b00020",
};

const styles = {
  // ✅ 전체 화면 사용 + iPhone safe-area
  page: {
    minHeight: "100vh",
    height: "100dvh",
    background: THEME.bg,
    color: THEME.text,
  },

  // ✅ 상단 sticky (노치 대응)
  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: THEME.bg,
    paddingTop: "env(safe-area-inset-top, 0px)",
    borderBottom: `1px solid ${THEME.border}`,
  },
  headerInner: {
    padding: "14px 14px 12px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    maxWidth: 1200,
    margin: "0 auto",
  },

  titleRow: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 900,
    color: THEME.text,
    letterSpacing: "-0.2px",
  },
  count: {
    fontSize: 13,
    fontWeight: 800,
    color: THEME.sub,
  },

  toolbar: {
    display: "flex",
    gap: 10,
    marginTop: 10,
    alignItems: "center",
  },
  input: {
    flex: 1,
    height: 44, // ✅ iPhone 터치 타겟
    padding: "0 12px",
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    fontSize: 14,
    outline: "none",
    background: "#fff",
    color: THEME.text,
    boxShadow: "0 6px 18px rgba(0,0,0,0.04)",
  },
  reload: {
    height: 44, // ✅ iPhone 터치 타겟
    padding: "0 14px",
    borderRadius: 12,
    border: "none",
    cursor: "pointer",
    background: THEME.pink,
    color: "#fff",
    fontWeight: 900,
    boxShadow: "0 8px 22px rgba(255,111,163,0.22)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  err: {
    marginTop: 10,
    color: THEME.danger,
    fontWeight: 800,
    fontSize: 13,
    background: "#fff",
    border: `1px solid #ffd3e3`,
    borderRadius: 12,
    padding: "10px 12px",
  },

  // 콘텐츠 영역 (safe-area bottom)
  content: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  // ✅ PC: table
  tableWrap: {
    background: THEME.card,
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
    // ✅ 모바일에선 숨김
    display: "block",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  th: {
    textAlign: "left",
    fontSize: 13,
    color: THEME.sub,
    fontWeight: 900,
    padding: "12px 14px",
    background: "#fbfcff",
    borderBottom: `1px solid ${THEME.border}`,
  },
  td: {
    padding: "12px 14px",
    borderBottom: `1px solid ${THEME.border}`,
    fontSize: 14,
    color: THEME.text,
    verticalAlign: "middle",
  },
  emptyRow: {
    textAlign: "center",
    color: THEME.sub,
    padding: "18px",
    fontWeight: 800,
  },

  // ✅ 모바일: cards
  cardsWrap: {
    display: "none",
  },
  card: {
    background: THEME.card,
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },
  cardTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardName: {
    fontSize: 16,
    fontWeight: 900,
    color: THEME.text,
    lineHeight: "20px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  cardMeta: {
    marginTop: 6,
    fontSize: 13,
    color: THEME.sub,
    fontWeight: 700,
    lineHeight: "16px",
    wordBreak: "break-word",
  },
  cardAction: {
    flex: "0 0 auto",
  },
  cardBottom: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: `1px dashed ${THEME.border}`,
  },
  kv: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
  k: {
    fontSize: 12,
    fontWeight: 900,
    color: THEME.sub,
  },
  v: {
    fontSize: 14,
    fontWeight: 900,
    color: THEME.text,
    wordBreak: "break-word",
    textAlign: "right",
  },
  emptyCard: {
    background: THEME.card,
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    padding: 16,
    textAlign: "center",
    color: THEME.sub,
    fontWeight: 900,
  },
};

// ✅ 반응형: 모바일에서 테이블 숨기고 카드 표시
// (inline style만 쓰고 있어서 media query는 JS로 흉내냄)
// 가장 안전하게: window.matchMedia로 제어하지 않고, CSS가 없으니 "간단하게" 폭 기반으로만 토글하려면
// 별도 CSS가 필요함. 하지만 지금 파일만으로 끝내려면 아래처럼 런타임으로 주입.
(function injectTeacherManageResponsiveCss() {
  if (typeof document === "undefined") return;
  const id = "teacher-manage-responsive-css-v1";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.innerHTML = `
    @media (max-width: 520px) {
      [aria-label="학생 목록 테이블"] { display: none !important; }
      [aria-label="학생 목록 카드"] { display: grid !important; gap: 12px !important; }
    }
  `;
  document.head.appendChild(style);
})();
