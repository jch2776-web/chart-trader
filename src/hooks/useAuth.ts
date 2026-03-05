// ── Client-side auth utilities (personal use / localStorage only) ─────────────
// Passwords are stored as btoa(password) — NOT cryptographically secure.
// This is intentionally minimal: designed for single-device personalization,
// NOT for shared or production environments.

const USERS_KEY        = 'auth-users';
const CURRENT_USER_KEY = 'auth-current-user';
const ROOT_USER        = 'root';
const ROOT_PW_ENCODED  = btoa('musashi1!');

// Ensure the root account always exists in localStorage.
function seedRoot(): void {
  try {
    const users = JSON.parse(localStorage.getItem(USERS_KEY) ?? '{}') as Record<string, string>;
    if (!users[ROOT_USER]) {
      users[ROOT_USER] = ROOT_PW_ENCODED;
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }
  } catch {}
}
seedRoot();

function readUsers(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) ?? '{}'); }
  catch { return {}; }
}

/** Returns the currently logged-in username, or null if not logged in. */
export function getCurrentUser(): string | null {
  try { return localStorage.getItem(CURRENT_USER_KEY); } catch { return null; }
}

/** Returns a namespaced localStorage key for the given user. */
export function userKey(username: string, key: string): string {
  return `u:${username}:${key}`;
}

/** Attempts login. Returns an error string on failure, or null on success. */
export function login(username: string, password: string): string | null {
  const u = username.trim();
  if (!u)       return '아이디를 입력해주세요.';
  if (!password) return '비밀번호를 입력해주세요.';
  const users = readUsers();
  if (!users[u])                  return '존재하지 않는 계정입니다.';
  if (users[u] !== btoa(password)) return '비밀번호가 일치하지 않습니다.';
  try { localStorage.setItem(CURRENT_USER_KEY, u); } catch {}
  return null;
}

/** Attempts registration. Returns an error string on failure, or null on success. */
export function register(username: string, password: string): string | null {
  const u = username.trim();
  if (!u)              return '아이디를 입력해주세요.';
  if (u.length < 2)    return '아이디는 2자 이상이어야 합니다.';
  if (u === ROOT_USER) return `'${ROOT_USER}'는 예약된 아이디입니다.`;
  if (!password)       return '비밀번호를 입력해주세요.';
  if (password.length < 4) return '비밀번호는 4자 이상이어야 합니다.';
  const users = readUsers();
  if (users[u]) return '이미 사용 중인 아이디입니다.';
  users[u] = btoa(password);
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    localStorage.setItem(CURRENT_USER_KEY, u);
  } catch {}
  return null;
}

/** Logs out the current user and reloads the page. */
export function logout(): void {
  try { localStorage.removeItem(CURRENT_USER_KEY); } catch {}
  window.location.reload();
}
