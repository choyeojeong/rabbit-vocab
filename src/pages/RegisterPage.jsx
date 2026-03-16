import { useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { Link, useNavigate } from 'react-router-dom';

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff5f8',
    padding: 16,
  },

  // ✅ 흰색 네모칸 제거: background/boxShadow/radius 제거, width는 maxWidth로만 제한
  card: {
    width: '100%',
    maxWidth: 420,
    padding: 12, // 너무 붙어 보이지 않게만
    background: 'transparent',
    boxShadow: 'none',
    borderRadius: 0,
  },

  title: { margin: 0, fontSize: 22, fontWeight: 800, color: '#ff6fa3', textAlign: 'center' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 },
  row: { display: 'grid', gap: 8, marginTop: 12 },
  label: { fontSize: 13, color: '#444', fontWeight: 800 },

  input: {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #ffd3e3',
    borderRadius: 12,
    outline: 'none',
    fontSize: 14,
    background: 'rgba(255,255,255,0.9)', // ✅ 카드 없애도 입력칸은 잘 보이게
  },

  btn: {
    width: '100%',
    padding: '12px 14px',
    background: '#ff8fb7',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    fontWeight: 800,
    cursor: 'pointer',
    marginTop: 14,
    boxShadow: '0 10px 20px rgba(255,111,163,0.18)', // 버튼만 살짝 떠 보이게
  },

  small: { fontSize: 12, color: '#777', fontWeight: 700 },

  error: {
    background: '#ffe3ea',
    color: '#b00020',
    padding: '8px 10px',
    borderRadius: 12,
    fontSize: 13,
    marginTop: 10,
    fontWeight: 800,
    border: '1px solid #ffb8c9',
  },

  success: {
    background: '#e7fff3',
    color: '#0a7a3d',
    padding: '8px 10px',
    borderRadius: 12,
    fontSize: 13,
    marginTop: 10,
    fontWeight: 800,
    border: '1px solid #b3f0d0',
  },
};

export default function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [school, setSchool] = useState('');
  const [grade, setGrade] = useState('');
  const [phone, setPhone] = useState('');
  const [teacherName, setTeacherName] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setErr('');
    setOk('');

    const nm = name.trim();
    const sc = school.trim();
    const gr = grade.trim();
    const ph = phone.replace(/\D/g, ''); // 숫자만
    const tn = teacherName.trim();

    if (!nm || !ph || ph.length < 7) return setErr('이름과 전화번호(숫자) 전체를 정확히 입력해 주세요.');
    if (!tn) return setErr('담당 선생님 성함을 입력해 주세요.');

    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .insert([
          {
            role: 'student',
            name: nm,
            school: sc || null,
            grade: gr || null,
            phone: ph, // 트리거가 phone_last4를 자동 채움
            teacher_name: tn,
          },
        ])
        .select('id,name');

      if (error) {
        if (error.code === '23505') setErr('이미 같은 이름/전화번호(뒷4자리)의 학생이 있어요. 확인해 주세요.');
        else setErr('회원가입 중 오류가 발생했어요.');
        return;
      }

      setOk('회원가입이 완료되었어요! 로그인 화면으로 이동합니다.');
      setTimeout(() => navigate('/'), 900);
    } catch (e) {
      console.error(e);
      setErr('회원가입 중 오류가 발생했어요. 다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <form onSubmit={onSubmit} style={styles.card}>
        <h1 style={styles.title}>Rabbit 회원가입 🐰</h1>

        <div style={styles.row}>
          <label style={styles.label}>이름 *</label>
          <input style={styles.input} placeholder="예: 홍길동" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div style={styles.row2}>
          <div>
            <label style={styles.label}>학교</label>
            <input style={styles.input} placeholder="예: 산본중" value={school} onChange={(e) => setSchool(e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>학년</label>
            <input style={styles.input} placeholder="예: 중2" value={grade} onChange={(e) => setGrade(e.target.value)} />
          </div>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>전화번호(숫자만) *</label>
          <input
            style={styles.input}
            placeholder="예: 01012345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
          <div style={styles.small}>
            로그인은 <b>이름 + 전화번호 뒷 4자리</b>로 진행돼요.
          </div>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>담당 선생님 성함 *</label>
          <input style={styles.input} value={teacherName} onChange={(e) => setTeacherName(e.target.value)} />
        </div>

        {err && <div style={styles.error}>{err}</div>}
        {ok && <div style={styles.success}>{ok}</div>}

        <button type="submit" style={styles.btn} disabled={loading}>
          {loading ? '가입 중…' : '회원가입'}
        </button>

        <div style={{ marginTop: 10, textAlign: 'center' }}>
          <Link to="/" style={{ color: '#ff6fa3', textDecoration: 'none', fontWeight: 800 }}>
            로그인으로 돌아가기
          </Link>
        </div>
      </form>
    </div>
  );
}
