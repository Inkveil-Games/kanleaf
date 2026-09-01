export const projectSettingsSections = [
  'general',
  'members',
  'features',
  'defaults',
  'danger',
] as const;

export type ProjectSettingsSection = (typeof projectSettingsSections)[number];

export function isProjectSettingsSection(
  value: unknown,
): value is ProjectSettingsSection {
  return (
    typeof value === 'string' &&
    projectSettingsSections.some((section) => section === value)
  );
}
