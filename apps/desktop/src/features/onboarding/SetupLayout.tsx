import type { ReactNode } from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import type { SetupStage } from '../../lib/api/types';

interface SetupLayoutProps {
  stage: Exclude<SetupStage, 'complete'>;
  children: ReactNode;
}

const STEPS = [
  { stage: 'account', label: 'Account preferences' },
  { stage: 'workspace', label: 'First Workspace' },
  { stage: 'invite', label: 'Invite collaborators' },
] as const;

export function SetupLayout({ stage, children }: SetupLayoutProps) {
  const activeIndex = STEPS.findIndex((step) => step.stage === stage);

  return (
    <main className="setup-shell">
      <aside className="setup-rail" aria-label="Kanleaf setup progress">
        <Wordmark />
        <div>
          <p className="eyebrow">Set up Kanleaf</p>
          <ol className="setup-progress">
            {STEPS.map((step, index) => (
              <li
                key={step.stage}
                className={index < activeIndex ? 'is-complete' : undefined}
              >
                <span aria-current={index === activeIndex ? 'step' : undefined}>
                  {index + 1}
                </span>
                <div>
                  <strong>{step.label}</strong>
                  <small>
                    {index < activeIndex
                      ? 'Complete'
                      : index === activeIndex
                        ? 'Current step'
                        : 'Up next'}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="setup-rail-note">
          Structured work in PostgreSQL. Durable writing in Markdown.
        </p>
      </aside>
      <section className="setup-content">{children}</section>
    </main>
  );
}
