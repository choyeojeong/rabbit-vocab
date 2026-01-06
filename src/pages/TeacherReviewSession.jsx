// src/pages/TeacherReviewSession.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";

dayjs.locale("ko");

const THEME = {
  pageBg: "transparent", // ✅ AdminGate 배경을 그대로 사용
  cardBg: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  borderPink: "#ffd3e3",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  link: "#2b59ff",
  danger: "#b00020",
  okSoft: "#e9fff2",
  okText: "#0f7a3a",
  badSoft: "#fff1f2",
  badText: "#b00020",
};

export default function TeacherReviewSession() {
  const { id: sessionId } = useParams(); // /teacher/review/:id
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]); // [{ id, order_index, term_en, meaning_ko, student_answer, auto_ok, final_ok }]

  // 세션 + 문항 로드
  useEffect(() => {
    let alive = true;

    async function fetchAll() {
      try {
        if (!sessionId) {
          setError("세션 ID가 없습니다.");
          setLoading(false);
          return;
        }

        // 세션
        const { data: sess, error: e1 } = await supabase
          .from("test_sessions")
          .select(
            "id, student_id, student_name, book, chapters_text, chapter_start, chapter_end, num_questions, cutoff_miss, created_at, status"
          )
          .eq("id", sessionId)
          .maybeSingle();
        if (e1) throw e1;
        if (!sess) {
          setError("세션을 찾을 수 없습니다.");
          setLoading(false);
          return;
        }

        // 문항
        const { data: its, error: e2 } = await supabase
          .from("test_items")
          .select("id, order_index, term_en, meaning_ko, student_answer, auto_ok, final_ok, word_id")
          .eq("session_id", sessionId)
          .order("order_index", { ascending: true });
        if (e2) throw e2;

        if (!alive) return;
        setSession(sess);
        setItems(its || []);
        setLoading(false);
      } catch (err) {
        console.error(err);
        if (alive) {
          setError("불러오는 중 오류가 발생했습니다.");
          setLoading(false);
        }
      }
    }

    fetchAll();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const header = useMemo(() => {
    if (!session) return "";
    const book = session.book || "Rabbit Vocab";
    const range =
      session.chapters_text || `${session.chapter_start ?? "?"}-${session.chapter_end ?? "?"}`;
    const when = dayjs(session.created_at).format("YYYY. M. D. A h:mm:ss");
    const cnt = Number.isFinite(session?.num_questions) ? session.num_questions : items?.length ?? 0;
    return `${book} · ${range} · ${cnt}문항 · 제출 ${when}`;
  }, [session, items.length]);

  // 일괄/토글 조작
  const setAll = (val) => setItems((prev) => prev.map((it) => ({ ...it, final_ok: !!val })));
  const setFromAuto = () => setItems((prev) => prev.map((it) => ({ ...it, final_ok: !!it.auto_ok })));
  const toggleItem = (id) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, final_ok: !it.final_ok } : it)));

  // 🔒 유틸: final_ok 저장 (다건 업데이트)
  async function persistFinalOk(updates) {
    const chunkSize = 50;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const slice = updates.slice(i, i + chunkSize);
      await Promise.all(
        slice.map(async ({ id, final_ok }) => {
          const { error } = await supabase.from("test_items").update({ final_ok: !!final_ok }).eq("id", id);
          if (error) console.warn("[test_items update failed]", id, error);
        })
      );
    }
  }

  // ✅ (추가) 오답파일 생성 RPC 호출
  async function createWrongBook(sessionId) {
    const { data, error } = await supabase.rpc("create_wrong_book_from_session", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    return data; // wrong_books.id (uuid) 반환
  }

  // 최종확정: ① 문항 final_ok 저장 → ② 세션 finalize RPC → ③ 오답파일 생성 RPC
  async function finalize() {
    try {
      setSaving(true);
      setError("");

      if (!sessionId) {
        setError("세션 ID가 없습니다.");
        return;
      }

      // 이미 확정된 세션이면 목록으로
      if (session?.status === "finalized") {
        navigate("/teacher/review", { replace: true });
        return;
      }

      // ① 문항 final_ok 저장
      const updates = items.map((it) => ({ id: it.id, final_ok: !!it.final_ok }));
      if (updates.length > 0) {
        await persistFinalOk(updates);
      }

      // ② 점수/통과 계산
      const totalQuestions = Number.isFinite(session?.num_questions) ? session.num_questions : items.length;
      const correct = items.filter((i) => !!i.final_ok).length;
      const cutoffMiss = Number.isFinite(session?.cutoff_miss) ? session.cutoff_miss : 0;
      const wrong = Math.max(0, totalQuestions - correct);
      const willPass = wrong <= cutoffMiss;

      // ③ 레거시 RPC 호출
      const { error: rpcError } = await supabase.rpc("finalize_test_session", {
        _id: sessionId,
        _final_score: correct,
        _final_pass: willPass,
      });

      if (rpcError) {
        console.error("[finalize RPC error]", rpcError);
        const msg = rpcError.details || rpcError.message || "최종 확정 중 오류가 발생했습니다.";
        setError(msg);
        return;
      }

      setSession((prev) => (prev ? { ...prev, status: "finalized" } : prev));

      // ④ ✅ 오답파일 생성
      try {
        await createWrongBook(sessionId);
      } catch (e) {
        console.error("[create_wrong_book_from_session error]", e);
        const msg = e?.details || e?.message || "오답 파일 생성 중 오류가 발생했습니다.";
        setError(
          `※ 최종 확정은 완료됐지만, 오답 파일 생성이 실패했어요.\n${msg}\n(페이지에서 다시 '최종 확정'을 눌러 재시도할 수 있어요.)`
        );
        return;
      }

      // 완료 이동
      navigate("/teacher/review", { replace: true });
    } catch (e) {
      console.error(e);
      setError("최종 확정 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={styles.loading}>
        불러오는 중…
      </div>
    );
  }

  const totalQuestions = Number.isFinite(session?.num_questions) ? session.num_questions : items.length;
  const correct = items.filter((i) => !!i.final_ok).length;
  const cutoffMiss = Number.isFinite(session?.cutoff_miss) ? session.cutoff_miss : 0;
  const wrong = Math.max(0, totalQuestions - correct);
  const willPass = wrong <= cutoffMiss;

  return (
    <div style={styles.page}>
      {/* ✅ 상단 sticky 헤더(전체 폭) */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.headerTopRow}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.hTitleRow}>
                <h2 style={styles.hTitle}>세션 검수 · {session?.student_name}</h2>

                {session?.status === "finalized" && (
                  <span style={styles.finalizedBadge}>확정됨</span>
                )}

                {items.length > 0 && (
                  <span
                    style={{
                      ...styles.scoreBadge,
                      background: willPass ? THEME.okSoft : THEME.badSoft,
                      color: willPass ? THEME.okText : THEME.badText,
                    }}
                    title={`정답 ${correct}/${totalQuestions} · 오답 ${wrong}개 (컷 ${cutoffMiss}개)`}
                  >
                    {correct}/{totalQuestions} · 오답 {wrong} · 컷 {cutoffMiss} · {willPass ? "PASS" : "FAIL"}
                  </span>
                )}
              </div>

              <div style={styles.hSub}>{header}</div>
            </div>

            <Link to="/teacher/review" style={styles.backLink}>
              ← 목록으로
            </Link>
          </div>

          {/* ✅ 액션 버튼 (모바일에서도 손가락으로 누르기 좋게) */}
          <div style={styles.actions}>
            <button className="btn-pink" onClick={setFromAuto} disabled={items.length === 0 || saving}>
              자동채점값으로 초기화
            </button>
            <button className="btn-ghost" onClick={() => setAll(true)} disabled={items.length === 0 || saving}>
              모두 정답 처리
            </button>
            <button className="btn-ghost" onClick={() => setAll(false)} disabled={items.length === 0 || saving}>
              모두 오답 처리
            </button>
            <button className="btn-pink" onClick={finalize} disabled={saving || items.length === 0}>
              {saving ? "처리 중…" : "최종 확정"}
            </button>
          </div>

          {error && (
            <div style={styles.err}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* ✅ 본문 (전체 폭, 카드 리스트) */}
      <div style={styles.content}>
        {items.length === 0 ? (
          <div style={styles.emptyBox}>
            <div style={{ fontWeight: 900 }}>이 세션에는 저장된 문항이 없습니다.</div>
            <div style={{ marginTop: 6, fontSize: 13, color: THEME.sub }}>
              ※ 점검: (1) 세션 ID 확인 (2) 시험 저장 시{" "}
              <code style={styles.code}>test_items</code> insert 누락 (3) RLS/권한
            </div>
          </div>
        ) : (
          <div style={styles.list}>
            {items.map((it, i) => {
              const isOk = !!it.final_ok;
              return (
                <div
                  key={it.id}
                  style={{
                    ...styles.itemCard,
                    border: `1px solid ${isOk ? "#bbf7d0" : "#fecdd3"}`,
                    background: isOk ? "#f0fdf4" : "#fff1f2",
                  }}
                >
                  <div style={styles.itemTop}>
                    <div style={styles.term}>
                      {i + 1}. {it.term_en}
                    </div>

                    <div style={styles.itemRight}>
                      <span style={styles.smallBadge} title="자동채점 결과">
                        자동 {it.auto_ok ? "O" : "X"}
                      </span>

                      <span
                        style={{
                          ...styles.smallBadge,
                          color: isOk ? THEME.okText : THEME.badText,
                        }}
                        title="현재 최종 판정"
                      >
                        최종 {isOk ? "O" : "X"}
                      </span>

                      <label style={styles.check}>
                        <input
                          type="checkbox"
                          checked={!!it.final_ok}
                          onChange={() => toggleItem(it.id)}
                          disabled={saving}
                        />
                        최종 정답
                      </label>
                    </div>
                  </div>

                  <div style={styles.itemBody}>
                    <div>
                      <b style={{ color: THEME.text }}>정답(ko):</b>{" "}
                      <span style={{ color: THEME.text }}>{it.meaning_ko}</span>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <b style={{ color: THEME.text }}>학생답안:</b>{" "}
                      {it.student_answer ? (
                        <span style={{ color: THEME.text }}>{it.student_answer}</span>
                      ) : (
                        <em style={{ color: THEME.sub, fontStyle: "italic" }}>—</em>
                      )}
                    </div>
                    <div style={styles.itemFoot}>
                      자동채점: {it.auto_ok ? "O" : "X"} · 현재최종: {it.final_ok ? "O" : "X"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ✅ 버튼 스타일 + 모바일 최적화 */}
      <style>{`
        .btn-pink {
          height: 44px; /* iPhone 터치 타겟 */
          background: ${THEME.pink};
          color: #fff;
          border: none;
          padding: 0 14px;
          border-radius: 12px;
          font-weight: 900;
          box-shadow: 0 10px 22px rgba(255,111,163,.18);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          white-space: nowrap;
        }
        .btn-pink:disabled { opacity: .6; cursor: not-allowed; }

        .btn-ghost {
          height: 44px; /* iPhone 터치 타겟 */
          background: #fff;
          color: ${THEME.text};
          border: 1px solid ${THEME.borderPink};
          padding: 0 14px;
          border-radius: 12px;
          font-weight: 900;
          box-shadow: 0 10px 22px rgba(31,42,68,.06);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          white-space: nowrap;
        }
        .btn-ghost:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

const styles = {
  loading: {
    padding: 16,
    paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
    color: THEME.text,
    minHeight: "100vh",
  },

  // ✅ 전체 화면 사용
  page: {
    background: THEME.pageBg,
    minHeight: "100vh",
    height: "100dvh",
    color: THEME.text,
  },

  // ✅ sticky header (노치 대응)
  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: "transparent", // AdminGate 배경 위에 자연스럽게
    paddingTop: "env(safe-area-inset-top, 0px)",
    borderBottom: `1px solid ${THEME.border}`,
    backdropFilter: "saturate(180%) blur(10px)",
  },
  headerInner: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
  },

  headerTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },

  hTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  hTitle: {
    margin: 0,
    color: THEME.text,
    fontWeight: 900,
    fontSize: 18,
    letterSpacing: "-0.2px",
    lineHeight: "24px",
  },

  finalizedBadge: {
    fontSize: 12,
    padding: "5px 10px",
    borderRadius: 999,
    background: THEME.pinkSoft,
    color: "#c94a7a",
    border: `1px solid ${THEME.borderPink}`,
    fontWeight: 900,
  },

  scoreBadge: {
    fontSize: 12,
    padding: "5px 10px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    fontWeight: 900,
  },

  hSub: {
    marginTop: 6,
    color: THEME.sub,
    fontSize: 13,
    fontWeight: 700,
    wordBreak: "break-word",
  },

  backLink: {
    color: THEME.link,
    textDecoration: "none",
    fontWeight: 900,
    height: 44,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    boxShadow: "0 10px 22px rgba(31,42,68,.06)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
  },

  actions: {
    marginTop: 12,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  },

  err: {
    marginTop: 12,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    color: "#9f1239",
    padding: 12,
    borderRadius: 12,
    whiteSpace: "pre-line",
    fontWeight: 800,
  },

  // ✅ 본문 (전체 폭)
  content: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: "14px",
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  emptyBox: {
    padding: 16,
    background: "#f3f6fb",
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    color: THEME.text,
  },

  code: {
    background: "#eef2ff",
    border: "1px solid #c7d2fe",
    padding: "1px 6px",
    borderRadius: 8,
    color: "#3730a3",
    fontWeight: 800,
  },

  list: {
    display: "grid",
    gap: 10,
    marginTop: 10,
  },

  itemCard: {
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 10px 30px rgba(31,42,68,.08)",
  },

  itemTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },

  term: {
    fontWeight: 900,
    fontSize: 15,
    color: THEME.text,
    wordBreak: "break-word",
  },

  itemRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  smallBadge: {
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.sub,
    fontWeight: 900,
  },

  check: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    fontWeight: 900,
    color: THEME.text,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#fff",
    border: `1px solid ${THEME.border}`,
  },

  itemBody: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 1.55,
  },

  itemFoot: {
    fontSize: 12,
    color: THEME.sub,
    marginTop: 8,
    fontWeight: 700,
  },
};
