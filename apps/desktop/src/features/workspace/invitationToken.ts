export function invitationTokenFromHash(hash: string) {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token?.trim() || null;
}
