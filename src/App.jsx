// src/App.jsx
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  Outlet,
} from "react-router-dom";

import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import Dashboard from "./pages/Dashboard";
import BookRangePage from "./pages/BookRangePage";
import PracticeMCQ from "./pages/PracticeMCQ";
import MockExamPage from "./pages/MockExamPage";
import OfficialExamPage from "./pages/OfficialExamPage";
import OfficialResultList from "./pages/OfficialResultList";
import OfficialResultPage from "./pages/OfficialResultPage";

// 교사용
import TeacherManagePage from "./pages/TeacherManagePage.jsx";
import TeacherReviewList from "./pages/TeacherReviewList";
import TeacherReviewSession from "./pages/TeacherReviewSession";
import TeacherToday from "./pages/TeacherToday";
import TeacherFocusMonitor from "./pages/TeacherFocusMonitor.jsx";

// CSV 관리
import CsvManagePage from "./pages/admin/CsvManagePage.jsx";
import CsvBatchListPage from "./pages/admin/CsvBatchListPage.jsx";

import { ensureLiveStudent, getSession } from "./utils/session";

/**
 * 학생 보호 라우트 (학생 전용)
 */
function Protected({ children }) {
  const nav = useNavigate();
  const [status, setStatus] = useState("checking"); // checking | ok

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await ensureLiveStudent();
        if (!alive) return;
        if (!s) {
          nav("/", { replace: true });
        } else {
          setStatus("ok");
        }
      } catch {
        if (!alive) return;
        nav("/", { replace: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [nav]);

  if (status !== "ok") return null;
  return <>{children}</>;
}

/**
 * 대시보드 보호 라우트
 * - 관리자면 바로 통과
 * - 학생이면 ensureLiveStudent로 통과
 */
function ProtectedDashboard({ children }) {
  const nav = useNavigate();
  const [status, setStatus] = useState("checking"); // checking | ok

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const me = getSession?.() || null;
        const role = me?.role || sessionStorage.getItem("role");

        // 관리자면 바로 OK
        if (role === "admin") {
          if (!alive) return;
          setStatus("ok");
          return;
        }

        // 그 외(학생)는 학생 세션 검증
        const s = await ensureLiveStudent();
        if (!alive) return;
        if (!s) {
          nav("/", { replace: true });
        } else {
          setStatus("ok");
        }
      } catch {
        if (!alive) return;
        nav("/", { replace: true });
      }
    })();

    return () => {
      alive = false;
    };
  }, [nav]);

  if (status !== "ok") return null;
  return <>{children}</>;
}

/**
 * 관리자/교사용 보호 라우트 (prompt 없음)
 */
function AdminGate() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const role = sessionStorage.getItem("role"); // 'admin' | 'student' | null
    if (role === "admin") setReady(true);
    else nav("/", { replace: true });
  }, [nav]);

  if (!ready) return null;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 공개 */}
        <Route path="/" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* 대시보드: 관리자/학생 공용 */}
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

        {/* 관리자 / 교사 */}
        <Route element={<AdminGate />}>
          <Route path="/teacher/manage" element={<TeacherManagePage />} />
          <Route path="/teacher/review" element={<TeacherReviewList />} />
          <Route path="/teacher/review/:id" element={<TeacherReviewSession />} />
          <Route path="/teacher/today" element={<TeacherToday />} />
          <Route path="/teacher/focus" element={<TeacherFocusMonitor />} />
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
