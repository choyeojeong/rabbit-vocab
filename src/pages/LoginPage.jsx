// src/pages/LoginPage.jsx
import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import {
  setSession,
  getRememberedName,
  saveRememberedName,
  clearRememberedName,
} from '../utils/session';
import { useNavigate, Link } from 'react-router-dom';

const styles = {
  label: { fontSize: 13, color: '#444', marginBottom: 6 },
  error: {
    background: '#ffe3ea',
    color: '#b00020',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 13,
    marginTop: 10,
  },
  remember: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    fontSize: 13,
    color: '#555',
  },
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [last4, setLast4] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const remembered = getRememberedName();
    if (remembered) {
      setName(remembered);
      setRemember(true);
    }
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;

    setErr('');
    const nm = name.trim();
    const l4 = last4.trim();

    if (!nm) return setErr('이름을 입력해 주세요.');

    // ✅ 1) 관리자 로그인 분기: (코드는 유지) habit / rabbit
    if (nm.toLowerCase() === 'habit' && l4 === 'rabbit') {
      setLoading(true);
      try {
        // 로그인 성공 → 관리자 role 저장 (AdminGate가 이 값을 보고 통과)
        sessionStorage.setItem('role', 'admin');

        setSession({
          id: 'admin-local',
          name: '관리자',
          role: 'admin',
        });

        if (remember) saveRememberedName(nm);
        else clearRememberedName();

        // 관리자 영역으로 이동 (학생 대시보드 대신)
        navigate('/admin/users');
      } catch (e) {
        console.error(e);
        sessionStorage.removeItem('role');
        setErr('로그인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // ✅ 2) 학생 로그인 유효성
    if (!/^\d{4}$/.test(l4)) {
      return setErr('전화번호 뒷 4자리를 숫자 4자리로 입력해 주세요.');
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, role, school, grade')
        .eq('name', nm)
        .eq('phone_last4', l4)
        .eq('role', 'student')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setErr('일치하는 학생을 찾을 수 없어요. 이름과 뒷 4자리를 확인해 주세요.');
        if (!remember) clearRememberedName();
        return;
      }

      // 로그인 성공 → 학생 role 저장 (AdminGate 차단용)
      sessionStorage.setItem('role', 'student');

      setSession({
        id: data.id,
        name: data.name,
        role: data.role,
        school: data.school,
        grade: data.grade,
      });

      if (remember) saveRememberedName(nm);
      else clearRememberedName();

      navigate('/dashboard');
    } catch (e) {
      console.error(e);
      sessionStorage.removeItem('role');
      setErr('로그인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page student-page vh-100 centered with-safe">
      <form onSubmit={onSubmit} className="student-container" style={{ width: '100%' }}>
        <div className="student-card stack">
          <h1 className="student-title" style={{ textAlign: 'center' }}>
            Rabbit 단어 로그인
          </h1>
          <p className="student-sub" style={{ textAlign: 'center' }}>
            이름 + 전화번호 뒷 4자리로 로그인
          </p>

          <div className="stack">
            <label style={styles.label}>이름</label>
            <input
              className="student-input"
              placeholder="예: 홍길동"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              inputMode="text"
            />
          </div>

          <div className="stack">
            <label style={styles.label}>전화번호 뒷 4자리</label>
            <input
              className="student-input"
              placeholder="예: 1234"
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\s/g, '').slice(0, 20))}
              // 관리자(habit)도 입력되어야 하므로 숫자만 강제하지 않음
              inputMode="text"
              maxLength={20}
            />
          </div>

          <label style={styles.remember}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            아이디(이름) 기억하기
          </label>

          {err && <div style={styles.error}>{err}</div>}

          <button
            type="submit"
            className="student-button"
            style={{ marginTop: 8 }}
            disabled={loading}
          >
            {loading ? '로그인 중…' : '로그인'}
          </button>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 10,
              fontSize: 13,
            }}
          >
            <Link
              to="/register"
              style={{ color: '#ff6fa3', textDecoration: 'none', fontWeight: 600 }}
            >
              회원가입
            </Link>
            <span style={{ color: '#aaa' }}>Rabbit 🐰</span>
          </div>
        </div>
      </form>
    </div>
  );
}
