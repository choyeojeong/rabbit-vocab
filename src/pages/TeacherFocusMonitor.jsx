// src/pages/TeacherFocusMonitor.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
dayjs.locale("ko");

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

  const fetchLogs = async () => {
    setLoading(true);

    // ✅ 변경점:
    // 기존: exam_focus_logs
    // 신규: focus_events (학생 시험 페이지에서 INSERT하는 테이블)
    //
    // focus_events 컬럼:
    // id, created_at, session_id, student_id, student_name, teacher_name, event_type, detail(jsonb)
    //
    // 세션 정보는 test_sessions로 조인해서 book/range 등 표시
    let query = supabase
      .from("focus_events")
      .select(
        `
        id, created_at, event_type, detail,
        session:test_sessions(id, student_name, teacher_name, book, chapters_text, status)
      `
      )
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

    const rows = data || [];

    // 프론트 필터(검색): 학생명 / 책 / 범위 / 세션ID / 이벤트타입
    const qq = (q || "").trim().toLowerCase();
    const filtered = !qq
      ? rows
      : rows.filter((r) => {
          const student = (r?.session?.student_name || r?.detail?.student_name || r?.student_name || "").toLowerCase();
          const book = (r?.session?.book || r?.detail?.book || "").toLowerCase();
          const range = (r?.session?.chapters_text || "").toLowerCase();
          const sid = (r?.session?.id || r?.session_id || "").toString().toLowerCase();
          const et = (r?.event_type || "").toLowerCase();
          return (
            student.includes(qq) ||
            book.includes(qq) ||
            range.includes(qq) ||
            sid.includes(qq) ||
            et.includes(qq)
          );
        });

    setLogs(filtered);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();

    // ✅ 실시간 구독: focus_events INSERT
    const channel = supabase
      .channel("focus_monitor_v2")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "focus_events" },
        (payload) => {
          const row = payload?.new;
          if (!row) return;

          // 필터에 맞는 경우만 반영 (대략적인 필터)
          if (filterMode === "session" && sessionFilter && row.session_id !== sessionFilter) return;
          if (filterMode === "today" && timeRange) {
            const ts = new Date(row.created_at).toISOString();
            if (ts < timeRange.start || ts > timeRange.end) return;
          }
          if (eventType !== "all" && row.event_type !== eventType) return;

          // 참조 조인(test_sessions)이 필요해서 즉시 row push는 위험
          // → 짧게 스로틀해서 재조회
          if (refetchTimer.current) clearTimeout(refetchTimer.current);
          refetchTimer.current = setTimeout(() => {
            fetchLogs();
            refetchTimer.current = null;
          }, 250);
        }
      )
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
        row?.session?.student_name ||
        row?.detail?.student_name ||
        row?.student_name ||
        "(이름없음)";
      const sid = row?.session?.id || row?.session_id || "unknown";
      const key = `${student}::${sid}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    // rows는 already created_at desc라 그룹 내도 대체로 desc
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
    return t;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", padding: 24 }}>
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>⚠️ 이탈 감지 (실시간)</h2>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn(false)} onClick={fetchLogs}>새로고침</button>
            <button style={btn(false)} onClick={openAll}>전체 펼치기</button>
            <button style={btn(false)} onClick={closeAll}>전체 접기</button>
          </div>
        </div>

        {/* 필터 UI */}
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button style={btn(filterMode === "today")} onClick={() => setFilterMode("today")}>오늘</button>
          <button style={btn(filterMode === "all")} onClick={() => setFilterMode("all")}>전체</button>

          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button style={btn(filterMode === "session")} onClick={() => setFilterMode("session")}>세션ID</button>
            <input
              placeholder="session_id 입력"
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              style={input}
            />
          </div>

          <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={select}>
            <option value="all">이벤트 전체</option>
            <option value="hidden">hidden (탭/앱 전환)</option>
            <option value="blur">blur (화면 이탈)</option>
            <option value="pagehide">pagehide (페이지 종료/전환)</option>
          </select>

          <input
            placeholder="검색(학생/책/범위/세션ID/이벤트)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ ...input, minWidth: 280 }}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          {loading ? <p>로딩 중…</p> : logs.length === 0 ? <p>기록이 없습니다.</p> : null}
        </div>

        {/* 목록(최근순) */}
        <div style={{ marginTop: 8 }}>
          {Array.from(grouped.entries()).map(([key, rows]) => {
            const [studentName, sid] = key.split("::");
            const lastAt = rows[0]?.created_at ? dayjs(rows[0].created_at).format("HH:mm:ss") : "-";
            const firstAt = rows[rows.length - 1]?.created_at ? dayjs(rows[rows.length - 1].created_at).format("HH:mm:ss") : "-";
            const isOpen = openKeys.has(key);

            const session = rows[0]?.session;
            const teacherName = session?.teacher_name || rows[0]?.detail?.teacher_name || "-";
            const book = session?.book || rows[0]?.detail?.book || "-";
            const range = session?.chapters_text || "-";
            const status = session?.status || "-";

            return (
              <div key={key} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 16, color: "#222" }}>{studentName}</div>
                    <div style={{ color: "#666", fontSize: 13 }}>
                      세션ID: <span style={mono}>{sid}</span> · 이탈 {rows.length}회 · 최근 {lastAt} (시작 {firstAt})
                    </div>
                    <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>
                      교사: {teacherName} · 도서: {book} · 범위: {range} · 상태: {status}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button style={btn(isOpen)} onClick={() => toggleOpen(key)}>
                      {isOpen ? "접기" : "펼치기"}
                    </button>
                    <button
                      style={btn(false)}
                      onClick={() => {
                        setFilterMode("session");
                        setSessionFilter(sid);
                        // 펼치기
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
                  <div style={{ marginTop: 10 }}>
                    <table style={table}>
                      <thead>
                        <tr>
                          <th style={th}>시간</th>
                          <th style={th}>이벤트</th>
                          <th style={th}>가시성</th>
                          <th style={th}>문항</th>
                          <th style={th}>페이지</th>
                          <th style={th}>UserAgent</th>
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
                              <td style={td}>{dayjs(r.created_at).format("HH:mm:ss")}</td>
                              <td style={td}>{eventLabel(r.event_type)}</td>
                              <td style={td}>{vs || "-"}</td>
                              <td style={td}>{atQ}{totalQ !== "-" ? ` / ${totalQ}` : ""}</td>
                              <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {href || "-"}
                              </td>
                              <td style={{ ...td, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {ua || "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* detail 원문 보기(선택) */}
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        style={btn(false)}
                        onClick={() => {
                          try {
                            const text = JSON.stringify(rows.map((r) => ({ id: r.id, created_at: r.created_at, event_type: r.event_type, detail: r.detail })), null, 2);
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
    </div>
  );
}

const box = {
  maxWidth: 1100,
  margin: "0 auto",
  background: "#fff",
  borderRadius: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  padding: 20,
};

const card = {
  border: "1px solid #eee",
  borderRadius: 12,
  padding: 14,
  marginBottom: 12,
  background: "#fff",
};

const table = {
  width: "100%",
  borderCollapse: "collapse",
};

const th = {
  textAlign: "left",
  fontSize: 12,
  color: "#666",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
};

const td = {
  fontSize: 12,
  color: "#333",
  padding: "10px 8px",
  borderBottom: "1px solid #f1f1f1",
  verticalAlign: "top",
};

const input = {
  height: 40,
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "0 10px",
};

const select = {
  height: 40,
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "0 10px",
  background: "#fff",
};

const mono = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  fontSize: 12,
};

const btn = (primary) => ({
  height: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "none",
  fontWeight: 800,
  background: primary ? "#ff6fa3" : "#f0f0f0",
  color: primary ? "#fff" : "#444",
  cursor: "pointer",
});
