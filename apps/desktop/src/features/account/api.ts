import { apiRequest } from '../../lib/api/client';
import type { User } from '../../lib/api/types';
import type { ApiContext } from '../workspace/api';

export interface AccountSession {
  id: string;
  created_at: string;
  expires_at: string;
  is_current: boolean;
}

export function getAccount(context: ApiContext) {
  return apiRequest<User>(context.serverUrl, '/api/account', {
    token: context.token,
  });
}

export function updateProfile(context: ApiContext, displayName: string) {
  return apiRequest<User>(context.serverUrl, '/api/account/profile', {
    method: 'PATCH',
    token: context.token,
    body: JSON.stringify({ display_name: displayName }),
  });
}

export function updatePreferences(
  context: ApiContext,
  preferences: Pick<User, 'theme' | 'timezone' | 'week_start' | 'date_format'>,
) {
  return apiRequest<User>(context.serverUrl, '/api/account/preferences', {
    method: 'PATCH',
    token: context.token,
    body: JSON.stringify(preferences),
  });
}

export function changePassword(
  context: ApiContext,
  currentPassword: string,
  newPassword: string,
) {
  return apiRequest<void>(context.serverUrl, '/api/account/password', {
    method: 'POST',
    token: context.token,
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export function listAccountSessions(context: ApiContext) {
  return apiRequest<AccountSession[]>(
    context.serverUrl,
    '/api/account/sessions',
    { token: context.token },
  );
}

export function revokeAccountSession(context: ApiContext, sessionId: string) {
  return apiRequest<void>(
    context.serverUrl,
    `/api/account/sessions/${sessionId}`,
    { method: 'DELETE', token: context.token },
  );
}

export function revokeOtherSessions(context: ApiContext) {
  return apiRequest<void>(
    context.serverUrl,
    '/api/account/sessions/revoke-others',
    { method: 'POST', token: context.token },
  );
}
