import {
  CheckSquare2,
  Bookmark,
  BookOpenText,
  CalendarRange,
  FolderKanban,
  Inbox,
  LayoutPanelTop,
  ListTodo,
  Layers3,
  PanelLeftOpen,
  Plus,
} from 'lucide-react';
import {
  useState,
  type AriaAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/DropdownMenu';
import { IconButton } from '../../components/ui/IconButton';
import { Tooltip } from '../../components/ui/Tooltip';
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
import type { NavigationMode } from './workspacePaneLayout';

interface WorkspaceNavigationProps {
  mode: NavigationMode;
  accountSwitcher: ReactNode;
  railWorkspaceControl: ReactNode;
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
  navigationRouteKey: string | null;
  onCreateProject: (input: ProjectCreateInput) => Promise<Project>;
  onSelectCollection: (collection: Collection) => void;
  onOpenProjectOverview: (projectId: string) => void;
  onOpenPlanning: (projectId: string, kind: 'cycles' | 'modules') => void;
  onOpenDocuments: (projectId: string | null) => void;
  onOpenViews: (projectId: string) => void;
  onOpenSavedView: (view: SavedView) => void;
  onToggleNavigation: () => void;
  railToggleLabel: string;
  railToggleExpanded: boolean;
  railToggleOpensDrawer: boolean;
  railToggleRef?: RefObject<HTMLButtonElement | null>;
}

export type WorkspaceSurface =
  'tasks' | 'project-overview' | 'cycles' | 'modules' | 'documents' | 'views';

export function WorkspaceNavigation({
  mode,
  accountSwitcher,
  railWorkspaceControl,
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
  navigationRouteKey,
  onCreateProject,
  onSelectCollection,
  onOpenProjectOverview,
  onOpenPlanning,
  onOpenDocuments,
  onOpenViews,
  onOpenSavedView,
  onToggleNavigation,
  railToggleLabel,
  railToggleExpanded,
  railToggleOpensDrawer,
  railToggleRef,
}: WorkspaceNavigationProps) {
  const [composingProject, setComposingProject] = useState(false);
  const canUseContent = workspace.role !== 'guest';
  const activeProject = projects.find(({ id }) => id === activeProjectId);

  if (mode === 'rail') {
    return (
      <aside className="navigation-pane navigation-pane-rail">
        <NavigationRail
          workspaceControl={railWorkspaceControl}
          canUseContent={canUseContent}
          projects={projects}
          workspaceViews={workspaceViews}
          projectViews={projectViews}
          collection={collection}
          surface={surface}
          activeProject={activeProject}
          activeViewId={activeViewId}
          navigationRouteKey={navigationRouteKey}
          onCreateProject={() => setComposingProject(true)}
          onSelectCollection={onSelectCollection}
          onOpenProjectOverview={onOpenProjectOverview}
          onOpenPlanning={onOpenPlanning}
          onOpenDocuments={onOpenDocuments}
          onOpenViews={onOpenViews}
          onOpenSavedView={onOpenSavedView}
          onToggleNavigation={onToggleNavigation}
          toggleLabel={railToggleLabel}
          toggleExpanded={railToggleExpanded}
          toggleOpensDrawer={railToggleOpensDrawer}
          toggleRef={railToggleRef}
        />

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

  return (
    <aside className="navigation-pane navigation-pane-full">
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

interface NavigationRailProps {
  workspaceControl: ReactNode;
  canUseContent: boolean;
  projects: Project[];
  workspaceViews: SavedView[];
  projectViews: SavedView[];
  collection: Collection;
  surface: WorkspaceSurface;
  activeProject: Project | undefined;
  activeViewId: string | null;
  navigationRouteKey: string | null;
  onCreateProject: () => void;
  onSelectCollection: (collection: Collection) => void;
  onOpenProjectOverview: (projectId: string) => void;
  onOpenPlanning: (projectId: string, kind: 'cycles' | 'modules') => void;
  onOpenDocuments: (projectId: string | null) => void;
  onOpenViews: (projectId: string) => void;
  onOpenSavedView: (view: SavedView) => void;
  onToggleNavigation: () => void;
  toggleLabel: string;
  toggleExpanded: boolean;
  toggleOpensDrawer: boolean;
  toggleRef?: RefObject<HTMLButtonElement | null>;
}

function NavigationRail({
  workspaceControl,
  canUseContent,
  projects,
  workspaceViews,
  projectViews,
  collection,
  surface,
  activeProject,
  activeViewId,
  navigationRouteKey,
  onCreateProject,
  onSelectCollection,
  onOpenProjectOverview,
  onOpenPlanning,
  onOpenDocuments,
  onOpenViews,
  onOpenSavedView,
  onToggleNavigation,
  toggleLabel,
  toggleExpanded,
  toggleOpensDrawer,
  toggleRef,
}: NavigationRailProps) {
  const workspaceViewActive = workspaceViews.some(
    ({ id }) => id === activeViewId,
  );
  const [menuState, setMenuState] = useState<{
    routeKey: string | null;
    openMenu: RailMenu | null;
  }>({ routeKey: navigationRouteKey, openMenu: null });
  if (menuState.routeKey !== navigationRouteKey) {
    setMenuState({ routeKey: navigationRouteKey, openMenu: null });
  }
  const openMenu =
    menuState.routeKey === navigationRouteKey ? menuState.openMenu : null;
  const changeMenu = (menu: RailMenu, open: boolean) => {
    setMenuState({
      routeKey: navigationRouteKey,
      openMenu: open ? menu : null,
    });
  };

  return (
    <nav className="navigation-rail" aria-label="Workspace navigation rail">
      <div className="navigation-rail-actions">
        <NavButton
          rail
          icon={<PanelLeftOpen aria-hidden="true" size={17} />}
          label={toggleLabel}
          onClick={onToggleNavigation}
          buttonRef={toggleRef}
          ariaControls={
            toggleOpensDrawer ? 'workspace-navigation-drawer' : undefined
          }
          ariaExpanded={toggleExpanded}
          ariaHasPopup={toggleOpensDrawer ? 'dialog' : undefined}
        />
        {workspaceControl}
        <div className="navigation-rail-separator" role="separator" />
        {canUseContent ? (
          <>
            <NavButton
              rail
              active={
                surface === 'tasks' &&
                collection.kind === 'inbox' &&
                !activeViewId
              }
              icon={<Inbox aria-hidden="true" size={17} />}
              label="Inbox"
              onClick={() => onSelectCollection({ kind: 'inbox' })}
            />
            <NavButton
              rail
              active={
                surface === 'tasks' &&
                collection.kind === 'my-work' &&
                !activeViewId
              }
              icon={<CheckSquare2 aria-hidden="true" size={17} />}
              label="My Work"
              onClick={() => onSelectCollection({ kind: 'my-work' })}
            />
            <NavButton
              rail
              active={
                surface === 'tasks' &&
                collection.kind === 'all' &&
                !activeViewId
              }
              icon={<ListTodo aria-hidden="true" size={17} />}
              label="All tasks"
              onClick={() => onSelectCollection({ kind: 'all' })}
            />
            <NavButton
              rail
              active={surface === 'documents' && activeProject === undefined}
              icon={<BookOpenText aria-hidden="true" size={17} />}
              label="Library"
              onClick={() => onOpenDocuments(null)}
            />
          </>
        ) : null}

        {canUseContent ? (
          <DropdownMenu
            className="navigation-rail-menu"
            label="Saved Views"
            placement="right"
            align="start"
            triggerAriaCurrent={workspaceViewActive ? 'page' : undefined}
            triggerTooltip="Saved Views"
            trigger={<Bookmark aria-hidden="true" size={17} />}
            open={openMenu === 'saved-views'}
            onOpenChange={(open) => changeMenu('saved-views', open)}
          >
            <div className="navigation-rail-menu-heading" role="presentation">
              Saved Views
            </div>
            {workspaceViews.length > 0 ? (
              workspaceViews.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  ariaCurrent={activeViewId === view.id ? 'page' : undefined}
                  onClick={() => onOpenSavedView(view)}
                >
                  <Bookmark aria-hidden="true" size={14} />
                  <span>{view.name}</span>
                  {view.visibility === 'shared' ? (
                    <small className="nav-suffix">Shared</small>
                  ) : null}
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled onClick={() => undefined}>
                No Saved Views yet
              </DropdownMenuItem>
            )}
          </DropdownMenu>
        ) : null}

        <DropdownMenu
          className="navigation-rail-menu"
          label="Projects"
          placement="right"
          align="start"
          triggerTooltip="Projects"
          trigger={<FolderKanban aria-hidden="true" size={17} />}
          open={openMenu === 'projects'}
          onOpenChange={(open) => changeMenu('projects', open)}
        >
          <div className="navigation-rail-menu-heading" role="presentation">
            Projects
          </div>
          {projects.length > 0 ? (
            projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                ariaCurrent={
                  activeProject?.id === project.id ? 'page' : undefined
                }
                onClick={() => onOpenProjectOverview(project.id)}
              >
                <ProjectIconGlyph
                  name={project.icon}
                  aria-hidden="true"
                  size={15}
                />
                <span>{project.name}</span>
                {project.can_join ? (
                  <small className="nav-suffix">Open</small>
                ) : null}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled onClick={() => undefined}>
              {canUseContent ? 'No Projects yet' : 'No shared Projects'}
            </DropdownMenuItem>
          )}
          {canUseContent ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onCreateProject}>
                <Plus aria-hidden="true" size={14} /> New project
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenu>

        {activeProject ? (
          <DropdownMenu
            className="navigation-rail-menu navigation-rail-project-menu"
            label={activeProject.name}
            placement="right"
            align="start"
            triggerAriaCurrent="page"
            triggerTooltip={activeProject.name}
            open={openMenu === 'active-project'}
            onOpenChange={(open) => changeMenu('active-project', open)}
            trigger={
              <ProjectIconGlyph
                name={activeProject.icon}
                aria-hidden="true"
                size={17}
              />
            }
          >
            <div className="navigation-rail-menu-heading" role="presentation">
              {activeProject.name}
            </div>
            <DropdownMenuItem
              ariaCurrent={surface === 'project-overview' ? 'page' : undefined}
              onClick={() => onOpenProjectOverview(activeProject.id)}
            >
              <LayoutPanelTop aria-hidden="true" size={14} /> Overview
            </DropdownMenuItem>
            {activeProject.effective_role ? (
              <>
                <DropdownMenuItem
                  ariaCurrent={
                    surface === 'tasks' &&
                    collection.kind === 'project' &&
                    collection.projectId === activeProject.id &&
                    !activeViewId
                      ? 'page'
                      : undefined
                  }
                  onClick={() =>
                    onSelectCollection({
                      kind: 'project',
                      projectId: activeProject.id,
                    })
                  }
                >
                  <ListTodo aria-hidden="true" size={14} /> Work items
                </DropdownMenuItem>
                {activeProject.cycles_enabled ? (
                  <DropdownMenuItem
                    ariaCurrent={surface === 'cycles' ? 'page' : undefined}
                    onClick={() => onOpenPlanning(activeProject.id, 'cycles')}
                  >
                    <CalendarRange aria-hidden="true" size={14} /> Cycles
                  </DropdownMenuItem>
                ) : null}
                {activeProject.modules_enabled ? (
                  <DropdownMenuItem
                    ariaCurrent={surface === 'modules' ? 'page' : undefined}
                    onClick={() => onOpenPlanning(activeProject.id, 'modules')}
                  >
                    <Layers3 aria-hidden="true" size={14} /> Modules
                  </DropdownMenuItem>
                ) : null}
                {activeProject.pages_enabled ? (
                  <DropdownMenuItem
                    ariaCurrent={surface === 'documents' ? 'page' : undefined}
                    onClick={() => onOpenDocuments(activeProject.id)}
                  >
                    <BookOpenText aria-hidden="true" size={14} /> Library
                  </DropdownMenuItem>
                ) : null}
                {activeProject.views_enabled ? (
                  <>
                    <DropdownMenuItem
                      ariaCurrent={
                        surface === 'views' && !activeViewId
                          ? 'page'
                          : undefined
                      }
                      onClick={() => onOpenViews(activeProject.id)}
                    >
                      <Bookmark aria-hidden="true" size={14} /> Views
                    </DropdownMenuItem>
                    {projectViews.length > 0 ? (
                      <>
                        <DropdownMenuSeparator />
                        <div
                          className="navigation-rail-menu-subheading"
                          role="presentation"
                        >
                          Saved
                        </div>
                        {projectViews.map((view) => (
                          <DropdownMenuItem
                            key={view.id}
                            ariaCurrent={
                              activeViewId === view.id ? 'page' : undefined
                            }
                            onClick={() => onOpenSavedView(view)}
                          >
                            <Bookmark aria-hidden="true" size={13} />
                            <span>{view.name}</span>
                            {view.visibility === 'shared' ? (
                              <small className="nav-suffix">Shared</small>
                            ) : null}
                          </DropdownMenuItem>
                        ))}
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </DropdownMenu>
        ) : null}
      </div>
    </nav>
  );
}

type RailMenu = 'saved-views' | 'projects' | 'active-project';

interface NavButtonProps {
  active?: boolean;
  ariaControls?: string;
  ariaExpanded?: boolean;
  ariaHasPopup?: AriaAttributes['aria-haspopup'];
  buttonRef?: RefObject<HTMLButtonElement | null>;
  icon: ReactNode;
  label: string;
  rail?: boolean;
  suffix?: string;
  onClick: () => void;
}

function NavButton({
  active = false,
  ariaControls,
  ariaExpanded,
  ariaHasPopup,
  buttonRef,
  icon,
  label,
  rail = false,
  suffix,
  onClick,
}: NavButtonProps) {
  if (rail) {
    return (
      <Tooltip
        label={label}
        placement="right"
        trigger={
          <button
            ref={buttonRef}
            className="navigation-rail-button"
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-controls={ariaControls}
            aria-expanded={ariaExpanded}
            aria-haspopup={ariaHasPopup}
            aria-label={label}
            onClick={onClick}
          >
            {icon}
          </button>
        }
      />
    );
  }

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
