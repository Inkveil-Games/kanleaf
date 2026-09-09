import { describe, expect, it } from 'vitest';
import { validatedInvitationReturnTo } from './safeReturnTo';

describe('validatedInvitationReturnTo', () => {
  it('accepts only a complete internal invitation fragment', () => {
    const destination = `/invite#token=${'I'.repeat(43)}`;
    expect(validatedInvitationReturnTo(destination)).toBe(destination);
  });

  it.each([
    'https://evil.example/invite#token=' + 'I'.repeat(43),
    '//evil.example/invite#token=' + 'I'.repeat(43),
    'javascript:alert(1)',
    '/host',
    '/invite?token=' + 'I'.repeat(43),
    '/invite#token=short',
    '/invite#token=' + 'I'.repeat(43) + '&extra=value',
  ])('rejects unsafe destination %s', (destination) => {
    expect(validatedInvitationReturnTo(destination)).toBeNull();
  });
});
