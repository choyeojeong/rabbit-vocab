import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../utils/session';
import StudentShell from './StudentShell';

export default function Dashboard() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);

  useEffect(() => {
    setMe(getSession());
  }, []);

  function logout() {
    clearSession();
    navigate('/');
  }

  return (
    <StudentShell title="Rabbit 단어 대시보드">
      {/* 중앙 정렬 래퍼 */}
      <div className="vh-100 centered with-safe" style={{ width: '100%' }}>
        <div className="student-container">
          <div className="student-card stack">
            {/* 상단: 학생 인사 + 로그아웃 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 }}>
              <div className="student-text">
                {me ? (
                  <>안녕하세요, <b>{me.name}</b> 학생! 🐰</>
                ) : (
                  <>세션 정보를 불러오는 중…</>
                )}
              </div>
              <button
                onClick={logout}
                className="student-button"
                style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}
              >
                로그아웃
              </button>
            </div>

            {/* 안내문구 */}
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 12, color: '#888' }}>
                학생 대시보드에서는 실시간 알림/오디오를 사용하지 않습니다.
              </span>
            </div>

            {/* 주요 버튼 */}
            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              <button className="student-button" onClick={() => navigate('/study')}>
                단어 공부 시작하기
              </button>
              <button className="student-button" onClick={() => navigate('/official')}>
                시험보기(공식)
              </button>
              <button className="student-button" onClick={() => navigate('/exam/official/results')}>
                공식시험 결과 보기
              </button>
            </div>

            {/* 설명 */}
            <div className="student-text" style={{ color: '#777', marginTop: 12 }}>
              ‘단어 공부 시작하기’에서는 객관식 연습과 모의시험 연습을 할 수 있어요.
            </div>
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
