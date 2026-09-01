export const workspaceSettingsSections = [
  'general',
  'members',
  'states',
  'labels',
  'task-types',
  'projects',
  'invitations',
  'storage',
  'danger',
] as const;

export type WorkspaceSettingsSection =
  (typeof workspaceSettingsSections)[number];

export function isWorkspaceSettingsSection(
  value: unknown,
): value is WorkspaceSettingsSection {
  return (
    typeof value === 'string' &&
    workspaceSettingsSections.some((section) => section === value)
  );
}
