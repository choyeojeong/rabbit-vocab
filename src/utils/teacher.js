// src/utils/teacher.js
export const TEACHER_PASS = import.meta.env.VITE_TEACHER_PASS || 'RABBIT';

export function ensureTeacher() {
  const ok = localStorage.getItem('teacher_pass_ok') === '1';
  if (ok) return true;
  const input = window.prompt('교사용 비밀번호를 입력하세요');
  if (input && input === TEACHER_PASS) {
    localStorage.setItem('teacher_pass_ok', '1');
    return true;
  }
  alert('비밀번호가 올바르지 않습니다.');
  return false;
}
