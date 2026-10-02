import { CalendarDays, FileText } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { errorMessage } from '../settings/utils';
import { PriorityIcon, StateIcon } from '../task/TaskValueIcon';
import { priorityLabel } from '../task/taskPropertyModel';
import type { Project, Workspace } from '../workspace/types';
import {
  workspaceContentPath,
  type WorkspaceContentLocation,
} from '../workspace/workspaceLocation';
import type { useHomeData } from './useHomeData';

type HomeData = ReturnType<typeof useHomeData>;
interface ActivityProps {
  data: HomeData;
  workspace: Workspace;
  projects: Project[];
  navigate: (
    event: MouseEvent<HTMLAnchorElement>,
    location: WorkspaceContentLocation,
  ) => void;
}

export function HomeUpcoming({
  data,
  workspace,
  projects,
  navigate,
}: ActivityProps) {
  const allWork: WorkspaceContentLocation = {
    kind: 'my-work',
    workspaceId: workspace.id,
    taskId: null,
  };
  return (
    <section className="home-upcoming" aria-labelledby="home-upcoming-heading">
      <div className="home-section-heading">
        <div className="home-section-title">
          <h2 id="home-upcoming-heading">Upcoming</h2>
          {data.tasksReady && (
            <span
              className="home-section-count"
              aria-label={`${data.summary.upcomingTasks.length} tasks`}
            >
              {data.summary.upcomingTasks.length}
            </span>
          )}
        </div>
        <a
          className="home-see-all"
          href={workspaceContentPath(allWork, workspace.identifier)}
          onClick={(event) => navigate(event, allWork)}
        >
          See all
        </a>
      </div>
      {data.tasksError ? (
        <HomeLoadError
          error={data.tasksError}
          label="Retry tasks"
          onRetry={data.retryTasks}
        />
      ) : !data.tasksReady ? (
        <p className="home-state" role="status">
          Loading tasks…
        </p>
      ) : data.summary.upcomingTasks.length === 0 ? (
        <p className="home-state">No upcoming tasks with a due date.</p>
      ) : (
        <ul className="home-upcoming-list">
          {data.summary.upcomingTasks.map((task) => {
            const location: WorkspaceContentLocation = {
              kind: 'my-work',
              workspaceId: workspace.id,
              taskId: task.id,
            };
            const project = projects.find(
              (project) => project.id === task.project_id,
            );
            const dueDate = new Date(`${task.due_date}T00:00:00`);
            const localToday = new Date(
              data.now.getFullYear(),
              data.now.getMonth(),
              data.now.getDate(),
            );
            const overdue = dueDate < localToday;
            const fullDate = dueDate.toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            });
            return (
              <li key={task.id}>
                <a
                  href={workspaceContentPath(
                    location,
                    workspace.identifier,
                    undefined,
                    () => String(task.task_number),
                  )}
                  onClick={(event) => navigate(event, location)}
                >
                  <span
                    className="home-task-state"
                    aria-label={`State: ${task.state.name}`}
                    style={{ color: task.state.color }}
                  >
                    <StateIcon role={task.state.system_role} size={16} />
                  </span>
                  <span className="home-task-copy">
                    <strong>{task.title}</strong>
                    <small>
                      {task.reference} · {project?.name ?? 'Inbox'}
                    </small>
                  </span>
                  <span
                    className="home-task-priority"
                    aria-label={`Priority: ${task.priority === 'none' ? 'None' : priorityLabel(task.priority)}`}
                  >
                    <PriorityIcon priority={task.priority} size={14} />
                    <span>
                      {task.priority === 'none'
                        ? '—'
                        : priorityLabel(task.priority)}
                    </span>
                  </span>
                  <time
                    className={`home-task-due${overdue ? ' is-overdue' : ''}`}
                    dateTime={task.due_date}
                    aria-label={`${overdue ? 'Overdue' : 'Due'}: ${fullDate}`}
                    title={`${overdue ? 'Overdue · ' : ''}${fullDate}`}
                  >
                    <CalendarDays size={13} aria-hidden="true" />
                    <span>
                      {dueDate.toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        ...(dueDate.getFullYear() !== data.now.getFullYear()
                          ? { year: 'numeric' }
                          : {}),
                      })}
                    </span>
                  </time>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function HomeRecentPages({
  data,
  workspace,
  projects,
  navigate,
}: ActivityProps) {
  return (
    <section aria-labelledby="home-pages-heading">
      <div className="home-section-heading">
        <h2 id="home-pages-heading">Recent pages</h2>
      </div>
      {data.pagesError ? (
        <HomeLoadError
          error={data.pagesError}
          label="Retry recent pages"
          onRetry={data.retryPages}
        />
      ) : !data.pagesReady ? (
        <p className="home-state" role="status">
          Loading recent pages…
        </p>
      ) : data.pages.length === 0 ? (
        <p className="home-state">No pages in this Workspace yet.</p>
      ) : (
        <ul className="home-project-list home-page-list">
          {data.pages.map((page) => {
            const project = projects.find(
              (project) => project.id === page.project_id,
            );
            const location: WorkspaceContentLocation = page.project_id
              ? {
                  kind: 'project-library',
                  workspaceId: workspace.id,
                  projectId: page.project_id,
                  documentId: page.id,
                }
              : {
                  kind: 'workspace-library',
                  workspaceId: workspace.id,
                  documentId: page.id,
                };
            return (
              <li key={page.id}>
                <a
                  href={workspaceContentPath(
                    location,
                    workspace.identifier,
                    () => project?.identifier ?? null,
                    undefined,
                    () => String(page.document_number),
                  )}
                  onClick={(event) => navigate(event, location)}
                >
                  <span className="home-project-icon" aria-hidden="true">
                    <FileText size={16} />
                  </span>
                  <span className="home-project-copy">
                    <strong>{page.title}</strong>
                    {project && <small>{project.name}</small>}
                  </span>
                  <time
                    className="home-page-date"
                    dateTime={page.updated_at}
                    title={new Date(page.updated_at).toLocaleString()}
                  >
                    {new Date(page.updated_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HomeLoadError({
  error,
  label,
  onRetry,
}: {
  error: unknown;
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="home-state">
      <p role="alert">{errorMessage(error)}</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        {label}
      </Button>
    </div>
  );
}
