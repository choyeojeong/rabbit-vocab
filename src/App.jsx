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

// 교사용 (TeacherShell/Home 제거됨)
import TeacherManagePage from "./pages/TeacherManagePage.jsx";
import TeacherReviewList from "./pages/TeacherReviewList";
import TeacherReviewSession from "./pages/TeacherReviewSession";
import TeacherToday from "./pages/TeacherToday";
import TeacherFocusMonitor from "./pages/TeacherFocusMonitor.jsx";

// CSV 관리
import CsvManagePage from "./pages/admin/CsvManagePage.jsx";
import CsvBatchListPage from "./pages/admin/CsvBatchListPage.jsx";

import { ensureLiveStudent } from "./utils/session";

/**
 * 세션 검증용 보호 라우트 (학생)
 */
function Protected({ children }) {
  const nav = useNavigate();
  const [status, setStatus] = useState("checking"); // 'checking' | 'ok' | 'redirect'

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await ensureLiveStudent();
        if (!alive) return;
        if (!s) {
          setStatus("redirect");
          nav("/", { replace: true });
        } else {
          setStatus("ok");
        }
      } catch (e) {
        if (!alive) return;
        setStatus("redirect");
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
 * 관리자/교사용 보호 라우트 (비밀번호 1회만 입력)
 * - 같은 탭(sessionStorage)에서는 다시 안 물어봄
 * - 새로고침/새 탭에서는 다시 1회 물어봄 (정상)
 */
function AdminGate() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const KEY = "admin_authed_v1";
    const authed = sessionStorage.getItem(KEY);

    if (authed === "1") {
      setReady(true);
      return;
    }

    const expected = import.meta.env.VITE_TEACHER_PASS || "RABBIT";
    const pw = prompt("관리자 비밀번호를 입력하세요");

    if (pw === expected) {
      sessionStorage.setItem(KEY, "1");
      setReady(true);
    } else {
      alert("비밀번호가 틀렸습니다.");
      nav("/", { replace: true });
    }
  }, [nav]);

  if (!ready) return null;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 공개 라우트 */}
        <Route path="/" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* 학생 영역 */}
        <Route
          path="/dashboard"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
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

        {/* === 교사/관리자 영역: 비번 1회 인증 게이트 === */}
        <Route element={<AdminGate />}>
          {/* 교사용 라우트 */}
          <Route path="/teacher/manage" element={<TeacherManagePage />} />
          <Route path="/teacher/review" element={<TeacherReviewList />} />
          <Route
            path="/teacher/review/:id"
            element={<TeacherReviewSession />}
          />
          <Route path="/teacher/today" element={<TeacherToday />} />
          <Route path="/teacher/focus" element={<TeacherFocusMonitor />} />
          <Route path="/teacher/csv" element={<CsvManagePage />} />
          <Route path="/teacher/csv/batches" element={<CsvBatchListPage />} />

          {/* 관리자 alias */}
          <Route path="/admin/users" element={<TeacherManagePage />} />
          <Route path="/admin/csv" element={<CsvManagePage />} />
          <Route path="/admin/csv/batches" element={<CsvBatchListPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
