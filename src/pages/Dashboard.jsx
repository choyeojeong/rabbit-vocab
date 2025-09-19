// src/pages/Dashboard.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession, clearSession } from '../utils/session';

const styles = {
  page: { minHeight: '100vh', background: '#fff5f8', padding: 24 },
  box: { maxWidth: 900, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 8px 24px rgba(255,192,217,0.35)' },
  title: { fontSize: 22, fontWeight: 800, color: '#ff6fa3' },
  btn: { padding: '10px 14px', background: '#ff8fb7', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' },
  hint: { fontSize: 12, color: '#888' },
};

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
    <div style={styles.page}>
      <div style={styles.box}>
        {/* 상단 헤더 (오디오/알림 UI 제거) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 }}>
          <h1 style={styles.title}>Rabbit 대시보드</h1>
          <button style={{ ...styles.btn, marginLeft: 8 }} onClick={logout}>로그아웃</button>
        </div>
        <div style={{ marginTop: 6 }}>
          <span style={styles.hint}>학생 대시보드에서는 실시간 알림/오디오를 사용하지 않습니다.</span>
        </div>

        {me ? (
          <div style={{ marginTop: 16 }}>
            <div>안녕하세요, <b>{me.name}</b> 학생! 🐰</div>

            {/* 버튼 3종: 공부 / 공식시험 / 결과보기 */}
            <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button style={styles.btn} onClick={() => navigate('/study')}>단어 공부 시작하기</button>
              <button style={styles.btn} onClick={() => navigate('/official')}>시험보기(공식)</button>
              <button style={styles.btn} onClick={() => navigate('/exam/official/results')}>공식시험 결과 보기</button>
            </div>

            <div style={{ color: '#777', marginTop: 12, fontSize: 14 }}>
              ‘단어 공부 시작하기’에서는 객관식 연습과 모의시험 연습을 할 수 있어요.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>세션 정보가 없어요.</div>
        )}
      </div>
    </div>
  );
}
