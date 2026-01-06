// src/pages/TeacherReviewList.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { useDing } from "../utils/ding";

dayjs.locale("ko");

/**
 * TeacherReviewList
 * ✅ 가운데 흰색 네모(box) 제거 → 화면 전체 사용
 * ✅ iPhone 모바일 최적화
 *  - safe-area(노치/홈바) 대응
 *  - 100dvh 사용(모바일 Safari 주소창 변화 대응)
 *  - 상단 컨트롤 sticky
 *  - 모바일에서 카드 레이아웃/버튼 터치 타겟(44px) 강화
 * ✅ 기능/로직은 그대로 유지 (실시간 구독/시간필터/알림/오디오 unlock)
 */

const THEME = {
  bg: "#f7f9fc",
  card: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  danger: "#c1121f",
  link: "#4361ee",
};

// --- helpers ---
function rangeText(s) {
  return s.chapters_text || `${s.chapter_start ?? "?"}-${s.chapter_end ?? "?"}`;
}
function normalizeStatus(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}
function pickRow(r) {
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
  if (idx === -1)
    return [row, ...list].sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "")
    );
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

  const { soundOn, setSoundOn, unlocked, unlock, play } = useDing("teacher_sound", {
    defaultLength: "long",
  });

  const sinceISO = useMemo(() => {
    if (noTimeLimit) return null;
    const since = new Date(Date.now() - 1000 * 60 * 60 * (Number(hours) || 72));
    return since.toISOString();
  }, [hours, noTimeLimit]);

  const showNotif = useCallback(
    async (s) => {
      setNotif(`새 제출: ${s.student_name} / ${s.book} / ${rangeText(s)} / ${s.num_questions}문제`);
      try {
        if (!unlocked) await unlock();
        if (soundOn) await play("long");
      } catch (err) {
        console.warn("[sound] play failed:", err);
      }
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
      notifTimerRef.current = setTimeout(() => setNotif(null), 4000);
    },
    [play, soundOn, unlock, unlocked]
  );

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      let q = supabase
        .from("test_sessions")
        .select(
          "id, student_name, teacher_name, book, chapters_text, chapter_start, chapter_end, num_questions, created_at, status, mode"
        )
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
    return () => {
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    };
  }, [fetchList]);

  // ✅ 실시간 구독: UPDATE(→ submitted 전환) + INSERT(바로 submitted인 경우)
  useEffect(() => {
    const ch = supabase.channel("teacher-new-submissions");

    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "test_sessions" }, async (payload) => {
      const s = pickRow(payload.new || {});
      if (s.mode !== "official") return;
      if (normalizeStatus(s.status) !== "submitted") return;

      setRows((prev) => upsertById(prev, s));

      if (!lastNotifiedRef.current.has(s.id)) {
        lastNotifiedRef.current.add(s.id);
        await showNotif(s);
      }
    });

    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "test_sessions" }, async (payload) => {
      const s = pickRow(payload.new || {});
      if (s.mode !== "official") return;
      if (normalizeStatus(s.status) !== "submitted") return;

      setRows((prev) => upsertById(prev, s));

      if (!lastNotifiedRef.current.has(s.id)) {
        lastNotifiedRef.current.add(s.id);
        await showNotif(s);
      }
    });

    ch.subscribe((status) => setRtStatus(`실시간: ${status}`));
    return () => supabase.removeChannel(ch);
  }, [showNotif]);

  return (
    <div style={styles.page}>
      {/* ✅ 상단 알림 (iPhone safe-area) */}
      {notif && <div style={styles.notif}>{notif}</div>}

      {/* ✅ 상단 컨트롤 (sticky, 전체 폭) */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.topRow}>
            <div style={{ minWidth: 0 }}>
              <h2 style={styles.title}>
                검수 목록{" "}
                <span style={styles.titleSub}>
                  {noTimeLimit ? "(전체 기간)" : `(최근 ${hours}시간)`}
                </span>
              </h2>
              <div style={styles.metaRow}>
                <span style={styles.hint}>{rtStatus}</span>
                <span style={styles.badge}>{unlocked ? "오디오 해제됨" : "오디오 잠금"}</span>
              </div>
            </div>

            <div style={styles.rightRow}>
              <button
                style={styles.pill}
                onClick={() => setSoundOn(!soundOn)}
                title="알림 소리 on/off"
              >
                {soundOn ? "🔔 켜짐" : "🔕 꺼짐"}
              </button>

              <button
                style={styles.pill}
                onClick={async () => {
                  const ok = await unlock();
                  if (ok && soundOn) {
                    try {
                      await play("short");
                    } catch {}
                  }
                }}
                title="브라우저 정책 때문에 한 번 눌러서 오디오를 활성화해야 해요."
              >
                🔊 소리 켜기(한번)
              </button>

              <Link to="/teacher/today" style={styles.linkBtn}>
                오늘 결과
              </Link>
            </div>
          </div>

          <div style={styles.controlsRow}>
            <button className="btn-refresh" onClick={fetchList} style={styles.refreshBtn}>
              새로고침
            </button>

            <label style={styles.checkLabel}>
              <input
                type="checkbox"
                checked={noTimeLimit}
                onChange={(e) => setNoTimeLimit(e.target.checked)}
              />
              시간 제한 해제
            </label>

            {!noTimeLimit && (
              <label style={styles.hoursLabel}>
                최근
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  style={styles.hoursInput}
                  inputMode="numeric"
                />
                시간
              </label>
            )}
          </div>

          {error && <div style={styles.err}>오류: {error}</div>}
        </div>
      </div>

      {/* ✅ 리스트 영역 (전체 폭) */}
      <div style={styles.content}>
        {loading ? (
          <div style={styles.stateText}>불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div style={styles.stateText}>대기 중인 제출이 없습니다.</div>
        ) : (
          <div style={styles.list}>
            {rows.map((s) => (
              <div key={s.id} style={styles.card}>
                <div style={styles.cardRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.cardTitle}>
                      <b style={{ fontWeight: 900 }}>{s.student_name}</b>
                      <span style={styles.dot}>·</span>
                      <span style={styles.strongEllip}>{s.book}</span>
                      <span style={styles.dot}>·</span>
                      <span style={styles.strongEllip}>{rangeText(s)}</span>
                      <span style={styles.dot}>·</span>
                      <span style={styles.qs}>{s.num_questions}문제</span>
                    </div>

                    <div style={styles.cardSub}>
                      제출: {dayjs(s.created_at).format("YYYY.MM.DD HH:mm")}
                    </div>
                  </div>

                  <Link to={`/teacher/review/${s.id}`} style={{ textDecoration: "none" }}>
                    <button style={styles.primaryBtn}>검수하기</button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 유지: 기존 CSS class도 동작하게 */}
      <style>{`
        .btn-refresh:hover { filter: brightness(0.98); }
      `}</style>
    </div>
  );
}

const styles = {
  // ✅ 전체 화면
  page: {
    minHeight: "100vh",
    height: "100dvh",
    background: THEME.bg,
    color: THEME.text,
  },

  // ✅ 상단 알림(노치/상단 inset 반영)
  notif: {
    position: "fixed",
    right: "calc(env(safe-area-inset-right, 0px) + 12px)",
    top: "calc(env(safe-area-inset-top, 0px) + 12px)",
    background: "#111",
    color: "#fff",
    padding: "10px 14px",
    borderRadius: 12,
    boxShadow: "0 10px 24px rgba(0,0,0,.2)",
    zIndex: 9999,
    maxWidth: "min(520px, calc(100vw - 24px))",
    wordBreak: "break-word",
  },

  // ✅ sticky 헤더
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

  topRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
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
  titleSub: {
    fontSize: 13,
    fontWeight: 800,
    color: THEME.sub,
    marginLeft: 6,
  },

  metaRow: {
    marginTop: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  hint: {
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 700,
  },
  badge: {
    fontSize: 12,
    padding: "3px 10px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.text,
    fontWeight: 900,
  },

  rightRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  pill: {
    height: 44, // ✅ iPhone 터치 타겟
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.text,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 8px 22px rgba(0,0,0,0.06)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  },

  linkBtn: {
    height: 44,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.link,
    fontWeight: 900,
    textDecoration: "none",
    boxShadow: "0 8px 22px rgba(0,0,0,0.06)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  },

  controlsRow: {
    marginTop: 12,
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },

  refreshBtn: {
    height: 44,
    padding: "0 12px",
    borderRadius: 12,
    background: "#fff",
    color: THEME.pink,
    border: `1px solid ${THEME.border}`,
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 8px 22px rgba(0,0,0,0.05)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  },

  checkLabel: {
    fontSize: 13,
    color: THEME.sub,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontWeight: 800,
    background: "#fff",
    border: `1px solid ${THEME.border}`,
    padding: "10px 12px",
    borderRadius: 12,
  },

  hoursLabel: {
    fontSize: 13,
    color: THEME.sub,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 800,
    background: "#fff",
    border: `1px solid ${THEME.border}`,
    padding: "8px 10px",
    borderRadius: 12,
  },

  hoursInput: {
    width: 72,
    height: 34,
    padding: "0 8px",
    borderRadius: 10,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.text,
    fontWeight: 900,
    outline: "none",
  },

  err: {
    marginTop: 10,
    color: THEME.danger,
    fontWeight: 900,
    fontSize: 13,
    background: "#fff",
    border: "1px solid #ffd3e3",
    borderRadius: 12,
    padding: "10px 12px",
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

  list: {
    display: "grid",
    gap: 10,
    marginTop: 10,
  },

  card: {
    background: THEME.card,
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  },

  cardRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },

  cardTitle: {
    fontSize: 14,
    color: THEME.text,
    lineHeight: "20px",
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
    wordBreak: "break-word",
  },

  strongEllip: {
    fontWeight: 800,
  },

  dot: {
    color: THEME.sub,
    fontWeight: 900,
  },

  qs: {
    fontWeight: 900,
    color: THEME.text,
  },

  cardSub: {
    marginTop: 6,
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 700,
  },

  primaryBtn: {
    height: 44, // ✅ iPhone 터치 타겟
    padding: "0 14px",
    borderRadius: 12,
    border: "none",
    background: THEME.pink,
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(255,111,163,0.22)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },
};
