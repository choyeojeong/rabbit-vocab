import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { setSession, getRememberedName, saveRememberedName, clearRememberedName } from '../utils/session';
import { useNavigate, Link } from 'react-router-dom';

const styles = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff5f8' },
  card: { width: 360, background: '#fff', borderRadius: 12, boxShadow: '0 8px 24px rgba(255,192,217,0.35)', padding: 24 },
  title: { margin: 0, fontSize: 22, fontWeight: 800, color: '#ff6fa3', textAlign: 'center' },
  sub: { marginTop: 6, fontSize: 12, color: '#777', textAlign: 'center' },
  input: { width: '100%', padding: '12px 14px', border: '1px solid #ffd3e3', borderRadius: 10, outline: 'none', fontSize: 14 },
  label: { fontSize: 13, color: '#444', marginBottom: 6 },
  btn: { width: '100%', padding: '12px 14px', background: '#ff8fb7', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' },
  linkRow: { display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13 },
  row: { display: 'grid', gap: 8, marginTop: 14 },
  remember: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: '#555' },
  error: { background: '#ffe3ea', color: '#b00020', padding: '8px 10px', borderRadius: 8, fontSize: 13, marginTop: 10 },
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
    setErr('');
    const nm = name.trim();
    const l4 = last4.trim();
    if (!nm) return setErr('이름을 입력해 주세요.');
    if (!/^\d{4}$/.test(l4)) return setErr('전화번호 뒷 4자리를 숫자 4자리로 입력해 주세요.');

    setLoading(true);
    try {
      // 프로필에서 이름 + 뒷4자리 매칭
      const { data, error } = await supabase
        .from('profiles')
        .select('id,name,role,school,grade')
        .eq('name', nm)
        .eq('phone_last4', l4)
        .eq('role', 'student')
        .limit(1);

      if (error) throw error;
      const user = (data && data[0]) || null;
      if (!user) {
        setErr('일치하는 학생을 찾을 수 없어요. 이름과 뒷 4자리를 확인해 주세요.');
        return;
      }

      // 세션 저장
      setSession(user);

      // 아이디 기억하기
      if (remember) saveRememberedName(nm);
      else clearRememberedName();

      navigate('/dashboard');
    } catch (e) {
      console.error(e);
      setErr('로그인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <form onSubmit={onSubmit} style={styles.card}>
        <h1 style={styles.title}>Rabbit 단어 로그인</h1>
        <div style={styles.sub}>이름 + 전화번호 뒷 4자리로 로그인</div>

        <div style={styles.row}>
          <label style={styles.label}>이름</label>
          <input
            style={styles.input}
            placeholder="예: 홍길동"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>

        <div style={styles.row}>
          <label style={styles.label}>전화번호 뒷 4자리</label>
          <input
            style={styles.input}
            placeholder="예: 1234"
            value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
          />
        </div>

        <label style={styles.remember}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          아이디(이름) 기억하기
        </label>

        {err && <div style={styles.error}>{err}</div>}

        <button type="submit" style={{ ...styles.btn, marginTop: 16 }} disabled={loading}>
          {loading ? '로그인 중…' : '로그인'}
        </button>

        <div style={styles.linkRow}>
          <Link to="/register" style={{ color: '#ff6fa3', textDecoration: 'none', fontWeight: 600 }}>
            회원가입
          </Link>
          <span style={{ color: '#aaa' }}>Rabbit 🐰</span>
        </div>
      </form>
    </div>
  );
}
