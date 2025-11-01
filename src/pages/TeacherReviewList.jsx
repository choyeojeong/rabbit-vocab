// src/pages/TeacherReviewList.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { useDing } from "../utils/ding";

dayjs.locale("ko");

const styles = {
  page: { minHeight: "100vh", background: "#fff5f8", padding: 24, color: "#000" },
  box: { maxWidth: 900, margin: "0 auto", background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 8px 24px rgba(255,192,217,.35)" },
  title: { fontSize: 22, fontWeight: 800, color: "#ff6fa3", margin: 0 },
  card: { border: "1px solid #ffd3e3", borderRadius: 12, padding: 14, marginTop: 10, color: "#000" },
  line: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  btn: { padding: "8px 12px", borderRadius: 10, border: "none", background: "#ff6fa3", color: "#fff", fontWeight: 700, cursor: "pointer" },
  notif: { position: "fixed", right: 16, top: 16, background: "#111", color: "#fff", padding: "10px 14px", borderRadius: 12, boxShadow: "0 10px 24px rgba(0,0,0,.2)", zIndex: 9999 },
  hint: { fontSize: 12, color: "#555" },
  iconBtn: { padding: "6px 10px", borderRadius: 10, border: "1px solid #ffd3e3", background: "#fff", cursor: "pointer", marginLeft: 8, color: "#000" },
  badge: { fontSize: 12, padding: "2px 8px", borderRadius: 999, border: "1px solid #ffd3e3", background: "#fff", color: "#000" },
};

function rangeText(s) {
  return s.chapters_text || `${s.chapter_start ?? "?"}-${s.chapter_end ?? "?"}`;
}
function normalizeStatus(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}
function pickRow(r) {
  // 핸들러에서 필요한 필드만 안전하게 추려서 사용
  return {
    id: r.id,
    student_name: r.student_name ?? "",
    teacher_name: r.teacher_name ?? null,
    book: r.book ?? "",
    chapters_text: r.chapters_text ?? null,
    chapter_start: r.chapter_start ?? null,
    chapter_end: r.chapter_end ?? null,
    num_questions: r.num_questions ?? null,
    created_at: r.created_at,
    status: r.status,
    mode: r.mode,
  };
}
function upsertById(list, row) {
  const idx = list.findIndex((x) => x.id === row.id);
  if (idx === -1) return [row, ...list].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const next = list.slice();
  next[idx] = { ...next[idx], ...row };
  next.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return next;
}

export default function TeacherReviewList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notif, setNotif] = useState(null);
  const [rtStatus, setRtStatus] = useState("연결 중…");
  const [error, setError] = useState("");

  const [hours, setHours] = useState(72);
  const [noTimeLimit, setNoTimeLimit] = useState(false);

  const lastNotifiedRef = useRef(new Set()); // 알림 중복 방지
  const notifTimerRef = useRef(null);

  const { soundOn, setSoundOn, unlocked, unlock, play } = useDing("teacher_sound", { defaultLength: "long" });

  const sinceISO = useMemo(() => {
    if (noTimeLimit) return null;
    const since = new Date(Date.now() - 1000 * 60 * 60 * (Number(hours) || 72));
    return since.toISOString();
  }, [hours, noTimeLimit]);

  const showNotif = useCallback(async (s) => {
    setNotif(`새 제출: ${s.student_name} / ${s.book} / ${rangeText(s)} / ${s.num_questions}문제`);
    try {
      if (!unlocked) await unlock();
      if (soundOn) await play("long");
    } catch (err) {
      console.warn("[sound] play failed:", err);
    }
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    notifTimerRef.current = setTimeout(() => setNotif(null), 4000);
  }, [play, soundOn, unlock, unlocked]);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      let q = supabase
        .from("test_sessions")
        .select("id, student_name, teacher_name, book, chapters_text, chapter_start, chapter_end, num_questions, created_at, status, mode")
        .eq("mode", "official")
        .order("created_at", { ascending: false });

      if (sinceISO) q = q.gte("created_at", sinceISO);

      const { data, error } = await q;
      if (error) throw error;

      const filtered = (data || []).filter((s) => normalizeStatus(s.status) === "submitted");
      setRows(filtered);
    } catch (e) {
      console.error("[review list] load error", e);
      setError(e.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [sinceISO]);

  useEffect(() => {
    fetchList();
    return () => { if (notifTimerRef.current) clearTimeout(notifTimerRef.current); };
  }, [fetchList]);

  // ✅ 실시간 구독: UPDATE(→ submitted 전환) + INSERT(바로 submitted인 경우)
  useEffect(() => {
    const ch = supabase.channel("teacher-new-submissions");

    // UPDATE: draft → submitted
    ch.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "test_sessions" },
      async (payload) => {
        const s = pickRow(payload.new || {});
        if (s.mode !== "official") return;
        if (normalizeStatus(s.status) !== "submitted") return;

        // 즉시 업서트 (시간 제한에 걸려도 실시간 건은 보여주기 위해 그대로 넣음)
        setRows((prev) => upsertById(prev, s));

        // 알림 중복 방지
        if (!lastNotifiedRef.current.has(s.id)) {
          lastNotifiedRef.current.add(s.id);
          await showNotif(s);
        }
      }
    );

    // INSERT: 혹시 INSERT 자체가 submitted로 들어오는 케이스
    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "test_sessions" },
      async (payload) => {
        const s = pickRow(payload.new || {});
        if (s.mode !== "official") return;
        if (normalizeStatus(s.status) !== "submitted") return;

        setRows((prev) => upsertById(prev, s));

        if (!lastNotifiedRef.current.has(s.id)) {
          lastNotifiedRef.current.add(s.id);
          await showNotif(s);
        }
      }
    );

    ch.subscribe((status) => setRtStatus(`실시간: ${status}`));
    return () => supabase.removeChannel(ch);
  }, [showNotif]);

  return (
    <div style={styles.page}>
      {notif && <div style={styles.notif}>{notif}</div>}

      <div style={styles.box}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", alignItems: "center", gap: 8 }}>
          <h2 style={styles.title}>검수 목록 {noTimeLimit ? "(전체 기간)" : `(최근 ${hours}시간)`}</h2>
          <span style={styles.hint}>{rtStatus}</span>
          <span style={styles.badge}>{unlocked ? "🔓 오디오 해제됨" : "🔒 오디오 잠금"}</span>

          <button style={styles.iconBtn} onClick={() => setSoundOn(!soundOn)}>
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
          >
            🔊 소리 켜기(한번)
          </button>

          <Link to="/teacher/today" style={{ marginLeft: 8, color: "#4361ee", textDecoration: "none" }}>
            오늘 결과
          </Link>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn-refresh" onClick={fetchList}>새로고침</button>
          <label style={{ fontSize: 13, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={noTimeLimit} onChange={(e) => setNoTimeLimit(e.target.checked)} />
            시간 제한 해제
          </label>
          {!noTimeLimit && (
            <label style={{ fontSize: 13, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
              최근
              <input
                type="number"
                min={1}
                max={240}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                style={{ width: 64, padding: "4px 6px", borderRadius: 8, border: "1px solid #ffd3e3" }}
              />
              시간
            </label>
          )}
        </div>

        {error && <div style={{ marginTop: 8, color: "#c1121f", fontSize: 13 }}>오류: {error}</div>}

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
                  <div style={{ fontSize: 12, color: "#555" }}>
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
        .btn-refresh:hover { background: #fff0f6; }
      `}</style>
    </div>
  );
}
