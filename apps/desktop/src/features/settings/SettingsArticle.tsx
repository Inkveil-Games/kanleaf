import type { ReactNode } from 'react';

interface SettingsArticleProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function SettingsArticle({
  eyebrow,
  title,
  description,
  children,
  className,
  action,
}: SettingsArticleProps) {
  return (
    <article className={`settings-article${className ? ` ${className}` : ''}`}>
      <header className="settings-header">
        <div className="settings-header-copy">
          <p className="pane-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action ? <div className="settings-header-action">{action}</div> : null}
      </header>
      {children}
    </article>
  );
}
