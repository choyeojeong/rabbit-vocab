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
          .select(
            "id, order_index, term_en, meaning_ko, student_answer, auto_ok, final_ok, word_id"
          )
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
      session.chapters_text ||
      `${session.chapter_start ?? "?"}-${session.chapter_end ?? "?"}`;
    const when = dayjs(session.created_at).format("YYYY. M. D. A h:mm:ss");
    const cnt = Number.isFinite(session?.num_questions)
      ? session.num_questions
      : (items?.length ?? 0);
    return `${book} · ${range} · ${cnt}문항 · 제출 ${when}`;
  }, [session, items.length]);

  // 일괄/토글 조작
  const setAll = (val) =>
    setItems((prev) => prev.map((it) => ({ ...it, final_ok: !!val })));
  const setFromAuto = () =>
    setItems((prev) => prev.map((it) => ({ ...it, final_ok: !!it.auto_ok })));
  const toggleItem = (id) =>
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, final_ok: !it.final_ok } : it))
    );

  // 🔒 유틸: final_ok 저장 (다건 업데이트)
  async function persistFinalOk(updates) {
    const chunkSize = 50;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const slice = updates.slice(i, i + chunkSize);
      await Promise.all(
        slice.map(async ({ id, final_ok }) => {
          const { error } = await supabase
            .from("test_items")
            .update({ final_ok: !!final_ok })
            .eq("id", id);
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
      const totalQuestions = Number.isFinite(session?.num_questions)
        ? session.num_questions
        : items.length;
      const correct = items.filter((i) => !!i.final_ok).length;
      const cutoffMiss = Number.isFinite(session?.cutoff_miss)
        ? session.cutoff_miss
        : 0;
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
        const msg =
          rpcError.details ||
          rpcError.message ||
          "최종 확정 중 오류가 발생했습니다.";
        setError(msg);
        return;
      }

      setSession((prev) => (prev ? { ...prev, status: "finalized" } : prev));

      // ④ ✅ 오답파일 생성
      try {
        await createWrongBook(sessionId);
      } catch (e) {
        console.error("[create_wrong_book_from_session error]", e);
        const msg =
          e?.details ||
          e?.message ||
          "오답 파일 생성 중 오류가 발생했습니다.";
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
      <div style={{ padding: 24, color: THEME.text }}>
        불러오는 중…
      </div>
    );
  }

  const totalQuestions = Number.isFinite(session?.num_questions)
    ? session.num_questions
    : items.length;
  const correct = items.filter((i) => !!i.final_ok).length;
  const cutoffMiss = Number.isFinite(session?.cutoff_miss) ? session.cutoff_miss : 0;
  const wrong = Math.max(0, totalQuestions - correct);
  const willPass = wrong <= cutoffMiss;

  return (
    <div
      style={{
        background: THEME.pageBg,
        minHeight: "100vh",
        padding: "24px 12px",
        color: THEME.text,
      }}
    >
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          background: THEME.cardBg,
          borderRadius: 16,
          padding: 24,
          border: `1px solid ${THEME.border}`,
          boxShadow: "0 10px 30px rgba(31,42,68,.08)",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, color: THEME.text, fontWeight: 900 }}>
              세션 검수 · {session?.student_name}
            </h2>

            {session?.status === "finalized" && (
              <span
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  borderRadius: 999,
                  background: THEME.pinkSoft,
                  color: "#c94a7a",
                  border: `1px solid ${THEME.borderPink}`,
                  fontWeight: 900,
                }}
              >
                확정됨
              </span>
            )}

            {/* ✅ 점수 요약 배지 */}
            {items.length > 0 && (
              <span
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  borderRadius: 999,
                  background: willPass ? THEME.okSoft : THEME.badSoft,
                  color: willPass ? THEME.okText : THEME.badText,
                  border: `1px solid ${THEME.border}`,
                  fontWeight: 900,
                }}
                title={`정답 ${correct}/${totalQuestions} · 오답 ${wrong}개 (컷 ${cutoffMiss}개)`}
              >
                {correct}/{totalQuestions} · 오답 {wrong} · 컷 {cutoffMiss} ·{" "}
                {willPass ? "PASS" : "FAIL"}
              </span>
            )}
          </div>

          <Link
            to="/teacher/review"
            style={{
              color: THEME.link,
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            ← 목록으로
          </Link>
        </div>

        <div style={{ marginTop: 6, color: THEME.sub, fontSize: 13 }}>{header}</div>

        {/* 일괄 버튼 */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button
            className="btn-pink"
            onClick={setFromAuto}
            disabled={items.length === 0 || saving}
          >
            자동채점값으로 초기화
          </button>
          <button
            className="btn-ghost"
            onClick={() => setAll(true)}
            disabled={items.length === 0 || saving}
          >
            모두 정답 처리
          </button>
          <button
            className="btn-ghost"
            onClick={() => setAll(false)}
            disabled={items.length === 0 || saving}
          >
            모두 오답 처리
          </button>
          <button
            className="btn-pink"
            onClick={finalize}
            disabled={saving || items.length === 0}
          >
            {saving ? "처리 중…" : "최종 확정"}
          </button>
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              background: "#fff1f2",
              border: "1px solid #fecdd3",
              color: "#9f1239",
              padding: 12,
              borderRadius: 12,
              whiteSpace: "pre-line",
              fontWeight: 800,
            }}
          >
            {error}
          </div>
        )}

        {/* 문항 리스트 */}
        <div style={{ marginTop: 20 }}>
          {items.length === 0 ? (
            <div
              style={{
                padding: 16,
                background: "#f3f6fb",
                borderRadius: 12,
                border: `1px solid ${THEME.border}`,
                color: THEME.text,
              }}
            >
              <div style={{ fontWeight: 900 }}>이 세션에는 저장된 문항이 없습니다.</div>
              <div style={{ marginTop: 6, fontSize: 13, color: THEME.sub }}>
                ※ 점검: (1) 세션 ID 확인 (2) 시험 저장 시{" "}
                <code
                  style={{
                    background: "#eef2ff",
                    border: "1px solid #c7d2fe",
                    padding: "1px 6px",
                    borderRadius: 8,
                    color: "#3730a3",
                    fontWeight: 800,
                  }}
                >
                  test_items
                </code>{" "}
                insert 누락 (3) RLS/권한
              </div>
            </div>
          ) : (
            items.map((it, i) => {
              const isOk = !!it.final_ok;
              return (
                <div
                  key={it.id}
                  style={{
                    border: `1px solid ${isOk ? "#bbf7d0" : "#fecdd3"}`,
                    background: isOk ? "#f0fdf4" : "#fff1f2",
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 10,
                    color: THEME.text,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: 15 }}>
                      {i + 1}. {it.term_en}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {/* 자동채점 배지 */}
                      <span
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: `1px solid ${THEME.border}`,
                          background: "#fff",
                          color: THEME.sub,
                          fontWeight: 900,
                        }}
                        title="자동채점 결과"
                      >
                        자동 {it.auto_ok ? "O" : "X"}
                      </span>

                      {/* 최종 배지 */}
                      <span
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: `1px solid ${THEME.border}`,
                          background: "#fff",
                          color: isOk ? THEME.okText : THEME.badText,
                          fontWeight: 900,
                        }}
                        title="현재 최종 판정"
                      >
                        최종 {isOk ? "O" : "X"}
                      </span>

                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          cursor: saving ? "not-allowed" : "pointer",
                          fontWeight: 900,
                          color: THEME.text,
                        }}
                      >
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

                  <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.55 }}>
                    <div>
                      <b style={{ color: THEME.text }}>정답(ko):</b>{" "}
                      <span style={{ color: THEME.text }}>{it.meaning_ko}</span>
                    </div>
                    <div style={{ marginTop: 2 }}>
                      <b style={{ color: THEME.text }}>학생답안:</b>{" "}
                      {it.student_answer ? (
                        <span style={{ color: THEME.text }}>{it.student_answer}</span>
                      ) : (
                        <em style={{ color: THEME.sub, fontStyle: "italic" }}>—</em>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: THEME.sub, marginTop: 6 }}>
                      자동채점: {it.auto_ok ? "O" : "X"} · 현재최종:{" "}
                      {it.final_ok ? "O" : "X"}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 버튼 스타일 */}
      <style>{`
        .btn-pink {
          background: ${THEME.pink};
          color: #fff;
          border: none;
          padding: 10px 14px;
          border-radius: 10px;
          font-weight: 900;
          box-shadow: 0 10px 22px rgba(255,111,163,.18);
          cursor: pointer;
        }
        .btn-pink:disabled { opacity: .6; cursor: not-allowed; }

        .btn-ghost {
          background: #fff;
          color: ${THEME.text};
          border: 1px solid ${THEME.borderPink};
          padding: 10px 14px;
          border-radius: 10px;
          font-weight: 900;
          box-shadow: 0 10px 22px rgba(31,42,68,.06);
          cursor: pointer;
        }
        .btn-ghost:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
