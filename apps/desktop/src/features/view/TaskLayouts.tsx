import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Fragment,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react';
import { Checkbox } from '../../components/ui/Checkbox';
import { IconButton } from '../../components/ui/IconButton';
import { Select } from '../../components/ui/Select';
import {
  MultiValuePicker,
  TaskDateControl,
} from '../task/TaskPropertyControls';
import {
  TASK_PRIORITY_OPTIONS,
  priorityLabel,
  selectableStates,
} from '../task/taskPropertyModel';
import { TaskPropertyIcon } from '../task/TaskPropertyIcon';
import { TASK_PROPERTY_PRESENTATION } from '../task/taskPropertyPresentation';
import { useTaskPropertyEditing } from '../task/useTaskPropertyEditing';
import type {
  Project,
  Task,
  TaskPatch,
  TaskPriority,
  TaskState,
} from '../workspace/types';
import type { TaskGroupField, TaskLayout, TaskQuery } from './types';
import {
  buildTaskGroups,
  buildTaskGroupTree,
  type TaskGroup,
  type TaskGroupBranch,
} from './grouping';

interface TaskLayoutsProps {
  layout: Exclude<TaskLayout, 'list'>;
  query: TaskQuery;
  tasks: Task[];
  projects: Project[];
  states: TaskState[];
  members: { user_id: string; display_name: string }[];
  selectedTaskId: string | null;
  checkedTaskIds: Set<string>;
  canEditTask: (task: Task) => boolean;
  onSelectTask: (taskId: string) => void;
  onToggleChecked: (taskId: string) => void;
  onPatchTask: (taskId: string, patch: TaskPatch) => Promise<void>;
}

export function TaskLayouts(props: TaskLayoutsProps) {
  switch (props.layout) {
    case 'board':
      return <TaskBoard {...props} />;
    case 'calendar':
      return <TaskCalendar {...props} />;
    case 'table':
      return <TaskTable {...props} />;
    case 'timeline':
      return <TaskTimeline {...props} />;
  }
}

