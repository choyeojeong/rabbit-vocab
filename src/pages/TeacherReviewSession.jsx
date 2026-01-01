// src/pages/TeacherReviewSession.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";

dayjs.locale("ko");

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
    // 가장 안전한 방법: 개별 UPDATE (왕복은 늘지만 확실함)
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

      // ③ 레거시 RPC 호출: finalize_test_session(_id, _final_score, _final_pass)
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

      // 프론트 상태도 finalized로 갱신 (사용자 혼란 방지)
      setSession((prev) => (prev ? { ...prev, status: "finalized" } : prev));

      // ④ ✅ 오답파일 생성 (실패 시: 확정은 완료됐으니 재시도 안내)
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
        return; // ✅ 여기서 멈춰서 재시도 가능하게
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
    return <div style={{ padding: 24 }}>불러오는 중…</div>;
  }

  return (
    <div style={{ background: "#fff5f8", minHeight: "100vh", padding: "24px 12px" }}>
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          background: "white",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 10px 30px rgba(255,111,163,.18)",
        }}
      >
        {/* 헤더 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0, color: "#ff6fa3" }}>
            세션 검수 · {session?.student_name}
            {session?.status === "finalized" && (
              <span
                style={{
                  marginLeft: 10,
                  fontSize: 13,
                  padding: "4px 8px",
                  borderRadius: 8,
                  background: "#ffe4ef",
                  color: "#c94a7a",
                }}
              >
                확정됨
              </span>
            )}
          </h2>
          <Link to="/teacher/review" style={{ color: "#4361ee", textDecoration: "none" }}>
            ← 목록으로
          </Link>
        </div>
        <div style={{ marginTop: 6, color: "#7e7e7e" }}>{header}</div>

        {/* 일괄 버튼 */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button className="btn-pink" onClick={setFromAuto} disabled={items.length === 0 || saving}>
            자동채점값으로 초기화
          </button>
          <button className="btn-pink" onClick={() => setAll(true)} disabled={items.length === 0 || saving}>
            모두 정답 처리
          </button>
          <button className="btn-pink" onClick={() => setAll(false)} disabled={items.length === 0 || saving}>
            모두 오답 처리
          </button>
          <button className="btn-pink" onClick={finalize} disabled={saving || items.length === 0}>
            {saving ? "처리 중…" : "최종 확정"}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 12, color: "#d00", whiteSpace: "pre-line" }}>
            {error}
          </div>
        )}

        {/* 문항 리스트 */}
        <div style={{ marginTop: 20 }}>
          {items.length === 0 ? (
            <div style={{ padding: 16, background: "#fff0f4", borderRadius: 12 }}>
              이 세션에는 저장된 문항이 없습니다.
              <div style={{ marginTop: 6, fontSize: 13, color: "#777" }}>
                ※ 점검: (1) 세션 ID 확인 (2) 시험 저장 시 <code>test_items</code> insert 누락 (3) RLS/권한
              </div>
            </div>
          ) : (
            items.map((it, i) => (
              <div
                key={it.id}
                style={{
                  border: "1px solid #ffe0eb",
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>
                    {i + 1}. {it.term_en}
                  </div>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!it.final_ok}
                      onChange={() => toggleItem(it.id)}
                      disabled={saving}
                    />
                    최종 정답
                  </label>
                </div>
                <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5 }}>
                  <div><b>정답(ko):</b> {it.meaning_ko}</div>
                  <div>
                    <b>학생답안:</b>{" "}
                    {it.student_answer ? it.student_answer : <em style={{ color: "#9a9a9a" }}>—</em>}
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                    자동채점: {it.auto_ok ? "O" : "X"} · 현재최종: {it.final_ok ? "O" : "X"}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 버튼 스타일 */}
      <style>{`
        .btn-pink {
          background: #ff6fa3;
          color: white;
          border: none;
          padding: 10px 14px;
          border-radius: 10px;
          font-weight: 700;
          box-shadow: 0 6px 14px rgba(255,111,163,.25);
          cursor: pointer;
        }
        .btn-pink:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
