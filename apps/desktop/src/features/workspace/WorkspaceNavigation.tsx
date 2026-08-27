import {
  CheckSquare2,
  ChevronDown,
  Folder,
  Inbox,
  LayoutPanelTop,
  ListTodo,
  LogOut,
  Pencil,
  Plus,
  Settings,
  UserRound,
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ContextMenu } from '../../components/ui/ContextMenu';
import { Wordmark } from '../../components/ui/Wordmark';
import type { SettingsSection } from '../settings/SettingsShell';
import type { Collection, Project, Workspace } from './types';

interface WorkspaceNavigationProps {
  email: string;
  displayName: string;
  workspaces: Workspace[];
  workspaceId: string;
  projects: Project[];
  collection: Collection;
  surface: WorkspaceSurface;
  activeProjectId: string | null;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (name: string) => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
  onSelectCollection: (collection: Collection) => void;
  onOpenProjectOverview: (projectId: string) => void;
  onOpenSettings: (section: SettingsSection) => void;
  onSignOut: () => void;
}

export type WorkspaceSurface = 'tasks' | 'project-overview';

type Composer = 'workspace' | 'rename-workspace' | 'project' | null;

export function WorkspaceNavigation({
  email,
  displayName,
  workspaces,
  workspaceId,
  projects,
  collection,
  surface,
  activeProjectId,
  onSwitchWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onCreateProject,
  onSelectCollection,
  onOpenProjectOverview,
  onOpenSettings,
  onSignOut,
}: WorkspaceNavigationProps) {
  const [composer, setComposer] = useState<Composer>(null);
  const activeWorkspace = workspaces.find(({ id }) => id === workspaceId);
  const canManageWorkspace =
    activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const canUseContent = activeWorkspace?.role !== 'guest';

  return (
    <aside className="navigation-pane">
      <div className="navigation-header">
        <Wordmark quiet />
        <div className="workspace-switcher">
          <label className="sr-only" htmlFor="workspace-select">
            Active workspace
          </label>
          <select
            id="workspace-select"
            value={workspaceId}
            onChange={(event) => void onSwitchWorkspace(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={14} />
          <ContextMenu label="Workspace actions">
            {canManageWorkspace && (
              <button
                role="menuitem"
                type="button"
                onClick={() => setComposer('rename-workspace')}
              >
                <Pencil aria-hidden="true" size={14} /> Rename workspace
              </button>
            )}
            <button
              role="menuitem"
              type="button"
              onClick={() => onOpenSettings('workspace:general')}
            >
              <Settings aria-hidden="true" size={14} /> Workspace settings
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => setComposer('workspace')}
            >
              <Plus aria-hidden="true" size={14} /> New workspace
            </button>
          </ContextMenu>
        </div>
        {composer === 'workspace' && (
          <InlineNameForm
            label="Workspace name"
            submitLabel="Create workspace"
            onCancel={() => setComposer(null)}
            onSubmit={async (name) => {
              await onCreateWorkspace(name);
              setComposer(null);
            }}
          />
        )}
        {composer === 'rename-workspace' && activeWorkspace && (
          <InlineNameForm
            label="Workspace name"
            initialValue={activeWorkspace.name}
            submitLabel="Rename workspace"
            onCancel={() => setComposer(null)}
            onSubmit={async (name) => {
              await onRenameWorkspace(name);
              setComposer(null);
            }}
          />
        )}
      </div>

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
                active={surface === 'tasks' && collection.kind === 'all'}
                icon={<CheckSquare2 aria-hidden="true" size={16} />}
                label="My tasks"
                onClick={() => onSelectCollection({ kind: 'all' })}
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
                onClick={() => setComposer('project')}
              >
                <Plus aria-hidden="true" size={15} />
              </button>
            )}
          </div>
          {canUseContent && composer === 'project' && (
            <InlineNameForm
              label="Project name"
              submitLabel="Create project"
              onCancel={() => setComposer(null)}
              onSubmit={async (name) => {
                await onCreateProject(name);
                setComposer(null);
              }}
            />
          )}
          {projects.length === 0 && composer !== 'project' ? (
            <button
              className="nav-empty-action"
              type="button"
              disabled={!canUseContent}
              onClick={() => canUseContent && setComposer('project')}
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
          onClick={() => onOpenSettings('account:profile')}
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
            onClick={() => onOpenSettings('account:profile')}
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

interface InlineNameFormProps {
  label: string;
  initialValue?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}

function InlineNameForm({
  label,
  initialValue = '',
  submitLabel,
  onSubmit,
  onCancel,
}: InlineNameFormProps) {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
      setSubmitting(false);
    }
  }

  return (
    <form className="inline-name-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span className="sr-only">{label}</span>
        <input
          autoFocus
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        />
      </label>
      <button type="submit" disabled={submitting} aria-label={submitLabel}>
        <Plus aria-hidden="true" size={14} />
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel">
        ×
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
