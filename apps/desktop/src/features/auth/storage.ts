const SESSION_TOKEN_KEY = 'kanleaf.session-token';

export function readSessionToken(): string | null {
  return readLocalValue(SESSION_TOKEN_KEY);
}

export function writeSessionToken(token: string | null): void {
  writeLocalValue(SESSION_TOKEN_KEY, token);
}

function readLocalValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalValue(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // The current session still works if a webview disables local storage.
  }
}
