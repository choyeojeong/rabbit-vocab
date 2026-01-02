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

  // ✅ 세션은 state로 들고와서 렌더/의존성 안전하게
  const [who, setWho] = useState(() => {
    const me = getSession();
    return { id: me?.id || null, name: (me?.name || "").trim() };
  });

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // ✅ 탭: all | pass | fail
  const [tab, setTab] = useState("all");

  // ✅ 마운트 시 한 번 더 “실존 학생” 검증
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

  // ✅ 파생값 + 필터
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
    shell: { width: "100%", color: COLORS.text },
    card: {
      background: COLORS.card,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 16,
      padding: 14,
      boxShadow: "0 10px 30px rgba(31,42,68,0.06)",
    },
    topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
    title: { fontSize: 18, fontWeight: 900, color: COLORS.text, margin: 0 },
    sub: { fontSize: 12, color: COLORS.sub, marginTop: 2 },
    refreshBtn: {
      padding: "8px 12px",
      borderRadius: 999,
      border: `1px solid ${COLORS.border}`,
      background: "#fff",
      color: COLORS.text,
      fontWeight: 800,
      cursor: "pointer",
      whiteSpace: "nowrap",
    },

    // Tabs
    tabsWrap: {
      marginTop: 12,
      background: "#fff",
      border: `1px solid ${COLORS.border}`,
      borderRadius: 999,
      padding: 4,
      display: "flex",
      gap: 4,
      width: "100%",
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
      borderRadius: 14,
      overflow: "hidden",
      background: "#fff",
    },
    headRow: {
      display: "grid",
      gridTemplateColumns: "90px 1.2fr 1fr 96px 84px 22px",
      gap: 8,
      padding: "10px 12px",
      background: "#fbfcff",
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
      background: "#fff",
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

    // Mobile hint
    mobileHint: { marginTop: 10, fontSize: 12, color: COLORS.sub, textAlign: "center" },
    bottomLink: { marginTop: 12, color: COLORS.blue, fontWeight: 900, display: "inline-block" },
  };

  // 비로그인 상태
  if (!who.id && !who.name) {
    return (
      <StudentShell>
        <div className="vh-100 centered with-safe" style={styles.shell}>
          <div className="student-container">
            <div className="student-card stack" style={styles.card}>
              <div className="student-text" style={{ color: COLORS.text, fontWeight: 900 }}>
                로그인 후 공식시험 결과를 확인할 수 있어요.
              </div>
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <button className="student-button" onClick={() => nav("/login")}>
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
      <div className="vh-100 centered with-safe" style={styles.shell}>
        <div className="student-container">
          <div className="student-card stack" style={styles.card}>
            {/* Header */}
            <div style={styles.topRow}>
              <div>
                <h2 style={styles.title}>공식시험 결과</h2>
                <div style={styles.sub}>
                  확정된 결과만 표시돼요 · {who.name ? `${who.name} 학생` : "내 계정"}
                </div>
              </div>

              <button onClick={fetchRows} style={styles.refreshBtn} title="새로고침">
                ⟳ 새로고침
              </button>
            </div>

            {/* Tabs */}
            <div style={styles.tabsWrap} aria-label="결과 필터 탭">
              <button
                type="button"
                style={styles.tabBtn(tab === "all")}
                onClick={() => setTab("all")}
              >
                전체 <span style={styles.tabSmall}>{counts.total}</span>
              </button>
              <button
                type="button"
                style={styles.tabBtn(tab === "pass")}
                onClick={() => setTab("pass")}
              >
                통과 <span style={styles.tabSmall}>{counts.pass}</span>
              </button>
              <button
                type="button"
                style={styles.tabBtn(tab === "fail")}
                onClick={() => setTab("fail")}
              >
                불통과 <span style={styles.tabSmall}>{counts.fail}</span>
              </button>
            </div>

            {err && <div style={{ marginTop: 10, color: "#b42318", fontWeight: 800 }}>{err}</div>}

            {loading ? (
              <div style={{ marginTop: 12, color: COLORS.sub, fontWeight: 800 }}>불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <div style={{ marginTop: 12, color: COLORS.sub, fontWeight: 800 }}>
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
                          e.currentTarget.style.background = "#fff7fb";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "#fff";
                        }}
                        onTouchStart={(e) => {
                          e.currentTarget.style.background = "#fff7fb";
                        }}
                        onTouchEnd={(e) => {
                          e.currentTarget.style.background = "#fff";
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
                            <span style={{ opacity: 0.7, fontWeight: 900 }}>
                              · -{r._wrong}
                            </span>
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
