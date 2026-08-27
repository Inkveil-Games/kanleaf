import type { ReactNode } from 'react';

interface SettingsArticleProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}

export function SettingsArticle({
  eyebrow,
  title,
  description,
  children,
  className,
}: SettingsArticleProps) {
  return (
    <article className={`settings-article${className ? ` ${className}` : ''}`}>
      <header className="settings-header">
        <p className="pane-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </article>
  );
}
