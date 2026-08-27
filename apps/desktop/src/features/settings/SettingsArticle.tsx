import type { ReactNode } from 'react';

interface SettingsArticleProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function SettingsArticle({
  eyebrow,
  title,
  description,
  children,
}: SettingsArticleProps) {
  return (
    <article className="settings-article">
      <header className="settings-header">
        <p className="pane-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </article>
  );
}
