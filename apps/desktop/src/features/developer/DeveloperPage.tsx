import type { ReactNode } from 'react';

export function DeveloperPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <article className="developer-page">
      <header>
        <p className="pane-eyebrow">Developer</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </article>
  );
}
