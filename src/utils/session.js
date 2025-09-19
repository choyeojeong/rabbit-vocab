const KEY = 'rabbit_session';
const REMEMBER_KEY = 'rabbit_remember_name';

export function setSession(profile) {
  const { id, name, role } = profile;
  localStorage.setItem(KEY, JSON.stringify({ id, name, role }));
}

export function getSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

export function saveRememberedName(name) {
  if (name && name.trim()) localStorage.setItem(REMEMBER_KEY, name.trim());
}

export function getRememberedName() {
  return localStorage.getItem(REMEMBER_KEY) || '';
}

export function clearRememberedName() {
  localStorage.removeItem(REMEMBER_KEY);
}
