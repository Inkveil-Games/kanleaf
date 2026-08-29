import { normalizeServerUrl } from '../../lib/config/server';

export const ACCOUNT_SESSIONS_KEY = 'kanleaf.account-sessions.v1';
export const LEGACY_SESSION_TOKEN_KEY = 'kanleaf.session-token';

export interface AccountSession {
  user_id: string;
  email: string;
  display_name: string;
  token: string;
  expires_at: string;
  last_used_at: string;
}

export interface ServerAccountSessions {
  active_user_id: string | null;
  accounts: AccountSession[];
}

interface AccountSessionRegistry {
  version: 1;
  servers: Record<string, ServerAccountSessions>;
}

const EMPTY_REGISTRY: AccountSessionRegistry = { version: 1, servers: {} };

export function readServerAccountSessions(
  serverUrl: string,
): ServerAccountSessions {
  const key = normalizeServerUrl(serverUrl);
  const sessions = readRegistry().servers[key];
  return sessions ? cloneSessions(sessions) : emptySessions();
}

export function writeServerAccountSessions(
  serverUrl: string,
  sessions: ServerAccountSessions,
): boolean {
  const key = normalizeServerUrl(serverUrl);
  const registry = readRegistry();
  const servers = { ...registry.servers };
  if (sessions.accounts.length === 0) {
    delete servers[key];
  } else {
    servers[key] = cloneSessions(sessions);
  }
  return writeLocalValue(
    ACCOUNT_SESSIONS_KEY,
    Object.keys(servers).length > 0
      ? JSON.stringify({ version: 1, servers })
      : null,
  );
}

export function clearServerAccountSessions(serverUrl: string): boolean {
  return writeServerAccountSessions(serverUrl, emptySessions());
}

export function upsertAccountSession(
  sessions: ServerAccountSessions,
  account: AccountSession,
  activate: boolean,
): ServerAccountSessions {
  const accounts = sessions.accounts.filter(
    ({ user_id }) => user_id !== account.user_id,
  );
  accounts.push({ ...account });
  return {
    active_user_id: activate ? account.user_id : sessions.active_user_id,
    accounts: sortAccounts(accounts),
  };
}

export function activateAccountSession(
  sessions: ServerAccountSessions,
  userId: string,
  lastUsedAt = new Date().toISOString(),
): ServerAccountSessions {
  if (!sessions.accounts.some(({ user_id }) => user_id === userId)) {
    throw new Error('Account session is not retained');
  }
  return {
    active_user_id: userId,
    accounts: sortAccounts(
      sessions.accounts.map((account) =>
        account.user_id === userId
          ? { ...account, last_used_at: lastUsedAt }
          : { ...account },
      ),
    ),
  };
}

export function removeAccountSession(
  sessions: ServerAccountSessions,
  userId: string,
): ServerAccountSessions {
  return {
    active_user_id:
      sessions.active_user_id === userId ? null : sessions.active_user_id,
    accounts: sessions.accounts
      .filter(({ user_id }) => user_id !== userId)
      .map((account) => ({ ...account })),
  };
}

export function readLegacySessionToken(): string | null {
  return readLocalValue(LEGACY_SESSION_TOKEN_KEY);
}

export function writeLegacySessionToken(token: string | null): boolean {
  return writeLocalValue(LEGACY_SESSION_TOKEN_KEY, token);
}

function readRegistry(): AccountSessionRegistry {
  const stored = readLocalValue(ACCOUNT_SESSIONS_KEY);
  if (!stored) return EMPTY_REGISTRY;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRegistry(parsed))
      throw new Error('Invalid account session registry');
    return parsed;
  } catch {
    writeLocalValue(ACCOUNT_SESSIONS_KEY, null);
    return EMPTY_REGISTRY;
  }
}

function isRegistry(value: unknown): value is AccountSessionRegistry {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.servers)) {
    return false;
  }
  return Object.entries(value.servers).every(([serverUrl, sessions]) => {
    try {
      if (normalizeServerUrl(serverUrl) !== serverUrl) return false;
    } catch {
      return false;
    }
    return isServerSessions(sessions);
  });
}

function isServerSessions(value: unknown): value is ServerAccountSessions {
  if (
    !isRecord(value) ||
    (value.active_user_id !== null &&
      typeof value.active_user_id !== 'string') ||
    !Array.isArray(value.accounts) ||
    !value.accounts.every(isAccountSession)
  ) {
    return false;
  }
  const userIds = value.accounts.map(({ user_id }) => user_id);
  return (
    new Set(userIds).size === userIds.length &&
    (value.active_user_id === null || userIds.includes(value.active_user_id))
  );
}

function isAccountSession(value: unknown): value is AccountSession {
  return (
    isRecord(value) &&
    isNonEmptyString(value.user_id) &&
    isNonEmptyString(value.email) &&
    typeof value.display_name === 'string' &&
    isNonEmptyString(value.token) &&
    isDate(value.expires_at) &&
    isDate(value.last_used_at)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function cloneSessions(sessions: ServerAccountSessions): ServerAccountSessions {
  return {
    active_user_id: sessions.active_user_id,
    accounts: sessions.accounts.map((account) => ({ ...account })),
  };
}

function emptySessions(): ServerAccountSessions {
  return { active_user_id: null, accounts: [] };
}

function sortAccounts(accounts: AccountSession[]): AccountSession[] {
  return [...accounts].sort((left, right) =>
    right.last_used_at.localeCompare(left.last_used_at),
  );
}

function readLocalValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalValue(key: string, value: string | null): boolean {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
    return true;
  } catch {
    return false;
  }
}
