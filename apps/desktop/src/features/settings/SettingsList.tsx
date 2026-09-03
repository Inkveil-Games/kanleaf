import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/DropdownMenu';

interface SettingsListProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  header?: ReactNode;
}

export function SettingsList({
  ariaLabel,
  children,
  className,
  header,
}: SettingsListProps) {
  return (
    <div
      className={`settings-list${className ? ` ${className}` : ''}`}
      role="list"
      aria-label={ariaLabel}
    >
      {header ? (
        <div className="settings-list-header" role="presentation">
          {header}
        </div>
      ) : null}
      <div className="settings-list-body" role="presentation">
        {children}
      </div>
    </div>
  );
}

export function SettingsListRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`settings-list-row${className ? ` ${className}` : ''}`}
      role="listitem"
    >
      {children}
    </div>
  );
}

export function SettingsListCell({
  ariaLabel,
  children,
  className,
  primary = false,
}: {
  ariaLabel?: string;
  children?: ReactNode;
  className?: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`settings-list-cell${primary ? ' settings-list-cell-primary' : ''}${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export function SettingsEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="settings-list-empty" role="status">
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SettingsActionsMenu({
  label,
  children,
  disabled,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu
      className="settings-actions-menu"
      label={label}
      disabled={disabled}
    >
      {children}
    </DropdownMenu>
  );
}

export function SettingsAction({
  children,
  destructive = false,
  disabled,
  icon,
  onClick,
}: {
  children: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      className={destructive ? 'danger-menu-item' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {children}
    </DropdownMenuItem>
  );
}

export function SettingsActionSeparator() {
  return <DropdownMenuSeparator />;
}
