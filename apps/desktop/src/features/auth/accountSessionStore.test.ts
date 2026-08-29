import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_SESSIONS_KEY,
  LEGACY_SESSION_TOKEN_KEY,
  activateAccountSession,
  clearServerAccountSessions,
  readLegacySessionToken,
  readServerAccountSessions,
  removeAccountSession,
  upsertAccountSession,
  writeLegacySessionToken,
  writeServerAccountSessions,
  type AccountSession,
} from './accountSessionStore';

const serverUrl = 'https://kanleaf.example.com/base';

describe('accountSessionStore', () => {
  it('stores accounts per normalized server without leaking between servers', () => {
    const first = upsertAccountSession(
      emptySessions(),
      account('user-1'),
      true,
    );
    const second = upsertAccountSession(
      emptySessions(),
      account('user-2'),
      true,
    );

    expect(writeServerAccountSessions(`${serverUrl}/`, first)).toBe(true);
    expect(writeServerAccountSessions('http://192.168.1.5:3000', second)).toBe(
      true,
    );

    expect(readServerAccountSessions(serverUrl)).toEqual(first);
    expect(readServerAccountSessions('http://192.168.1.5:3000/')).toEqual(
      second,
    );
  });

  it('upserts one session per user and orders the most recently used first', () => {
    const first = upsertAccountSession(
      emptySessions(),
      account('user-1', '2026-08-30T01:00:00.000Z'),
      true,
    );
    const withSecond = upsertAccountSession(
      first,
      account('user-2', '2026-08-30T02:00:00.000Z'),
      false,
    );
    const replaced = upsertAccountSession(
      withSecond,
      {
        ...account('user-1', '2026-08-30T03:00:00.000Z'),
        display_name: 'Updated name',
        token: 'replacement-token',
      },
      false,
    );

    expect(replaced.active_user_id).toBe('user-1');
    expect(replaced.accounts.map(({ user_id }) => user_id)).toEqual([
      'user-1',
      'user-2',
    ]);
    expect(replaced.accounts[0]).toMatchObject({
      display_name: 'Updated name',
      token: 'replacement-token',
    });
  });

  it('activates explicitly and leaves no implicit identity after removal', () => {
    const sessions = upsertAccountSession(
      upsertAccountSession(emptySessions(), account('user-1'), true),
      account('user-2'),
      false,
    );

    const activated = activateAccountSession(
      sessions,
      'user-2',
      '2026-08-30T04:00:00.000Z',
    );
    expect(activated.active_user_id).toBe('user-2');
    expect(activated.accounts[0]?.user_id).toBe('user-2');

    const removed = removeAccountSession(activated, 'user-2');
    expect(removed.active_user_id).toBeNull();
    expect(removed.accounts.map(({ user_id }) => user_id)).toEqual(['user-1']);
    expect(() => activateAccountSession(removed, 'missing')).toThrow(
      'Account session is not retained',
    );
  });

  it('removes malformed registry data instead of partially trusting it', () => {
    localStorage.setItem(
      ACCOUNT_SESSIONS_KEY,
      JSON.stringify({
        version: 1,
        servers: {
          [serverUrl]: {
            active_user_id: 'missing-user',
            accounts: [],
          },
        },
      }),
    );

    expect(readServerAccountSessions(serverUrl)).toEqual(emptySessions());
    expect(localStorage.getItem(ACCOUNT_SESSIONS_KEY)).toBeNull();
  });

  it('clears one server while preserving sessions for another server', () => {
    writeServerAccountSessions(
      serverUrl,
      upsertAccountSession(emptySessions(), account('user-1'), true),
    );
    writeServerAccountSessions(
      'http://127.0.0.1:3000',
      upsertAccountSession(emptySessions(), account('user-2'), true),
    );

    expect(clearServerAccountSessions(serverUrl)).toBe(true);
    expect(readServerAccountSessions(serverUrl)).toEqual(emptySessions());
    expect(
      readServerAccountSessions('http://127.0.0.1:3000').accounts[0]?.user_id,
    ).toBe('user-2');
  });

  it('keeps the legacy token available for validated migration', () => {
    expect(readLegacySessionToken()).toBeNull();
    writeLegacySessionToken('legacy-token');
    expect(localStorage.getItem(LEGACY_SESSION_TOKEN_KEY)).toBe('legacy-token');
    expect(readLegacySessionToken()).toBe('legacy-token');
    writeLegacySessionToken(null);
    expect(readLegacySessionToken()).toBeNull();
  });
});

function emptySessions() {
  return { active_user_id: null, accounts: [] };
}

function account(
  userId: string,
  lastUsedAt = '2026-08-30T01:00:00.000Z',
): AccountSession {
  return {
    user_id: userId,
    email: `${userId}@example.com`,
    display_name: `Account ${userId}`,
    token: `${userId}-token`,
    expires_at: '2026-09-29T01:00:00.000Z',
    last_used_at: lastUsedAt,
  };
}
