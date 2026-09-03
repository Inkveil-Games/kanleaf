import type { ReactNode } from 'react';
import {
  SettingsList,
  SettingsListCell,
  SettingsListRow,
} from '../settings/SettingsList';

export interface ArchivedConfigurationItem {
  detail: string;
  id: string;
  name: string;
  visual: ReactNode;
}

export function ArchivedConfigurationList({
  ariaLabel,
  canManage,
  className,
  items,
  onRestore,
}: {
  ariaLabel: string;
  canManage: boolean;
  className: string;
  items: ArchivedConfigurationItem[];
  onRestore: (id: string) => Promise<unknown>;
}) {
  if (items.length === 0) return null;

  return (
    <section className="configuration-archive">
      <h2>Archived</h2>
      <SettingsList
        ariaLabel={ariaLabel}
        className={`configuration-archive-grid ${className}`}
      >
        {items.map((item) => (
          <SettingsListRow key={item.id}>
            <SettingsListCell className="settings-visual-cell">
              {item.visual}
            </SettingsListCell>
            <SettingsListCell primary>{item.name}</SettingsListCell>
            <SettingsListCell className="settings-description-cell">
              {item.detail}
            </SettingsListCell>
            <SettingsListCell className="settings-list-actions-cell">
              {canManage ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void onRestore(item.id)}
                >
                  Restore
                </button>
              ) : null}
            </SettingsListCell>
          </SettingsListRow>
        ))}
      </SettingsList>
    </section>
  );
}
