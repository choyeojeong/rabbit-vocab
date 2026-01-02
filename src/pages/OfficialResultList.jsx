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

export default function OfficialResultList() {
  const nav = useNavigate();

  const [who, setWho] = useState(() => {
    const me = getSession();
    return { id: me?.id || null, name: (me?.name || "").trim() };
  });

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

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

      let q = supabase
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

  // ✅ 풀스크린 + 중앙정렬 + 흰 네모 제거 스타일
  const styles = {
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
      maxWidth: 860, // 결과표는 조금 넓게
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

    topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
    title: { fontSize: 18, fontWeight: 900, color: COLORS.text, margin: 0 },
    sub: { fontSize: 12, color: COLORS.sub, marginTop: 2, fontWeight: 800 },

    refreshBtn: {
      padding: "8px 12px",
      borderRadius: 999,
      border: `1px solid ${COLORS.border}`,
      background: "rgba(255,255,255,0.55)",
      color: COLORS.text,
      fontWeight: 900,
      cursor: "pointer",
      whiteSpace: "nowrap",
      boxShadow: "0 10px 20px rgba(31,42,68,0.05)",
    },

    // Tabs
    tabsWrap: {
      marginTop: 12,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 999,
      padding: 4,
      display: "flex",
      gap: 4,
      width: "100%",
      background: "rgba(255,255,255,0.40)",
      backdropFilter: "blur(6px)",
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
      boxShadow: active ? "0 8px 20px rgba(255,111,163,0.25)" : "none",
      transition: "transform 0.05s ease",
    }),
    tabSmall: { fontWeight: 800, opacity: 0.9, marginLeft: 6, fontSize: 12 },

    // Table
    tableWrap: {
      marginTop: 12,
      border: `1px solid ${COLORS.gray}`,
      borderRadius: 16,
      overflow: "hidden",
      background: "rgba(255,255,255,0.55)",
      backdropFilter: "blur(6px)",
      boxShadow: "0 10px 24px rgba(31,42,68,0.06)",
    },
    headRow: {
      display: "grid",
      gridTemplateColumns: "90px 1.2fr 1fr 96px 84px 22px",
      gap: 8,
      padding: "10px 12px",
      background: "rgba(255,255,255,0.65)",
      borderBottom: `1px solid ${COLORS.gray}`,
      fontSize: 12,
      fontWeight: 900,
      color: COLORS.sub,
      alignItems: "center",
    },
    bodyRowLink: {
      display: "grid",
      gridTemplateColumns: "90px 1.2fr 1fr 96px 84px 22px",
      gap: 8,
      padding: "11px 12px",
      alignItems: "center",
      textDecoration: "none",
      color: COLORS.text,
      borderBottom: `1px solid ${COLORS.gray}`,
      background: "transparent",
      cursor: "pointer",
    },
    cellMain: {
      fontSize: 13,
      fontWeight: 900,
      color: COLORS.text,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    cellSub: {
      fontSize: 12,
      color: COLORS.sub,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontWeight: 800,
    },
    badge: (ok) => ({
      justifySelf: "start",
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
    arrow: { fontSize: 18, fontWeight: 900, color: "#a7b0bf", textAlign: "right" },

    // Misc
    errText: { marginTop: 10, color: COLORS.noText, fontWeight: 900 },
    loadingText: { marginTop: 12, color: COLORS.sub, fontWeight: 900 },
    emptyText: { marginTop: 12, color: COLORS.sub, fontWeight: 900 },
    mobileHint: { marginTop: 10, fontSize: 12, color: COLORS.sub, textAlign: "center", fontWeight: 800 },

    bottomLink: { marginTop: 12, color: COLORS.blue, fontWeight: 900, display: "inline-block" },

    // auth empty state
    authText: { color: COLORS.text, fontWeight: 900 },
    authBtn: {
      padding: "12px 16px",
      borderRadius: 12,
      border: "none",
      background: `linear-gradient(90deg, ${COLORS.pink}, ${COLORS.pink2})`,
      color: "#fff",
      fontWeight: 900,
      cursor: "pointer",
      boxShadow: "0 10px 20px rgba(255,111,163,0.22)",
    },
  };

  if (!who.id && !who.name) {
    return (
      <StudentShell>
        <div style={styles.pageWrap}>
          <div style={styles.container}>
            <div style={styles.headBar}>
              <div style={styles.authText}>로그인 후 공식시험 결과를 확인할 수 있어요.</div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <button type="button" style={styles.authBtn} onClick={() => nav("/login")}>
                  로그인 하러 가기
                </button>
              </div>

              <div style={{ marginTop: 10 }}>
                <Link to="/" style={{ color: COLORS.blue, fontWeight: 900 }}>
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
      <div style={styles.pageWrap}>
        <div style={styles.container}>
          {/* Header */}
          <div style={styles.headBar}>
            <div style={styles.topRow}>
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

            {err && <div style={styles.errText}>{err}</div>}

            {loading ? (
              <div style={styles.loadingText}>불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <div style={styles.emptyText}>
                {tab === "all" ? "확정된 결과가 없습니다." : "해당 탭에 표시할 결과가 없어요."}
              </div>
            ) : (
              <>
                {/* Table */}
                <div style={styles.tableWrap} role="table" aria-label="공식시험 결과 표">
                  <div style={styles.headRow} role="row">
                    <div role="columnheader">날짜</div>
                    <div role="columnheader">책</div>
                    <div role="columnheader">범위</div>
                    <div role="columnheader" style={{ textAlign: "right" }}>
                      문제수
                    </div>
                    <div role="columnheader">통과</div>
                    <div role="columnheader" aria-hidden />
                  </div>

                  {filtered.map((r, idx) => {
                    const href = `/exam/official/results/${r.id}`;
                    const isLast = idx === filtered.length - 1;
                    return (
                      <Link
                        key={r.id}
                        to={href}
                        role="row"
                        style={{
                          ...styles.bodyRowLink,
                          borderBottom: isLast ? "none" : styles.bodyRowLink.borderBottom,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(255,255,255,0.35)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                        onTouchStart={(e) => {
                          e.currentTarget.style.background = "rgba(255,255,255,0.35)";
                        }}
                        onTouchEnd={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <div role="cell" style={styles.cellSub}>
                          {r._dateStr}
                        </div>

                        <div role="cell" style={styles.cellMain} title={r.book || ""}>
                          {r.book || "-"}
                        </div>

                        <div role="cell" style={styles.cellSub} title={r._range || ""}>
                          {r._range}
                        </div>

                        <div
                          role="cell"
                          style={{
                            ...styles.cellMain,
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {r._numQ}문제
                        </div>

                        <div role="cell">
                          <span style={styles.badge(!!r.final_pass)}>
                            {r.final_pass ? "통과" : "불통과"}
                            <span style={{ opacity: 0.7, fontWeight: 900 }}>· -{r._wrong}</span>
                          </span>
                        </div>

                        <div role="cell" style={styles.arrow} aria-hidden>
                          ›
                        </div>
                      </Link>
                    );
                  })}
                </div>

                <div style={styles.mobileHint}>원하는 행을 눌러 상세 결과를 확인하세요.</div>
              </>
            )}

            <div style={{ marginTop: 10 }}>
              <Link to="/dashboard" style={styles.bottomLink}>
                ← 대시보드
              </Link>
            </div>
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
