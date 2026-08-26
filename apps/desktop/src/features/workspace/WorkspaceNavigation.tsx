import {
  Archive,
  CheckSquare2,
  ChevronDown,
  Folder,
  Inbox,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Server,
} from 'lucide-react';
import {
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Wordmark } from '../../components/ui/Wordmark';
import type { Collection, Project, Workspace } from './types';

interface WorkspaceNavigationProps {
  email: string;
  workspaces: Workspace[];
  workspaceId: string;
  projects: Project[];
  collection: Collection;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (name: string) => Promise<void>;
  onCreateProject: (name: string) => Promise<void>;
  onRenameProject: (projectId: string, name: string) => Promise<void>;
  onArchiveProject: (projectId: string) => Promise<void>;
  onSelectCollection: (collection: Collection) => void;
  onChangeServer: () => void;
  onSignOut: () => void;
}

type Composer = 'workspace' | 'rename-workspace' | 'project' | null;

export function WorkspaceNavigation({
  email,
  workspaces,
  workspaceId,
  projects,
  collection,
  onSwitchWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onCreateProject,
  onRenameProject,
  onArchiveProject,
  onSelectCollection,
  onChangeServer,
  onSignOut,
}: WorkspaceNavigationProps) {
  const [composer, setComposer] = useState<Composer>(null);
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const activeWorkspace = workspaces.find(({ id }) => id === workspaceId);

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
          <details className="context-menu">
            <summary aria-label="Workspace actions">
              <MoreHorizontal aria-hidden="true" size={16} />
            </summary>
            <div className="context-menu-popover">
              {activeWorkspace?.role === 'owner' && (
                <button
                  type="button"
                  onClick={(event) => {
                    closeContextMenu(event);
                    setComposer('rename-workspace');
                  }}
                >
                  <Pencil aria-hidden="true" size={14} /> Rename workspace
                </button>
              )}
              <button
                type="button"
                onClick={(event) => {
                  closeContextMenu(event);
                  setComposer('workspace');
                }}
              >
                <Plus aria-hidden="true" size={14} /> New workspace
              </button>
            </div>
          </details>
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
          <NavButton
            active={collection.kind === 'inbox'}
            icon={<Inbox aria-hidden="true" size={16} />}
            label="Inbox"
            onClick={() => onSelectCollection({ kind: 'inbox' })}
          />
          <NavButton
            active={collection.kind === 'all'}
            icon={<CheckSquare2 aria-hidden="true" size={16} />}
            label="My tasks"
            onClick={() => onSelectCollection({ kind: 'all' })}
          />
        </div>

        <section className="nav-section" aria-labelledby="projects-heading">
          <div className="nav-section-heading">
            <h2 id="projects-heading">Projects</h2>
            <button
              className="icon-button"
              type="button"
              aria-label="New project"
              onClick={() => setComposer('project')}
            >
              <Plus aria-hidden="true" size={15} />
            </button>
          </div>
          {composer === 'project' && (
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
              onClick={() => setComposer('project')}
            >
              <Plus aria-hidden="true" size={14} /> Create a project
            </button>
          ) : (
            <div className="project-nav-list">
              {projects.map((project) =>
                renamingProject === project.id ? (
                  <InlineNameForm
                    key={project.id}
                    label="Project name"
                    initialValue={project.name}
                    submitLabel="Rename project"
                    onCancel={() => setRenamingProject(null)}
                    onSubmit={async (name) => {
                      await onRenameProject(project.id, name);
                      setRenamingProject(null);
                    }}
                  />
                ) : (
                  <div className="project-nav-row" key={project.id}>
                    <NavButton
                      active={
                        collection.kind === 'project' &&
                        collection.projectId === project.id
                      }
                      icon={<Folder aria-hidden="true" size={15} />}
                      label={project.name}
                      onClick={() =>
                        onSelectCollection({
                          kind: 'project',
                          projectId: project.id,
                        })
                      }
                    />
                    <details className="context-menu project-menu">
                      <summary aria-label={`${project.name} actions`}>
                        <MoreHorizontal aria-hidden="true" size={15} />
                      </summary>
                      <div className="context-menu-popover">
                        <button
                          type="button"
                          onClick={(event) => {
                            closeContextMenu(event);
                            setRenamingProject(project.id);
                          }}
                        >
                          <Pencil aria-hidden="true" size={14} /> Rename
                        </button>
                        <button
                          className="danger-menu-item"
                          type="button"
                          onClick={(event) => {
                            closeContextMenu(event);
                            if (
                              window.confirm(
                                `Archive ${project.name}? Its tasks will move to Inbox.`,
                              )
                            ) {
                              void onArchiveProject(project.id);
                            }
                          }}
                        >
                          <Archive aria-hidden="true" size={14} /> Archive
                        </button>
                      </div>
                    </details>
                  </div>
                ),
              )}
            </div>
          )}
        </section>
      </nav>

      <div className="navigation-footer">
        <div className="account-copy">
          <span>{email}</span>
          <small>Connected account</small>
        </div>
        <details className="context-menu context-menu-up">
          <summary aria-label="Account actions">
            <MoreHorizontal aria-hidden="true" size={16} />
          </summary>
          <div className="context-menu-popover">
            <button
              type="button"
              onClick={(event) => {
                closeContextMenu(event);
                onChangeServer();
              }}
            >
              <Server aria-hidden="true" size={14} /> Change server
            </button>
            <button
              type="button"
              onClick={(event) => {
                closeContextMenu(event);
                onSignOut();
              }}
            >
              <LogOut aria-hidden="true" size={14} /> Sign out
            </button>
          </div>
        </details>
      </div>
    </aside>
  );
}

function closeContextMenu(event: MouseEvent<HTMLButtonElement>) {
  event.currentTarget.closest('details')?.removeAttribute('open');
}

interface NavButtonProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

function NavButton({ active, icon, label, onClick }: NavButtonProps) {
  return (
    <button
      className="nav-button"
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
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
