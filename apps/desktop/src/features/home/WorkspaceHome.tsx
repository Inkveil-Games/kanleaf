import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  FileText,
  FolderKanban,
  Globe,
  Inbox,
  Plus,
  SquareCheck,
  Sun,
} from 'lucide-react';
import { useId, useState, type MouseEvent } from 'react';
import { AppDialog } from '../../components/ui/AppDialog';
import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/DropdownMenu';
import { Input } from '../../components/ui/Input';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { Select } from '../../components/ui/Select';
import { Tooltip } from '../../components/ui/Tooltip';
import { listDocuments } from '../document/api';
import { ProjectIconGlyph } from '../project/ProjectIconGlyph';
import { errorMessage } from '../settings/utils';
import { listProjects, type ApiContext } from '../workspace/api';
import type { Project, Workspace } from '../workspace/types';
import {
  workspaceContentPath,
  type WorkspaceContentLocation,
} from '../workspace/workspaceLocation';
import {
  createQuickLink,
  deleteQuickLink,
  listQuickLinks,
  reorderQuickLinks,
  updateQuickLink,
  type QuickLink,
  type QuickLinkInput,
} from './api';
import './WorkspaceHome.css';
import { HomeRecentPages, HomeUpcoming } from './HomeActivity';
import { useHomeData } from './useHomeData';

interface WorkspaceHomeProps {
  context: ApiContext;
  workspace: Workspace;
  displayName: string;
  userId: string;
  accessSettled: boolean;
  projects: Project[];
  projectsAccessSettled: boolean;
  projectsError: unknown;
  onRetryProjects: () => void;
  onNavigate: (location: WorkspaceContentLocation) => void;
}

