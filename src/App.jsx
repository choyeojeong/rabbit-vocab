// src/App.jsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';

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
import TeacherFocusMonitor from './pages/TeacherFocusMonitor.jsx'; // 이탈 감지 모니터

// CSV 관리 (🔁 경로 수정: admin 폴더)
import CsvManagePage from './pages/admin/CsvManagePage.jsx';

import { ensureLiveStudent } from './utils/session';

/**
 * 삭제된 계정/없는 계정의 "유령 로그인"을 막기 위한 보호 라우트
 * - 로컬 세션이 있어도 DB(profiles)에 실제 존재하는지 비동기로 확인
 * - 존재하지 않으면 세션을 비우고 로그인 페이지로 보냄
 * - 관리자(role==='admin')는 ensureLiveStudent에서 통과
 */
function Protected({ children }) {
  const nav = useNavigate();
  const [status, setStatus] = useState('checking'); // 'checking' | 'ok' | 'redirect'

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await ensureLiveStudent(); // 없으면 내부에서 세션 제거
        if (!alive) return;
        if (!s) {
          setStatus('redirect');
          nav('/', { replace: true });
        } else {
          setStatus('ok');
        }
      } catch (e) {
        if (!alive) return;
        setStatus('redirect');
        nav('/', { replace: true });
      }
    })();
    return () => { alive = false; };
  }, [nav]);

  if (status === 'checking') return null;
  if (status === 'redirect') return null;
  return <>{children}</>;
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

        {/* 공부(연습/모의) */}
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

        {/* 공식시험 준비(책/챕터 선택) */}
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
          path="/exam/official/results/:id"
          element={
            <Protected>
              <OfficialResultPage />
            </Protected>
          }
        />

        {/* === 교사용: /teacher/* (TeacherShell 비번 게이트) === */}
        <Route path="/teacher" element={<TeacherShell />}>
          {/* /teacher → /teacher/home 리다이렉트는 Shell 내부에서 처리한다고 가정 */}
          <Route path="home" element={<TeacherHome />} />
          <Route path="manage" element={<TeacherManagePage />} />
          <Route path="review" element={<TeacherReviewList />} />
          <Route path="review/:id" element={<TeacherReviewSession />} />
          <Route path="today" element={<TeacherToday />} />
          <Route path="focus" element={<TeacherFocusMonitor />} />
          {/* ⬇ CSV 관리 (교사용 경로) */}
          <Route path="csv" element={<CsvManagePage />} />
        </Route>

        {/* === 관리자 alias: /admin/* → TeacherShell 경유로 동일 페이지 제공 === */}
        <Route path="/admin" element={<TeacherShell />}>
          <Route path="users" element={<TeacherManagePage />} />
          {/* ⬇ CSV 관리 (관리자 경로) */}
          <Route path="csv" element={<CsvManagePage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
