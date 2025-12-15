// src/pages/TeacherFocusMonitor.jsx
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
dayjs.locale("ko");

export default function TeacherFocusMonitor() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState("today"); // 'today' | 'all' | 'session'
  const [sessionFilter, setSessionFilter] = useState("");

  const timeRange = useMemo(() => {
    if (filterMode !== "today") return null;
    const start = dayjs().startOf("day").toISOString();
    const end = dayjs().endOf("day").toISOString();
    return { start, end };
  }, [filterMode]);

  const fetchLogs = async () => {
    setLoading(true);

    let query = supabase
      .from("exam_focus_logs")
      .select(`
        id, created_at, event, visible_state, user_agent,
        session:test_sessions(id, student_name, teacher_name, book, chapters_text, status),
        profile:profiles(id, name, school, grade)
      `)
      .order("created_at", { ascending: false })
      .limit(500);

    if (filterMode === "today" && timeRange) {
      query = query.gte("created_at", timeRange.start).lte("created_at", timeRange.end);
    }
    if (filterMode === "session" && sessionFilter) {
      query = query.eq("session_id", sessionFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[focus monitor] fetch error", error);
      setLogs([]);
    } else {
      setLogs(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    // 실시간 구독
    const channel = supabase
      .channel("focus_monitor")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "exam_focus_logs" },
        (payload) => {
          // 필터에 맞는 경우만 반영
          const row = payload.new;
          if (filterMode === "session" && sessionFilter && row.session_id !== sessionFilter) return;
          if (filterMode === "today" && timeRange) {
            const ts = new Date(row.created_at).toISOString();
            if (ts < timeRange.start || ts > timeRange.end) return;
          }
          // 참조 필드 없으니 새로 고침이 더 안전하지만, 일단 즉시 재조회
          fetchLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, sessionFilter, timeRange?.start, timeRange?.end]);

  // 학생/세션별 집계
  const grouped = useMemo(() => {
    const map = new Map();
    for (const row of logs) {
      const student = row?.profile?.name || "(이름없음)";
      const sid = row?.session?.id || "unknown";
      const key = `${student}::${sid}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [logs]);

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", padding: 24 }}>
      <div style={box}>
        <h2 style={{ margin: 0, fontSize: 22 }}>⚠️ 이탈 감지 (실시간)</h2>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            style={btn(filterMode === "today")}
            onClick={() => setFilterMode("today")}
          >오늘</button>
          <button
            style={btn(filterMode === "all")}
            onClick={() => setFilterMode("all")}
          >전체</button>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              style={btn(filterMode === "session")}
              onClick={() => setFilterMode("session")}
            >세션ID</button>
            <input
              placeholder="session_id 입력"
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              style={input}
            />
            <button style={btn(false)} onClick={fetchLogs}>새로고침</button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          {loading ? <p>로딩 중…</p> : logs.length === 0 ? <p>기록이 없습니다.</p> : null}
        </div>

        {/* 목록(최근순) */}
        <div style={{ marginTop: 8 }}>
          {Array.from(grouped.entries()).map(([key, rows]) => {
            const [studentName, sid] = key.split("::");
            const lastAt = rows[0]?.created_at ? dayjs(rows[0].created_at).format("HH:mm:ss") : "-";
            return (
              <div key={key} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{studentName}</div>
                    <div style={{ color: "#666", fontSize: 13 }}>
                      세션ID: {sid} · 이탈 {rows.length}회 · 최근 {lastAt}
                    </div>
                    {rows[0]?.session && (
                      <div style={{ color: "#888", fontSize: 12 }}>
                        교사: {rows[0].session.teacher_name || "-"} · 도서: {rows[0].session.book || "-"} · 범위: {rows[0].session.chapters_text || "-"}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 8 }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th>시간</th>
                        <th>상태</th>
                        <th>가시성</th>
                        <th>UserAgent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>{dayjs(r.created_at).format("HH:mm:ss")}</td>
                          <td>{r.event}</td>
                          <td>{r.visible_state || "-"}</td>
                          <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.user_agent || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const box = {
  maxWidth: 1100, margin: "0 auto", background: "#fff", borderRadius: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)", padding: 20
};
const card = {
  border: "1px solid #eee", borderRadius: 10, padding: 12, marginBottom: 12, background: "#fff"
};
const table = {
  width: "100%", borderCollapse: "collapse"
};
const input = {
  height: 40, border: "1px solid #ddd", borderRadius: 8, padding: "0 10px"
};
const btn = (primary) => ({
  height: 40,
  padding: "0 14px",
  borderRadius: 8,
  border: "none",
  fontWeight: 700,
  background: primary ? "#ff6fa3" : "#f0f0f0",
  color: primary ? "#fff" : "#444",
  cursor: "pointer"
});
