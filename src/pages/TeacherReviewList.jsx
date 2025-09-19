// src/pages/TeacherReviewList.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { useDing } from "../utils/ding";

dayjs.locale("ko");

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 24 },
  box: { maxWidth: 900, margin: "0 auto", background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 8px 24px rgba(255,192,217,.35)" },
  title: { fontSize: 22, fontWeight: 800, color: "#ff6fa3", margin: 0 },
  card: { border: "1px solid #ffd3e3", borderRadius: 12, padding: 14, marginTop: 10 },
  line: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  btn: { padding: "8px 12px", borderRadius: 10, border: "none", background: "#ff6fa3", color: "#fff", fontWeight: 700, cursor: "pointer" },
  notif: { position: "fixed", right: 16, top: 16, background: "#111", color: "#fff", padding: "10px 14px", borderRadius: 12, boxShadow: "0 10px 24px rgba(0,0,0,.2)", zIndex: 9999 },
  hint: { fontSize: 12, color: "#888" },
  iconBtn: { padding: "6px 10px", borderRadius: 10, border: "1px solid #ffd3e3", background: "#fff", cursor: "pointer", marginLeft: 8 },
  badge: { fontSize: 12, padding: "2px 8px", borderRadius: 999, border: "1px solid #ffd3e3", background: "#fff" },
};

function rangeText(s) {
  return s.chapters_text || `${s.chapter_start ?? "?"}-${s.chapter_end ?? "?"}`;
}

