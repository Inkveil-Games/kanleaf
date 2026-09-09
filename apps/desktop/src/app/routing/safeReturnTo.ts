const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function validatedInvitationReturnTo(value: unknown) {
  if (typeof value !== 'string') return null;
  const prefix = '/invite#token=';
  const token = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  return INVITATION_TOKEN_PATTERN.test(token) ? value : null;
}
