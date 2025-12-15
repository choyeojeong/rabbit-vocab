// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// 공개
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";

// 공용
import Dashboard from "./pages/Dashboard";

// 학생
import BookRangePage from "./pages/BookRangePage";
import PracticeMCQ from "./pages/PracticeMCQ";
import MockExamPage from "./pages/MockExamPage";
import OfficialExamPage from "./pages/OfficialExamPage";
import OfficialResultList from "./pages/OfficialResultList";
import OfficialResultPage from "./pages/OfficialResultPage";

// 교사 / 관리자
import TeacherManagePage from "./pages/TeacherManagePage";
import TeacherReviewList from "./pages/TeacherReviewList";
import TeacherReviewSession from "./pages/TeacherReviewSession";
import TeacherToday from "./pages/TeacherToday";
import TeacherFocusMonitor from "./pages/TeacherFocusMonitor";

// CSV 관리
import CsvManagePage from "./pages/admin/CsvManagePage";
import CsvBatchListPage from "./pages/admin/CsvBatchListPage";

// ✅ 관리자 게이트 (전역 토스트 + Realtime)
import AdminGate from "./pages/admin/AdminGate";

// 학생 보호
import { ensureLiveStudent, getSession } from "./utils/session";

/* =========================
   학생 전용 보호 라우트
========================= */
function Protected({ children }) {
  const navigate = useNavigate();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await ensureLiveStudent();
        if (!alive) return;
        if (!s) navigate("/", { replace: true });
        else setOk(true);
      } catch {
        if (!alive) return;
        navigate("/", { replace: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);

  if (!ok) return null;
  return children;
}

/* =========================
   대시보드 보호 (관리자/학생)
========================= */
function ProtectedDashboard({ children }) {
  const navigate = useNavigate();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = getSession?.();
        const role = me?.role || sessionStorage.getItem("role");

        if (role === "admin") {
          if (!alive) return;
          setOk(true);
          return;
        }

        const s = await ensureLiveStudent();
        if (!alive) return;
        if (!s) navigate("/", { replace: true });
        else setOk(true);
      } catch {
        if (!alive) return;
        navigate("/", { replace: true });
      }
    })();

    return () => {
      alive = false;
    };
  }, [navigate]);

  if (!ok) return null;
  return children;
}

/* =========================
   App Router
========================= */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 공개 */}
        <Route path="/" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* 대시보드 (공용) */}
        <Route
          path="/dashboard"
          element={
            <ProtectedDashboard>
              <Dashboard />
            </ProtectedDashboard>
          }
        />

        {/* 학생 */}
        <Route
          path="/study"
          element={
            <Protected>
              <BookRangePage mode="practice" />
            </Protected>
          }
        />
        <Route
          path="/practice/mcq"
          element={
            <Protected>
              <PracticeMCQ />
            </Protected>
          }
        />
        <Route
          path="/practice/mock"
          element={
            <Protected>
              <MockExamPage />
            </Protected>
          }
        />
        <Route
          path="/official"
          element={
            <Protected>
              <BookRangePage mode="official" />
            </Protected>
          }
        />
        <Route
          path="/exam/official"
          element={
            <Protected>
              <OfficialExamPage />
            </Protected>
          }
        />
        <Route
          path="/exam/official/results"
          element={
            <Protected>
              <OfficialResultList />
            </Protected>
          }
        />
        <Route
          path="/exam/official/results/:id"
          element={
            <Protected>
              <OfficialResultPage />
            </Protected>
          }
        />

        {/* 관리자 / 교사 (AdminGate 내부) */}
        <Route element={<AdminGate />}>
          <Route path="/teacher/manage" element={<TeacherManagePage />} />
          <Route path="/teacher/review" element={<TeacherReviewList />} />
          <Route path="/teacher/review/:id" element={<TeacherReviewSession />} />
          <Route path="/teacher/today" element={<TeacherToday />} />
          <Route path="/teacher/focus" element={<TeacherFocusMonitor />} />

          {/* ✅ CSV (teacher 경로도 유지하는 게 안전) */}
          <Route path="/teacher/csv" element={<CsvManagePage />} />
          <Route path="/teacher/csv/batches" element={<CsvBatchListPage />} />

          {/* 관리자 alias */}
          <Route path="/admin/users" element={<TeacherManagePage />} />
          <Route path="/admin/csv" element={<CsvManagePage />} />
          <Route path="/admin/csv/batches" element={<CsvBatchListPage />} />
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