export function WorkspaceHome({
  context,
  workspace,
  displayName,
  userId,
  accessSettled,
  projects,
  projectsAccessSettled,
  projectsError,
  onRetryProjects,
  onNavigate,
}: WorkspaceHomeProps) {
  const client = useQueryClient();
  const queryKey = [
    'quick-links',
    context.serverUrl,
    context.token,
    workspace.id,
  ];
  const links = useQuery({
    queryKey,
    queryFn: () => listQuickLinks(context, workspace.id),
    enabled: accessSettled,
    retry: false,
    staleTime: 0,
  });
  const [editing, setEditing] = useState<QuickLink | 'new' | null>(null);
  const [removing, setRemoving] = useState<QuickLink | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';
  const homeData = useHomeData(
    context,
    workspace.id,
    userId,
    accessSettled && projectsAccessSettled && !projectsError,
    workspace.role !== 'guest',
    new Set(
      projects
        .filter(
          (project) =>
            !project.archived_at &&
            project.effective_role &&
            project.pages_enabled,
        )
        .map((project) => project.id),
    ),
  );
  const activity =
    accessSettled && projectsError
      ? {
          ...homeData,
          tasksError: new Error(errorMessage(projectsError)),
          pagesError: new Error(errorMessage(projectsError)),
          retryTasks: onRetryProjects,
          retryPages: onRetryProjects,
        }
      : homeData;
  const { now } = activity;
  const greeting =
    now.getHours() < 12
      ? 'Good morning'
      : now.getHours() < 18
        ? 'Good afternoon'
        : 'Good evening';
  const firstName = displayName.trim().split(/\s+/)[0] || displayName;
  const visibleLinks =
    accessSettled && links.isFetchedAfterMount && !links.error
      ? (links.data ?? [])
      : [];
  const refresh = () => client.invalidateQueries({ queryKey });
  const visibleProjects =
    accessSettled && projectsAccessSettled && !projectsError
      ? projects
          .filter((project) => !project.archived_at)
          .sort(
            (a, b) =>
              b.updated_at.localeCompare(a.updated_at) ||
              a.name.localeCompare(b.name),
          )
      : [];

  async function move(link: QuickLink, direction: -1 | 1) {
    if (ordering || !canManage || !accessSettled) return;
    const ids = visibleLinks.map(({ id }) => id);
    const index = ids.indexOf(link.id);
    const target = ids[index + direction];
    if (!target || index < 0) return;
    ids[index] = target;
    ids[index + direction] = link.id;
    setOrdering(true);
    setActionError(null);
    try {
      await reorderQuickLinks(context, workspace.id, ids);
      await refresh();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setOrdering(false);
    }
  }

  function navigate(
    event: MouseEvent<HTMLAnchorElement>,
    location: WorkspaceContentLocation,
  ) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate(location);
  }

  return (
    <ScrollArea
      className="workspace-home"
      orientation="vertical"
      viewportProps={{ role: 'region', 'aria-label': 'Workspace Home' }}
    >
      <div className="workspace-home-content">
        <header className="home-greeting">
          <div>
            <p className="home-date">
              {now.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            <h1>
              {greeting}, {firstName}
              <span>.</span>
            </h1>
            <p>Pick up where you left off.</p>
          </div>
          <Sun aria-hidden="true" size={24} strokeWidth={1.2} />
        </header>
        {workspace.role !== 'guest' && (
          <nav className="home-work-actions" aria-label="Your work">
            <a
              aria-label="Open My work"
              aria-describedby="home-my-work-summary"
              href={workspaceContentPath(
                { kind: 'my-work', workspaceId: workspace.id, taskId: null },
                workspace.identifier,
              )}
              onClick={(event) =>
                navigate(event, {
                  kind: 'my-work',
                  workspaceId: workspace.id,
                  taskId: null,
                })
              }
            >
              <SquareCheck
                className="home-work-icon"
                size={16}
                aria-hidden="true"
              />
              <span className="home-work-copy">
                <strong>My work</strong>
                <span className="home-work-stats" id="home-my-work-summary">
                  {activity.tasksReady ? (
                    <>
                      <span>
                        <b>{activity.summary.todayTasks.length}</b> due today
                      </span>
                      <span
                        className={
                          activity.summary.overdue ? 'is-overdue' : undefined
                        }
                      >
                        <b>{activity.summary.overdue}</b> overdue
                      </span>
                    </>
                  ) : (
                    <small>
                      {activity.tasksError
                        ? 'Task counts unavailable'
                        : 'Loading tasks…'}
                    </small>
                  )}
                </span>
              </span>
              <ArrowRight
                className="home-work-arrow"
                size={14}
                aria-hidden="true"
              />
            </a>
            <a
              aria-label="Review inbox"
              aria-describedby="home-inbox-summary"
              href={workspaceContentPath(
                { kind: 'inbox', workspaceId: workspace.id, taskId: null },
                workspace.identifier,
              )}
              onClick={(event) =>
                navigate(event, {
                  kind: 'inbox',
                  workspaceId: workspace.id,
                  taskId: null,
                })
              }
            >
              <Inbox className="home-work-icon" size={16} aria-hidden="true" />
              <span className="home-work-copy">
                <strong>Inbox</strong>
                <span className="home-work-stats" id="home-inbox-summary">
                  {activity.tasksReady ? (
                    <span>
                      <b>{activity.summary.inbox}</b> unorganized{' '}
                      {activity.summary.inbox === 1 ? 'task' : 'tasks'}
                    </span>
                  ) : (
                    <small>
                      {activity.tasksError
                        ? 'Task counts unavailable'
                        : 'Loading tasks…'}
                    </small>
                  )}
                </span>
              </span>
              <ArrowRight
                className="home-work-arrow"
                size={14}
                aria-hidden="true"
              />
            </a>
          </nav>
        )}
        <section
          className="home-quick-links"
          aria-labelledby="quick-links-heading"
          aria-busy={links.isFetching || ordering}
        >
          <div className="home-section-heading">
            <h2 id="quick-links-heading">Quick links</h2>
            {canManage && accessSettled && !links.error && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing('new')}
              >
                <Plus size={14} aria-hidden="true" /> Add link
              </Button>
            )}
          </div>
          {!accessSettled || (!links.isFetchedAfterMount && !links.error) ? (
            <p className="home-state" role="status">
              Loading quick links…
            </p>
          ) : links.error ? (
            <div className="home-state">
              <p role="alert">{errorMessage(links.error)}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void links.refetch()}
              >
                Retry quick links
              </Button>
            </div>
          ) : visibleLinks.length === 0 ? (
            <p className="home-state">
              {canManage
                ? 'Add the pages, projects, and websites your Workspace uses most.'
                : 'No quick links have been added to this Workspace yet.'}
            </p>
          ) : (
            <ul className="home-quick-grid">
              {visibleLinks.map((link, index) => {
                const location = quickLinkLocation(link, workspace.id);
                const externalUrl =
                  link.kind === 'external' ? httpUrl(link.url) : null;
                const href =
                  externalUrl?.href ??
                  (location
                    ? workspaceContentPath(
                        location,
                        workspace.identifier,
                        () => link.project_identifier,
                        undefined,
                        () => link.document_number?.toString() ?? null,
                      )
                    : null);
                const content = (
                  <>
                    <QuickLinkIcon key={link.url ?? link.kind} link={link} />
                    <span className="home-quick-copy">
                      <strong>{link.title}</strong>
                      <small>
                        {!link.available
                          ? 'Unavailable'
                          : externalUrl
                            ? externalUrl.hostname
                            : link.kind === 'page'
                              ? 'Page'
                              : 'Project'}
                      </small>
                    </span>
                    {externalUrl && (
                      <ArrowUpRight
                        className="home-quick-arrow"
                        size={13}
                        aria-hidden="true"
                      />
                    )}
                  </>
                );
                return (
                  <li key={link.id} className="home-quick-tile">
                    {link.available && href ? (
                      <a
                        className="home-quick-link"
                        href={href}
                        target={externalUrl ? '_blank' : undefined}
                        rel={externalUrl ? 'noopener noreferrer' : undefined}
                        aria-label={
                          externalUrl
                            ? `${link.title} (opens in a new tab)`
                            : link.title
                        }
                        onClick={(event) => {
                          if (location) navigate(event, location);
                        }}
                      >
                        {content}
                      </a>
                    ) : (
                      <div
                        className="home-quick-link is-unavailable"
                        aria-disabled="true"
                      >
                        {content}
                      </div>
                    )}
                    {canManage && (
                      <div className="home-quick-actions">
                        <DropdownMenu
                          label={`Manage ${link.title}`}
                          disabled={ordering}
                        >
                          <DropdownMenuItem onClick={() => setEditing(link)}>
                            Edit link
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={index === 0}
                            onClick={() => void move(link, -1)}
                          >
                            Move left
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={index === visibleLinks.length - 1}
                            onClick={() => void move(link, 1)}
                          >
                            Move right
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setRemoving(link)}>
                            Remove link
                          </DropdownMenuItem>
                        </DropdownMenu>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {actionError && (
            <p role="alert" className="home-action-error">
              {actionError}
            </p>
          )}
        </section>
        {workspace.role !== 'guest' && (
          <HomeUpcoming
            data={activity}
            workspace={workspace}
            projects={visibleProjects}
            navigate={navigate}
          />
        )}
        <div className="home-secondary-grid">
          <section aria-labelledby="home-projects-heading">
            <div className="home-section-heading">
              <h2 id="home-projects-heading">Projects</h2>
            </div>
            {!accessSettled ? (
              <p className="home-state" role="status">
                Loading projects…
              </p>
            ) : projectsError ? (
              <div className="home-state">
                <p role="alert">{errorMessage(projectsError)}</p>
                <Button variant="secondary" size="sm" onClick={onRetryProjects}>
                  Retry projects
                </Button>
              </div>
            ) : !projectsAccessSettled ? (
              <p className="home-state" role="status">
                Loading projects…
              </p>
            ) : visibleProjects.length === 0 ? (
              <p className="home-state">
                No active projects in this Workspace yet.
              </p>
            ) : (
              <ScrollArea
                className="home-project-scroll"
                orientation="vertical"
                viewportProps={{
                  className: 'home-project-viewport',
                  role: 'region',
                  'aria-label': 'Project list',
                }}
              >
                <ul className="home-project-list">
                  {visibleProjects.map((project) => {
                    const location: WorkspaceContentLocation = {
                      kind: 'project-overview',
                      workspaceId: workspace.id,
                      projectId: project.id,
                    };
                    return (
                      <li key={project.id}>
                        <Tooltip
                          label={project.description}
                          disabled={!project.description}
                          placement="top"
                          trigger={
                            <a
                              href={workspaceContentPath(
                                location,
                                workspace.identifier,
                                () => project.identifier,
                              )}
                              onClick={(event) => navigate(event, location)}
                            >
                              <span
                                className="home-project-icon"
                                aria-hidden="true"
                              >
                                <ProjectIconGlyph
                                  name={project.icon}
                                  size={16}
                                />
                              </span>
                              <span className="home-project-copy">
                                <strong>{project.name}</strong>
                              </span>
                              {activity.tasksReady &&
                                project.effective_role && (
                                  <span className="home-project-count">
                                    {activity.summary.openByProject.get(
                                      project.id,
                                    ) ?? 0}{' '}
                                    open
                                  </span>
                                )}
                            </a>
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            )}
          </section>
          <HomeRecentPages
            data={activity}
            workspace={workspace}
            projects={visibleProjects}
            navigate={navigate}
          />
        </div>
      </div>
      {editing && canManage && accessSettled && !links.error && (
        <QuickLinkEditor
          key={editing === 'new' ? 'new' : editing.id}
          context={context}
          workspaceId={workspace.id}
          link={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === 'new')
              await createQuickLink(context, workspace.id, input);
            else
              await updateQuickLink(context, workspace.id, editing.id, input);
            await refresh();
          }}
        />
      )}
      {removing && canManage && accessSettled && !links.error && (
        <AppDialog
          type="confirm"
          open
          title={`Remove ${removing.title}?`}
          description="This removes the shared quick link for everyone in the Workspace. The linked content is kept."
          variant="danger"
          confirmLabel="Remove link"
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
          onConfirm={async () => {
            await deleteQuickLink(context, workspace.id, removing.id);
            await refresh();
          }}
        />
      )}
    </ScrollArea>
  );
}

function QuickLinkIcon({ link }: { link: QuickLink }) {
  const [failed, setFailed] = useState(false);
  const url = link.kind === 'external' ? httpUrl(link.url) : null;
  return (
    <span className={`home-quick-icon is-${link.kind}`} aria-hidden="true">
      {link.kind === 'page' ? (
        <FileText size={17} />
      ) : link.kind === 'project' ? (
        <FolderKanban size={17} />
      ) : url && !failed ? (
        <img
          src={`${url.origin}/favicon.ico`}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Globe size={17} />
      )}
    </span>
  );
}

function httpUrl(value: string | null): URL | null {
  try {
    const url = new URL(value ?? '');
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}
function quickLinkLocation(
  link: QuickLink,
  workspaceId: string,
): WorkspaceContentLocation | null {
  if (link.kind === 'project' && link.project_id)
    return {
      kind: 'project-overview',
      workspaceId,
      projectId: link.project_id,
    };
  if (link.kind === 'page' && link.document_id)
    return link.project_id
      ? {
          kind: 'project-library',
          workspaceId,
          projectId: link.project_id,
          documentId: link.document_id,
        }
      : {
          kind: 'workspace-library',
          workspaceId,
          documentId: link.document_id,
        };
  return null;
}

interface QuickLinkEditorProps {
  context: ApiContext;
  workspaceId: string;
  link: QuickLink | null;
  onClose: () => void;
  onSave: (input: QuickLinkInput) => Promise<void>;
}
function QuickLinkEditor({
  context,
  workspaceId,
  link,
  onClose,
  onSave,
}: QuickLinkEditorProps) {
  const [kind, setKind] = useState<QuickLink['kind']>(link?.kind ?? 'external');
  const [title, setTitle] = useState(link?.title ?? '');
  const [url, setUrl] = useState(link?.url ?? '');
  const [target, setTarget] = useState(
    link?.document_id ?? link?.project_id ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const projects = useQuery({
    queryKey: [
      'quick-link-projects',
      context.serverUrl,
      context.token,
      workspaceId,
    ],
    queryFn: () => listProjects(context, workspaceId),
    enabled: kind !== 'external',
    retry: false,
    staleTime: 0,
  });
  const documents = useQuery({
    queryKey: [
      'quick-link-pages',
      context.serverUrl,
      context.token,
      workspaceId,
    ],
    queryFn: () => listDocuments(context, workspaceId),
    enabled: kind === 'page',
    retry: false,
    staleTime: 0,
  });
  const targetError =
    kind === 'external'
      ? null
      : (projects.error ?? (kind === 'page' ? documents.error : null));
  const loadingTargets =
    kind !== 'external' &&
    !targetError &&
    (!projects.isFetchedAfterMount ||
      (kind === 'page' && !documents.isFetchedAfterMount));
  const availableProjects = (projects.data ?? []).filter(
    (project) => !project.archived_at && project.effective_role,
  );
  const options =
    kind === 'page'
      ? (documents.data ?? [])
          .filter(
            (page) =>
              !page.archived_at &&
              (!page.project_id ||
                availableProjects.some(
                  (project) =>
                    project.id === page.project_id && project.pages_enabled,
                )),
          )
          .map((page) => ({
            value: page.id,
            label: page.title,
            description: page.project_id
              ? projects.data?.find((project) => project.id === page.project_id)
                  ?.name
              : 'Workspace Library',
          }))
      : availableProjects.map((project) => ({
          value: project.id,
          label: project.name,
          description: project.identifier,
        }));
  const targetValid = options.some((option) => option.value === target);
  async function save() {
    setError(null);
    let input: QuickLinkInput;
    if (kind === 'external') {
      const parsed = httpUrl(url.trim());
      if (!title.trim() || [...title.trim()].length > 120) {
        setError('Enter a title of 1–120 characters.');
        return;
      }
      if (!parsed) {
        setError('Enter an HTTP or HTTPS URL without embedded credentials.');
        return;
      }
      input = { kind, title: title.trim(), url: parsed.href };
    } else {
      if (!targetValid || targetError || loadingTargets) {
        setError(`Choose an available ${kind}.`);
        return;
      }
      input =
        kind === 'page'
          ? { kind, document_id: target }
          : { kind, project_id: target };
    }
    setSaving(true);
    try {
      await onSave(input);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <AppDialog
      type="custom"
      open
      title={link ? 'Edit quick link' : 'Add quick link'}
      description="Shared with people who can access the linked content in this Workspace."
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      formId={formId}
      confirmLabel={link ? 'Save link' : 'Add quick link'}
      loading={saving}
      error={error}
      confirmDisabled={
        loadingTargets ||
        Boolean(targetError) ||
        (kind !== 'external' && !targetValid)
      }
    >
      <form
        id={formId}
        className="quick-link-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          <span>Link type</span>
          <Select
            ariaLabel="Link type"
            value={kind}
            options={[
              { value: 'external', label: 'Website' },
              { value: 'page', label: 'Page' },
              { value: 'project', label: 'Project' },
            ]}
            disabled={saving}
            onValueChange={(value) => {
              if (
                value === 'page' ||
                value === 'project' ||
                value === 'external'
              ) {
                setKind(value);
                setTarget('');
                setError(null);
              }
            }}
          />
        </label>
        {kind === 'external' ? (
          <>
            <label>
              <span>Title</span>
              <Input
                aria-label="Title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={saving}
                autoFocus
              />
            </label>
            <label>
              <span>URL</span>
              <Input
                aria-label="URL"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={saving}
                placeholder="https://example.com"
              />
            </label>
          </>
        ) : loadingTargets ? (
          <p role="status">Loading {kind === 'page' ? 'pages' : 'projects'}…</p>
        ) : targetError ? (
          <div>
            <p role="alert">{errorMessage(targetError)}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void projects.refetch();
                if (kind === 'page') void documents.refetch();
              }}
            >
              Retry targets
            </Button>
          </div>
        ) : (
          <label>
            <span>{kind === 'page' ? 'Page' : 'Project'}</span>
            <Select
              ariaLabel={kind === 'page' ? 'Page' : 'Project'}
              value={targetValid ? target : ''}
              options={[
                {
                  value: '',
                  label: options.length
                    ? `Choose a ${kind}`
                    : `No available ${kind === 'page' ? 'pages' : 'projects'}`,
                  disabled: true,
                },
                ...options,
              ]}
              onValueChange={setTarget}
              disabled={saving || options.length === 0}
            />
          </label>
        )}
      </form>
    </AppDialog>
  );
}
