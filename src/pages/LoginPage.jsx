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

  // ✅ 추가: 우측 상단 "앱 설치" 버튼
  installBtn: {
    position: 'fixed',
    top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
    right: 12,
    zIndex: 99990,
    height: 34,
    padding: '0 12px',
    borderRadius: 999,
    border: '1px solid rgba(255, 111, 163, 0.35)',
    background: 'rgba(255, 255, 255, 0.92)',
    color: '#ff6fa3',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  },

  // ✅ 추가: 모달(팝업) 오버레이/패널
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 99999,
    background: 'rgba(10, 15, 25, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 14px calc(env(safe-area-inset-bottom, 0px) + 16px)',
  },
  modalPanel: {
    width: 'min(520px, 100%)',
    maxHeight: 'min(78vh, 720px)',
    overflow: 'auto',
    background: 'rgba(255,255,255,0.98)',
    border: '1px solid rgba(255, 111, 163, 0.22)',
    borderRadius: 16,
    padding: 16,
    boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
  },
  modalHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  modalTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 900,
    color: '#1f2a44',
    letterSpacing: '-0.2px',
  },
  modalCloseBtn: {
    height: 32,
    padding: '0 12px',
    borderRadius: 999,
    border: '1px solid rgba(31,42,68,0.18)',
    background: '#fff',
    color: '#1f2a44',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
  },
  modalSub: {
    margin: '0 0 12px 0',
    fontSize: 13,
    color: '#5d6b82',
    lineHeight: 1.45,
  },
  section: {
    borderTop: '1px dashed rgba(31,42,68,0.18)',
    paddingTop: 12,
    marginTop: 12,
  },
  sectionTitle: {
    margin: '0 0 8px 0',
    fontSize: 14,
    fontWeight: 900,
    color: '#1f2a44',
  },
  stepList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 13,
    color: '#1f2a44',
    lineHeight: 1.55,
  },
  tipBox: {
    marginTop: 10,
    background: 'rgba(255, 111, 163, 0.08)',
    border: '1px solid rgba(255, 111, 163, 0.22)',
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    color: '#1f2a44',
    lineHeight: 1.5,
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid rgba(31,42,68,0.14)',
    background: '#fff',
    fontSize: 12,
    color: '#1f2a44',
    fontWeight: 800,
  },
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [last4, setLast4] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // ✅ 추가: 설치 방법 팝업 상태
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  // ✅ 추가: 모달 열렸을 때 스크롤 잠금 + ESC 닫기
  useEffect(() => {
    if (!showInstallGuide) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e) {
      if (e.key === 'Escape') setShowInstallGuide(false);
    }
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showInstallGuide]);

  // ✅ 추가: 이미 로그인 상태면 로그인 페이지를 보여주지 않고 대시보드로 (뒤로가도 로그인 화면 방지)
  useEffect(() => {
    const role = sessionStorage.getItem('role'); // 'admin' | 'student' | null
    if (role) {
      navigate('/dashboard', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        navigate('/dashboard', { replace: true });
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

      navigate('/dashboard', { replace: true });
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
      {/* ✅ 우측 상단 버튼 */}
      <button
        type="button"
        style={styles.installBtn}
        onClick={() => setShowInstallGuide(true)}
        aria-label="앱 설치 방법 보기"
        title="앱 설치 방법"
      >
        앱 설치
      </button>

      {/* ✅ 설치 안내 모달 */}
      {showInstallGuide && (
        <div
          style={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="앱 설치 방법"
          onMouseDown={(e) => {
            // 바깥(오버레이) 클릭 시 닫기
            if (e.target === e.currentTarget) setShowInstallGuide(false);
          }}
        >
          <div style={styles.modalPanel}>
            <div style={styles.modalHeaderRow}>
              <h2 style={styles.modalTitle}>📲 Rabbit 단어앱 설치 방법</h2>
              <button
                type="button"
                style={styles.modalCloseBtn}
                onClick={() => setShowInstallGuide(false)}
              >
                닫기
              </button>
            </div>

            <p style={styles.modalSub}>
              브라우저로 접속한 뒤 “홈 화면에 추가”를 하면 앱처럼 바로 실행할 수 있어요.
              <br />
              (설치 후에는 <b>홈 화면</b>에서 Rabbit 아이콘을 눌러 실행하면 됩니다.)
            </p>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>🍎 아이폰(iPhone) — Safari 기준</h3>
              <ol style={styles.stepList}>
                <li>
                  <b>Safari</b>에서 Rabbit 단어앱 사이트에 접속합니다.
                </li>
                <li>
                  아래쪽 <b>공유 버튼(⬆️ 네모 아이콘)</b>을 누릅니다.
                </li>
                <li>
                  메뉴에서 <b>“홈 화면에 추가”</b>를 선택합니다.
                </li>
                <li>
                  이름이 보이면 그대로 두고 <b>“추가”</b>를 누릅니다.
                </li>
                <li>
                  홈 화면에 생긴 <b>Rabbit 아이콘</b>을 눌러 실행합니다.
                </li>
              </ol>

              <div style={styles.tipBox}>
                <b>아이폰 팁</b>
                <br />• 꼭 <b>Safari</b>로 설치해 주세요. (Chrome/카카오톡 내 브라우저에서는 “홈 화면에 추가”가 안 보일 수 있어요)
                <br />• “홈 화면에 추가”가 안 보이면: 공유 메뉴를 아래로 조금 더 스크롤해 보세요.
              </div>
            </div>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>📱 갤럭시(Galaxy) — Chrome / Samsung Internet</h3>
              <ol style={styles.stepList}>
                <li>
                  <b>Chrome</b> 또는 <b>삼성 인터넷</b>에서 Rabbit 단어앱 사이트에 접속합니다.
                </li>
                <li>
                  오른쪽 위 <b>⋮(더보기)</b> 또는 메뉴 버튼을 누릅니다.
                </li>
                <li>
                  <b>“홈 화면에 추가”</b> 또는 <b>“앱 설치(Install app)”</b>를 선택합니다.
                </li>
                <li>
                  안내창이 뜨면 <b>“설치/추가”</b>를 눌러 완료합니다.
                </li>
                <li>
                  홈 화면(또는 앱 목록)에 생긴 <b>Rabbit 아이콘</b>으로 실행합니다.
                </li>
              </ol>

              <div style={styles.tipBox}>
                <b>갤럭시 팁</b>
                <br />• “앱 설치”가 안 보이면: <b>홈 화면에 추가</b>를 찾아보세요.
                <br />• 삼성 인터넷에서는 메뉴 이름이 “홈 화면에 추가”로 표시되는 경우가 많아요.
              </div>
            </div>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>✅ 설치가 잘 됐는지 확인</h3>
              <ul style={styles.stepList}>
                <li>홈 화면에 Rabbit 아이콘이 생기면 정상입니다.</li>
                <li>아이콘으로 실행했을 때 주소창이 거의 안 보이면 앱처럼 설치된 상태예요.</li>
                <li>이미 설치되어 있다면 “홈 화면에 추가/앱 설치” 메뉴가 안 보이거나 비활성일 수 있어요.</li>
              </ul>

              <div style={styles.badgeRow}>
                <span style={styles.badge}>iPhone: Safari → 공유 → 홈 화면에 추가</span>
                <span style={styles.badge}>Galaxy: 메뉴(⋮) → 앱 설치 / 홈 화면에 추가</span>
              </div>
            </div>
          </div>
        </div>
      )}

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
