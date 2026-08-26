import { apiRequest } from '../../lib/api/client';
import type { HealthResponse } from '../../lib/api/types';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000';

const SERVER_URL_KEY = 'kanleaf.server-url';
const SESSION_TOKEN_KEY = 'kanleaf.session-token';

export function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a complete HTTP or HTTPS server URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Server URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Server URL cannot contain credentials');
  }
  if (url.search || url.hash) {
    throw new Error('Server URL cannot contain a query or fragment');
  }

  return url.toString().replace(/\/$/, '');
}

export async function verifyServerUrl(
  value: string,
  signal?: AbortSignal,
): Promise<string> {
  const serverUrl = normalizeServerUrl(value);
  const health = await apiRequest<HealthResponse>(serverUrl, '/api/health', {
    signal,
  });
  if (health.service !== 'kanleaf' || health.status !== 'ok') {
    throw new Error('This URL does not identify a healthy Kanleaf server');
  }
  return serverUrl;
}

export function readServerUrl(): string | null {
  return readLocalValue(SERVER_URL_KEY);
}

export function writeServerUrl(serverUrl: string | null): void {
  writeLocalValue(SERVER_URL_KEY, serverUrl);
}

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
