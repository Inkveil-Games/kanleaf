import { apiRequest } from '../../lib/api/client';
import type { AuthResponse } from '../../lib/api/types';

export function authenticate(
  serverUrl: string,
  mode: 'login' | 'register',
  email: string,
  password: string,
) {
  return apiRequest<AuthResponse>(serverUrl, `/api/auth/${mode}`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function requestPasswordReset(
  serverUrl: string,
  email: string,
  returnTo: string | null,
) {
  return apiRequest<void>(serverUrl, '/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({
      email,
      ...(returnTo ? { return_to: returnTo } : {}),
    }),
  });
}

export function resetPassword(
  serverUrl: string,
  token: string,
  password: string,
) {
  return apiRequest<void>(serverUrl, '/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}
