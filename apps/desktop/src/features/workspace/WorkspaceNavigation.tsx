import {
  CheckSquare2,
  Bookmark,
  BookOpenText,
  CalendarRange,
  Inbox,
  LayoutPanelTop,
  ListTodo,
  Layers3,
  Plus,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { CreateProjectDialog } from '../project/create/CreateProjectDialog';
import { ProjectIconGlyph } from '../project/ProjectIconGlyph';
import type { SavedView } from '../view/types';
import type {
  Collection,
  Project,
  ProjectCreateInput,
  Workspace,
} from './types';
import type { ApiContext } from './api';

interface WorkspaceNavigationProps {
  accountSwitcher: ReactNode;
  context: ApiContext;
  workspace: Workspace;
  currentUser: { id: string; displayName: string };
  projects: Project[];
  workspaceViews: SavedView[];
  projectViews: SavedView[];
  collection: Collection;
  surface: WorkspaceSurface;
  activeProjectId: string | null;
  activeViewId: string | null;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project>;
  onSelectCollection: (collection: Collection) => void;
  onOpenProjectOverview: (projectId: string) => void;
  onOpenPlanning: (projectId: string, kind: 'cycles' | 'modules') => void;
  onOpenDocuments: (projectId: string | null) => void;
  onOpenViews: (projectId: string) => void;
  onOpenSavedView: (view: SavedView) => void;
}

export type WorkspaceSurface =
  'tasks' | 'project-overview' | 'cycles' | 'modules' | 'documents' | 'views';

export function WorkspaceNavigation({
  accountSwitcher,
  context,
  workspace,
  currentUser,
  projects,
  workspaceViews,
  projectViews,
  collection,
  surface,
  activeProjectId,
  activeViewId,
  onCreateProject,
  onSelectCollection,
  onOpenProjectOverview,
  onOpenPlanning,
  onOpenDocuments,
  onOpenViews,
  onOpenSavedView,
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
                active={
                  surface === 'tasks' &&
                  collection.kind === 'inbox' &&
                  !activeViewId
                }
                icon={<Inbox aria-hidden="true" size={16} />}
                label="Inbox"
                onClick={() => onSelectCollection({ kind: 'inbox' })}
              />
              <NavButton
                active={
                  surface === 'tasks' &&
                  collection.kind === 'my-work' &&
                  !activeViewId
                }
                icon={<CheckSquare2 aria-hidden="true" size={16} />}
                label="My Work"
                onClick={() => onSelectCollection({ kind: 'my-work' })}
              />
              <NavButton
                active={
                  surface === 'tasks' &&
                  collection.kind === 'all' &&
                  !activeViewId
                }
                icon={<ListTodo aria-hidden="true" size={16} />}
                label="All tasks"
                onClick={() => onSelectCollection({ kind: 'all' })}
              />
              <NavButton
                active={surface === 'documents' && activeProjectId === null}
                icon={<BookOpenText aria-hidden="true" size={16} />}
                label="Library"
                onClick={() => onOpenDocuments(null)}
              />
            </>
          )}
        </div>

        {workspaceViews.length > 0 && (
          <section className="nav-section" aria-labelledby="views-heading">
            <div className="nav-section-heading">
              <h2 id="views-heading">Saved Views</h2>
            </div>
            {workspaceViews.map((view) => (
              <NavButton
                key={view.id}
                active={activeViewId === view.id}
                icon={<Bookmark aria-hidden="true" size={14} />}
                label={view.name}
                suffix={view.visibility === 'shared' ? 'Shared' : undefined}
                onClick={() => onOpenSavedView(view)}
              />
            ))}
          </section>
        )}

        <section className="nav-section" aria-labelledby="projects-heading">
          <div className="nav-section-heading">
            <h2 id="projects-heading">Projects</h2>
            {canUseContent && (
              <IconButton
                variant="ghost"
                size="sm"
                type="button"
                aria-label="New project"
                onClick={() => setComposingProject(true)}
              >
                <Plus aria-hidden="true" size={15} />
              </IconButton>
            )}
          </div>
          {projects.length === 0 && !composingProject ? (
            <Button
              className="nav-empty-action"
              variant="text"
              size="sm"
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
            </Button>
          ) : (
            <div className="project-nav-list">
              {projects.map((project) => {
                const active = activeProjectId === project.id;
                return (
                  <div className="project-nav-group" key={project.id}>
                    <div className="project-nav-row">
                      <NavButton
                        active={active && surface === 'project-overview'}
                        icon={
                          <ProjectIconGlyph
                            name={project.icon}
                            aria-hidden="true"
                            size={15}
                          />
                        }
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
                            collection.projectId === project.id &&
                            !activeViewId
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
                        {project.cycles_enabled && (
                          <NavButton
                            active={surface === 'cycles'}
                            icon={
                              <CalendarRange aria-hidden="true" size={14} />
                            }
                            label="Cycles"
                            onClick={() => onOpenPlanning(project.id, 'cycles')}
                          />
                        )}
                        {project.modules_enabled && (
                          <NavButton
                            active={surface === 'modules'}
                            icon={<Layers3 aria-hidden="true" size={14} />}
                            label="Modules"
                            onClick={() =>
                              onOpenPlanning(project.id, 'modules')
                            }
                          />
                        )}
                        {project.pages_enabled && (
                          <NavButton
                            active={surface === 'documents'}
                            icon={<BookOpenText aria-hidden="true" size={14} />}
                            label="Library"
                            onClick={() => onOpenDocuments(project.id)}
                          />
                        )}
                        {project.views_enabled && (
                          <>
                            <NavButton
                              active={surface === 'views'}
                              icon={<Bookmark aria-hidden="true" size={14} />}
                              label="Views"
                              onClick={() => onOpenViews(project.id)}
                            />
                            {projectViews.length > 0 && (
                              <div className="project-view-nav">
                                <span>Saved</span>
                                {projectViews.map((view) => (
                                  <NavButton
                                    key={view.id}
                                    active={activeViewId === view.id}
                                    icon={
                                      <Bookmark aria-hidden="true" size={13} />
                                    }
                                    label={view.name}
                                    suffix={
                                      view.visibility === 'shared'
                                        ? 'Shared'
                                        : undefined
                                    }
                                    onClick={() => onOpenSavedView(view)}
                                  />
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </nav>

      {composingProject ? (
        <CreateProjectDialog
          workspace={workspace}
          context={context}
          currentUser={currentUser}
          onCreate={onCreateProject}
          onClose={() => setComposingProject(false)}
        />
      ) : null}

      <div className="navigation-footer">{accountSwitcher}</div>
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
