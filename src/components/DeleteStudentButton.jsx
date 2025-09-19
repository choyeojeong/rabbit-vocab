// src/components/DeleteStudentButton.jsx
import { useState } from "react";
import { supabase } from "../utils/supabaseClient";

export default function DeleteStudentButton({ studentId, studentName, onDone }) {
  const [busy, setBusy] = useState(false);
  const [resultRows, setResultRows] = useState(null);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    if (!studentId) return;
    // 정말 삭제할지 이중 확인 (이름 입력 확인)
    const ok = window.confirm(
      `정말로 '${studentName}' 학생의 모든 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.`
    );
    if (!ok) return;

    const confirmName = window.prompt(
      `안전 확인: '${studentName}' 을(를) 정확히 입력해 주세요.\n일치하면 삭제가 진행됩니다.`
    );
    if (confirmName !== studentName) {
      alert("이름이 일치하지 않아 삭제를 취소했습니다.");
      return;
    }

    try {
      setBusy(true);
      setError("");
      setResultRows(null);

      // RPC 호출
      const { data, error } = await supabase.rpc("delete_student_all", {
        p_student_id: studentId,
        p_confirm: "YES",
      });

      if (error) throw error;

      setResultRows(data || []);
      alert("삭제가 완료되었습니다.");

      // 목록 새로고침 등 후처리
      onDone?.();
    } catch (e) {
      console.error("[delete_student_all error]", e);
      setError(e.message || "삭제 중 오류가 발생했습니다.");
      alert(`삭제 실패: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button
        onClick={handleDelete}
        disabled={busy}
        style={{
          background: "#ff4d6d",
          color: "white",
          border: "none",
          padding: "6px 10px",
          borderRadius: 6,
          cursor: busy ? "not-allowed" : "pointer",
        }}
        title="이 학생의 모든 데이터를 완전히 삭제합니다"
      >
        {busy ? "삭제 중..." : "학생 완전 삭제"}
      </button>

      {/* (선택) 삭제 결과 요약 표시 */}
      {resultRows && (
        <details>
          <summary style={{ cursor: "pointer" }}>삭제 상세</summary>
          <ul style={{ margin: "6px 0 0 16px" }}>
            {resultRows.map((r, i) => (
              <li key={i}>
                {r.deleted_table}: {r.affected}건
              </li>
            ))}
          </ul>
        </details>
      )}

      {error && (
        <span style={{ color: "#c00", fontSize: 12 }}>
          오류: {error}
        </span>
      )}
    </div>
  );
}
