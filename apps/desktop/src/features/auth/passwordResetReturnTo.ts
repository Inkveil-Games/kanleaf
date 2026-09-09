import { validatedInvitationReturnTo } from '../../app/routing/safeReturnTo';

const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface PasswordResetRoute {
  token: string;
  returnTo: string | null;
}

export function invitationReturnToFromHash(hash: string) {
  const parameters = new URLSearchParams(
    hash.startsWith('#') ? hash.slice(1) : hash,
  );
  return validatedInvitationReturnTo(parameters.get('returnTo'));
}

export function invitationReturnToHash(returnTo: string) {
  const validated = validatedInvitationReturnTo(returnTo);
  if (!validated) return '';
  return `#${new URLSearchParams({ returnTo: validated }).toString()}`;
}

export function passwordResetRouteFromHash(
  hash: string,
): PasswordResetRoute | null {
  const parameters = new URLSearchParams(
    hash.startsWith('#') ? hash.slice(1) : hash,
  );
  const token = parameters.get('token');
  if (!token || !SECRET_TOKEN_PATTERN.test(token)) return null;

  const rawReturnTo = parameters.get('returnTo');
  const returnTo = rawReturnTo
    ? validatedInvitationReturnTo(rawReturnTo)
    : null;
  if (rawReturnTo && !returnTo) return null;
  return { token, returnTo };
}