export default function TeacherReviewList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notif, setNotif] = useState(null);
  const [rtStatus, setRtStatus] = useState("연결 중…");

  const latestCreatedAtRef = useRef(null);
  const seenIdsRef = useRef(new Set()); // 중복 알림 방지
  const notifTimerRef = useRef(null);

  // 🔊 합성 딩 사운드 (긴 소리 기본)
  const { soundOn, setSoundOn, unlocked, unlock, play } = useDing("teacher_sound", { defaultLength: "long" });

  const sinceISO = useMemo(() => {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 48);
    return since.toISOString();
  }, []);

  const showNotif = useCallback(async (s) => {
    setNotif(`새 제출: ${s.student_name} / ${s.book} / ${rangeText(s)} / ${s.num_questions}문제`);
    try {
      if (!unlocked) await unlock();
      if (soundOn) await play("long");
      else console.log("[sound] not played: soundOff");
    } catch (err) {
      console.warn("[sound] play failed:", err);
    }
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    notifTimerRef.current = setTimeout(() => setNotif(null), 4000);
  }, [play, soundOn, unlock, unlocked]);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("test_sessions")
        .select("id, student_name, book, chapters_text, chapter_start, chapter_end, num_questions, created_at, status, mode")
        .gte("created_at", sinceISO)
        .eq("mode", "official")
        .eq("status", "submitted")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows(data || []);
      if (data && data.length) {
        latestCreatedAtRef.current = data[0].created_at;
        // 목록 갱신 시 이미 본 ID 메모
        seenIdsRef.current = new Set(data.map(d => d.id));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [sinceISO]);

  useEffect(() => {
    fetchList();
    return () => { if (notifTimerRef.current) clearTimeout(notifTimerRef.current); };
  }, [fetchList]);

  // ✅ Realtime (INSERT, 서버 필터)
  useEffect(() => {
    const ch = supabase
      .channel("teacher-new-submissions")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "test_sessions",
          filter: "mode=eq.official,status=eq.submitted",
        },
        async (payload) => {
          const s = payload.new || {};
          // 중복 알림 방지
          if (seenIdsRef.current.has(s.id)) return;
          seenIdsRef.current.add(s.id);
          await showNotif(s);
          fetchList();
        }
      );

    ch.subscribe((status) => setRtStatus(`실시간: ${status}`));
    return () => supabase.removeChannel(ch);
  }, [fetchList, showNotif]);

  // ✅ Polling fallback (10초)
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from("test_sessions")
          .select("id, student_name, book, chapters_text, chapter_start, chapter_end, num_questions, created_at, status, mode")
          .gte("created_at", sinceISO)
          .eq("mode", "official")
          .eq("status", "submitted")
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        const latest = data?.[0];

        if (!latest) return;

        // 최초 진입
        if (!latestCreatedAtRef.current) {
          latestCreatedAtRef.current = latest.created_at;
          if (!seenIdsRef.current.has(latest.id)) {
            seenIdsRef.current.add(latest.id);
            await showNotif(latest);
            fetchList();
          }
          return;
        }

        // 이후 갱신
        if (latest.created_at > latestCreatedAtRef.current) {
          latestCreatedAtRef.current = latest.created_at;
          if (!seenIdsRef.current.has(latest.id)) {
            seenIdsRef.current.add(latest.id);
            await showNotif(latest);
            fetchList();
          }
        }
      } catch (e) {
        console.error("[Polling] error:", e);
      }
    }, 10000);
    return () => clearInterval(id);
  }, [fetchList, showNotif, sinceISO]);

  return (
    <div style={styles.page}>
      {notif && <div style={styles.notif}>{notif}</div>}

      <div style={styles.box}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", alignItems: "center", gap: 8 }}>
          <h2 style={styles.title}>검수 목록 (최근 48시간 제출)</h2>
          <span style={styles.hint}>{rtStatus}</span>
          <span style={styles.badge}>{unlocked ? "🔓 오디오 해제됨" : "🔒 오디오 잠금"}</span>

          <button
            style={styles.iconBtn}
            onClick={() => setSoundOn(!soundOn)}
            title="알림음 토글"
          >
            {soundOn ? "🔔 켜짐" : "🔕 꺼짐"}
          </button>

          <button
            style={styles.iconBtn}
            onClick={async () => {
              const ok = await unlock();
              if (ok && soundOn) {
                try { await play("short"); } catch {}
              }
            }}
            title="오디오 사용 허용(1회)"
          >
            🔊 소리 켜기(한번)
          </button>

          <button
            style={styles.iconBtn}
            onClick={async () => {
              try {
                if (!unlocked) await unlock();
                if (soundOn) await play("long");
              } catch (e) {
                console.warn("[sound test] failed:", e);
              }
            }}
            title="테스트 사운드"
          >
            ▶︎ 테스트
          </button>

          <Link to="/teacher/today" style={{ marginLeft: 8, color: "#4361ee", textDecoration: "none" }}>
            오늘 결과
          </Link>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button className="btn-refresh" onClick={fetchList}>새로고침</button>
          <span style={{ fontSize: 12, color: "#9a9a9a" }}>
            제출만 표시됩니다(status=submitted). 확정된 항목은 목록에서 사라집니다.
          </span>
        </div>

        {loading ? (
          <div style={{ marginTop: 10 }}>불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div style={{ marginTop: 10, color: "#777" }}>대기 중인 제출이 없습니다.</div>
        ) : (
          rows.map((s) => (
            <div key={s.id} style={styles.card}>
              <div style={styles.line}>
                <div>
                  <b>{s.student_name}</b> · {s.book} · {rangeText(s)} · {s.num_questions}문제
                  <div style={{ fontSize: 12, color: "#888" }}>
                    제출: {dayjs(s.created_at).format("YYYY.MM.DD HH:mm")}
                  </div>
                </div>
                <Link to={`/teacher/review/${s.id}`}>
                  <button style={styles.btn}>검수하기</button>
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        .btn-refresh {
          background: #fff;
          color: #ff6fa3;
          border: 1px solid #ffd3e3;
          padding: 8px 12px;
          border-radius: 10px;
          font-weight: 700;
          cursor: pointer;
        }
        .btn-refresh:hover {
          background: #fff0f6;
        }
      `}</style>
    </div>
  );
}
