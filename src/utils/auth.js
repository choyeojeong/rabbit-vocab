const KEY = "rabbit_auth";

export function getAuth() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuth(authObj) {
  localStorage.setItem(KEY, JSON.stringify(authObj));
}

export function clearAuth() {
  localStorage.removeItem(KEY);
}
