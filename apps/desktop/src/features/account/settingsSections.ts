export const accountSettingsSections = [
  'profile',
  'preferences',
  'security',
  'invitations',
  'notifications',
] as const;

export type AccountSettingsSection = (typeof accountSettingsSections)[number];

export function isAccountSettingsSection(
  value: unknown,
): value is AccountSettingsSection {
  return (
    typeof value === 'string' &&
    accountSettingsSections.some((section) => section === value)
  );
}
