// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

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

// ✅ 관리자 게이트
import AdminGate from "./pages/admin/AdminGate";

// ✅ 단어책 분류(신규)
import BookCategoryManagePage from "./pages/admin/BookCategoryManagePage";
import BookCategorizePage from "./pages/admin/BookCategorizePage";

// ✅ (추가) 관리자 오답노트(학생별/월별) 페이지
import WrongBooksAdminPage from "./pages/admin/WrongBooksAdminPage";

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
   ✅ 구버전 단수 경로(/result/:id) → /results/:id 로 리다이렉트
========================= */
function LegacyOfficialResultRedirect() {
  const { id } = useParams();
  return <Navigate to={`/exam/official/results/${id}`} replace />;
}

/* =========================
   ✅ 로그인 유지용 리다이렉트
========================= */
function LoginGate({ children }) {
  const navigate = useNavigate();

  useEffect(() => {
    const role = sessionStorage.getItem("role"); // 'admin' | 'student' | null
    if (role) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

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
        <Route
          path="/"
          element={
            <LoginGate>
              <LoginPage />
            </LoginGate>
          }
        />
        <Route
          path="/login"
          element={
            <LoginGate>
              <LoginPage />
            </LoginGate>
          }
        />
        <Route path="/register" element={<RegisterPage />} />

        {/* 대시보드 */}
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

        {/* ✅ 구버전 단수 경로도 살려두기 */}
        <Route
          path="/exam/official/result/:id"
          element={<LegacyOfficialResultRedirect />}
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

          {/* ✅ (추가) 오답노트(관리자) */}
          <Route path="/teacher/wrongs" element={<WrongBooksAdminPage />} />
          <Route path="/admin/wrongs" element={<WrongBooksAdminPage />} />

          {/* ✅ 단어책 분류(신규) */}
          <Route
            path="/teacher/book-categories"
            element={<BookCategoryManagePage />}
          />
          <Route
            path="/teacher/book-categorize"
            element={<BookCategorizePage />}
          />

          {/* admin alias */}
          <Route path="/admin/users" element={<TeacherManagePage />} />
          <Route path="/admin/csv" element={<CsvManagePage />} />
          <Route path="/admin/csv/batches" element={<CsvBatchListPage />} />
          <Route
            path="/admin/book-categories"
            element={<BookCategoryManagePage />}
          />
          <Route
            path="/admin/book-categorize"
            element={<BookCategorizePage />}
          />
        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
