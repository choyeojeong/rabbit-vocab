// src/utils/session.js
import { supabase } from './supabaseClient';

const KEY = 'rabbit_session';
const REMEMBER_KEY = 'rabbit_remember_name';

/**
 * 세션 저장
 * - profile: { id, name, role? }
 * - role이 없으면 기본값 'student'
 */
export function setSession(profile = {}) {
  const { id = null, name = '', role = 'student' } = profile;
  localStorage.setItem(KEY, JSON.stringify({ id, name, role }));
}

/**
 * 로컬 세션 가져오기 (검증 없이)
 */
export function getSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 관리자 여부
 */
export function isAdmin() {
  return getSession()?.role === 'admin';
}

/**
 * 세션 지우기
 */
export function clearSession() {
  localStorage.removeItem(KEY);
}

/**
 * 이름 기억하기 저장
 */
export function saveRememberedName(name) {
  if (name && name.trim()) localStorage.setItem(REMEMBER_KEY, name.trim());
}

/**
 * 기억된 이름 가져오기
 */
export function getRememberedName() {
  return localStorage.getItem(REMEMBER_KEY) || '';
}

/**
 * 기억된 이름 지우기
 */
export function clearRememberedName() {
  localStorage.removeItem(REMEMBER_KEY);
}

/**
 * ✅ DB에서 실제 존재하는 학생인지 확인
 * - 관리자(role==='admin')는 검증을 건너뜁니다.
 * - 삭제된 학생이면 null을 반환하고 세션을 자동으로 정리합니다.
 */
export async function ensureLiveStudent() {
  const s = getSession();
  if (!s?.id) return null;

  // 관리자 세션은 DB에 존재하지 않으므로 바로 허용
  if (s.role === 'admin') return s;

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', s.id)
    .maybeSingle();

  if (error || !data) {
    clearSession();
    return null;
  }
  return s;
}
