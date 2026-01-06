// src/pages/TeacherFocusMonitor.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
dayjs.locale("ko");

/**
 * TeacherFocusMonitor
 * ✅ 가운데 흰색 네모(box) 제거 → 화면 전체 사용
 * ✅ iPhone 모바일 최적화
 *  - safe-area(노치/홈바) 대응
 *  - 100dvh 사용(모바일 Safari 주소창 변화 대응)
 *  - 상단 컨트롤 sticky
 *  - 테이블은 모바일에서 가로 스크롤 + UA/URL은 줄바꿈/축약
 *  - 버튼/입력 터치 타겟 44px
 * ✅ 기능/로직 그대로 유지 (필터/실시간/그룹핑/복사)
 */

const THEME = {
  bg: "#f7f9fc",
  card: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  border2: "#f1f4f8",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  danger: "#b00020",
};

export default function TeacherFocusMonitor() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터
  const [filterMode, setFilterMode] = useState("today"); // 'today' | 'all' | 'session'
  const [sessionFilter, setSessionFilter] = useState("");

  // 추가 필터(선택): 이름/책/이벤트
  const [q, setQ] = useState("");
  const [eventType, setEventType] = useState("all"); // all | hidden | blur | pagehide | etc.

  // 펼치기/접기 (학생+세션 카드)
  const [openKeys, setOpenKeys] = useState(() => new Set());

  // 실시간 재조회 스로틀
  const refetchTimer = useRef(null);

  const timeRange = useMemo(() => {
    if (filterMode !== "today") return null;
    const start = dayjs().startOf("day").toISOString();
    const end = dayjs().endOf("day").toISOString();
    return { start, end };
  }, [filterMode]);

  // ✅ 세션 메타 캐시 (id -> session row)
  const sessionCacheRef = useRef(new Map());

  async function fetchSessionsByIds(ids) {
    const uniq = Array.from(new Set((ids || []).filter(Boolean)));
    if (uniq.length === 0) return new Map();

    const need = uniq.filter((id) => !sessionCacheRef.current.has(id));
    if (need.length === 0) return sessionCacheRef.current;

    const { data, error } = await supabase
      .from("test_sessions")
      .select("id, student_name, teacher_name, book, chapters_text, status")
      .in("id", need);

    if (error) {
      console.error("[focus monitor] sessions fetch error", error);
      return sessionCacheRef.current;
    }

    (data || []).forEach((s) => {
      sessionCacheRef.current.set(s.id, s);
    });

    return sessionCacheRef.current;
  }

  const fetchLogs = async () => {
    setLoading(true);

    let query = supabase
      .from("focus_events")
      .select("id, created_at, session_id, student_id, student_name, teacher_name, event_type, detail")
      .order("created_at", { ascending: false })
      .limit(500);

    if (filterMode === "today" && timeRange) {
      query = query.gte("created_at", timeRange.start).lte("created_at", timeRange.end);
    }
    if (filterMode === "session" && sessionFilter) {
      query = query.eq("session_id", sessionFilter);
    }
    if (eventType !== "all") {
      query = query.eq("event_type", eventType);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[focus monitor] fetch error", error);
      setLogs([]);
      setLoading(false);
      return;
    }

    const rows = (data || []).map((r) => ({
      ...r,
      session: null,
    }));

    // 세션 메타 붙이기
    const sessionIds = rows.map((r) => r.session_id).filter(Boolean);
    await fetchSessionsByIds(sessionIds);

    const enriched = rows.map((r) => {
      const s = r.session_id ? sessionCacheRef.current.get(r.session_id) : null;
      return { ...r, session: s || null };
    });

    // 프론트 필터(검색): 학생명 / 책 / 범위 / 세션ID / 이벤트타입
    const qq = (q || "").trim().toLowerCase();
    const filtered = !qq
      ? enriched
      : enriched.filter((r) => {
          const student =
            (r?.session?.student_name || r?.detail?.student_name || r?.student_name || "").toLowerCase();
          const book = (r?.session?.book || r?.detail?.book || "").toLowerCase();
          const range = (r?.session?.chapters_text || r?.detail?.chapters_text || "").toLowerCase();
          const sid = (r?.session?.id || r?.session_id || "").toString().toLowerCase();
          const et = (r?.event_type || "").toLowerCase();

          return student.includes(qq) || book.includes(qq) || range.includes(qq) || sid.includes(qq) || et.includes(qq);
        });

    setLogs(filtered);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();

    const channel = supabase
      .channel("focus_monitor_v3")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "focus_events" }, (payload) => {
        const row = payload?.new;
        if (!row) return;

        if (filterMode === "session" && sessionFilter && row.session_id !== sessionFilter) return;

        if (filterMode === "today" && timeRange) {
          const ts = new Date(row.created_at).toISOString();
          if (ts < timeRange.start || ts > timeRange.end) return;
        }

        if (eventType !== "all" && row.event_type !== eventType) return;

        if (refetchTimer.current) clearTimeout(refetchTimer.current);
        refetchTimer.current = setTimeout(() => {
          fetchLogs();
          refetchTimer.current = null;
        }, 250);
      })
      .subscribe();

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, sessionFilter, timeRange?.start, timeRange?.end, q, eventType]);

  // 학생/세션별 집계 (최근순 유지)
  const grouped = useMemo(() => {
    const map = new Map();
    for (const row of logs) {
      const student =
        row?.session?.student_name || row?.detail?.student_name || row?.student_name || "(이름없음)";
      const sid = row?.session?.id || row?.session_id || "unknown";
      const key = `${student}::${sid}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [logs]);

  // 카드 열고닫기
  function toggleOpen(key) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function openAll() {
    const keys = Array.from(grouped.keys());
    setOpenKeys(new Set(keys));
  }
  function closeAll() {
    setOpenKeys(new Set());
  }

  const eventLabel = (t) => {
    if (!t) return "-";
    if (t === "hidden") return "탭/앱 전환(hidden)";
    if (t === "blur") return "화면 이탈(blur)";
    if (t === "pagehide") return "페이지 종료/전환(pagehide)";
    if (t === "beforeunload") return "페이지 이탈(beforeunload)";
    return t;
  };

  return (
    <div style={styles.page}>
      {/* ✅ 상단 sticky 헤더 */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.headerTop}>
            <h2 style={styles.title}>이탈 감지 (실시간)</h2>

            <div style={styles.headerBtns}>
              <button style={styles.pillBtn(false)} onClick={fetchLogs}>
                새로고침
              </button>
              <button style={styles.pillBtn(false)} onClick={openAll}>
                전체 펼치기
              </button>
              <button style={styles.pillBtn(false)} onClick={closeAll}>
                전체 접기
              </button>
            </div>
          </div>

          {/* 필터 UI */}
          <div style={styles.filters}>
            <button style={styles.pillBtn(filterMode === "today")} onClick={() => setFilterMode("today")}>
              오늘
            </button>
            <button style={styles.pillBtn(filterMode === "all")} onClick={() => setFilterMode("all")}>
              전체
            </button>

            <div style={styles.sessionFilterWrap}>
              <button style={styles.pillBtn(filterMode === "session")} onClick={() => setFilterMode("session")}>
                세션ID
              </button>
              <input
                placeholder="session_id 입력"
                value={sessionFilter}
                onChange={(e) => setSessionFilter(e.target.value)}
                style={styles.input}
                inputMode="text"
              />
            </div>

            <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={styles.select}>
              <option value="all">이벤트 전체</option>
              <option value="hidden">hidden (탭/앱 전환)</option>
              <option value="blur">blur (화면 이탈)</option>
              <option value="pagehide">pagehide (페이지 종료/전환)</option>
              <option value="beforeunload">beforeunload (페이지 이탈)</option>
            </select>

            <input
              placeholder="검색(학생/책/범위/세션ID/이벤트)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ ...styles.input, minWidth: 260, flex: 1 }}
            />
          </div>

          <div style={{ marginTop: 10 }}>
            {loading ? <div style={styles.state}>로딩 중…</div> : logs.length === 0 ? <div style={styles.state}>기록이 없습니다.</div> : null}
          </div>
        </div>
      </div>

      {/* ✅ 목록 */}
      <div style={styles.content}>
        {Array.from(grouped.entries()).map(([key, rows]) => {
          const [studentName, sid] = key.split("::");
          const lastAt = rows[0]?.created_at ? dayjs(rows[0].created_at).format("HH:mm:ss") : "-";
          const firstAt = rows[rows.length - 1]?.created_at ? dayjs(rows[rows.length - 1].created_at).format("HH:mm:ss") : "-";
          const isOpen = openKeys.has(key);

          const session = rows[0]?.session;
          const teacherName = session?.teacher_name || rows[0]?.teacher_name || rows[0]?.detail?.teacher_name || "-";
          const book = session?.book || rows[0]?.detail?.book || "-";
          const range = session?.chapters_text || rows[0]?.detail?.chapters_text || "-";
          const status = session?.status || "-";

          return (
            <div key={key} style={styles.card}>
              <div style={styles.cardTop}>
                <div style={{ minWidth: 0 }}>
                  <div style={styles.studentName}>{studentName}</div>
                  <div style={styles.cardMeta}>
                    세션ID: <span style={styles.mono}>{sid}</span> · 이탈 {rows.length}회 · 최근 {lastAt} (시작 {firstAt})
                  </div>
                  <div style={styles.cardMeta2}>
                    교사: {teacherName} · 도서: {book} · 범위: {range} · 상태: {status}
                  </div>
                </div>

                <div style={styles.cardBtns}>
                  <button style={styles.pillBtn(isOpen)} onClick={() => toggleOpen(key)}>
                    {isOpen ? "접기" : "펼치기"}
                  </button>
                  <button
                    style={styles.pillBtn(false)}
                    onClick={() => {
                      setFilterMode("session");
                      setSessionFilter(sid);
                      setOpenKeys((prev) => {
                        const next = new Set(prev);
                        next.add(key);
                        return next;
                      });
                    }}
                    title="이 세션만 보기"
                  >
                    이 세션만
                  </button>
                </div>
              </div>

              {isOpen && (
                <div style={{ marginTop: 12 }}>
                  {/* ✅ 모바일 대응: 테이블 가로 스크롤 */}
                  <div style={styles.tableScroll}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>시간</th>
                          <th style={styles.th}>이벤트</th>
                          <th style={styles.th}>가시성</th>
                          <th style={styles.th}>문항</th>
                          <th style={styles.th}>페이지</th>
                          <th style={styles.th}>UserAgent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const ua = r?.detail?.userAgent || r?.detail?.user_agent || r?.detail?.ua || "";
                          const vs = r?.detail?.visibilityState || r?.detail?.visible_state || "-";
                          const atQ = r?.detail?.at_question ?? "-";
                          const totalQ = r?.detail?.total_questions ?? "-";
                          const href = r?.detail?.href || "";

                          return (
                            <tr key={r.id}>
                              <td style={styles.td}>{dayjs(r.created_at).format("HH:mm:ss")}</td>
                              <td style={styles.td}>{eventLabel(r.event_type)}</td>
                              <td style={styles.td}>{vs || "-"}</td>
                              <td style={styles.td}>
                                {atQ}
                                {totalQ !== "-" ? ` / ${totalQ}` : ""}
                              </td>
                              <td style={{ ...styles.td, maxWidth: 280 }}>
                                <span style={styles.ellip}>{href || "-"}</span>
                              </td>
                              <td style={{ ...styles.td, maxWidth: 360 }}>
                                <span style={styles.ellip}>{ua || "-"}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      style={styles.pillBtn(false)}
                      onClick={() => {
                        try {
                          const text = JSON.stringify(
                            rows.map((r) => ({
                              id: r.id,
                              created_at: r.created_at,
                              event_type: r.event_type,
                              detail: r.detail,
                            })),
                            null,
                            2
                          );
                          navigator.clipboard.writeText(text);
                          alert("이 세션 로그(JSON) 복사 완료");
                        } catch {
                          alert("복사 실패");
                        }
                      }}
                    >
                      이 세션 로그 복사(JSON)
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
    maxWidth: 1200,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
  },

  headerTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: "-0.2px",
    lineHeight: "24px",
    color: THEME.text,
  },

  headerBtns: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
  },

  filters: {
    marginTop: 12,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },

  sessionFilterWrap: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    flexWrap: "wrap",
  },

  input: {
    height: 44, // ✅ iPhone
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    padding: "0 12px",
    background: "#fff",
    color: THEME.text,
    fontWeight: 800,
    outline: "none",
    boxShadow: "0 8px 22px rgba(0,0,0,0.05)",
  },

  select: {
    height: 44, // ✅ iPhone
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    padding: "0 12px",
    background: "#fff",
    color: THEME.text,
    fontWeight: 900,
    outline: "none",
    boxShadow: "0 8px 22px rgba(0,0,0,0.05)",
  },

  pillBtn: (primary) => ({
    height: 44, // ✅ iPhone
    padding: "0 14px",
    borderRadius: 999,
    border: primary ? "none" : `1px solid ${THEME.border}`,
    fontWeight: 900,
    background: primary ? THEME.pink : "#fff",
    color: primary ? "#fff" : THEME.text,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(31,42,68,.06)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  }),

  state: {
    color: THEME.sub,
    fontWeight: 800,
    fontSize: 13,
  },

  // ✅ content (전체 폭)
  content: {
    maxWidth: 1200,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  card: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    background: THEME.card,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },

  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },

  studentName: {
    fontWeight: 900,
    fontSize: 16,
    color: THEME.text,
    wordBreak: "break-word",
  },

  cardMeta: {
    color: THEME.sub,
    fontSize: 13,
    marginTop: 4,
    fontWeight: 700,
    wordBreak: "break-word",
  },

  cardMeta2: {
    color: "#7b879a",
    fontSize: 12,
    marginTop: 4,
    fontWeight: 700,
    wordBreak: "break-word",
  },

  cardBtns: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  mono: {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: 12,
  },

  tableScroll: {
    width: "100%",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    borderRadius: 12,
    border: `1px solid ${THEME.border2}`,
    background: "#fff",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 920, // ✅ 모바일에서 스크롤 생기게(가독성)
  },

  th: {
    textAlign: "left",
    fontSize: 12,
    color: THEME.sub,
    padding: "10px 8px",
    borderBottom: `1px solid ${THEME.border}`,
    background: "#fbfcff",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },

  td: {
    fontSize: 12,
    color: "#334155",
    padding: "10px 8px",
    borderBottom: `1px solid ${THEME.border2}`,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },

  ellip: {
    display: "inline-block",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
