import {
  readLegacySessionToken,
  writeLegacySessionToken,
} from './accountSessionStore';

export function readSessionToken(): string | null {
  return readLegacySessionToken();
}

export function writeSessionToken(token: string | null): void {
  writeLegacySessionToken(token);
}
