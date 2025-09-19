// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import BookRangePage from './pages/BookRangePage';
import PracticeMCQ from './pages/PracticeMCQ';
import MockExamPage from './pages/MockExamPage';
import OfficialExamPage from './pages/OfficialExamPage';
import OfficialResultList from './pages/OfficialResultList';
import OfficialResultPage from './pages/OfficialResultPage';

// 교사용
import TeacherShell from './pages/TeacherShell.jsx';
import TeacherHome from './pages/TeacherHome.jsx';
import TeacherManagePage from './pages/TeacherManagePage.jsx';
import TeacherReviewList from './pages/TeacherReviewList';
import TeacherReviewSession from './pages/TeacherReviewSession';
import TeacherToday from './pages/TeacherToday';
import TeacherFocusMonitor from './pages/TeacherFocusMonitor.jsx'; // ✅ 이탈 감지 모니터 추가

import { getSession } from './utils/session';

function Protected({ children }) {
  const s = getSession();
  if (!s) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 인증 없이 접근 가능한 페이지 */}
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

        {/* 공부(연습/모의) – 공식 버튼은 이 페이지에서 제거됨 */}
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

        {/* 공식시험 준비(책/챕터 선택) -> 제출 시 /exam/official 로 진입 */}
        <Route
          path="/official"
          element={
            <Protected>
              <BookRangePage mode="official" />
            </Protected>
          }
        />

        {/* 공식시험 본문 */}
        <Route
          path="/exam/official"
          element={
            <Protected>
              <OfficialExamPage />
            </Protected>
          }
        />

        {/* 학생용: 공식시험 결과 목록/상세 */}
        <Route
          path="/exam/official/results"
          element={
            <Protected>
              <OfficialResultList />
            </Protected>
          }
        />
        <Route
          path="/exam/official/result/:id"
          element={
            <Protected>
              <OfficialResultPage />
            </Protected>
          }
        />

        {/* === 교사용: 모든 하위 라우트는 TeacherShell(비번 게이트)로 보호 === */}
        <Route path="/teacher" element={<TeacherShell />}>
          {/* /teacher → /teacher/home 리다이렉트는 Shell 내부에서 처리 */}
          <Route path="home" element={<TeacherHome />} />
          <Route path="manage" element={<TeacherManagePage />} />
          <Route path="review" element={<TeacherReviewList />} />
          <Route path="review/:id" element={<TeacherReviewSession />} />
          <Route path="today" element={<TeacherToday />} />
          <Route path="focus" element={<TeacherFocusMonitor />} /> {/* ✅ 이탈 감지 */}
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
