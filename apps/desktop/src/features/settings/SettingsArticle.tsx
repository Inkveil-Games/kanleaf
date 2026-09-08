import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

interface SettingsArticleProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  backAction?: {
    label: string;
    onClick: () => void;
  };
}

export function SettingsArticle({
  eyebrow,
  title,
  description,
  children,
  className,
  action,
  backAction,
}: SettingsArticleProps) {
  return (
    <article className={`settings-article${className ? ` ${className}` : ''}`}>
      {backAction ? (
        <button
          className="settings-back settings-detail-back"
          type="button"
          onClick={backAction.onClick}
        >
          <ArrowLeft aria-hidden="true" size={15} /> {backAction.label}
        </button>
      ) : null}
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
