import {
  ArrowRight,
  BookOpenText,
  Eye,
  Gauge,
  Layers3,
  ListTodo,
  LockKeyhole,
  Settings2,
  UserPlus,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import type { Project } from '../workspace/types';
import { ProjectIconGlyph } from './ProjectIconGlyph';

interface ProjectOverviewProps {
  project: Project;
  joining: boolean;
  onJoin: () => Promise<void>;
  onOpenWorkItems: () => void;
  onOpenCycles: () => void;
  onOpenModules: () => void;
  onOpenPages: () => void;
  onOpenViews: () => void;
  onOpenSettings: () => void;
}

export function ProjectOverview({
  project,
  joining,
  onJoin,
  onOpenWorkItems,
  onOpenCycles,
  onOpenModules,
  onOpenPages,
  onOpenViews,
  onOpenSettings,
}: ProjectOverviewProps) {
  const accessible = project.effective_role !== null;

  return (
    <section className="project-surface" aria-labelledby="project-heading">
      <div className="project-overview-cover" aria-hidden="true">
        <span />
        <span />
      </div>
      <header className="project-overview-header">
        <div className="project-identity">
          <span className="project-mark" aria-hidden="true">
            <ProjectIconGlyph name={project.icon} size={24} strokeWidth={1.8} />
          </span>
          <div>
            <p className="pane-eyebrow">{project.identifier}</p>
            <h1 id="project-heading">{project.name}</h1>
          </div>
        </div>
        <div className="project-header-actions">
          {accessible ? (
            <>
              <Button variant="primary" size="sm" onClick={onOpenWorkItems}>
                <ListTodo aria-hidden="true" size={15} /> Work items
              </Button>
              {project.effective_role === 'admin' && (
                <Button variant="secondary" size="sm" onClick={onOpenSettings}>
                  <Settings2 aria-hidden="true" size={15} /> Settings
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              disabled={!project.can_join}
              loading={joining}
              loadingLabel="Joining…"
              onClick={() => void onJoin()}
            >
              <UserPlus aria-hidden="true" size={15} />
              Join Project
            </Button>
          )}
        </div>
      </header>

      <div className="project-overview-body">
        <p className="project-description">
          {project.description ||
            (accessible
              ? 'Add a concise description in Project settings.'
              : 'This Public Project is available to Workspace Members.')}
        </p>

        <dl className="project-facts">
          <div>
            {project.visibility === 'private' ? (
              <LockKeyhole aria-hidden="true" size={15} />
            ) : (
              <Eye aria-hidden="true" size={15} />
            )}
            <dt>Visibility</dt>
            <dd>{project.visibility === 'private' ? 'Private' : 'Public'}</dd>
          </div>
          <div>
            <Gauge aria-hidden="true" size={15} />
            <dt>Your access</dt>
            <dd>{roleLabel(project.effective_role)}</dd>
          </div>
        </dl>

        {accessible && (
          <section
            className="project-work-section"
            aria-labelledby="work-heading"
          >
            <div className="project-section-heading">
              <div>
                <h2 id="work-heading">Project work</h2>
                <p>
                  Structured work items and the features enabled for this
                  Project.
                </p>
              </div>
            </div>
            <div className="project-feature-list">
              <button type="button" onClick={onOpenWorkItems}>
                <ListTodo aria-hidden="true" size={16} />
                <span>
                  <strong>Work items</strong>
                  <small>Plan, prioritize, and document tasks</small>
                </span>
                <ArrowRight aria-hidden="true" size={15} />
              </button>
              <FeatureRow
                icon={<Layers3 aria-hidden="true" size={16} />}
                label="Cycles"
                enabled={project.cycles_enabled}
                onOpen={project.cycles_enabled ? onOpenCycles : undefined}
                onConfigure={
                  project.effective_role === 'admin'
                    ? onOpenSettings
                    : undefined
                }
              />
              <FeatureRow
                icon={<Gauge aria-hidden="true" size={16} />}
                label="Modules"
                enabled={project.modules_enabled}
                onOpen={project.modules_enabled ? onOpenModules : undefined}
                onConfigure={
                  project.effective_role === 'admin'
                    ? onOpenSettings
                    : undefined
                }
              />
              <FeatureRow
                icon={<BookOpenText aria-hidden="true" size={16} />}
                label="Library"
                enabled={project.pages_enabled}
                onOpen={project.pages_enabled ? onOpenPages : undefined}
                openDescription="Open Markdown Library"
              />
              <FeatureRow
                icon={<Eye aria-hidden="true" size={16} />}
                label="Views"
                enabled={project.views_enabled}
                onOpen={project.views_enabled ? onOpenViews : undefined}
                onConfigure={
                  project.effective_role === 'admin'
                    ? onOpenSettings
                    : undefined
                }
                openDescription="Open saved task Views"
              />
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

function FeatureRow({
  icon,
  label,
  enabled,
  onOpen,
  onConfigure,
  openDescription = 'Open planning workspace',
}: {
  icon: ReactNode;
  label: string;
  enabled: boolean;
  onOpen?: () => void;
  onConfigure?: () => void;
  openDescription?: string;
}) {
  const content = (
    <>
      {icon}
      <span>
        <strong>{label}</strong>
        <small>
          {enabled
            ? onOpen
              ? openDescription
              : 'Enabled · interface arrives later'
            : onConfigure
              ? 'Disabled · enable in Project settings'
              : 'Disabled'}
        </small>
      </span>
      {enabled && (
        <span className="project-feature-state">{onOpen ? 'Open' : 'On'}</span>
      )}
    </>
  );
  if (onOpen || onConfigure) {
    return (
      <button type="button" onClick={onOpen ?? onConfigure}>
        {content}
        <ArrowRight aria-hidden="true" size={15} />
      </button>
    );
  }
  return (
    <div className="project-feature-row" aria-disabled="true">
      {content}
    </div>
  );
}

function roleLabel(role: Project['effective_role']) {
  if (!role) return 'Not joined';
  return role.charAt(0).toUpperCase() + role.slice(1);
}
