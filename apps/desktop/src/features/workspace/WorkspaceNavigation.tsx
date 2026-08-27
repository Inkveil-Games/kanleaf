import {
  CheckSquare2,
  Folder,
  Inbox,
  LayoutPanelTop,
  ListTodo,
  LogOut,
  Plus,
  UserRound,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ContextMenu } from '../../components/ui/ContextMenu';
import type { AccountSettingsSection } from '../account/AccountSettings';
import { InlineNameForm } from './InlineNameForm';
import type { Collection, Project, Workspace } from './types';

interface WorkspaceNavigationProps {
  email: string;
  displayName: string;
  workspace: Workspace;
  projects: Project[];
  collection: Collection;
  surface: WorkspaceSurface;
  activeProjectId: string | null;
  onCreateProject: (name: string) => Promise<void>;
  onSelectCollection: (collection: Collection) => void;
  onOpenProjectOverview: (projectId: string) => void;
  onOpenAccountSettings: (section: AccountSettingsSection) => void;
  onSignOut: () => void;
}

export type WorkspaceSurface = 'tasks' | 'project-overview';

export function WorkspaceNavigation({
  email,
  displayName,
  workspace,
  projects,
  collection,
  surface,
  activeProjectId,
  onCreateProject,
  onSelectCollection,
  onOpenProjectOverview,
  onOpenAccountSettings,
  onSignOut,
}: WorkspaceNavigationProps) {
  const [composingProject, setComposingProject] = useState(false);
  const canUseContent = workspace.role !== 'guest';

  return (
    <aside className="navigation-pane">
      <nav className="navigation-scroll" aria-label="Workspace">
        <div className="nav-section nav-primary">
          {canUseContent && (
            <>
              <NavButton
                active={surface === 'tasks' && collection.kind === 'inbox'}
                icon={<Inbox aria-hidden="true" size={16} />}
                label="Inbox"
                onClick={() => onSelectCollection({ kind: 'inbox' })}
              />
              <NavButton
                active={surface === 'tasks' && collection.kind === 'my-work'}
                icon={<CheckSquare2 aria-hidden="true" size={16} />}
                label="My Work"
                onClick={() => onSelectCollection({ kind: 'my-work' })}
              />
            </>
          )}
        </div>

        <section className="nav-section" aria-labelledby="projects-heading">
          <div className="nav-section-heading">
            <h2 id="projects-heading">Projects</h2>
            {canUseContent && (
              <button
                className="icon-button"
                type="button"
                aria-label="New project"
                onClick={() => setComposingProject(true)}
              >
                <Plus aria-hidden="true" size={15} />
              </button>
            )}
          </div>
          {canUseContent && composingProject && (
            <InlineNameForm
              label="Project name"
              submitLabel="Create project"
              onCancel={() => setComposingProject(false)}
              onSubmit={async (name) => {
                await onCreateProject(name);
                setComposingProject(false);
              }}
            />
          )}
          {projects.length === 0 && !composingProject ? (
            <button
              className="nav-empty-action"
              type="button"
              disabled={!canUseContent}
              onClick={() => canUseContent && setComposingProject(true)}
            >
              {canUseContent ? (
                <>
                  <Plus aria-hidden="true" size={14} /> Create a project
                </>
              ) : (
                'No shared Projects'
              )}
            </button>
          ) : (
            <div className="project-nav-list">
              {projects.map((project) => {
                const active = activeProjectId === project.id;
                return (
                  <div className="project-nav-group" key={project.id}>
                    <div className="project-nav-row">
                      <NavButton
                        active={active && surface === 'project-overview'}
                        icon={<Folder aria-hidden="true" size={15} />}
                        label={project.name}
                        suffix={project.can_join ? 'Open' : undefined}
                        onClick={() => onOpenProjectOverview(project.id)}
                      />
                    </div>
                    {active && project.effective_role && (
                      <div className="project-subnav">
                        <NavButton
                          active={surface === 'project-overview'}
                          icon={<LayoutPanelTop aria-hidden="true" size={14} />}
                          label="Overview"
                          onClick={() => onOpenProjectOverview(project.id)}
                        />
                        <NavButton
                          active={
                            surface === 'tasks' &&
                            collection.kind === 'project' &&
                            collection.projectId === project.id
                          }
                          icon={<ListTodo aria-hidden="true" size={14} />}
                          label="Work items"
                          onClick={() =>
                            onSelectCollection({
                              kind: 'project',
                              projectId: project.id,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </nav>

      <div className="navigation-footer">
        <button
          className="account-button"
          type="button"
          onClick={() => onOpenAccountSettings('profile')}
        >
          <span className="member-monogram" aria-hidden="true">
            {displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className="account-copy">
            <span>{displayName}</span>
            <small>{email}</small>
          </span>
        </button>
        <ContextMenu label="Account actions" placement="up">
          <button
            role="menuitem"
            type="button"
            onClick={() => onOpenAccountSettings('profile')}
          >
            <UserRound aria-hidden="true" size={14} /> Account settings
          </button>
          <button role="menuitem" type="button" onClick={onSignOut}>
            <LogOut aria-hidden="true" size={14} /> Sign out
          </button>
        </ContextMenu>
      </div>
    </aside>
  );
}

interface NavButtonProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  suffix?: string;
  onClick: () => void;
}

function NavButton({ active, icon, label, suffix, onClick }: NavButtonProps) {
  return (
    <button
      className="nav-button"
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {suffix && <small className="nav-suffix">{suffix}</small>}
    </button>
  );
}