function TaskBoard({
  query,
  tasks,
  projects,
  states,
  selectedTaskId,
  canEditTask,
  onSelectTask,
  onPatchTask,
}: TaskLayoutsProps) {
  const field = query.grouping.primary ?? 'state_group';
  const groups = buildTaskGroups(field, tasks, projects, states);

  async function dropTask(event: DragEvent, group: TaskGroup) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kanleaf-task');
    const task = tasks.find(({ id }) => id === taskId);
    if (!task || !canEditTask(task)) return;
    const patch = boardDropPatch(field, group.id, states);
    if (patch) await onPatchTask(taskId, patch);
  }

  return (
    <div className="task-board" aria-label={`Board grouped by ${field}`}>
      {groups.map((group) => {
        const groupedTasks = tasks.filter((task) => group.taskIds.has(task.id));
        const secondaryGroups = query.grouping.secondary
          ? buildTaskGroups(
              query.grouping.secondary,
              groupedTasks,
              projects,
              states,
            ).filter(({ taskIds }) => taskIds.size > 0)
          : [];
        return (
          <section
            className="board-column"
            key={group.id}
            onDragOver={(event) => {
              if (boardDropPatch(field, group.id, states)) {
                event.preventDefault();
              }
            }}
            onDrop={(event) => void dropTask(event, group)}
          >
            <header>
              {group.color && (
                <span
                  style={{ '--group-color': group.color } as CSSProperties}
                />
              )}
              <h2>{group.label}</h2>
              <small>{groupedTasks.length}</small>
            </header>
            <div className="board-column-list">
              {secondaryGroups.length > 0
                ? secondaryGroups.map((secondary) => (
                    <section className="board-subgroup" key={secondary.id}>
                      <h3>{secondary.label}</h3>
                      {groupedTasks
                        .filter((task) => secondary.taskIds.has(task.id))
                        .map((task) => (
                          <BoardTaskButton
                            key={task.id}
                            task={task}
                            selected={task.id === selectedTaskId}
                            draggable={canEditTask(task)}
                            onSelect={() => onSelectTask(task.id)}
                          />
                        ))}
                    </section>
                  ))
                : groupedTasks.map((task) => (
                    <BoardTaskButton
                      key={task.id}
                      task={task}
                      selected={task.id === selectedTaskId}
                      draggable={canEditTask(task)}
                      onSelect={() => onSelectTask(task.id)}
                    />
                  ))}
              {groupedTasks.length === 0 && <p>Drop tasks here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardTaskButton({
  task,
  selected,
  draggable,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  draggable: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="board-task"
      data-selected={selected || undefined}
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/kanleaf-task', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onSelect}
    >
      <span>{task.title}</span>
      <small>
        {task.reference}
        {task.priority !== 'none' && ` · ${task.priority}`}
        {task.due_date && ` · ${formatShortDate(task.due_date)}`}
      </small>
    </button>
  );
}

function TaskCalendar({
  tasks,
  selectedTaskId,
  canEditTask,
  onSelectTask,
  onPatchTask,
}: TaskLayoutsProps) {
  const firstScheduled = tasks.find(({ due_date }) => due_date)?.due_date;
  const [anchor, setAnchor] = useState(() =>
    firstScheduled ? parseDate(firstScheduled) : startOfDay(new Date()),
  );
  const days = useMemo(() => calendarDays(anchor), [anchor]);
  const unscheduled = tasks.filter(({ due_date }) => !due_date);

  async function dropOnDate(event: DragEvent, dueDate: string | null) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kanleaf-task');
    const task = tasks.find(({ id }) => id === taskId);
    if (task && canEditTask(task)) {
      await onPatchTask(task.id, { due_date: dueDate });
    }
  }

  return (
    <div className="task-calendar">
      <header className="calendar-toolbar">
        <IconButton
          variant="ghost"
          size="sm"
          type="button"
          aria-label="Previous month"
          onClick={() => setAnchor(addMonths(anchor, -1))}
        >
          <ChevronLeft aria-hidden="true" size={15} />
        </IconButton>
        <h2>
          {new Intl.DateTimeFormat(undefined, {
            month: 'long',
            year: 'numeric',
          }).format(anchor)}
        </h2>
        <IconButton
          variant="ghost"
          size="sm"
          type="button"
          aria-label="Next month"
          onClick={() => setAnchor(addMonths(anchor, 1))}
        >
          <ChevronRight aria-hidden="true" size={15} />
        </IconButton>
      </header>
      <div className="calendar-weekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid" role="grid" aria-label="Task due dates">
        {days.map((day) => {
          const key = toDateInput(day);
          const dayTasks = tasks.filter(({ due_date }) => due_date === key);
          return (
            <div
              className="calendar-day"
              data-outside={day.getMonth() !== anchor.getMonth() || undefined}
              data-today={isSameDay(day, new Date()) || undefined}
              key={key}
              role="gridcell"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void dropOnDate(event, key)}
            >
              <span>{day.getDate()}</span>
              {dayTasks.map((task) => (
                <CalendarTask
                  key={task.id}
                  task={task}
                  selected={task.id === selectedTaskId}
                  draggable={canEditTask(task)}
                  onSelect={() => onSelectTask(task.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
      {unscheduled.length > 0 && (
        <section
          className="calendar-unscheduled"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void dropOnDate(event, null)}
        >
          <strong>Unscheduled</strong>
          {unscheduled.map((task) => (
            <CalendarTask
              key={task.id}
              task={task}
              selected={task.id === selectedTaskId}
              draggable={canEditTask(task)}
              onSelect={() => onSelectTask(task.id)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function CalendarTask({
  task,
  selected,
  draggable,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  draggable: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="calendar-task"
      data-selected={selected || undefined}
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/kanleaf-task', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onSelect}
    >
      <span
        style={{ '--task-state-color': task.state.color } as CSSProperties}
      />
      {task.title}
    </button>
  );
}

function TaskTable({
  query,
  tasks,
  projects,
  states,
  members,
  selectedTaskId,
  checkedTaskIds,
  canEditTask,
  onSelectTask,
  onToggleChecked,
  onPatchTask,
}: TaskLayoutsProps) {
  const show = (property: string) => query.display.includes(property as never);
  const groupedTasks = query.grouping.primary
    ? buildTaskGroupTree(
        query.grouping.primary,
        query.grouping.secondary,
        tasks,
        projects,
        states,
      )
    : [];
  const columnCount = query.display.length + 2;

  function renderRows(rows: Task[], keyPrefix = '') {
    return rows.map((task) => (
      <TaskTableRow
        key={`${keyPrefix}${task.id}`}
        task={task}
        projects={projects}
        states={states}
        members={members}
        show={show}
        selected={task.id === selectedTaskId}
        checked={checkedTaskIds.has(task.id)}
        editable={canEditTask(task)}
        onSelect={() => onSelectTask(task.id)}
        onToggleChecked={() => onToggleChecked(task.id)}
        onPatch={(patch) => onPatchTask(task.id, patch)}
      />
    ));
  }

  function renderGroup(branch: TaskGroupBranch) {
    return (
      <Fragment key={branch.group.id}>
        <TaskTableGroupRow
          branch={branch}
          columnCount={columnCount}
          secondary={false}
        />
        {branch.secondary.length > 0
          ? branch.secondary.flatMap((secondary) => [
              <TaskTableGroupRow
                key={`heading-${secondary.group.id}`}
                branch={secondary}
                columnCount={columnCount}
                secondary
              />,
              ...renderRows(secondary.tasks, `${secondary.group.id}:`),
            ])
          : renderRows(branch.tasks)}
      </Fragment>
    );
  }

  return (
    <div className="task-table-wrap">
      <table className="task-table" aria-label="Tasks">
        <thead>
          <tr>
            <th aria-label="Select" />
            <th>Task</th>
            {show('state') && <TaskTablePropertyHeading propertyKey="state" />}
            {show('task_type') && <th>Type</th>}
            {show('priority') && (
              <TaskTablePropertyHeading propertyKey="priority" />
            )}
            {show('project') && <th>Project</th>}
            {show('assignees') && (
              <TaskTablePropertyHeading propertyKey="assignees" />
            )}
            {show('labels') && <th>Labels</th>}
            {show('cycle') && <th>Cycle</th>}
            {show('modules') && <th>Modules</th>}
            {show('start_date') && <th>Start</th>}
            {show('due_date') && (
              <TaskTablePropertyHeading propertyKey="due-date" />
            )}
            {show('estimate') && <th>Estimate</th>}
            {show('updated_at') && <th>Updated</th>}
          </tr>
        </thead>
        <tbody>
          {groupedTasks.length > 0
            ? groupedTasks.map(renderGroup)
            : renderRows(tasks)}
        </tbody>
      </table>
    </div>
  );
}

function TaskTablePropertyHeading({
  propertyKey,
}: {
  propertyKey: 'state' | 'priority' | 'assignees' | 'due-date';
}) {
  const label = TASK_PROPERTY_PRESENTATION[propertyKey].label;
  return (
    <th className={`task-table-heading task-table-heading-${propertyKey}`}>
      <TaskPropertyIcon propertyKey={propertyKey} size={13} />
      <span>{label}</span>
    </th>
  );
}

function TaskTableGroupRow({
  branch,
  columnCount,
  secondary,
}: {
  branch: TaskGroupBranch;
  columnCount: number;
  secondary: boolean;
}) {
  return (
    <tr
      className={secondary ? 'task-table-subgroup-row' : 'task-table-group-row'}
    >
      <th
        aria-label={`${branch.group.label}, ${taskCountLabel(branch.tasks.length)}`}
        colSpan={columnCount}
        scope="rowgroup"
      >
        {branch.group.color ? (
          <span
            className="task-table-group-color"
            style={{ '--group-color': branch.group.color } as CSSProperties}
          />
        ) : null}
        <strong>{branch.group.label}</strong>
        <span>{branch.tasks.length}</span>
      </th>
    </tr>
  );
}

function TaskTableRow({
  task,
  projects,
  states,
  members,
  show,
  selected,
  checked,
  editable,
  onSelect,
  onToggleChecked,
  onPatch,
}: {
  task: Task;
  projects: Project[];
  states: TaskState[];
  members: { user_id: string; display_name: string }[];
  show: (property: string) => boolean;
  selected: boolean;
  checked: boolean;
  editable: boolean;
  onSelect: () => void;
  onToggleChecked: () => void;
  onPatch: (patch: TaskPatch) => Promise<void>;
}) {
  const editing = useTaskPropertyEditing(editable, onPatch);
  const assigneeOptions = [
    ...task.assignees
      .filter(
        (assignee) =>
          !members.some(({ user_id }) => user_id === assignee.user_id),
      )
      .map((assignee) => ({
        id: assignee.user_id,
        label: assignee.display_name,
      })),
    ...members.map((member) => ({
      id: member.user_id,
      label: member.display_name,
    })),
  ];

  return (
    <tr data-selected={selected || undefined}>
      <td className="task-table-select-cell">
        <Checkbox
          aria-label={`Select ${task.title}`}
          checked={checked}
          onCheckedChange={onToggleChecked}
        />
      </td>
      <th scope="row" className="task-table-task-cell">
        <button type="button" onClick={onSelect}>
          <span>{task.title}</span>
          <small>{task.reference}</small>
        </button>
        {editing.error ? (
          <small className="task-table-edit-error" role="alert">
            {editing.error.message}
          </small>
        ) : null}
      </th>
      {show('state') && (
        <td className="task-table-state-cell">
          {editable ? (
            <Select
              className="task-table-property-control"
              ariaLabel={`${task.title} state`}
              value={task.state.id}
              disabled={editing.disabled('state')}
              options={selectableStates(states, task).map((state) => ({
                value: state.id,
                label: state.name,
              }))}
              onValueChange={(value) =>
                void editing.patchProperty('state', { state_id: value })
              }
            />
          ) : (
            task.state.name
          )}
        </td>
      )}
      {show('task_type') && <td>{task.task_type.name}</td>}
      {show('priority') && (
        <td className="task-table-priority-cell">
          {editable ? (
            <Select
              className="task-table-property-control"
              ariaLabel={`${task.title} priority`}
              value={task.priority}
              disabled={editing.disabled('priority')}
              options={[...TASK_PRIORITY_OPTIONS]}
              onValueChange={(value) =>
                void editing.patchProperty('priority', {
                  priority: value as TaskPriority,
                })
              }
            />
          ) : (
            priorityLabel(task.priority)
          )}
        </td>
      )}
      {show('project') && (
        <td>
          {projects.find(({ id }) => id === task.project_id)?.name ?? 'Inbox'}
        </td>
      )}
      {show('assignees') && (
        <td className="task-table-assignees-cell">
          <MultiValuePicker
            className="task-table-property-control"
            label={`Edit ${task.title} assignees`}
            emptyLabel="—"
            readOnly={!editable}
            saving={editing.savingProperties.has('assignees')}
            values={task.assignees.map(({ user_id }) => user_id)}
            options={assigneeOptions}
            onChange={async (assigneeIds) => {
              await editing.patchProperty('assignees', {
                assignee_ids: assigneeIds,
              });
            }}
          />
        </td>
      )}
      {show('labels') && (
        <td>{task.labels.map(({ name }) => name).join(', ') || '—'}</td>
      )}
      {show('cycle') && <td>{task.cycle?.name ?? '—'}</td>}
      {show('modules') && (
        <td>{task.modules.map(({ name }) => name).join(', ') || '—'}</td>
      )}
      {show('start_date') && <td>{task.start_date ?? '—'}</td>}
      {show('due_date') && (
        <td className="task-table-due-cell">
          {editable ? (
            <TaskDateControl
              className="task-table-date"
              label={`${task.title} due date`}
              value={task.due_date}
              disabled={editing.disabled('due-date')}
              onChange={(dueDate) =>
                editing.patchProperty('due-date', { due_date: dueDate })
              }
            />
          ) : (
            (task.due_date ?? '—')
          )}
        </td>
      )}
      {show('estimate') && <td>{task.estimate ?? '—'}</td>}
      {show('updated_at') && (
        <td>{formatShortDate(task.updated_at.slice(0, 10))}</td>
      )}
    </tr>
  );
}

function TaskTimeline({
  tasks,
  selectedTaskId,
  canEditTask,
  onSelectTask,
  onPatchTask,
}: TaskLayoutsProps) {
  const anchor = useMemo(() => timelineAnchor(tasks), [tasks]);
  const days = useMemo(
    () => Array.from({ length: 21 }, (_, index) => addDays(anchor, index)),
    [anchor],
  );
  const unscheduled = tasks.filter(
    (task) => !task.start_date && !task.due_date,
  );

  async function moveTask(event: DragEvent, date: Date) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/kanleaf-task');
    const mode = event.dataTransfer.getData('text/kanleaf-timeline-mode');
    const task = tasks.find(({ id }) => id === taskId);
    if (!task || !canEditTask(task)) return;
    if (mode === 'start') {
      await onPatchTask(task.id, { start_date: toDateInput(date) });
      return;
    }
    if (mode === 'end') {
      await onPatchTask(task.id, { due_date: toDateInput(date) });
      return;
    }
    const duration = taskDuration(task);
    const start = toDateInput(date);
    await onPatchTask(task.id, {
      start_date: task.start_date ? start : null,
      due_date: toDateInput(addDays(date, duration)),
    });
  }

  return (
    <div className="task-timeline">
      <div className="timeline-header timeline-task-heading">Task</div>
      <div className="timeline-dates">
        {days.map((day) => (
          <span
            data-today={isSameDay(day, new Date()) || undefined}
            key={toDateInput(day)}
          >
            {day.getDate()}
            <small>
              {day.toLocaleDateString(undefined, { weekday: 'short' })}
            </small>
          </span>
        ))}
      </div>
      {tasks
        .filter((task) => task.start_date || task.due_date)
        .map((task) => {
          const range = timelineRange(task, anchor, days.length);
          return (
            <div className="timeline-row" key={task.id}>
              <button
                className="timeline-task-name"
                data-selected={task.id === selectedTaskId || undefined}
                type="button"
                onClick={() => onSelectTask(task.id)}
              >
                <span>{task.title}</span>
                <small>{task.reference}</small>
              </button>
              <div className="timeline-track">
                {days.map((day) => (
                  <span
                    key={toDateInput(day)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => void moveTask(event, day)}
                  />
                ))}
                <div
                  className="timeline-bar"
                  style={
                    {
                      '--timeline-start': range.start,
                      '--timeline-span': range.span,
                      '--task-state-color': task.state.color,
                    } as CSSProperties
                  }
                >
                  {canEditTask(task) && (
                    <button
                      className="timeline-resize-handle timeline-resize-start"
                      type="button"
                      draggable
                      aria-label={`Resize ${task.title} start`}
                      title="Drag to change the start date; click to extend one day"
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          'text/kanleaf-task',
                          task.id,
                        );
                        event.dataTransfer.setData(
                          'text/kanleaf-timeline-mode',
                          'start',
                        );
                      }}
                      onClick={() => {
                        const start = parseDate(
                          task.start_date ?? task.due_date!,
                        );
                        void onPatchTask(task.id, {
                          start_date: toDateInput(addDays(start, -1)),
                        });
                      }}
                    />
                  )}
                  <button
                    className="timeline-bar-main"
                    type="button"
                    draggable={canEditTask(task)}
                    title="Drag to move this schedule"
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/kanleaf-task', task.id);
                      event.dataTransfer.setData(
                        'text/kanleaf-timeline-mode',
                        'move',
                      );
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onSelectTask(task.id)}
                  >
                    {task.title}
                  </button>
                  {canEditTask(task) && (
                    <button
                      className="timeline-resize-handle timeline-resize-end"
                      type="button"
                      draggable
                      aria-label={`Resize ${task.title} end`}
                      title="Drag to change the due date; click to extend one day"
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          'text/kanleaf-task',
                          task.id,
                        );
                        event.dataTransfer.setData(
                          'text/kanleaf-timeline-mode',
                          'end',
                        );
                      }}
                      onClick={() => {
                        const end = parseDate(
                          task.due_date ?? task.start_date!,
                        );
                        void onPatchTask(task.id, {
                          due_date: toDateInput(addDays(end, 1)),
                        });
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      {unscheduled.length > 0 && (
        <section className="timeline-unscheduled">
          <CalendarDays aria-hidden="true" size={14} />
          <strong>Unscheduled</strong>
          {unscheduled.map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onSelectTask(task.id)}
            >
              {task.title}
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function boardDropPatch(
  field: TaskGroupField,
  id: string,
  states: TaskState[],
): TaskPatch | null {
  if (field === 'state') return { state_id: id };
  if (field === 'state_group') {
    const state = states.find(
      ({ archived_at, state_group }) => !archived_at && state_group === id,
    );
    return state ? { state_id: state.id } : null;
  }
  if (field === 'priority') return { priority: id as TaskPriority };
  if (field === 'project') return { project_id: id === 'none' ? null : id };
  return null;
}

function calendarDays(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function timelineAnchor(tasks: Task[]) {
  const dates = tasks
    .flatMap((task) => [task.start_date, task.due_date])
    .filter(Boolean) as string[];
  const earliest = dates.sort()[0];
  return addDays(earliest ? parseDate(earliest) : startOfDay(new Date()), -3);
}

function timelineRange(task: Task, anchor: Date, length: number) {
  const start = parseDate(task.start_date ?? task.due_date!);
  const due = parseDate(task.due_date ?? task.start_date!);
  const rawStart = dayDifference(anchor, start) + 1;
  const rawEnd = dayDifference(anchor, due) + 2;
  const clippedStart = Math.max(1, Math.min(length, rawStart));
  const clippedEnd = Math.max(clippedStart + 1, Math.min(length + 1, rawEnd));
  return { start: clippedStart, span: clippedEnd - clippedStart };
}

function taskDuration(task: Task) {
  if (!task.start_date || !task.due_date) return 0;
  return Math.max(
    0,
    dayDifference(parseDate(task.start_date), parseDate(task.due_date)),
  );
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, amount: number) {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate() + amount,
  );
}

function addMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function dayDifference(from: Date, to: Date) {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  );
}

function isSameDay(first: Date, second: Date) {
  return toDateInput(first) === toDateInput(second);
}

function toDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(parseDate(value));
}

function taskCountLabel(count: number) {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}
