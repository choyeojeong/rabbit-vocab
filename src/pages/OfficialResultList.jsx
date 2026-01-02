// src/pages/OfficialResultList.jsx
import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { ensureLiveStudent, getSession } from "../utils/session";
import StudentShell from "./StudentShell";

dayjs.locale("ko");

const COLORS = {
  bg: "#fff5f8",
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

export default function OfficialResultList() {
  const nav = useNavigate();

  const [who, setWho] = useState(() => {
    const me = getSession();
    return { id: me?.id || null, name: (me?.name || "").trim() };
  });

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // all | pass | fail
  const [tab, setTab] = useState("all");

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

      const q = supabase
        .from("test_sessions")
        .select(
          "id, status, mode, book, chapters_text, chapter_start, chapter_end, num_questions, final_score, final_pass, teacher_confirmed_at, created_at, student_id, student_name"
        )
        .eq("mode", "official")
        .eq("status", "finalized")
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

  const decorated = useMemo(() => {
    return (rows || []).map((r) => {
      const range = r.chapters_text || `${r.chapter_start ?? "?"}-${r.chapter_end ?? "?"}`;
      const numQ = r.num_questions ?? 0;
      const score = r.final_score ?? 0;
      const wrong = Math.max(0, numQ - score);
      const dateStr = dayjs(r.teacher_confirmed_at || r.created_at).format("YYYY.MM.DD");
      return { ...r, _range: range, _numQ: numQ, _wrong: wrong, _dateStr: dateStr };
    });
  }, [rows]);

  const counts = useMemo(() => {
    const total = decorated.length;
    const pass = decorated.filter((r) => !!r.final_pass).length;
    const fail = total - pass;
    return { total, pass, fail };
  }, [decorated]);

  const filtered = useMemo(() => {
    if (tab === "pass") return decorated.filter((r) => !!r.final_pass);
    if (tab === "fail") return decorated.filter((r) => !r.final_pass);
    return decorated;
  }, [decorated, tab]);

  const styles = {
    // ✅ 화면 전체 사용 (네모 카드/패널 없음)
    page: {
      minHeight: "100dvh",
      width: "100%",
      background: COLORS.bg,
      paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)",
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
      paddingLeft: 16,
      paddingRight: 16,
      color: COLORS.text,
    },
    container: {
      width: "100%",
      maxWidth: 980,
      margin: "0 auto",
    },

    // 상단 헤더
    header: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 10,
      marginBottom: 10,
    },
    title: { fontSize: 18, fontWeight: 900, margin: 0, color: COLORS.text },
    sub: { marginTop: 4, fontSize: 12, fontWeight: 800, color: COLORS.sub },

    refreshBtn: {
      padding: "9px 12px",
      borderRadius: 999,
      border: `1px solid ${COLORS.border}`,
      background: "rgba(255,255,255,0.55)",
      color: COLORS.text,
      fontWeight: 900,
      cursor: "pointer",
      whiteSpace: "nowrap",
      boxShadow: "0 10px 18px rgba(31,42,68,0.06)",
    },

    // Tabs
    tabsWrap: {
      marginTop: 8,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 999,
      padding: 4,
      display: "flex",
      gap: 4,
      width: "100%",
      background: "rgba(255,255,255,0.35)",
      backdropFilter: "blur(6px)",
      boxShadow: "0 10px 18px rgba(31,42,68,0.05)",
    },
    tabBtn: (active) => ({
      flex: 1,
      border: "none",
      borderRadius: 999,
      padding: "9px 10px",
      fontWeight: 900,
      cursor: "pointer",
      background: active ? `linear-gradient(90deg, ${COLORS.pink}, ${COLORS.pink2})` : "transparent",
      color: active ? "#fff" : COLORS.sub,
      boxShadow: active ? "0 8px 18px rgba(255,111,163,0.25)" : "none",
    }),
    tabSmall: { fontWeight: 900, opacity: 0.9, marginLeft: 6, fontSize: 12 },

    // 리스트(표 대신)
    list: { marginTop: 12, display: "grid", gap: 10 },

    rowCard: {
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: 10,
      padding: 12,
      borderRadius: 16,
      border: `1px solid rgba(255,255,255,0.55)`,
      background: "rgba(255,255,255,0.55)",
      backdropFilter: "blur(6px)",
      boxShadow: "0 10px 22px rgba(31,42,68,0.06)",
      textDecoration: "none",
      color: COLORS.text,
      transition: "transform 0.12s ease",
    },

    left: { minWidth: 0 },

    topLine: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },

    date: { fontSize: 12, fontWeight: 900, color: COLORS.sub, whiteSpace: "nowrap" },

    badge: (ok) => ({
      display: "inline-flex",
      alignItems: "center",
      padding: "6px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 900,
      background: ok ? COLORS.okBg : COLORS.noBg,
      color: ok ? COLORS.okText : COLORS.noText,
      border: `1px solid ${ok ? "#c7f0d8" : "#ffd0d0"}`,
      whiteSpace: "nowrap",
    }),

    book: {
      marginTop: 6,
      fontSize: 14,
      fontWeight: 900,
      color: COLORS.text,
      lineHeight: 1.25,
      wordBreak: "break-word",
    },

    range: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: 800,
      color: COLORS.sub,
      lineHeight: 1.3,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
    },

    metaRow: {
      marginTop: 8,
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      alignItems: "center",
    },

    chip: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 10px",
      borderRadius: 999,
      background: "rgba(255,255,255,0.55)",
      border: `1px solid ${COLORS.gray}`,
      color: COLORS.text,
      fontSize: 12,
      fontWeight: 900,
      boxShadow: "0 8px 16px rgba(31,42,68,0.04)",
      whiteSpace: "nowrap",
    },
    chipSub: { color: COLORS.sub, fontWeight: 900 },

    right: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      paddingLeft: 6,
      color: "#a7b0bf",
      fontSize: 20,
      fontWeight: 900,
    },

    err: { marginTop: 10, color: COLORS.noText, fontWeight: 900 },
    loading: { marginTop: 12, color: COLORS.sub, fontWeight: 900 },
    empty: { marginTop: 12, color: COLORS.sub, fontWeight: 900 },

    bottomLink: {
      marginTop: 14,
      display: "inline-block",
      color: COLORS.blue,
      fontWeight: 900,
      textDecoration: "none",
    },

    // 로그인 필요 화면도 카드 느낌만 최소
    authBox: {
      marginTop: 12,
      padding: 12,
      borderRadius: 16,
      border: `1px solid rgba(255,255,255,0.55)`,
      background: "rgba(255,255,255,0.55)",
      backdropFilter: "blur(6px)",
      boxShadow: "0 10px 22px rgba(31,42,68,0.06)",
    },
    authBtn: {
      width: "100%",
      marginTop: 10,
      padding: "12px 16px",
      borderRadius: 12,
      border: "none",
      background: `linear-gradient(90deg, ${COLORS.pink}, ${COLORS.pink2})`,
      color: "#fff",
      fontWeight: 900,
      cursor: "pointer",
      boxShadow: "0 10px 18px rgba(255,111,163,0.22)",
    },
  };

  // 비로그인
  if (!who.id && !who.name) {
    return (
      <StudentShell>
        <div style={styles.page}>
          <div style={styles.container}>
            <div style={styles.header}>
              <div>
                <h2 style={styles.title}>공식시험 결과</h2>
                <div style={styles.sub}>로그인 후 결과를 확인할 수 있어요.</div>
              </div>
            </div>

            <div style={styles.authBox}>
              <div style={{ fontWeight: 900, color: COLORS.text }}>로그인 후 공식시험 결과를 확인할 수 있어요.</div>
              <button type="button" style={styles.authBtn} onClick={() => nav("/login")}>
                로그인 하러 가기
              </button>
              <div style={{ marginTop: 10 }}>
                <Link to="/" style={styles.bottomLink}>
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
      <div style={styles.page}>
        <div style={styles.container}>
          {/* Header */}
          <div style={styles.header}>
            <div>
              <h2 style={styles.title}>공식시험 결과</h2>
              <div style={styles.sub}>확정된 결과만 표시돼요 · {who.name ? `${who.name} 학생` : "내 계정"}</div>
            </div>

            <button onClick={fetchRows} style={styles.refreshBtn} title="새로고침" type="button">
              ⟳ 새로고침
            </button>
          </div>

          {/* Tabs */}
          <div style={styles.tabsWrap} aria-label="결과 필터 탭">
            <button type="button" style={styles.tabBtn(tab === "all")} onClick={() => setTab("all")}>
              전체 <span style={styles.tabSmall}>{counts.total}</span>
            </button>
            <button type="button" style={styles.tabBtn(tab === "pass")} onClick={() => setTab("pass")}>
              통과 <span style={styles.tabSmall}>{counts.pass}</span>
            </button>
            <button type="button" style={styles.tabBtn(tab === "fail")} onClick={() => setTab("fail")}>
              불통과 <span style={styles.tabSmall}>{counts.fail}</span>
            </button>
          </div>

          {err && <div style={styles.err}>{err}</div>}

          {loading ? (
            <div style={styles.loading}>불러오는 중…</div>
          ) : filtered.length === 0 ? (
            <div style={styles.empty}>{tab === "all" ? "확정된 결과가 없습니다." : "해당 탭에 표시할 결과가 없어요."}</div>
          ) : (
            <div style={styles.list} aria-label="공식시험 결과 목록">
              {filtered.map((r) => {
                const href = `/exam/official/results/${r.id}`;
                const ok = !!r.final_pass;

                return (
                  <Link
                    key={r.id}
                    to={href}
                    style={styles.rowCard}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0px)";
                    }}
                    onTouchStart={(e) => {
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onTouchEnd={(e) => {
                      e.currentTarget.style.transform = "translateY(0px)";
                    }}
                  >
                    <div style={styles.left}>
                      <div style={styles.topLine}>
                        <div style={styles.date}>{r._dateStr}</div>

                        {/* ✅ 통과/불통과만 표시 (점/숫자 제거) */}
                        <span style={styles.badge(ok)}>{ok ? "통과" : "불통과"}</span>
                      </div>

                      <div style={styles.book}>{r.book || "-"}</div>

                      <div style={styles.range}>
                        <span style={{ fontWeight: 900, color: COLORS.sub }}>범위: </span>
                        {r._range}
                      </div>

                      <div style={styles.metaRow}>
                        <span style={styles.chip}>
                          <span style={styles.chipSub}>문제수</span> {r._numQ}문제
                        </span>

                        {/* ✅ 필요하면 틀린 수는 여기서만 보여주고, 배지 옆 숫자는 안 보여줌 */}
                        <span style={styles.chip}>
                          <span style={styles.chipSub}>틀린 수</span> -{r._wrong}
                        </span>

                        {/* ✅ 상태(검수 확정) 칩 제거 */}
                      </div>
                    </div>

                    <div style={styles.right} aria-hidden>
                      ›
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <Link to="/dashboard" style={styles.bottomLink}>
            ← 대시보드
          </Link>
        </div>
      </div>
    </StudentShell>
  );
}
