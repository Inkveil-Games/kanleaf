export function normalizeWorkspaceIdentifier(value: string) {
  return value
    .replace(/[đĐ]/g, 'd')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}
